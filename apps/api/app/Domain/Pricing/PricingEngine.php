<?php

namespace App\Domain\Pricing;

/**
 * Bill pricing & tax engine. Exact mirror of packages/shared/src/tax.ts (see that file for the
 * algorithm description). Inputs and outputs use the same snake_case array shapes as the client.
 */
final class PricingEngine
{
    private const ROUND_STEPS = ['none' => 0, '0.05' => 5, '0.10' => 10, '0.50' => 50, '1.00' => 100];

    /**
     * @param  array<string, mixed>|null  $tax
     * @return list<array{code: string, name: string, rate: float}>
     */
    public static function resolveComponents(?array $tax, string $supplyType = 'intra'): array
    {
        if (! $tax || ($tax['kind'] ?? 'exempt') === 'exempt') {
            return [];
        }
        $components = [];
        $rate = (float) ($tax['rate'] ?? 0);
        switch ($tax['kind']) {
            case 'gst':
                if ($rate > 0) {
                    if ($supplyType === 'inter') {
                        $components[] = ['code' => 'IGST', 'name' => 'IGST', 'rate' => $rate];
                    } else {
                        $half = Money::fromScaled(Money::divRound(Money::toScaled($rate, Money::RATE_SCALE), 2), Money::RATE_SCALE);
                        $components[] = ['code' => 'CGST', 'name' => 'CGST', 'rate' => $half];
                        $components[] = $supplyType === 'union_territory'
                            ? ['code' => 'UTGST', 'name' => 'UTGST', 'rate' => $half]
                            : ['code' => 'SGST', 'name' => 'SGST', 'rate' => $half];
                    }
                }
                $cess = (float) ($tax['cess_rate'] ?? 0);
                if ($cess > 0) {
                    $components[] = ['code' => 'CESS', 'name' => 'Cess', 'rate' => $cess];
                }
                break;
            case 'vat':
                if ($rate > 0) {
                    $components[] = ['code' => 'VAT', 'name' => 'VAT', 'rate' => $rate];
                }
                break;
            case 'simple':
                if ($rate > 0) {
                    $components[] = ['code' => 'TAX', 'name' => $tax['name'] ?? 'Tax', 'rate' => $rate];
                }
                break;
            case 'custom':
                foreach ($tax['components'] ?? [] as $c) {
                    if ((float) ($c['rate'] ?? 0) > 0) {
                        $components[] = ['code' => (string) $c['code'], 'name' => (string) $c['name'], 'rate' => (float) $c['rate']];
                    }
                }
                break;
        }

        return $components;
    }

    /**
     * @param  list<array{code: string, name: string, rate: float}>  $components
     * @return array{taxable: int, amounts: list<int>}
     */
    private static function splitTax(int $net, array $components, bool $inclusive): array
    {
        if ($components === []) {
            return ['taxable' => $net, 'amounts' => []];
        }
        $hundred = 100 * (10 ** Money::RATE_SCALE);
        $bps = array_map(fn ($c) => Money::toScaled($c['rate'], Money::RATE_SCALE), $components);
        $totalBps = array_sum($bps);
        if ($inclusive) {
            $base = Money::mulDivRound($net, $hundred, $hundred + $totalBps);
            $amounts = array_map(fn ($b) => Money::mulDivRound($base, $b, $hundred), $bps);

            return ['taxable' => $net - array_sum($amounts), 'amounts' => $amounts];
        }

        return ['taxable' => $net, 'amounts' => array_map(fn ($b) => Money::mulDivRound($net, $b, $hundred), $bps)];
    }

