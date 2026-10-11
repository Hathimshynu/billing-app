<?php

namespace App\Services\Sales;

use App\Domain\Pricing\Money;
use App\Models\BusinessSetting;
use App\Models\Coupon;
use App\Models\Customer;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\ProductVariant;
use App\Models\TaxRate;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Collection;

/**
 * Server-side re-verification of a sale recorded on a device. Values the device cannot be trusted
 * with (prices below the catalogue, tax rates, coupons, loyalty points) are recomputed or compared
 * here. Offline sales are never rejected for these anomalies — the caller records review flags.
 */
class SaleIntegrity
{
    /** Tolerance for comparing money values that went through float JSON transport. */
    private const EPSILON = 0.005;

    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * Unit prices lower than every applicable catalogue price (product, variant, batch, quantity
     * tier) need the sales.price_override permission. Jewellery lines are priced from metal rates
     * and are not compared here.
     *
     * @param  list<array<string, mixed>>  $items
     * @param  Collection<string, Product>  $products
     * @return list<string>
     */
    public function priceFlags(array $items, Collection $products): array
    {
        if ($this->tenant->can('sales.price_override')) {
            return [];
        }
        foreach ($items as $item) {
            $product = isset($item['product_id']) ? $products->get($item['product_id']) : null;
            if (! $product || $product->product_type === 'jewellery' || ! empty($item['jewellery']) || (float) $item['quantity'] < 0) {
                continue;
            }
            $candidates = [(float) $product->selling_price];
            if (! empty($item['variant_id']) && ($variant = ProductVariant::withTrashed()->find($item['variant_id'])) && $variant->selling_price !== null) {
                $candidates[] = (float) $variant->selling_price;
            }
            if (! empty($item['batch_id']) && ($batch = ProductBatch::withTrashed()->find($item['batch_id'])) && $batch->selling_price !== null) {
                $candidates[] = (float) $batch->selling_price;
            }
            foreach ($product->priceTiers as $tier) {
                if ((float) $item['quantity'] >= (float) $tier->min_qty) {
                    $candidates[] = (float) $tier->price;
                }
            }
            $modifiers = 0.0;
            foreach ($item['modifiers'] ?? [] as $modifier) {
                $modifiers += is_array($modifier) ? (float) ($modifier['price'] ?? 0) : 0;
            }
            $base = (float) $item['unit_price'] - $modifiers;
            if ($base < min($candidates) - self::EPSILON) {
                return ['price_override_without_permission'];
            }
        }

        return [];
    }

    /**
     * The tax snapshot travels with the line (so an offline sale keeps the rate it was billed at).
     * A snapshot that disagrees with the product's tax rate is flagged — it may be a legitimate rate
     * change made while the device was offline, or a manipulated payload.
     *
     * @param  list<array<string, mixed>>  $items
     * @param  Collection<string, Product>  $products
     * @return list<string>
     */
    public function taxFlags(array $items, Collection $products): array
    {
        foreach ($items as $item) {
            $product = isset($item['product_id']) ? $products->get($item['product_id']) : null;
            if (! $product) {
                continue;
            }
            $expected = $product->tax_rate_id ? TaxRate::withTrashed()->find($product->tax_rate_id) : null;
            $snapshot = is_array($item['tax'] ?? null) ? $item['tax'] : null;
            $expectedRate = $expected && $expected->kind !== 'exempt' ? (float) $expected->rate + (float) $expected->cess_rate : 0.0;
            $snapshotRate = $snapshot && ($snapshot['kind'] ?? '') !== 'exempt' ? (float) ($snapshot['rate'] ?? 0) + (float) ($snapshot['cess_rate'] ?? 0) : 0.0;
            if ($expected && $expected->kind === 'custom') {
                $expectedRate = array_sum(array_map(fn ($c) => (float) ($c['rate'] ?? 0), $expected->components ?? []));
                $snapshotRate = array_sum(array_map(fn ($c) => (float) ($c['rate'] ?? 0), $snapshot['components'] ?? []));
            }
            if (abs($expectedRate - $snapshotRate) > 0.0005) {
                return ['tax_mismatch'];
            }
        }

        return [];
    }

    /** @return list<string> */
    public function couponFlags(?string $code, float $billBeforeDiscount, string $invoiceDate): array
    {
        if (! $code) {
            return [];
        }
        $coupon = Coupon::query()->where('code', strtoupper($code))->first();
        $invalid = ! $coupon
            || ! $coupon->active
            || ($coupon->valid_from && $invoiceDate < substr((string) $coupon->valid_from, 0, 10))
            || ($coupon->valid_to && $invoiceDate > substr((string) $coupon->valid_to, 0, 10))
            || ($coupon->usage_limit !== null && $coupon->used_count >= $coupon->usage_limit)
            || $billBeforeDiscount + self::EPSILON < (float) $coupon->min_amount;

        return $invalid ? ['invalid_coupon'] : [];
    }

    /**
     * Loyalty points are never taken from the device. Earned points follow the business rules;
     * redeemed points are derived from the money actually given as a loyalty payment and checked
     * against the customer's balance.
     *
     * @param  list<array<string, mixed>>  $payments
     * @return array{earned: int, redeemed: int, flags: list<string>}
     */
    public function loyalty(?Customer $customer, array $payments, float $grandTotal, int $clientRedeemed, int $decimals): array
    {
        $settings = BusinessSetting::query()->where('key', 'loyalty')->value('value');
        $settings = is_array($settings) ? $settings : (is_string($settings) ? (array) json_decode($settings, true) : []);
        $enabled = (bool) ($settings['enabled'] ?? false);
        $earnPer100 = max(0.0, (float) ($settings['earn_per_100'] ?? 0));
        $pointValue = (float) ($settings['point_value'] ?? 1);
        $minRedeem = (int) ($settings['min_redeem_points'] ?? 0);

        $loyaltyScaled = 0;
        foreach ($payments as $p) {
            if (($p['method'] ?? null) === 'loyalty') {
                $loyaltyScaled += Money::toScaled($p['amount'], $decimals);
            }
        }
        $flags = [];
        $redeemed = 0;
        if ($loyaltyScaled > 0 || $clientRedeemed > 0) {
            if (! $customer || ! $enabled || $pointValue <= 0) {
                $flags[] = 'loyalty_invalid';
            } else {
                $amount = Money::fromScaled($loyaltyScaled, $decimals);
                $redeemed = (int) ceil(round($amount / $pointValue, 6));
                if ($redeemed !== $clientRedeemed) {
                    $flags[] = 'loyalty_mismatch';
                }
                $available = (int) $customer->loyalty_points;
                if ($redeemed > $available || $available < $minRedeem) {
                    $flags[] = 'loyalty_over_redeemed';
                }
            }
        }

        $earned = 0;
        if ($customer && $enabled && $earnPer100 > 0) {
            $eligible = Money::fromScaled(max(Money::toScaled($grandTotal, $decimals) - $loyaltyScaled, 0), $decimals);
            $earned = (int) floor(round($eligible / 100 * $earnPer100, 6));
        }

        return ['earned' => $earned, 'redeemed' => $redeemed, 'flags' => $flags];
    }
}
