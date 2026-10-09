<?php

namespace App\Domain\Numbering;

/**
 * Document number formatting. Mirrors packages/shared/src/numbering.ts.
 *
 * Tokens: {YYYY} {YY} {MM} {FY} {FYY} {DEVICE} {STORE} {SEQ} {SEQ:n}
 */
final class DocumentNumberFormatter
{
    public const DEFAULT_FORMATS = [
        'sale' => 'INV-{YYYY}-{SEQ:6}',
        'quotation' => 'QT-{YYYY}-{SEQ:5}',
        'estimate' => 'EST-{YYYY}-{SEQ:5}',
        'proforma' => 'PI-{YYYY}-{SEQ:5}',
        'delivery_challan' => 'DC-{YYYY}-{SEQ:5}',
        'sale_return' => 'CN-{YYYY}-{SEQ:5}',
        'purchase' => 'PUR-{YYYY}-{SEQ:5}',
        'purchase_order' => 'PO-{YYYY}-{SEQ:5}',
        'purchase_return' => 'DN-{YYYY}-{SEQ:5}',
        'expense' => 'EXP-{YYYY}-{SEQ:5}',
        'customer_payment' => 'RCPT-{YYYY}-{SEQ:5}',
        'supplier_payment' => 'PAY-{YYYY}-{SEQ:5}',
        'stock_transfer' => 'TRF-{YYYY}-{SEQ:5}',
        'kot' => 'KOT-{SEQ:4}',
        'jewellery_order' => 'JO-{YYYY}-{SEQ:5}',
    ];

    /** Sale doc types map to their own numbering series. */
    public const SALE_DOC_SERIES = [
        'invoice' => 'sale',
        'quotation' => 'quotation',
        'estimate' => 'estimate',
        'proforma' => 'proforma',
        'delivery_challan' => 'delivery_challan',
    ];

    public static function financialYearStart(string $date, int $fyStartMonth = 4): int
    {
        [$year, $month] = array_map('intval', explode('-', substr($date, 0, 10)));

        return $month >= $fyStartMonth ? $year : $year - 1;
    }

    public static function format(string $format, int $sequence, string $date, ?string $deviceCode = null, ?string $storeCode = null, int $fyStartMonth = 4): string
    {
        [$year, $month] = array_map('intval', explode('-', substr($date, 0, 10)));
        $fyStart = self::financialYearStart($date, $fyStartMonth);
        $fyEndShort = str_pad((string) (($fyStart + 1) % 100), 2, '0', STR_PAD_LEFT);

        return preg_replace_callback('/\{([A-Z]+)(?::(\d+))?\}/', function ($m) use ($year, $month, $fyStart, $fyEndShort, $fyStartMonth, $sequence, $deviceCode, $storeCode) {
            return match ($m[1]) {
                'YYYY' => (string) $year,
                'YY' => str_pad((string) ($year % 100), 2, '0', STR_PAD_LEFT),
                'MM' => str_pad((string) $month, 2, '0', STR_PAD_LEFT),
                'FY' => $fyStartMonth === 1 ? (string) $year : "{$fyStart}-{$fyEndShort}",
                'FYY' => $fyStartMonth === 1
                    ? str_pad((string) ($year % 100), 2, '0', STR_PAD_LEFT)
                    : str_pad((string) ($fyStart % 100), 2, '0', STR_PAD_LEFT).$fyEndShort,
                'DEVICE' => $deviceCode ?? '',
                'STORE' => $storeCode ?? '',
                'SEQ' => str_pad((string) $sequence, max((int) ($m[2] ?? 0), 0) ?: 6, '0', STR_PAD_LEFT),
                default => $m[0],
            };
        }, $format) ?? $format;
    }

    public static function period(string $format, string $date, int $fyStartMonth = 4): string
    {
        [$year, $month] = array_map('intval', explode('-', substr($date, 0, 10)));
        if (str_contains($format, '{MM}')) {
            return sprintf('%d-%02d', $year, $month);
        }
        if (preg_match('/\{FYY?\}/', $format)) {
            return 'FY'.self::financialYearStart($date, $fyStartMonth);
        }
        if (preg_match('/\{YYYY\}|\{YY\}/', $format)) {
            return (string) $year;
        }

        return 'all';
    }

    public static function isPerDevice(string $format): bool
    {
        return str_contains($format, '{DEVICE}');
    }
}
