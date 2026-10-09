<?php

namespace App\Domain\Pricing;

/**
 * Jewellery valuation. Mirrors packages/shared/src/jewellery.ts.
 */
final class JewelleryPricing
{
    /**
     * @param  array<string, mixed>  $input
     * @return array<string, float>
     */
    public static function price(array $input): array
    {
        $d = (int) ($input['decimals'] ?? Money::DEFAULT_DECIMALS);
        $hundred = 100 * (10 ** Money::RATE_SCALE);
        $qtyFactor = 10 ** Money::QTY_SCALE;
        $weight = Money::toScaled($input['net_weight'] ?? 0, Money::QTY_SCALE);
        $rate = Money::toScaled($input['rate_per_gram'] ?? 0, $d);
        $metal = Money::mulDivRound($weight, $rate, $qtyFactor);

        $making = match ($input['making_charge_type'] ?? 'fixed') {
            'per_gram' => Money::mulDivRound($weight, Money::toScaled($input['making_charge_value'] ?? 0, $d), $qtyFactor),
            'percent' => Money::mulDivRound($metal, Money::toScaled($input['making_charge_value'] ?? 0, Money::RATE_SCALE), $hundred),
            default => Money::toScaled($input['making_charge_value'] ?? 0, $d),
        };

        $wastage = 0;
        if (! empty($input['wastage_value'])) {
            $wastage = ($input['wastage_type'] ?? 'percent') === 'fixed'
                ? Money::toScaled($input['wastage_value'], $d)
                : Money::mulDivRound($metal, Money::toScaled($input['wastage_value'], Money::RATE_SCALE), $hundred);
        }
        $stones = Money::toScaled($input['stone_charges'] ?? 0, $d);
        $other = Money::toScaled($input['other_charges'] ?? 0, $d);
        $gross = $metal + $making + $wastage + $stones + $other;
        $discount = min(max(Money::toScaled($input['discount'] ?? 0, $d), 0), $gross);
        $m = fn (int $v) => Money::fromScaled($v, $d);

        return [
            'metal_value' => $m($metal),
            'making_charges' => $m($making),
            'wastage_charges' => $m($wastage),
            'stone_charges' => $m($stones),
            'other_charges' => $m($other),
            'discount' => $m($discount),
            'taxable_value' => $m($gross - $discount),
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, float>
     */
    public static function oldGold(array $input): array
    {
        $d = (int) ($input['decimals'] ?? Money::DEFAULT_DECIMALS);
        $gross = Money::toScaled($input['gross_weight'] ?? 0, Money::QTY_SCALE);
        $stone = Money::toScaled($input['stone_weight'] ?? 0, Money::QTY_SCALE);
        $net = max($gross - $stone, 0);
        $deduction = Money::mulDivRound($net, Money::toScaled($input['deduction_percent'] ?? 0, Money::RATE_SCALE), 100 * (10 ** Money::RATE_SCALE));
        $effective = $net - $deduction;
        $value = Money::mulDivRound($effective, Money::toScaled($input['rate_per_gram'] ?? 0, $d), 10 ** Money::QTY_SCALE);

        return [
            'net_weight' => Money::fromScaled($net, Money::QTY_SCALE),
            'deduction_weight' => Money::fromScaled($deduction, Money::QTY_SCALE),
            'effective_weight' => Money::fromScaled($effective, Money::QTY_SCALE),
            'value' => Money::fromScaled($value, $d),
        ];
    }
}