    private static function clampDiscount(int $discount, int $base): int
    {
        if ($base <= 0 || $discount < 0) {
            return 0;
        }

        return min($discount, $base);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public static function calculate(array $input): array
    {
        $d = (int) ($input['decimals'] ?? Money::DEFAULT_DECIMALS);
        $supply = (string) ($input['supply_type'] ?? 'intra');
        $hundred = 100 * (10 ** Money::RATE_SCALE);
        $qtyFactor = 10 ** Money::QTY_SCALE;
        $m = fn (int $v): float => Money::fromScaled($v, $d);

        $prepared = [];
        foreach ($input['lines'] ?? [] as $line) {
            $qty = Money::toScaled($line['quantity'] ?? 0, Money::QTY_SCALE);
            $price = Money::toScaled($line['unit_price'] ?? 0, $d);
            $gross = Money::mulDivRound($qty, $price, $qtyFactor);
            $lineDiscount = 0;
            $dv = (float) ($line['discount_value'] ?? 0);
            if (($line['discount_type'] ?? null) === 'percent' && $dv) {
                $lineDiscount = Money::mulDivRound($gross, Money::toScaled($line['discount_value'], Money::RATE_SCALE), $hundred);
            } elseif (($line['discount_type'] ?? null) === 'amount' && $dv) {
                $lineDiscount = Money::toScaled($line['discount_value'], $d);
            }
            $lineDiscount = self::clampDiscount($lineDiscount, $gross);
            $prepared[] = ['line' => $line, 'qty' => $qty, 'gross' => $gross, 'disc' => $lineDiscount, 'net' => $gross - $lineDiscount];
        }

        $netSum = array_sum(array_map(fn ($p) => max($p['net'], 0), $prepared));
        $billDiscount = 0;
        $bv = (float) ($input['bill_discount_value'] ?? 0);
        if (($input['bill_discount_type'] ?? null) === 'percent' && $bv) {
            $billDiscount = Money::mulDivRound($netSum, Money::toScaled($input['bill_discount_value'], Money::RATE_SCALE), $hundred);
        } elseif (($input['bill_discount_type'] ?? null) === 'amount' && $bv) {
            $billDiscount = Money::toScaled($input['bill_discount_value'], $d);
        }
        $billDiscount = self::clampDiscount($billDiscount, $netSum);
        $shares = Money::allocate($billDiscount, array_map(fn ($p) => max($p['net'], 0), $prepared));

        $breakup = [];
        $addBreakup = function (array $components, array $amounts, int $taxable) use (&$breakup) {
            foreach ($components as $i => $c) {
                $rateBps = Money::toScaled($c['rate'], Money::RATE_SCALE);
                $key = $c['code'].'|'.$rateBps;
                $breakup[$key] ??= ['code' => $c['code'], 'name' => $c['name'], 'rateBps' => $rateBps, 'taxable' => 0, 'amount' => 0];
                $breakup[$key]['taxable'] += $taxable;
                $breakup[$key]['amount'] += $amounts[$i] ?? 0;
            }
        };

        $grossTotal = $lineDiscTotal = $taxableTotal = $taxTotal = $taxExcl = $taxIncl = $linesTotal = $qtyTotal = 0;
        $lines = [];
        foreach ($prepared as $i => $p) {
            $share = $shares[$i] ?? 0;
            $net = $p['net'] - $share;
            $inclusive = (bool) ($p['line']['price_includes_tax'] ?? false);
            $components = self::resolveComponents($p['line']['tax'] ?? null, $supply);
            $split = self::splitTax($net, $components, $inclusive);
            $lineTax = array_sum($split['amounts']);
            $total = $split['taxable'] + $lineTax;
            $addBreakup($components, $split['amounts'], $split['taxable']);
            $grossTotal += $p['gross'];
            $lineDiscTotal += $p['disc'];
            $taxableTotal += $split['taxable'];
            $taxTotal += $lineTax;
            $inclusive ? $taxIncl += $lineTax : $taxExcl += $lineTax;
            $linesTotal += $total;
            $qtyTotal += $p['qty'];
            $lines[] = [
                'key' => $p['line']['key'] ?? (string) $i,
                'quantity' => Money::fromScaled($p['qty'], Money::QTY_SCALE),
                'unit_price' => $m(Money::toScaled($p['line']['unit_price'] ?? 0, $d)),
                'price_includes_tax' => $inclusive,
                'gross' => $m($p['gross']),
                'line_discount' => $m($p['disc']),
                'bill_discount' => $m($share),
                'net' => $m($net),
                'taxable' => $m($split['taxable']),
                'taxes' => array_map(fn ($c, $idx) => [
                    'code' => $c['code'], 'name' => $c['name'], 'rate' => $c['rate'], 'amount' => $m($split['amounts'][$idx] ?? 0),
                ], $components, array_keys($components)),
                'tax_total' => $m($lineTax),
                'total' => $m($total),
            ];
        }

        $chargesTotal = 0;
        $charges = [];
        foreach ($input['charges'] ?? [] as $charge) {
            $amount = Money::toScaled($charge['amount'] ?? 0, $d);
            $components = self::resolveComponents($charge['tax'] ?? null, $supply);
            $split = self::splitTax($amount, $components, false);
            $chargeTax = array_sum($split['amounts']);
            $addBreakup($components, $split['amounts'], $split['taxable']);
            $taxableTotal += $split['taxable'];
            $taxTotal += $chargeTax;
            $taxExcl += $chargeTax;
            $chargesTotal += $split['taxable'];
            $total = $split['taxable'] + $chargeTax;
            $linesTotal += $total;
            $charges[] = [
                'key' => $charge['key'] ?? '',
                'name' => $charge['name'] ?? '',
                'taxable' => $m($split['taxable']),
                'taxes' => array_map(fn ($c, $idx) => [
                    'code' => $c['code'], 'name' => $c['name'], 'rate' => $c['rate'], 'amount' => $m($split['amounts'][$idx] ?? 0),
                ], $components, array_keys($components)),
                'tax_total' => $m($chargeTax),
                'total' => $m($total),
            ];
        }

        $step = self::ROUND_STEPS[$input['round_off'] ?? 'none'] ?? 0;
        $rounded = $step > 0 ? Money::divRound($linesTotal, $step) * $step : $linesTotal;

        $rows = array_values($breakup);
        usort($rows, fn ($a, $b) => strcmp($a['code'], $b['code']) ?: ($a['rateBps'] <=> $b['rateBps']));

        return [
            'lines' => $lines,
            'charges' => $charges,
            'gross_total' => $m($grossTotal),
            'line_discount_total' => $m($lineDiscTotal),
            'bill_discount_total' => $m($billDiscount),
            'discount_total' => $m($lineDiscTotal + $billDiscount),
            'taxable_total' => $m($taxableTotal),
            'tax_total' => $m($taxTotal),
            'tax_exclusive_total' => $m($taxExcl),
            'tax_inclusive_total' => $m($taxIncl),
            'charges_total' => $m($chargesTotal),
            'total_before_round' => $m($linesTotal),
            'round_off' => $m($rounded - $linesTotal),
            'grand_total' => $m($rounded),
            'total_quantity' => Money::fromScaled($qtyTotal, Money::QTY_SCALE),
            'item_count' => count($prepared),
            'tax_breakup' => array_map(fn ($r) => [
                'code' => $r['code'],
                'name' => $r['name'],
                'rate' => Money::fromScaled($r['rateBps'], Money::RATE_SCALE),
                'taxable' => $m($r['taxable']),
                'amount' => $m($r['amount']),
            ], $rows),
        ];
    }

    public static function supplyType(?string $sellerState, ?string $buyerState, bool $unionTerritory = false): string
    {
        if (! $sellerState || ! $buyerState) {
            return $unionTerritory ? 'union_territory' : 'intra';
        }
        if (strtoupper(trim($sellerState)) !== strtoupper(trim($buyerState))) {
            return 'inter';
        }

        return $unionTerritory ? 'union_territory' : 'intra';
    }

    public static function isValidGstin(?string $value): bool
    {
        if (! $value) {
            return false;
        }
        $gstin = strtoupper(trim($value));
        if (! preg_match('/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/', $gstin)) {
            return false;
        }
        $chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        $sum = 0;
        for ($i = 0; $i < 14; $i++) {
            $product = strpos($chars, $gstin[$i]) * ($i % 2 === 0 ? 1 : 2);
            $sum += intdiv($product, 36) + ($product % 36);
        }

        return $chars[(36 - ($sum % 36)) % 36] === $gstin[14];
    }
}
