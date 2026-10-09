<?php

namespace App\Domain\Pricing;

use InvalidArgumentException;

/**
 * Exact decimal arithmetic on scaled integers. Mirrors packages/shared/src/money.ts exactly and is
 * verified against the same fixture vectors, so a bill priced offline on a device is re-validated
 * on the server with identical results.
 */
final class Money
{
    public const QTY_SCALE = 3;

    public const RATE_SCALE = 3;

    public const DEFAULT_DECIMALS = 2;

    /**
     * Convert a decimal (int|float|numeric-string) to a scaled integer, rounding half away from zero
     * on the decimal representation (so 1.005 → 101 at scale 2).
     */
    public static function toScaled(int|float|string|null $value, int $scale): int
    {
        if ($value === null || $value === '') {
            return 0;
        }

        if (is_int($value)) {
            $str = (string) $value;
        } elseif (is_float($value)) {
            if (! is_finite($value)) {
                throw new InvalidArgumentException('Invalid numeric value');
            }
            $str = number_format($value, min($scale + 6, 20), '.', '');
        } else {
            $str = trim($value);
            if (! preg_match('/^[+-]?\d*(\.\d*)?$/', $str) || in_array($str, ['', '.', '-', '+'], true)) {
                if (! is_numeric($str)) {
                    throw new InvalidArgumentException("Invalid numeric value: {$value}");
                }
                $str = number_format((float) $str, min($scale + 6, 20), '.', '');
            }
        }

        $negative = str_starts_with($str, '-');
        $str = ltrim($str, '+-');
        [$int, $frac] = array_pad(explode('.', $str, 2), 2, '');
        $int = $int === '' ? '0' : $int;
        $kept = substr(str_pad($frac, $scale, '0'), 0, $scale);
        $result = (int) ($int.$kept);
        $firstDropped = substr($frac, $scale, 1);
        if ($firstDropped !== '' && $firstDropped >= '5') {
            $result++;
        }

        return $negative && $result !== 0 ? -$result : $result;
    }

    public static function fromScaled(int $value, int $scale): float
    {
        if ($value === 0) {
            return 0.0;
        }

        return $value / (10 ** $scale);
    }

    /** Scaled integer to a fixed-decimals string, e.g. 12345 (scale 2) → "123.45". */
    public static function toDecimalString(int $value, int $scale): string
    {
        $negative = $value < 0;
        $abs = (string) abs($value);
        if ($scale === 0) {
            return ($negative ? '-' : '').$abs;
        }
        $abs = str_pad($abs, $scale + 1, '0', STR_PAD_LEFT);

        return ($negative ? '-' : '').substr($abs, 0, -$scale).'.'.substr($abs, -$scale);
    }

    /** Integer division rounding half away from zero. */
    public static function divRound(int $numerator, int $denominator): int
    {
        if ($denominator === 0) {
            throw new InvalidArgumentException('Division by zero');
        }
        if ($numerator === 0) {
            return 0;
        }
        $negative = ($numerator < 0) !== ($denominator < 0);
        $a = abs($numerator);
        $b = abs($denominator);
        $q = intdiv($a, $b);
        $r = $a % $b;
        if (2 * $r >= $b) {
            $q++;
        }

        return $negative && $q !== 0 ? -$q : $q;
    }

    /** round(a × b ÷ c), exact for any 64-bit inputs (switches to bcmath when a × b would overflow). */
    public static function mulDivRound(int $a, int $b, int $c): int
    {
        if ($a === 0 || $b === 0 || abs($b) <= intdiv(PHP_INT_MAX, abs($a))) {
            return self::divRound($a * $b, $c);
        }
        $negative = ((($a < 0) xor ($b < 0)) xor ($c < 0));
        $num = bcmul((string) abs($a), (string) abs($b));
        $den = (string) abs($c);
        $q = bcdiv($num, $den, 0);
        $r = bcmod($num, $den);
        if (bccomp(bcmul($r, '2'), $den) >= 0) {
            $q = bcadd($q, '1');
        }
        $result = (int) $q;

        return $negative && $result !== 0 ? -$result : $result;
    }

    /**
     * Largest-remainder allocation of an integer total across weights. Ties go to the lower index.
     *
     * @param  array<int, int>  $weights
     * @return array<int, int>
     */
    public static function allocate(int $total, array $weights): array
    {
        $n = count($weights);
        if ($n === 0) {
            return [];
        }
        $weights = array_values(array_map(fn ($w) => $w > 0 ? (int) $w : 0, $weights));
        if ($total === 0) {
            return array_fill(0, $n, 0);
        }
        $sign = $total < 0 ? -1 : 1;
        $abs = abs($total);
        $sum = array_sum($weights);
        if ($sum === 0) {
            $base = intdiv($abs, $n);
            $extra = $abs - $base * $n;
            $out = [];
            for ($i = 0; $i < $n; $i++) {
                $out[] = $sign * ($base + ($i < $extra ? 1 : 0));
            }

            return $out;
        }

        $parts = [];
        foreach ($weights as $i => $w) {
            $product = $abs * $w;
            $parts[] = ['index' => $i, 'q' => intdiv($product, $sum), 'r' => $product % $sum];
        }
        $remaining = $abs - array_sum(array_column($parts, 'q'));
        $order = $parts;
        usort($order, fn ($x, $y) => ($y['r'] <=> $x['r']) ?: ($x['index'] <=> $y['index']));
        foreach ($order as $part) {
            if ($remaining <= 0) {
                break;
            }
            $parts[$part['index']]['q']++;
            $remaining--;
        }

        return array_map(fn ($p) => $sign * $p['q'], $parts);
    }

    public static function round(int|float|string|null $value, int $decimals = self::DEFAULT_DECIMALS): float
    {
        return self::fromScaled(self::toScaled($value, $decimals), $decimals);
    }

    public static function qty(int|float|string|null $value): float
    {
        return self::fromScaled(self::toScaled($value, self::QTY_SCALE), self::QTY_SCALE);
    }

    /** Exact equality of two money values at currency precision. */
    public static function equals(int|float|string|null $a, int|float|string|null $b, int $decimals = self::DEFAULT_DECIMALS): bool
    {
        return self::toScaled($a, $decimals) === self::toScaled($b, $decimals);
    }
}
