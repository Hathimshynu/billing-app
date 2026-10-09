<?php

namespace App\Services\Sync;

/**
 * Semantic equality for conflict detection: 31999 == 31999.0, '' == null, key order of objects
 * does not matter.
 */
final class ValueComparator
{
    public static function equals(mixed $a, mixed $b): bool
    {
        return json_encode(self::normalize($a)) === json_encode(self::normalize($b));
    }

    public static function normalize(mixed $value): mixed
    {
        if ($value === '' || $value === null) {
            return null;
        }
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value) || is_float($value)) {
            return (string) round((float) $value, 6);
        }
        if (is_object($value)) {
            $value = (array) $value;
        }
        if (is_array($value)) {
            $normalized = array_map([self::class, 'normalize'], $value);
            if (! array_is_list($normalized)) {
                ksort($normalized);
            }

            return $normalized;
        }

        return is_string($value) ? trim($value) : $value;
    }
}
