<?php

namespace App\Services\Purchases;

use App\Domain\Business\BusinessTypes;
use App\Domain\Pricing\Money;
use App\Domain\Pricing\PricingEngine;
use App\Models\Device;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\ProductSerial;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\PurchasePayment;
use App\Models\PurchaseReturn;
use App\Models\PurchaseReturnItem;
use App\Models\Store;
use App\Models\Supplier;
use App\Models\SupplierPayment;
use App\Services\Audit\AuditLogger;
use App\Services\Inventory\InventoryService;
use App\Services\Ledger\LedgerService;
use App\Services\Numbering\NumberingService;
use App\Services\Sync\Exceptions\SyncRejected;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Supplier → Purchase Order → Receive Stock → Purchase Invoice → Payment.
 * Purchase invoices receive stock immediately; purchase orders receive (partially) later.
 */
class PurchaseService
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly InventoryService $inventory,
        private readonly LedgerService $ledger,
        private readonly NumberingService $numbering,
        private readonly AuditLogger $audit,
    ) {}

    /** @return array<string, mixed> */
    private static function rules(): array
    {
        return [
            'store_id' => ['required', 'uuid'],
            'supplier_id' => ['required', 'uuid'],
            'doc_type' => ['required', Rule::in(['order', 'invoice'])],
            'purchase_number' => ['nullable', 'string', 'max:64'],
            'number_status' => ['nullable', Rule::in(['final', 'provisional'])],
            'number_block_id' => ['nullable', 'uuid'],
            'number_sequence' => ['nullable', 'integer'],
            'supplier_invoice_no' => ['nullable', 'string', 'max:64'],
            'purchase_date' => ['required', 'date_format:Y-m-d'],
            'expected_date' => ['nullable', 'date_format:Y-m-d'],
            'supply_type' => ['nullable', Rule::in(['intra', 'inter', 'union_territory', 'none'])],
            'items' => ['required', 'array', 'min:1', 'max:500'],
            'items.*.id' => ['required', 'uuid'],
            'items.*.product_id' => ['required', 'uuid'],
            'items.*.variant_id' => ['nullable', 'uuid'],
            'items.*.name' => ['required', 'string', 'max:200'],
            'items.*.quantity' => ['required', 'numeric', 'gt:0'],
            'items.*.unit_cost' => ['required', 'numeric', 'min:0'],
            'items.*.mrp' => ['nullable', 'numeric', 'min:0'],
            'items.*.selling_price' => ['nullable', 'numeric', 'min:0'],
            'items.*.discount_type' => ['nullable', Rule::in(['percent', 'amount'])],
            'items.*.discount_value' => ['nullable', 'numeric', 'min:0'],
            'items.*.tax_rate_id' => ['nullable', 'uuid'],
            'items.*.tax' => ['nullable', 'array'],
            'items.*.price_includes_tax' => ['boolean'],
            'items.*.batch_id' => ['nullable', 'uuid'],
            'items.*.batch_no' => ['nullable', 'string', 'max:64'],
            'items.*.expiry_date' => ['nullable', 'date_format:Y-m-d'],
            'items.*.mfg_date' => ['nullable', 'date_format:Y-m-d'],
            'items.*.serial_numbers' => ['nullable', 'array'],
            'items.*.serial_numbers.*' => ['string', 'max:64'],
            'items.*.serial_ids' => ['nullable', 'array'],
            'items.*.serial_ids.*' => ['uuid'],
            'items.*.movement_id' => ['nullable', 'uuid'],
            'charges' => ['nullable', 'array'],
            'charges.*.key' => ['required', 'string', 'max:40'],
            'charges.*.name' => ['required', 'string', 'max:80'],
            'charges.*.amount' => ['required', 'numeric', 'min:0'],
            'charges.*.tax' => ['nullable', 'array'],
            'bill_discount_type' => ['nullable', Rule::in(['percent', 'amount'])],
            'bill_discount_value' => ['nullable', 'numeric', 'min:0'],
            'round_off_mode' => ['nullable', Rule::in(['none', '0.05', '0.10', '0.50', '1.00'])],
            'payments' => ['nullable', 'array'],
            'payments.*.id' => ['required', 'uuid'],
            'payments.*.method' => ['required', Rule::in(BusinessTypes::PAYMENT_METHODS)],
            'payments.*.amount' => ['required', 'numeric', 'gt:0'],
            'payments.*.reference' => ['nullable', 'string', 'max:100'],
            'payments.*.occurred_at' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'ledger_ids' => ['nullable', 'array'],
            'ledger_ids.purchase' => ['nullable', 'uuid'],
            'ledger_ids.payment' => ['nullable', 'uuid'],
            'update_prices' => ['boolean'],
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{purchase: Purchase, result: array<string, mixed>}
     */
    public function create(array $payload, string $purchaseId, ?Device $device, string $userId): array
    {
        $existing = Purchase::query()->find($purchaseId);
        if ($existing) {
            return ['purchase' => $existing, 'result' => ['duplicate' => true]];
        }
        if (! $this->tenant->can('purchases.create')) {
            throw SyncRejected::forbidden('purchases.create');
        }
        $validator = Validator::make($payload, self::rules());
        if ($validator->fails()) {
            throw SyncRejected::invalid($validator->errors()->toArray());
        }
        $data = $validator->validated();
        $supplier = Supplier::withTrashed()->find($data['supplier_id']);
        if (! $supplier) {
            throw SyncRejected::dependency('Supplier');
        }
        if (! Store::query()->whereKey($data['store_id'])->exists()) {
            throw SyncRejected::invalid(['store_id' => ['Unknown store.']]);
        }
        $productIds = array_values(array_unique(array_column($data['items'], 'product_id')));
        $products = Product::withTrashed()->whereIn('id', $productIds)->get()->keyBy('id');
        if ($products->count() !== count($productIds)) {
            throw SyncRejected::dependency('Product');
        }
        $decimals = (int) $this->tenant->business()->currency_decimals;
        $pricing = PricingEngine::calculate([
            'lines' => array_map(fn ($i) => [
                'key' => $i['id'], 'quantity' => $i['quantity'], 'unit_price' => $i['unit_cost'],
                'price_includes_tax' => (bool) ($i['price_includes_tax'] ?? false), 'discount_type' => $i['discount_type'] ?? null,
                'discount_value' => $i['discount_value'] ?? null, 'tax' => $i['tax'] ?? null,
            ], $data['items']),
            'bill_discount_type' => $data['bill_discount_type'] ?? null,
            'bill_discount_value' => $data['bill_discount_value'] ?? null,
            'charges' => array_map(fn ($c) => ['key' => $c['key'], 'name' => $c['name'], 'amount' => $c['amount'], 'tax' => $c['tax'] ?? null], $data['charges'] ?? []),
            'supply_type' => $data['supply_type'] ?? 'intra',
            'round_off' => $data['round_off_mode'] ?? 'none',
            'decimals' => $decimals,
        ]);

        $isInvoice = $data['doc_type'] === 'invoice';
        $number = $this->numbering->finalize(
            $isInvoice ? 'purchase' : 'purchase_order', 'purchase', $purchaseId, $data['purchase_number'] ?? null,
            $data['number_status'] ?? null, $data['number_block_id'] ?? null,
            isset($data['number_sequence']) ? (int) $data['number_sequence'] : null, $data['purchase_date'], $device, $data['store_id'],
        );

        $purchase = Purchase::query()->create([
            'id' => $purchaseId,
            'store_id' => $data['store_id'],
            'device_id' => $device?->id,
            'supplier_id' => $supplier->id,
            'supplier_name' => $supplier->name,
            'doc_type' => $data['doc_type'],
            'status' => $isInvoice ? 'received' : 'ordered',
            'purchase_number' => $number['number'],
            'number_status' => 'final',
            'provisional_number' => $number['reassigned'] ? $number['provisional'] : null,
            'supplier_invoice_no' => $data['supplier_invoice_no'] ?? null,
            'purchase_date' => $data['purchase_date'],
            'expected_date' => $data['expected_date'] ?? null,
            'supply_type' => $data['supply_type'] ?? 'intra',
            'bill_discount_type' => $data['bill_discount_type'] ?? null,
            'bill_discount_value' => $data['bill_discount_value'] ?? null,
            'gross_total' => $pricing['gross_total'],
            'discount_total' => $pricing['discount_total'],
            'taxable_total' => $pricing['taxable_total'],
            'tax_total' => $pricing['tax_total'],
            'charges' => array_map(fn ($c, $i) => [
                'key' => $c['key'], 'name' => $c['name'], 'amount' => (float) $c['amount'], 'tax_rate_id' => null, 'tax' => $c['tax'] ?? null,
                'taxable' => $pricing['charges'][$i]['taxable'] ?? 0, 'tax_total' => $pricing['charges'][$i]['tax_total'] ?? 0, 'total' => $pricing['charges'][$i]['total'] ?? 0,
            ], $data['charges'] ?? [], array_keys($data['charges'] ?? [])),
            'charges_total' => $pricing['charges_total'],
            'round_off' => $pricing['round_off'],
            'grand_total' => $pricing['grand_total'],
            'notes' => $data['notes'] ?? null,
            'created_by' => $userId,
            'received_at' => $isInvoice ? now() : null,
        ]);

        foreach (array_values($data['items']) as $index => $row) {
            $line = $pricing['lines'][$index];
            $item = PurchaseItem::query()->create([
                'id' => $row['id'],
                'purchase_id' => $purchase->id,
                'product_id' => $row['product_id'],
                'variant_id' => $row['variant_id'] ?? null,
                'name' => $row['name'],
                'quantity' => $row['quantity'],
                'received_qty' => 0,
                'unit_cost' => $row['unit_cost'],
                'mrp' => $row['mrp'] ?? null,
                'selling_price' => $row['selling_price'] ?? null,
                'discount_type' => $row['discount_type'] ?? null,
                'discount_value' => $row['discount_value'] ?? null,
                'tax_rate_id' => $row['tax_rate_id'] ?? null,
                'tax' => $row['tax'] ?? null,
                'price_includes_tax' => (bool) ($row['price_includes_tax'] ?? false),
                'batch_id' => $row['batch_id'] ?? null,
                'batch_no' => $row['batch_no'] ?? null,
                'expiry_date' => $row['expiry_date'] ?? null,
                'mfg_date' => $row['mfg_date'] ?? null,
                'serial_numbers' => $row['serial_numbers'] ?? [],
                'taxable' => $line['taxable'],
                'tax_total' => $line['tax_total'],
                'total' => $line['total'],
                'sort_order' => $index,
            ]);
            if ($isInvoice) {
                $this->receiveLine($purchase, $item, $products[$row['product_id']], [
                    'quantity' => (float) $row['quantity'],
                    'batch_id' => $row['batch_id'] ?? null,
                    'batch_no' => $row['batch_no'] ?? null,
                    'expiry_date' => $row['expiry_date'] ?? null,
                    'mfg_date' => $row['mfg_date'] ?? null,
                    'serial_numbers' => $row['serial_numbers'] ?? [],
                    'serial_ids' => $row['serial_ids'] ?? [],
                    'movement_id' => $row['movement_id'] ?? null,
                ], $userId, $device, (bool) ($data['update_prices'] ?? true));
            }
        }

        $ledgerIds = $data['ledger_ids'] ?? [];
        if ($isInvoice) {
            $this->ledger->supplier([
                'id' => $ledgerIds['purchase'] ?? null, 'supplier_id' => $supplier->id, 'type' => 'purchase',
                'credit' => $purchase->grand_total, 'reference_type' => 'purchase', 'reference_id' => $purchase->id,
                'reference_no' => $purchase->purchase_number, 'created_by' => $userId, 'device_id' => $device?->id,
            ]);
        }
        $paid = 0;
        foreach ($data['payments'] ?? [] as $p) {
            PurchasePayment::query()->create([
                'id' => $p['id'], 'purchase_id' => $purchase->id, 'method' => $p['method'], 'amount' => $p['amount'],
                'reference' => $p['reference'] ?? null, 'occurred_at' => isset($p['occurred_at']) ? Carbon::parse($p['occurred_at']) : now(),
            ]);
            $paid += Money::toScaled($p['amount'], $decimals);
        }
        if ($paid > 0) {
            $this->ledger->supplier([
                'id' => $ledgerIds['payment'] ?? null, 'supplier_id' => $supplier->id, 'type' => 'purchase_payment',
                'debit' => Money::fromScaled($paid, $decimals), 'reference_type' => 'purchase', 'reference_id' => $purchase->id,
                'reference_no' => $purchase->purchase_number, 'created_by' => $userId, 'device_id' => $device?->id,
            ]);
        }
        $this->refreshPaymentStatus($purchase, $decimals);
        $this->audit->log('PURCHASE_CREATED', 'purchase', $purchase->id, null, ['number' => $purchase->purchase_number, 'total' => $purchase->grand_total, 'doc_type' => $purchase->doc_type], $userId, $device?->id);

        return ['purchase' => $purchase->refresh(), 'result' => ['purchase_number' => $purchase->purchase_number, 'reassigned' => $number['reassigned']]];
    }

    /**
     * Receive (part of) a purchase order.
     *
     * @param  array<string, mixed>  $payload
     */
    public function receive(Purchase $purchase, array $payload, ?Device $device, string $userId): Purchase
    {
        if (! $this->tenant->can('purchases.edit')) {
            throw SyncRejected::forbidden('purchases.edit');
        }
        if ($purchase->status === 'cancelled') {
            throw new SyncRejected('invalid_state', 'This purchase order was cancelled.');
        }
        $validator = Validator::make($payload, [
            'items' => ['required', 'array', 'min:1'],
            'items.*.purchase_item_id' => ['required', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'gt:0'],
            'items.*.batch_id' => ['nullable', 'uuid'],
            'items.*.batch_no' => ['nullable', 'string', 'max:64'],
            'items.*.expiry_date' => ['nullable', 'date_format:Y-m-d'],
            'items.*.mfg_date' => ['nullable', 'date_format:Y-m-d'],
            'items.*.serial_numbers' => ['nullable', 'array'],
            'items.*.serial_numbers.*' => ['string', 'max:64'],
            'items.*.serial_ids' => ['nullable', 'array'],
            'items.*.movement_id' => ['nullable', 'uuid'],
            'ledger_id' => ['nullable', 'uuid'],
        ]);
        if ($validator->fails()) {
            throw SyncRejected::invalid($validator->errors()->toArray());
        }
        $data = $validator->validated();
        $decimals = (int) $this->tenant->business()->currency_decimals;
        $value = 0;
        foreach ($data['items'] as $row) {
            /** @var PurchaseItem|null $item */
            $item = $purchase->items()->whereKey($row['purchase_item_id'])->first();
            if (! $item) {
                throw SyncRejected::invalid(['items' => ['Unknown purchase line.']]);
            }
            $product = Product::withTrashed()->findOrFail($item->product_id);
            $this->receiveLine($purchase, $item, $product, $row + ['serial_numbers' => [], 'serial_ids' => []], $userId, $device, true);
            $qtyScaled = Money::toScaled($row['quantity'], Money::QTY_SCALE);
            $orderedScaled = Money::toScaled($item->quantity, Money::QTY_SCALE);
            $value += $orderedScaled > 0 ? Money::mulDivRound(Money::toScaled($item->total, $decimals), $qtyScaled, $orderedScaled) : 0;
        }
        $purchase->refresh();
        $allReceived = $purchase->items->every(fn (PurchaseItem $i) => (float) $i->received_qty + 0.0005 >= (float) $i->quantity);
        $purchase->status = $allReceived ? 'received' : 'partially_received';
        $purchase->received_at = now();
        $purchase->save();
        $this->ledger->supplier([
            'id' => $data['ledger_id'] ?? null, 'supplier_id' => $purchase->supplier_id, 'type' => 'purchase',
            'credit' => Money::fromScaled($value, $decimals), 'reference_type' => 'purchase', 'reference_id' => $purchase->id,
            'reference_no' => $purchase->purchase_number, 'notes' => 'Goods received', 'created_by' => $userId, 'device_id' => $device?->id,
        ]);
        $this->audit->log('PURCHASE_RECEIVED', 'purchase', $purchase->id, null, ['status' => $purchase->status], $userId, $device?->id);

        return $purchase->refresh();
    }

    /** @param array<string, mixed> $row */
    private function receiveLine(Purchase $purchase, PurchaseItem $item, Product $product, array $row, string $userId, ?Device $device, bool $updatePrices): void
    {
        $qty = (float) $row['quantity'];
        $batchId = $row['batch_id'] ?? null;
        if ($product->track_batch || ! empty($row['batch_no'])) {
            if (! empty($row['batch_no'])) {
                $batch = $batchId ? ProductBatch::withTrashed()->find($batchId) : null;
                $batch ??= ProductBatch::query()
                    ->where('product_id', $product->id)
                    ->where('batch_no', $row['batch_no'])
                    ->when($row['expiry_date'] ?? null, fn ($q, $e) => $q->where('expiry_date', $e))
                    ->first();
                if (! $batch) {
                    $batch = ProductBatch::query()->create([
                        'id' => $batchId,
                        'product_id' => $product->id,
                        'variant_id' => $item->variant_id,
                        'batch_no' => $row['batch_no'],
                        'expiry_date' => $row['expiry_date'] ?? null,
                        'mfg_date' => $row['mfg_date'] ?? null,
                        'mrp' => $item->mrp,
                        'purchase_price' => $item->unit_cost,
                        'selling_price' => $item->selling_price ?? $product->selling_price,
                    ]);
                }
                $batchId = $batch->id;
                if (! $item->batch_id) {
                    $item->batch_id = $batchId;
                }
            }
        }

        $unitCost = Money::toScaled($item->quantity, Money::QTY_SCALE) > 0
            ? Money::round((float) $item->taxable / (float) $item->quantity, 2)
            : (float) $item->unit_cost;
        $this->inventory->move([
            'id' => $row['movement_id'] ?? null,
            'store_id' => $purchase->store_id,
            'product_id' => $product->id,
            'variant_id' => $item->variant_id,
            'batch_id' => $batchId,
            'type' => 'PURCHASE',
            'qty_in' => $qty,
            'unit_cost' => $unitCost,
            'reference_type' => 'purchase',
            'reference_id' => $purchase->id,
            'reference_no' => $purchase->purchase_number,
            'created_by' => $userId,
            'device_id' => $device?->id,
        ]);

        $serialIds = $row['serial_ids'] ?? [];
        foreach (array_values($row['serial_numbers'] ?? []) as $i => $serialNo) {
            $serialNo = trim($serialNo);
            if ($serialNo === '' || ProductSerial::query()->where('serial_no', $serialNo)->exists()) {
                continue;
            }
            ProductSerial::query()->create([
                'id' => $serialIds[$i] ?? null,
                'product_id' => $product->id,
                'variant_id' => $item->variant_id,
                'store_id' => $purchase->store_id,
                'serial_no' => $serialNo,
                'imei1' => preg_match('/^\d{15}$/', $serialNo) ? $serialNo : null,
                'status' => 'in_stock',
                'cost_price' => $item->unit_cost,
                'purchase_id' => $purchase->id,
                'warranty_months' => $product->warranty_months,
            ]);
        }

        $item->received_qty = (float) $item->received_qty + $qty;
        $item->save();

        if ($updatePrices) {
            $changed = false;
            if ((float) $item->unit_cost > 0 && (float) $product->purchase_price !== (float) $item->unit_cost && ! $item->variant_id) {
                $product->purchase_price = $item->unit_cost;
                $changed = true;
            }
            if ($item->mrp && ! $product->track_batch && ! $item->variant_id && (float) $product->mrp !== (float) $item->mrp) {
                $product->mrp = $item->mrp;
                $changed = true;
            }
            if ($changed) {
                $product->save();
            }
        }
    }

    /** @param array<string, string> $movementIds purchase item id → movement id generated on the device */
    public function cancel(Purchase $purchase, string $userId, ?Device $device, array $movementIds = []): Purchase
    {
        if (! $this->tenant->can('purchases.delete')) {
            throw SyncRejected::forbidden('purchases.delete');
        }
        if ($purchase->status === 'cancelled') {
            return $purchase;
        }
        foreach ($purchase->items as $item) {
            $received = (float) $item->received_qty - (float) $item->returned_qty;
            if ($received > 0) {
                $this->inventory->move([
                    'id' => isset($movementIds[$item->id]) && Str::isUuid($movementIds[$item->id]) ? $movementIds[$item->id] : null,
                    'store_id' => $purchase->store_id, 'product_id' => $item->product_id, 'variant_id' => $item->variant_id,
                    'batch_id' => $item->batch_id, 'type' => 'PURCHASE_RETURN', 'qty_out' => $received, 'unit_cost' => $item->unit_cost,
                    'reference_type' => 'purchase_cancel', 'reference_id' => $purchase->id, 'reference_no' => $purchase->purchase_number,
                    'notes' => 'Purchase cancelled', 'created_by' => $userId, 'device_id' => $device?->id,
                ]);
            }
        }
        if ($purchase->status !== 'ordered') {
            $this->ledger->supplier([
                'supplier_id' => $purchase->supplier_id, 'type' => 'adjustment', 'debit' => Money::round((float) $purchase->grand_total - (float) $purchase->returned_total),
                'reference_type' => 'purchase_cancel', 'reference_id' => $purchase->id, 'reference_no' => $purchase->purchase_number,
                'notes' => 'Purchase cancelled', 'created_by' => $userId, 'device_id' => $device?->id,
            ]);
        }
        $purchase->status = 'cancelled';
        $purchase->save();
        $this->numbering->markCancelled('purchase', $purchase->id);
        $this->audit->log('PURCHASE_CANCELLED', 'purchase', $purchase->id, null, null, $userId, $device?->id);

        return $purchase->refresh();
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{return: PurchaseReturn, result: array<string, mixed>}
     */
    public function createReturn(array $payload, string $returnId, ?Device $device, string $userId): array
    {
        $existing = PurchaseReturn::query()->find($returnId);
        if ($existing) {
            return ['return' => $existing, 'result' => ['duplicate' => true]];
        }
        if (! $this->tenant->can('purchases.return')) {
            throw SyncRejected::forbidden('purchases.return');
        }
        $validator = Validator::make($payload, [
            'purchase_id' => ['required', 'uuid'],
            'return_number' => ['nullable', 'string', 'max:64'],
            'number_status' => ['nullable', Rule::in(['final', 'provisional'])],
            'number_block_id' => ['nullable', 'uuid'],
            'number_sequence' => ['nullable', 'integer'],
            'return_date' => ['required', 'date_format:Y-m-d'],
            'occurred_at' => ['required', 'date'],
            'reason' => ['nullable', 'string', 'max:500'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.id' => ['required', 'uuid'],
            'items.*.purchase_item_id' => ['required', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'gt:0'],
            'items.*.movement_id' => ['nullable', 'uuid'],
            'ledger_id' => ['nullable', 'uuid'],
        ]);
        if ($validator->fails()) {
            throw SyncRejected::invalid($validator->errors()->toArray());
        }
        $data = $validator->validated();
        $purchase = Purchase::query()->with('items')->whereKey($data['purchase_id'])->first();
        if (! $purchase) {
            throw SyncRejected::dependency('Purchase');
        }
        $decimals = (int) $this->tenant->business()->currency_decimals;
        $number = $this->numbering->finalize(
            'purchase_return', 'purchase_return', $returnId, $data['return_number'] ?? null, $data['number_status'] ?? null,
            $data['number_block_id'] ?? null, isset($data['number_sequence']) ? (int) $data['number_sequence'] : null,
            $data['return_date'], $device, $purchase->store_id,
        );
        $return = PurchaseReturn::query()->create([
            'id' => $returnId,
            'store_id' => $purchase->store_id,
            'device_id' => $device?->id,
            'purchase_id' => $purchase->id,
            'supplier_id' => $purchase->supplier_id,
            'return_number' => $number['number'],
            'number_status' => 'final',
            'provisional_number' => $number['reassigned'] ? $number['provisional'] : null,
            'return_date' => $data['return_date'],
            'occurred_at' => Carbon::parse($data['occurred_at']),
            'reason' => $data['reason'] ?? null,
            'created_by' => $userId,
        ]);
        $taxable = $total = 0;
        foreach ($data['items'] as $row) {
            /** @var PurchaseItem|null $item */
            $item = $purchase->items->firstWhere('id', $row['purchase_item_id']);
            if (! $item) {
                throw SyncRejected::invalid(['items' => ['Unknown purchase line.']]);
            }
            $ordered = Money::toScaled($item->quantity, Money::QTY_SCALE);
            $qty = Money::toScaled($row['quantity'], Money::QTY_SCALE);
            $lineTaxable = $ordered ? Money::mulDivRound(Money::toScaled($item->taxable, $decimals), $qty, $ordered) : 0;
            $lineTotal = $ordered ? Money::mulDivRound(Money::toScaled($item->total, $decimals), $qty, $ordered) : 0;
            $taxable += $lineTaxable;
            $total += $lineTotal;
            PurchaseReturnItem::query()->create([
                'id' => $row['id'],
                'purchase_return_id' => $return->id,
                'purchase_item_id' => $item->id,
                'product_id' => $item->product_id,
                'variant_id' => $item->variant_id,
                'batch_id' => $item->batch_id,
                'name' => $item->name,
                'quantity' => $row['quantity'],
                'unit_cost' => $item->unit_cost,
                'taxable' => Money::fromScaled($lineTaxable, $decimals),
                'tax_total' => Money::fromScaled($lineTotal - $lineTaxable, $decimals),
                'total' => Money::fromScaled($lineTotal, $decimals),
            ]);
            $item->returned_qty = (float) $item->returned_qty + (float) $row['quantity'];
            $item->save();
            $this->inventory->move([
                'id' => $row['movement_id'] ?? null,
                'store_id' => $purchase->store_id, 'product_id' => $item->product_id, 'variant_id' => $item->variant_id,
                'batch_id' => $item->batch_id, 'type' => 'PURCHASE_RETURN', 'qty_out' => $row['quantity'], 'unit_cost' => $item->unit_cost,
                'reference_type' => 'purchase_return', 'reference_id' => $return->id, 'reference_no' => $return->return_number,
                'created_by' => $userId, 'device_id' => $device?->id, 'occurred_at' => $return->occurred_at,
            ]);
        }
        $return->taxable_total = Money::fromScaled($taxable, $decimals);
        $return->tax_total = Money::fromScaled($total - $taxable, $decimals);
        $return->total = Money::fromScaled($total, $decimals);
        $return->save();
        $purchase->returned_total = Money::round((float) $purchase->returned_total + $return->total, $decimals);
        $purchase->save();
        $this->ledger->supplier([
            'id' => $data['ledger_id'] ?? null, 'supplier_id' => $purchase->supplier_id, 'type' => 'purchase_return', 'debit' => $return->total,
            'reference_type' => 'purchase_return', 'reference_id' => $return->id, 'reference_no' => $return->return_number,
            'created_by' => $userId, 'device_id' => $device?->id, 'occurred_at' => $return->occurred_at,
        ]);
        $this->audit->log('PURCHASE_RETURNED', 'purchase_return', $return->id, null, ['total' => $return->total], $userId, $device?->id);

        return ['return' => $return->refresh(), 'result' => ['return_number' => $return->return_number, 'reassigned' => $number['reassigned']]];
    }

    public function refreshPaymentStatus(Purchase $purchase, int $decimals = 2): void
    {
        $paid = Money::toScaled($purchase->payments()->sum('amount'), $decimals)
            + Money::toScaled(SupplierPayment::query()->where('purchase_id', $purchase->id)->sum('amount'), $decimals);
        $total = Money::toScaled($purchase->grand_total, $decimals);
        $purchase->paid_total = Money::fromScaled(min($paid, $total), $decimals);
        $purchase->balance_due = $purchase->doc_type === 'invoice' || $purchase->status !== 'ordered' ? Money::fromScaled(max($total - $paid, 0), $decimals) : 0;
        $purchase->payment_status = $paid >= $total ? 'paid' : ($paid > 0 ? 'partial' : 'unpaid');
        $purchase->save();
    }
}
