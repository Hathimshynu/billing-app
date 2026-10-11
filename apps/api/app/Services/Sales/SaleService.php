<?php

namespace App\Services\Sales;

use App\Domain\Business\BusinessTypes;
use App\Domain\Numbering\DocumentNumberFormatter;
use App\Domain\Pricing\Money;
use App\Domain\Pricing\PricingEngine;
use App\Models\Coupon;
use App\Models\Customer;
use App\Models\Device;
use App\Models\KitchenOrder;
use App\Models\OldGoldPurchase;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\ProductSerial;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SalePayment;
use App\Models\Store;
use App\Models\SyncConflict;
use App\Services\Audit\AuditLogger;
use App\Services\Inventory\InventoryService;
use App\Services\Ledger\LedgerService;
use App\Services\Notifications\NotificationService;
use App\Services\Numbering\NumberingService;
use App\Services\Sync\Exceptions\SyncRejected;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Sales documents. Financial records created offline are never discarded: anomalies (totals that
 * do not re-price identically, credit limit exceeded offline, an IMEI sold twice...) are accepted
 * and flagged for review instead of rejected.
 */
class SaleService
{
    public const STOCK_DOC_TYPES = ['invoice', 'delivery_challan'];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly InventoryService $inventory,
        private readonly LedgerService $ledger,
        private readonly NumberingService $numbering,
        private readonly AuditLogger $audit,
        private readonly NotificationService $notifications,
        private readonly SaleIntegrity $integrity,
    ) {}

    /** @return array<string, mixed> */
    public static function rules(): array
    {
        $methods = BusinessTypes::PAYMENT_METHODS;

        return [
            'store_id' => ['required', 'uuid'],
            'register_id' => ['nullable', 'uuid'],
            'customer_id' => ['nullable', 'uuid'],
            'customer_name' => ['nullable', 'string', 'max:150'],
            'customer_phone' => ['nullable', 'string', 'max:20'],
            'customer_gstin' => ['nullable', 'string', 'max:15'],
            'doc_type' => ['required', Rule::in(array_keys(DocumentNumberFormatter::SALE_DOC_SERIES))],
            'status' => ['nullable', Rule::in(['completed', 'draft'])],
            'invoice_number' => ['nullable', 'string', 'max:64'],
            'number_status' => ['nullable', Rule::in(['final', 'provisional'])],
            'number_block_id' => ['nullable', 'uuid'],
            'number_sequence' => ['nullable', 'integer', 'min:1'],
            'invoice_date' => ['required', 'date_format:Y-m-d'],
            'occurred_at' => ['required', 'date'],
            'due_date' => ['nullable', 'date_format:Y-m-d'],
            'supply_type' => ['nullable', Rule::in(['intra', 'inter', 'union_territory', 'none'])],
            'place_of_supply' => ['nullable', 'string', 'max:4'],
            'order_type' => ['nullable', Rule::in(['retail', 'dine_in', 'takeaway', 'delivery'])],
            'table_id' => ['nullable', 'uuid'],
            'kitchen_order_ids' => ['nullable', 'array'],
            'kitchen_order_ids.*' => ['uuid'],
            'items' => ['required', 'array', 'min:1', 'max:500'],
            'items.*.id' => ['required', 'uuid'],
            'items.*.product_id' => ['nullable', 'uuid'],
            'items.*.variant_id' => ['nullable', 'uuid'],
            'items.*.batch_id' => ['nullable', 'uuid'],
            'items.*.serial_ids' => ['nullable', 'array'],
            'items.*.serial_ids.*' => ['uuid'],
            'items.*.serial_numbers' => ['nullable', 'array'],
            'items.*.serial_numbers.*' => ['string', 'max:64'],
            'items.*.name' => ['required', 'string', 'max:200'],
            'items.*.sku' => ['nullable', 'string', 'max:64'],
            'items.*.hsn_code' => ['nullable', 'string', 'max:10'],
            'items.*.unit_code' => ['nullable', 'string', 'max:16'],
            'items.*.quantity' => ['required', 'numeric', 'not_in:0'],
            'items.*.unit_price' => ['required', 'numeric', 'min:0'],
            'items.*.mrp' => ['nullable', 'numeric', 'min:0'],
            'items.*.cost_price' => ['nullable', 'numeric', 'min:0'],
            'items.*.price_includes_tax' => ['boolean'],
            'items.*.discount_type' => ['nullable', Rule::in(['percent', 'amount'])],
            'items.*.discount_value' => ['nullable', 'numeric', 'min:0'],
            'items.*.tax_rate_id' => ['nullable', 'uuid'],
            'items.*.tax' => ['nullable', 'array'],
            'items.*.tax.id' => ['nullable'],
            'items.*.tax.name' => ['required_with:items.*.tax', 'string', 'max:80'],
            'items.*.tax.kind' => ['required_with:items.*.tax', Rule::in(['gst', 'vat', 'simple', 'custom', 'exempt'])],
            'items.*.tax.rate' => ['required_with:items.*.tax', 'numeric', 'min:0', 'max:100'],
            'items.*.tax.cess_rate' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'items.*.tax.components' => ['nullable', 'array'],
            'items.*.gross' => ['nullable', 'numeric'],
            'items.*.line_discount' => ['nullable', 'numeric'],
            'items.*.bill_discount' => ['nullable', 'numeric'],
            'items.*.taxable' => ['nullable', 'numeric'],
            'items.*.taxes' => ['nullable', 'array'],
            'items.*.tax_total' => ['nullable', 'numeric'],
            'items.*.total' => ['nullable', 'numeric'],
            'items.*.modifiers' => ['nullable', 'array'],
            'items.*.jewellery' => ['nullable', 'array'],
            'items.*.warranty_months' => ['nullable', 'integer', 'min:0', 'max:240'],
            'items.*.kitchen_order_id' => ['nullable', 'uuid'],
            'items.*.notes' => ['nullable', 'string', 'max:500'],
            'items.*.movement_id' => ['nullable', 'uuid'],
            'payments' => ['nullable', 'array', 'max:20'],
            'payments.*.id' => ['required', 'uuid'],
            'payments.*.method' => ['required', Rule::in($methods)],
            'payments.*.amount' => ['required', 'numeric', 'min:0'],
            'payments.*.reference' => ['nullable', 'string', 'max:100'],
            'payments.*.tendered' => ['nullable', 'numeric', 'min:0'],
            'payments.*.change' => ['nullable', 'numeric', 'min:0'],
            'payments.*.old_gold' => ['nullable', 'array'],
            'payments.*.occurred_at' => ['nullable', 'date'],
            'charges' => ['nullable', 'array', 'max:10'],
            'charges.*.key' => ['required', 'string', 'max:40'],
            'charges.*.name' => ['required', 'string', 'max:80'],
            'charges.*.amount' => ['required', 'numeric', 'min:0'],
            'charges.*.tax_rate_id' => ['nullable', 'uuid'],
            'charges.*.tax' => ['nullable', 'array'],
            'charges.*.taxable' => ['nullable', 'numeric'],
            'charges.*.tax_total' => ['nullable', 'numeric'],
            'charges.*.total' => ['nullable', 'numeric'],
            'bill_discount_type' => ['nullable', Rule::in(['percent', 'amount'])],
            'bill_discount_value' => ['nullable', 'numeric', 'min:0'],
            'round_off_mode' => ['nullable', Rule::in(['none', '0.05', '0.10', '0.50', '1.00'])],
            'grand_total' => ['nullable', 'numeric'],
            'coupon_code' => ['nullable', 'string', 'max:32'],
            'loyalty_points_earned' => ['nullable', 'integer', 'min:0'],
            'loyalty_points_redeemed' => ['nullable', 'integer', 'min:0'],
            'converted_from_id' => ['nullable', 'uuid'],
            'valid_until' => ['nullable', 'date_format:Y-m-d'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'ledger_ids' => ['nullable', 'array'],
            'ledger_ids.sale' => ['nullable', 'uuid'],
            'ledger_ids.payment' => ['nullable', 'uuid'],
            'ledger_ids.loyalty_earn' => ['nullable', 'uuid'],
            'ledger_ids.loyalty_redeem' => ['nullable', 'uuid'],
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{sale: Sale, result: array<string, mixed>}
     */
    public function create(array $payload, string $saleId, ?Device $device, string $userId): array
    {
        $existing = Sale::query()->find($saleId);
        if ($existing) {
            return ['sale' => $existing, 'result' => ['duplicate' => true, 'invoice_number' => $existing->invoice_number]];
        }
        if (! $this->tenant->can('sales.create')) {
            throw SyncRejected::forbidden('sales.create');
        }

        $validator = Validator::make($payload, self::rules());
        if ($validator->fails()) {
            throw SyncRejected::invalid($validator->errors()->toArray());
        }
        $data = $validator->validated();
        $business = $this->tenant->business();
        $decimals = (int) $business->currency_decimals;

        $store = Store::query()->find($data['store_id']);
        if (! $store) {
            throw SyncRejected::invalid(['store_id' => ['Unknown store.']]);
        }
        $customer = null;
        if (! empty($data['customer_id'])) {
            $customer = Customer::withTrashed()->find($data['customer_id']);
            if (! $customer) {
                throw SyncRejected::dependency('Customer');
            }
        }
        $productIds = array_values(array_unique(array_filter(array_column($data['items'], 'product_id'))));
        $products = Product::withTrashed()->whereIn('id', $productIds)->get()->keyBy('id');
        if ($products->count() !== count($productIds)) {
            throw SyncRejected::dependency('Product');
        }

        $docType = $data['doc_type'];
        $isInvoice = $docType === 'invoice';
        $status = $isInvoice ? 'completed' : ($data['status'] ?? 'draft');
        $flags = [];

        // Re-price the document with the server engine (identical algorithm to the device).
        $pricing = PricingEngine::calculate([
            'lines' => array_map(fn ($i) => [
                'key' => $i['id'],
                'quantity' => $i['quantity'],
                'unit_price' => $i['unit_price'],
                'price_includes_tax' => (bool) ($i['price_includes_tax'] ?? false),
                'discount_type' => $i['discount_type'] ?? null,
                'discount_value' => $i['discount_value'] ?? null,
                'tax' => $i['tax'] ?? null,
            ], $data['items']),
            'bill_discount_type' => $data['bill_discount_type'] ?? null,
            'bill_discount_value' => $data['bill_discount_value'] ?? null,
            'charges' => array_map(fn ($c) => ['key' => $c['key'], 'name' => $c['name'], 'amount' => $c['amount'], 'tax' => $c['tax'] ?? null], $data['charges'] ?? []),
            'supply_type' => $data['supply_type'] ?? 'intra',
            'round_off' => $data['round_off_mode'] ?? 'none',
            'decimals' => $decimals,
        ]);
        // The server calculation is authoritative for every stored amount. A device total that
        // differs is kept in `meta` for review, never trusted for the ledger or refunds.
        $clientTotal = $data['grand_total'] ?? null;
        if ($clientTotal !== null && ! Money::equals($clientTotal, $pricing['grand_total'], $decimals)) {
            $flags[] = 'totals_mismatch';
        }
        foreach (array_values($data['items']) as $index => $item) {
            if (isset($item['total']) && ! Money::equals($item['total'], $pricing['lines'][$index]['total'], $decimals)) {
                $flags[] = 'totals_mismatch';
            }
        }
        $grandTotal = $pricing['grand_total'];

        // Payments
        $payments = $isInvoice ? ($data['payments'] ?? []) : [];
        $paidScaled = 0;
        $changeScaled = 0;
        $ledgerCreditScaled = 0;
        foreach ($payments as $p) {
            if ($p['method'] === 'credit') {
                continue;
            }
            $paidScaled += Money::toScaled($p['amount'], $decimals);
            $changeScaled += Money::toScaled($p['change'] ?? 0, $decimals);
            if ($p['method'] !== 'credit_note') {
                $ledgerCreditScaled += Money::toScaled($p['amount'], $decimals);
            }
        }
        $totalScaled = Money::toScaled($grandTotal, $decimals);
        $balanceScaled = max($totalScaled - $paidScaled, 0);
        $paidTotal = Money::fromScaled(min($paidScaled, $totalScaled), $decimals);
        $balanceDue = Money::fromScaled($balanceScaled, $decimals);
        $paymentStatus = ! $isInvoice ? 'unpaid' : ($balanceScaled === 0 ? 'paid' : ($paidScaled > 0 ? 'partial' : 'unpaid'));

        if ($isInvoice) {
            if ($pricing['discount_total'] > 0 && ! $this->tenant->can('sales.discount')) {
                $flags[] = 'discount_without_permission';
            }
            if ($balanceScaled > 0) {
                if (! $customer) {
                    $flags[] = 'credit_without_customer';
                } else {
                    if (! $this->tenant->can('sales.credit')) {
                        $flags[] = 'credit_without_permission';
                    }
                    $limit = (float) $customer->credit_limit;
                    $after = $this->ledger->customerBalance($customer->id) + $balanceDue;
                    if ($limit > 0 && $after > $limit && ! $this->tenant->can('sales.credit_override')) {
                        $flags[] = 'credit_limit_exceeded';
                    }
                }
            }
            $items = array_values($data['items']);
            array_push(
                $flags,
                ...$this->integrity->priceFlags($items, $products),
                ...$this->integrity->taxFlags($items, $products),
                ...$this->integrity->couponFlags($data['coupon_code'] ?? null, $pricing['gross_total'] - $pricing['line_discount_total'], $data['invoice_date']),
            );
            foreach ($data['items'] as $item) {
                // Negative lines are returns inside an invoice; they need the refund permission.
                if ((float) $item['quantity'] < 0 && ! $this->tenant->can('sales.refund')) {
                    $flags[] = 'negative_line_without_permission';
                }
                $product = $item['product_id'] ? $products[$item['product_id']] : null;
                if ($product && $product->min_selling_price && $item['unit_price'] < $product->min_selling_price && ! $this->tenant->can('sales.price_override')) {
                    $flags[] = 'below_minimum_price';
                }
                if (! empty($item['batch_id'])) {
                    $expiry = ProductBatch::withTrashed()->whereKey($item['batch_id'])->value('expiry_date');
                    if ($expiry && substr((string) $expiry, 0, 10) < $data['invoice_date'] && ! $this->tenant->can('sales.sell_expired')) {
                        $flags[] = 'expired_batch_sold';
                    }
                }
            }
        }
        $loyalty = ['earned' => 0, 'redeemed' => 0, 'flags' => []];
        if ($isInvoice) {
            $loyalty = $this->integrity->loyalty($customer, $payments, $grandTotal, (int) ($data['loyalty_points_redeemed'] ?? 0), $decimals);
            array_push($flags, ...$loyalty['flags']);
        }
        $flags = array_values(array_unique($flags));

        // Number: accept the device's block number or assign a final one.
        $series = DocumentNumberFormatter::SALE_DOC_SERIES[$docType];
        $number = $this->numbering->finalize(
            $series, 'sale', $saleId, $data['invoice_number'] ?? null, $data['number_status'] ?? null,
            $data['number_block_id'] ?? null, isset($data['number_sequence']) ? (int) $data['number_sequence'] : null,
            $data['invoice_date'], $device, $store->id,
        );

        $occurredAt = Carbon::parse($data['occurred_at']);
        $sale = Sale::query()->create([
            'id' => $saleId,
            'store_id' => $store->id,
            'device_id' => $device?->id,
            'register_id' => $data['register_id'] ?? null,
            'customer_id' => $customer?->id,
            'customer_name' => $data['customer_name'] ?? $customer?->name,
            'customer_phone' => $data['customer_phone'] ?? $customer?->phone,
            'customer_gstin' => $data['customer_gstin'] ?? $customer?->gstin,
            'doc_type' => $docType,
            'status' => $status,
            'invoice_number' => $number['number'],
            'number_status' => 'final',
            'number_block_id' => $data['number_block_id'] ?? null,
            'provisional_number' => $number['reassigned'] ? $number['provisional'] : null,
            'invoice_date' => $data['invoice_date'],
            'occurred_at' => $occurredAt,
            'due_date' => $data['due_date'] ?? null,
            'supply_type' => $data['supply_type'] ?? 'intra',
            'place_of_supply' => $data['place_of_supply'] ?? null,
            'order_type' => $data['order_type'] ?? 'retail',
            'table_id' => $data['table_id'] ?? null,
            'kitchen_order_ids' => $data['kitchen_order_ids'] ?? [],
            'bill_discount_type' => $data['bill_discount_type'] ?? null,
            'bill_discount_value' => $data['bill_discount_value'] ?? null,
            'round_off_mode' => $data['round_off_mode'] ?? 'none',
            'gross_total' => $pricing['gross_total'],
            'line_discount_total' => $pricing['line_discount_total'],
            'bill_discount_total' => $pricing['bill_discount_total'],
            'discount_total' => $pricing['discount_total'],
            'taxable_total' => $pricing['taxable_total'],
            'tax_total' => $pricing['tax_total'],
            'charges' => array_map(function ($charge, $i) use ($pricing) {
                $calc = $pricing['charges'][$i] ?? [];

                return [
                    'key' => $charge['key'],
                    'name' => $charge['name'],
                    'amount' => (float) $charge['amount'],
                    'tax_rate_id' => $charge['tax_rate_id'] ?? null,
                    'tax' => $charge['tax'] ?? null,
                    'taxable' => $calc['taxable'] ?? (float) $charge['amount'],
                    'tax_total' => $calc['tax_total'] ?? 0,
                    'total' => $calc['total'] ?? (float) $charge['amount'],
                ];
            }, $data['charges'] ?? [], array_keys($data['charges'] ?? [])),
            'charges_total' => $pricing['charges_total'],
            'round_off' => $pricing['round_off'],
            'grand_total' => $grandTotal,
            'paid_total' => $paidTotal,
            'change_due' => Money::fromScaled($changeScaled, $decimals),
            'balance_due' => $isInvoice ? $balanceDue : 0,
            'payment_status' => $paymentStatus,
            'tax_breakup' => $pricing['tax_breakup'],
            'coupon_code' => $data['coupon_code'] ?? null,
            'loyalty_points_earned' => $loyalty['earned'],
            'loyalty_points_redeemed' => $loyalty['redeemed'],
            'converted_from_id' => $data['converted_from_id'] ?? null,
            'valid_until' => $data['valid_until'] ?? null,
            'notes' => $data['notes'] ?? null,
            'created_by' => $userId,
            'review_flags' => $flags,
            'meta' => in_array('totals_mismatch', $flags, true) || $loyalty['flags'] !== []
                ? array_filter([
                    'server_grand_total' => $pricing['grand_total'],
                    'client_grand_total' => $clientTotal,
                    'client_loyalty_earned' => $data['loyalty_points_earned'] ?? null,
                    'client_loyalty_redeemed' => $data['loyalty_points_redeemed'] ?? null,
                ], fn ($v) => $v !== null)
                : null,
        ]);

        foreach (array_values($data['items']) as $index => $item) {
            $line = $pricing['lines'][$index];
            $product = $item['product_id'] ? $products[$item['product_id']] : null;
            $saleItem = SaleItem::query()->create([
                'id' => $item['id'],
                'sale_id' => $sale->id,
                'product_id' => $item['product_id'] ?? null,
                'variant_id' => $item['variant_id'] ?? null,
                'batch_id' => $item['batch_id'] ?? null,
                'serial_ids' => $item['serial_ids'] ?? [],
                'serial_numbers' => $item['serial_numbers'] ?? [],
                'name' => $item['name'],
                'sku' => $item['sku'] ?? null,
                'hsn_code' => $item['hsn_code'] ?? $product?->hsn_code,
                'unit_code' => $item['unit_code'] ?? null,
                'quantity' => $item['quantity'],
                'unit_price' => $item['unit_price'],
                'mrp' => $item['mrp'] ?? null,
                'cost_price' => $item['cost_price'] ?? ($product->purchase_price ?? 0),
                'price_includes_tax' => (bool) ($item['price_includes_tax'] ?? false),
                'discount_type' => $item['discount_type'] ?? null,
                'discount_value' => $item['discount_value'] ?? null,
                'tax_rate_id' => $item['tax_rate_id'] ?? null,
                'tax' => $item['tax'] ?? null,
                // Line amounts always come from the server calculation: refunds are pro-rated
                // from them, so device-supplied values must never reach the database.
                'gross' => $line['gross'],
                'line_discount' => $line['line_discount'],
                'bill_discount' => $line['bill_discount'],
                'taxable' => $line['taxable'],
                'taxes' => $line['taxes'],
                'tax_total' => $line['tax_total'],
                'total' => $line['total'],
                'modifiers' => $item['modifiers'] ?? [],
                'jewellery' => $item['jewellery'] ?? null,
                'warranty_months' => $item['warranty_months'] ?? $product?->warranty_months,
                'kitchen_order_id' => $item['kitchen_order_id'] ?? null,
                'notes' => $item['notes'] ?? null,
                'sort_order' => $index,
            ]);

            if (in_array($docType, self::STOCK_DOC_TYPES, true) && $product && $product->track_inventory && $product->product_type !== 'service') {
                $qty = (float) $item['quantity'];
                $this->inventory->move([
                    'id' => $item['movement_id'] ?? null,
                    'store_id' => $store->id,
                    'product_id' => $product->id,
                    'variant_id' => $item['variant_id'] ?? null,
                    'batch_id' => $item['batch_id'] ?? null,
                    'type' => $qty > 0 ? 'SALE' : 'SALE_RETURN',
                    'qty_out' => $qty > 0 ? $qty : 0,
                    'qty_in' => $qty < 0 ? -$qty : 0,
                    'unit_cost' => (float) ($item['cost_price'] ?? $product->purchase_price),
                    'reference_type' => 'sale',
                    'reference_id' => $sale->id,
                    'reference_no' => $sale->invoice_number,
                    'created_by' => $userId,
                    'device_id' => $device?->id,
                    'occurred_at' => $occurredAt,
                ]);
            }
            if ($isInvoice) {
                $this->sellSerials($sale, $saleItem, $product, $item, $userId, $device);
            }
        }

        foreach ($payments as $p) {
            SalePayment::query()->create([
                'id' => $p['id'],
                'sale_id' => $sale->id,
                'method' => $p['method'],
                'amount' => $p['amount'],
                'reference' => $p['reference'] ?? null,
                'tendered' => $p['tendered'] ?? null,
                'change' => $p['change'] ?? null,
                'meta' => ! empty($p['old_gold']) ? ['old_gold' => $p['old_gold']] : null,
                'occurred_at' => isset($p['occurred_at']) ? Carbon::parse($p['occurred_at']) : $occurredAt,
            ]);
            if ($p['method'] === 'old_gold' && ! empty($p['old_gold'])) {
                $og = $p['old_gold'];
                OldGoldPurchase::query()->create([
                    'store_id' => $store->id,
                    'sale_id' => $sale->id,
                    'customer_id' => $customer?->id,
                    'description' => $og['description'] ?? 'Old gold exchange',
                    'metal' => $og['metal'] ?? 'gold',
                    'purity' => $og['purity'] ?? '22K',
                    'gross_weight' => $og['gross_weight'] ?? 0,
                    'stone_weight' => $og['stone_weight'] ?? 0,
                    'net_weight' => $og['net_weight'] ?? 0,
                    'deduction_percent' => $og['deduction_percent'] ?? 0,
                    'effective_weight' => $og['effective_weight'] ?? 0,
                    'rate_per_gram' => $og['rate_per_gram'] ?? 0,
                    'value' => $p['amount'],
                    'occurred_at' => $occurredAt,
                ]);
            }
        }

        if ($isInvoice) {
            $this->postInvoiceEffects($sale, $data, $customer, Money::fromScaled($ledgerCreditScaled, $decimals), $userId, $device, $flags);
        }

        if (! empty($data['converted_from_id'])) {
            $quotation = Sale::query()->find($data['converted_from_id']);
            if ($quotation && ! $quotation->isInvoice()) {
                $quotation->status = 'converted';
                $quotation->converted_to_id = $sale->id;
                $quotation->save();
            }
        }

        $this->audit->log('SALE_CREATED', 'sale', $sale->id, null, [
            'doc_type' => $docType,
            'invoice_number' => $sale->invoice_number,
            'grand_total' => $sale->grand_total,
            'items' => count($data['items']),
            'review_flags' => $flags,
        ], $userId, $device?->id);

        return ['sale' => $sale, 'result' => [
            'invoice_number' => $sale->invoice_number,
            'number_status' => 'final',
            'reassigned' => $number['reassigned'],
            'review_flags' => $flags,
        ]];
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  list<string>  $flags
     */
    private function postInvoiceEffects(Sale $sale, array $data, ?Customer $customer, float $ledgerCredit, string $userId, ?Device $device, array $flags): void
    {
        $ledgerIds = $data['ledger_ids'] ?? [];
        if ($customer) {
            $common = [
                'customer_id' => $customer->id,
                'reference_type' => 'sale',
                'reference_id' => $sale->id,
                'reference_no' => $sale->invoice_number,
                'created_by' => $userId,
                'device_id' => $device?->id,
                'occurred_at' => $sale->occurred_at,
            ];
            $this->ledger->customer($common + ['id' => $ledgerIds['sale'] ?? null, 'type' => 'sale', 'debit' => $sale->grand_total]);
            $this->ledger->customer($common + ['id' => $ledgerIds['payment'] ?? null, 'type' => 'sale_payment', 'credit' => $ledgerCredit]);
            if ($sale->loyalty_points_earned > 0) {
                $this->ledger->customer($common + ['id' => $ledgerIds['loyalty_earn'] ?? null, 'type' => 'loyalty_earn', 'points' => $sale->loyalty_points_earned]);
            }
            if ($sale->loyalty_points_redeemed > 0) {
                $this->ledger->customer($common + ['id' => $ledgerIds['loyalty_redeem'] ?? null, 'type' => 'loyalty_redeem', 'points' => -$sale->loyalty_points_redeemed]);
            }
        }

        if (! empty($data['coupon_code'])) {
            $coupon = Coupon::query()->where('code', strtoupper($data['coupon_code']))->first();
            if ($coupon) {
                $coupon->used_count = $coupon->used_count + 1;
                $coupon->save();
            }
        }

        foreach (KitchenOrder::query()->whereIn('id', $data['kitchen_order_ids'] ?? [])->get() as $kot) {
            $kot->sale_id = $sale->id;
            if ($kot->status !== 'cancelled') {
                $kot->status = 'served';
            }
            $kot->save();
        }

        if (in_array('credit_limit_exceeded', $flags, true)) {
            $this->notifications->notify('credit_limit_exceeded', "Credit limit exceeded: {$customer?->name}", "Invoice {$sale->invoice_number} took {$customer?->name} over their credit limit.", 'warning', 'sale', $sale->id);
        }
        if (in_array('totals_mismatch', $flags, true)) {
            $this->notifications->notify('totals_mismatch', "Invoice {$sale->invoice_number} needs review", 'The invoice totals recorded on the device differ from the server calculation.', 'critical', 'sale', $sale->id);
        }
        $review = [
            'price_override_without_permission' => 'Items were sold below the catalogue price without the price-override permission.',
            'tax_mismatch' => 'The tax rate on the invoice differs from the product tax rate.',
            'negative_line_without_permission' => 'The invoice contains returned (negative) lines entered without the refund permission.',
            'loyalty_over_redeemed' => 'More loyalty points were redeemed than the customer had.',
            'loyalty_invalid' => 'Loyalty points were redeemed without a customer or while loyalty is disabled.',
            'invalid_coupon' => 'A coupon that was invalid, expired or used up was applied.',
        ];
        foreach ($review as $flag => $body) {
            if (in_array($flag, $flags, true)) {
                $this->notifications->notify($flag, "Invoice {$sale->invoice_number} needs review", $body, 'warning', 'sale', $sale->id);
            }
        }
        if (in_array('expired_batch_sold', $flags, true)) {
            $this->notifications->notify('expired_batch_sold', "Expired stock sold on {$sale->invoice_number}", 'An expired batch was sold without the required permission.', 'critical', 'sale', $sale->id);
        }
    }

    private function addFlag(Sale $sale, string $flag): void
    {
        $flags = $sale->review_flags ?? [];
        if (! in_array($flag, $flags, true)) {
            $flags[] = $flag;
            $sale->review_flags = $flags;
            $sale->save();
        }
    }

    /** @param array<string, mixed> $item */
    private function sellSerials(Sale $sale, SaleItem $saleItem, ?Product $product, array $item, string $userId, ?Device $device): void
    {
        foreach ($item['serial_ids'] ?? [] as $serialId) {
            $serial = ProductSerial::query()->find($serialId);
            if (! $serial) {
                continue;
            }
            if (! $product || $serial->product_id !== $product->id || (isset($item['variant_id']) && $serial->variant_id !== null && $serial->variant_id !== $item['variant_id'])) {
                // An IMEI of a different product cannot be sold on this line.
                $this->addFlag($sale, 'serial_mismatch');

                continue;
            }
            if ($serial->status === 'sold' && $serial->sale_id !== $sale->id) {
                $conflict = SyncConflict::query()->create([
                    'operation_id' => (string) Str::uuid7(),
                    'device_id' => $device?->id,
                    'user_id' => $userId,
                    'entity_type' => 'product_serial',
                    'entity_id' => $serial->id,
                    'conflict_type' => 'serial_double_sale',
                    'fields' => [['field' => 'sale_id', 'base' => null, 'local' => $sale->id, 'server' => $serial->sale_id]],
                    'server_data' => $serial->toSyncArray(),
                    'local_payload' => ['sale_id' => $sale->id, 'invoice_number' => $sale->invoice_number],
                    'message' => "Serial/IMEI {$serial->serial_no} was sold on two devices (invoice {$sale->invoice_number}).",
                    'status' => 'open',
                ]);
                $this->notifications->notify('serial_double_sale', "IMEI {$serial->serial_no} sold twice", $conflict->message, 'critical', 'sale', $sale->id);

                continue;
            }
            $months = $saleItem->warranty_months ?? $serial->warranty_months ?? $product->warranty_months;
            $serial->status = 'sold';
            $serial->sale_id = $sale->id;
            $serial->sale_item_id = $saleItem->id;
            $serial->customer_id = $sale->customer_id;
            $serial->sold_at = $sale->occurred_at;
            $serial->warranty_months = $months;
            $serial->warranty_expires_at = $months ? Carbon::parse($sale->invoice_date)->addMonths($months)->toDateString() : null;
            $serial->save();
        }
    }

    /**
     * Cancel an invoice: reverses stock, ledger and serials. The number stays used (register marks
     * it cancelled) as required for audit.
     */
    /** @param array<string, string> $movementIds sale item id → movement id generated on the device */
    public function cancel(Sale $sale, ?string $reason, string $userId, ?Device $device, array $movementIds = []): Sale
    {
        if (! $this->tenant->can('sales.delete')) {
            throw SyncRejected::forbidden('sales.delete');
        }
        if ($sale->status === 'cancelled') {
            return $sale;
        }
        $wasInvoice = $sale->isInvoice() && $sale->status === 'completed';
        $sale->status = 'cancelled';
        $sale->cancelled_at = now();
        $sale->cancelled_by = $userId;
        $sale->cancel_reason = $reason;
        $sale->save();

        if ($wasInvoice || $sale->doc_type === 'delivery_challan') {
            foreach ($sale->items as $item) {
                $product = $item->product_id ? Product::withTrashed()->find($item->product_id) : null;
                $remaining = (float) $item->quantity - (float) $item->returned_qty;
                if ($product && $product->track_inventory && $product->product_type !== 'service' && $remaining > 0) {
                    $this->inventory->move([
                        'id' => isset($movementIds[$item->id]) && Str::isUuid($movementIds[$item->id]) ? $movementIds[$item->id] : null,
                        'store_id' => $sale->store_id,
                        'product_id' => $product->id,
                        'variant_id' => $item->variant_id,
                        'batch_id' => $item->batch_id,
                        'type' => 'SALE_RETURN',
                        'qty_in' => $remaining,
                        'unit_cost' => $item->cost_price,
                        'reference_type' => 'sale_cancel',
                        'reference_id' => $sale->id,
                        'reference_no' => $sale->invoice_number,
                        'notes' => 'Invoice cancelled',
                        'created_by' => $userId,
                        'device_id' => $device?->id,
                    ]);
                }
                foreach ($item->serial_ids ?? [] as $serialId) {
                    $serial = ProductSerial::query()->find($serialId);
                    if ($serial && $serial->sale_id === $sale->id) {
                        $serial->forceFill(['status' => 'in_stock', 'sale_id' => null, 'sale_item_id' => null, 'customer_id' => null, 'sold_at' => null, 'warranty_expires_at' => null])->save();
                    }
                }
            }
        }
        if ($wasInvoice && $sale->customer_id) {
            $outstanding = Money::round((float) $sale->grand_total - (float) $sale->returned_total);
            $common = ['customer_id' => $sale->customer_id, 'reference_type' => 'sale_cancel', 'reference_id' => $sale->id, 'reference_no' => $sale->invoice_number, 'created_by' => $userId, 'device_id' => $device?->id];
            $this->ledger->customer($common + ['type' => 'adjustment', 'credit' => $outstanding, 'notes' => 'Invoice cancelled']);
            $paidRefund = Money::round(min((float) $sale->paid_total, $outstanding));
            $this->ledger->customer($common + ['type' => 'refund', 'debit' => $paidRefund, 'notes' => 'Payment refunded on cancellation']);
        }
        $this->numbering->markCancelled('sale', $sale->id);
        $this->audit->log('SALE_CANCELLED', 'sale', $sale->id, ['status' => 'completed'], ['status' => 'cancelled', 'reason' => $reason], $userId, $device?->id);

        return $sale->refresh();
    }

    /**
     * Quotations / estimates are editable until converted.
     *
     * @param  array<string, mixed>  $payload
     */
    public function updateQuotation(Sale $sale, array $payload, string $userId, ?Device $device): Sale
    {
        if (! $this->tenant->can('sales.create')) {
            throw SyncRejected::forbidden('sales.create');
        }
        if ($sale->isInvoice() || $sale->status !== 'draft') {
            throw new SyncRejected('not_editable', 'Only draft quotations and estimates can be edited.');
        }
        $payload['store_id'] ??= $sale->store_id;
        $payload['doc_type'] = $sale->doc_type;
        $payload['invoice_date'] ??= substr((string) $sale->invoice_date, 0, 10);
        $payload['occurred_at'] ??= $sale->occurred_at?->toIso8601String();
        $validator = Validator::make($payload, self::rules());
        if ($validator->fails()) {
            throw SyncRejected::invalid($validator->errors()->toArray());
        }
        $data = $validator->validated();
        $pricing = PricingEngine::calculate([
            'lines' => array_map(fn ($i) => [
                'key' => $i['id'], 'quantity' => $i['quantity'], 'unit_price' => $i['unit_price'],
                'price_includes_tax' => (bool) ($i['price_includes_tax'] ?? false), 'discount_type' => $i['discount_type'] ?? null,
                'discount_value' => $i['discount_value'] ?? null, 'tax' => $i['tax'] ?? null,
            ], $data['items']),
            'bill_discount_type' => $data['bill_discount_type'] ?? null,
            'bill_discount_value' => $data['bill_discount_value'] ?? null,
            'supply_type' => $data['supply_type'] ?? 'intra',
            'round_off' => $data['round_off_mode'] ?? 'none',
        ]);
        $sale->items()->delete();
        foreach (array_values($data['items']) as $index => $item) {
            $line = $pricing['lines'][$index];
            SaleItem::query()->create([
                'id' => $item['id'], 'sale_id' => $sale->id, 'product_id' => $item['product_id'] ?? null,
                'variant_id' => $item['variant_id'] ?? null, 'batch_id' => $item['batch_id'] ?? null,
                'name' => $item['name'], 'sku' => $item['sku'] ?? null, 'hsn_code' => $item['hsn_code'] ?? null,
                'unit_code' => $item['unit_code'] ?? null, 'quantity' => $item['quantity'], 'unit_price' => $item['unit_price'],
                'mrp' => $item['mrp'] ?? null, 'cost_price' => $item['cost_price'] ?? 0,
                'price_includes_tax' => (bool) ($item['price_includes_tax'] ?? false), 'discount_type' => $item['discount_type'] ?? null,
                'discount_value' => $item['discount_value'] ?? null, 'tax_rate_id' => $item['tax_rate_id'] ?? null, 'tax' => $item['tax'] ?? null,
                'gross' => $line['gross'], 'line_discount' => $line['line_discount'], 'bill_discount' => $line['bill_discount'],
                'taxable' => $line['taxable'], 'taxes' => $line['taxes'], 'tax_total' => $line['tax_total'], 'total' => $line['total'],
                'modifiers' => $item['modifiers'] ?? [], 'jewellery' => $item['jewellery'] ?? null, 'notes' => $item['notes'] ?? null,
                'sort_order' => $index,
            ]);
        }
        $sale->fill([
            'customer_id' => $data['customer_id'] ?? null,
            'customer_name' => $data['customer_name'] ?? null,
            'customer_phone' => $data['customer_phone'] ?? null,
            'bill_discount_type' => $data['bill_discount_type'] ?? null,
            'bill_discount_value' => $data['bill_discount_value'] ?? null,
            'gross_total' => $pricing['gross_total'],
            'line_discount_total' => $pricing['line_discount_total'],
            'bill_discount_total' => $pricing['bill_discount_total'],
            'discount_total' => $pricing['discount_total'],
            'taxable_total' => $pricing['taxable_total'],
            'tax_total' => $pricing['tax_total'],
            'round_off' => $pricing['round_off'],
            'grand_total' => $pricing['grand_total'],
            'tax_breakup' => $pricing['tax_breakup'],
            'valid_until' => $data['valid_until'] ?? $sale->valid_until,
            'notes' => $data['notes'] ?? null,
        ]);
        $sale->save();
        $sale->unsetRelation('items');
        $this->audit->log('SALE_UPDATED', 'sale', $sale->id, null, ['grand_total' => $sale->grand_total], $userId, $device?->id);

        return $sale->refresh();
    }
}
