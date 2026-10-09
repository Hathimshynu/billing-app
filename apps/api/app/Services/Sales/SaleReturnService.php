<?php

namespace App\Services\Sales;

use App\Domain\Pricing\Money;
use App\Models\Device;
use App\Models\Product;
use App\Models\ProductSerial;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SaleReturn;
use App\Models\SaleReturnItem;
use App\Services\Audit\AuditLogger;
use App\Services\Inventory\InventoryService;
use App\Services\Ledger\LedgerService;
use App\Services\Notifications\NotificationService;
use App\Services\Numbering\NumberingService;
use App\Services\Sync\Exceptions\SyncRejected;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * Sales returns / credit notes: full, partial and exchange. Restocked items go back to inventory
 * via SALE_RETURN movements; the customer ledger is credited (store credit) or credited and
 * debited (money refunded).
 */
class SaleReturnService
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly InventoryService $inventory,
        private readonly LedgerService $ledger,
        private readonly NumberingService $numbering,
        private readonly AuditLogger $audit,
        private readonly NotificationService $notifications,
    ) {}

    /**
     * @param  array<string, mixed>  $payload
     * @return array{return: SaleReturn, result: array<string, mixed>}
     */
    public function create(array $payload, string $returnId, ?Device $device, string $userId): array
    {
        $existing = SaleReturn::query()->find($returnId);
        if ($existing) {
            return ['return' => $existing, 'result' => ['duplicate' => true, 'return_number' => $existing->return_number]];
        }
        if (! $this->tenant->can('sales.refund')) {
            throw SyncRejected::forbidden('sales.refund');
        }
        $validator = Validator::make($payload, [
            'sale_id' => ['required', 'uuid'],
            'store_id' => ['nullable', 'uuid'],
            'register_id' => ['nullable', 'uuid'],
            'return_number' => ['nullable', 'string', 'max:64'],
            'number_status' => ['nullable', Rule::in(['final', 'provisional'])],
            'number_block_id' => ['nullable', 'uuid'],
            'number_sequence' => ['nullable', 'integer'],
            'return_date' => ['required', 'date_format:Y-m-d'],
            'occurred_at' => ['required', 'date'],
            'refund_method' => ['required', Rule::in(['cash', 'upi', 'card', 'bank_transfer', 'store_credit', 'exchange'])],
            'reason' => ['nullable', 'string', 'max:500'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.id' => ['required', 'uuid'],
            'items.*.sale_item_id' => ['required', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'gt:0'],
            'items.*.restock' => ['boolean'],
            'items.*.serial_ids' => ['nullable', 'array'],
            'items.*.serial_ids.*' => ['uuid'],
            'items.*.movement_id' => ['nullable', 'uuid'],
            'ledger_ids' => ['nullable', 'array'],
            'ledger_ids.return' => ['nullable', 'uuid'],
            'ledger_ids.refund' => ['nullable', 'uuid'],
        ]);
        if ($validator->fails()) {
            throw SyncRejected::invalid($validator->errors()->toArray());
        }
        $data = $validator->validated();
        $sale = Sale::query()->with('items')->whereKey($data['sale_id'])->first();
        if (! $sale) {
            throw SyncRejected::dependency('Original invoice');
        }
        $decimals = (int) $this->tenant->business()->currency_decimals;

        $number = $this->numbering->finalize(
            'sale_return', 'sale_return', $returnId, $data['return_number'] ?? null, $data['number_status'] ?? null,
            $data['number_block_id'] ?? null, isset($data['number_sequence']) ? (int) $data['number_sequence'] : null,
            $data['return_date'], $device, $sale->store_id,
        );
        $occurredAt = Carbon::parse($data['occurred_at']);

        $return = SaleReturn::query()->create([
            'id' => $returnId,
            'store_id' => $data['store_id'] ?? $sale->store_id,
            'device_id' => $device?->id,
            'register_id' => $data['register_id'] ?? null,
            'sale_id' => $sale->id,
            'customer_id' => $sale->customer_id,
            'return_number' => $number['number'],
            'number_status' => 'final',
            'provisional_number' => $number['reassigned'] ? $number['provisional'] : null,
            'return_date' => $data['return_date'],
            'occurred_at' => $occurredAt,
            'refund_method' => $data['refund_method'],
            'reason' => $data['reason'] ?? null,
            'created_by' => $userId,
        ]);

        $taxable = $tax = $total = 0;
        $overReturn = false;
        foreach ($data['items'] as $row) {
            /** @var SaleItem|null $item */
            $item = $sale->items->firstWhere('id', $row['sale_item_id']);
            if (! $item) {
                throw SyncRejected::invalid(['items' => ["Item {$row['sale_item_id']} is not part of invoice {$sale->invoice_number}."]]);
            }
            $qty = (float) $row['quantity'];
            $available = (float) $item->quantity - (float) $item->returned_qty;
            if ($qty > $available + 0.0005) {
                $overReturn = true;
            }
            // Pro-rata amounts from the original line (includes its share of discounts & tax).
            // Integer math, identical to the device (apps/web/src/lib/repos/returns.ts).
            $soldQty = Money::toScaled($item->quantity, Money::QTY_SCALE);
            $retQty = Money::toScaled($qty, Money::QTY_SCALE);
            $taxableScaled = $soldQty !== 0 ? Money::mulDivRound(Money::toScaled($item->taxable, $decimals), $retQty, $soldQty) : 0;
            $totalScaled = $soldQty !== 0 ? Money::mulDivRound(Money::toScaled($item->total, $decimals), $retQty, $soldQty) : 0;
            $lineTaxable = Money::fromScaled($taxableScaled, $decimals);
            $lineTotal = Money::fromScaled($totalScaled, $decimals);
            $lineTax = Money::fromScaled($totalScaled - $taxableScaled, $decimals);
            $taxable += $taxableScaled;
            $tax += $totalScaled - $taxableScaled;
            $total += $totalScaled;
            $restock = (bool) ($row['restock'] ?? true);

            SaleReturnItem::query()->create([
                'id' => $row['id'],
                'sale_return_id' => $return->id,
                'sale_item_id' => $item->id,
                'product_id' => $item->product_id,
                'variant_id' => $item->variant_id,
                'batch_id' => $item->batch_id,
                'serial_ids' => $row['serial_ids'] ?? [],
                'name' => $item->name,
                'quantity' => $qty,
                'unit_price' => $item->unit_price,
                'taxable' => $lineTaxable,
                'tax_total' => $lineTax,
                'total' => $lineTotal,
                'restock' => $restock,
            ]);
            $item->returned_qty = (float) $item->returned_qty + $qty;
            $item->save();

            $product = $item->product_id ? Product::withTrashed()->find($item->product_id) : null;
            if ($restock && $product && $product->track_inventory && $product->product_type !== 'service') {
                $this->inventory->move([
                    'id' => $row['movement_id'] ?? null,
                    'store_id' => $return->store_id,
                    'product_id' => $product->id,
                    'variant_id' => $item->variant_id,
                    'batch_id' => $item->batch_id,
                    'type' => 'SALE_RETURN',
                    'qty_in' => $qty,
                    'unit_cost' => $item->cost_price,
                    'reference_type' => 'sale_return',
                    'reference_id' => $return->id,
                    'reference_no' => $return->return_number,
                    'created_by' => $userId,
                    'device_id' => $device?->id,
                    'occurred_at' => $occurredAt,
                ]);
            }
            foreach ($row['serial_ids'] ?? [] as $serialId) {
                $serial = ProductSerial::query()->find($serialId);
                if ($serial && $serial->sale_id === $sale->id) {
                    $serial->forceFill([
                        'status' => $restock ? 'in_stock' : 'returned',
                        'sale_id' => null,
                        'sale_item_id' => null,
                        'customer_id' => null,
                        'sold_at' => null,
                        'warranty_expires_at' => null,
                    ])->save();
                }
            }
        }

        $return->taxable_total = Money::fromScaled($taxable, $decimals);
        $return->tax_total = Money::fromScaled($tax, $decimals);
        $return->total = Money::fromScaled($total, $decimals);
        $return->save();

        $sale->returned_total = Money::round((float) $sale->returned_total + $return->total, $decimals);
        $sale->save();

        if ($sale->customer_id) {
            $ledgerIds = $data['ledger_ids'] ?? [];
            $common = ['customer_id' => $sale->customer_id, 'reference_type' => 'sale_return', 'reference_id' => $return->id, 'reference_no' => $return->return_number, 'created_by' => $userId, 'device_id' => $device?->id, 'occurred_at' => $occurredAt];
            $this->ledger->customer($common + ['id' => $ledgerIds['return'] ?? null, 'type' => 'sale_return', 'credit' => $return->total]);
            if (! in_array($return->refund_method, ['store_credit', 'exchange'], true)) {
                $this->ledger->customer($common + ['id' => $ledgerIds['refund'] ?? null, 'type' => 'refund', 'debit' => $return->total]);
            }
        }
        if ($overReturn) {
            $flags = $sale->review_flags ?? [];
            $flags[] = 'over_returned';
            $sale->review_flags = array_values(array_unique($flags));
            $sale->save();
            $this->notifications->notify('over_return', "More items returned than sold on {$sale->invoice_number}", "Credit note {$return->return_number} returns more than the remaining quantity.", 'critical', 'sale_return', $return->id);
        }
        $this->audit->log('REFUND', 'sale_return', $return->id, null, [
            'return_number' => $return->return_number,
            'sale' => $sale->invoice_number,
            'total' => $return->total,
            'refund_method' => $return->refund_method,
        ], $userId, $device?->id);

        return ['return' => $return->refresh(), 'result' => ['return_number' => $return->return_number, 'reassigned' => $number['reassigned']]];
    }
}
