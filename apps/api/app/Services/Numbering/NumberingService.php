<?php

namespace App\Services\Numbering;

use App\Domain\Numbering\DocumentNumberFormatter;
use App\Models\BusinessSetting;
use App\Models\Device;
use App\Models\DocumentRegister;
use App\Models\InvoiceNumberBlock;
use App\Models\InvoiceSequence;
use App\Models\Store;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Offline-safe document numbering.
 *
 * Devices reserve blocks of numbers while online and issue them offline. When an offline device
 * runs out it issues a provisional number (TMP-C1-00001) and the server assigns the final number
 * here during sync. Every final number is written to the document register (`invoices`), which
 * has a unique index — two documents can never share a number.
 */
class NumberingService
{
    public function __construct(private readonly TenantContext $tenant) {}

    public function format(string $documentType): string
    {
        $settings = BusinessSetting::query()->where('key', 'invoice')->value('value');
        $value = is_string($settings) ? json_decode($settings, true) : $settings;
        $formats = is_array($value) ? ($value['formats'] ?? []) : [];

        return $formats[$documentType] ?? DocumentNumberFormatter::DEFAULT_FORMATS[$documentType] ?? strtoupper($documentType).'-{YYYY}-{SEQ:5}';
    }

    private function fyStartMonth(): int
    {
        return (int) ($this->tenant->business()->fy_start_month ?? 4);
    }

    private function sequence(string $documentType, string $period, string $format, string $seriesKey): InvoiceSequence
    {
        $query = fn () => InvoiceSequence::query()
            ->where('document_type', $documentType)
            ->where('series_key', $seriesKey)
            ->where('period', $period)
            ->lockForUpdate()
            ->first();

        $sequence = $query();
        if ($sequence) {
            return $sequence;
        }
        InvoiceSequence::query()->insertOrIgnore([
            'id' => (string) Str::uuid7(),
            'business_id' => $this->tenant->businessId(),
            'document_type' => $documentType,
            'series_key' => $seriesKey,
            'period' => $period,
            'format' => $format,
            'next_number' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $query() ?? throw new RuntimeException('Unable to create numbering sequence.');
    }

    /**
     * Reserve a contiguous block of numbers for a device.
     */
    public function reserveBlock(Device $device, string $documentType, string $date, int $size = 50): InvoiceNumberBlock
    {
        $size = max(1, min($size, 1000));
        $format = $this->format($documentType);
        $period = DocumentNumberFormatter::period($format, $date, $this->fyStartMonth());
        $seriesKey = DocumentNumberFormatter::isPerDevice($format) ? $device->code : '';
        $sequence = $this->sequence($documentType, $period, $format, $seriesKey);

        $start = $sequence->next_number;
        $sequence->next_number = $start + $size;
        $sequence->save();

        return InvoiceNumberBlock::query()->create([
            'sequence_id' => $sequence->id,
            'device_id' => $device->id,
            'document_type' => $documentType,
            'period' => $period,
            'format' => $format,
            'start_number' => $start,
            'end_number' => $start + $size - 1,
        ]);
    }

    /**
     * Allocate the next number directly on the server (online REST documents and provisional
     * numbers being finalised during sync).
     *
     * @return array{number: string, sequence: int, period: string}
     */
    public function allocate(string $documentType, string $date, ?Device $device = null, ?string $storeId = null): array
    {
        $format = $this->format($documentType);
        $period = DocumentNumberFormatter::period($format, $date, $this->fyStartMonth());
        $perDevice = DocumentNumberFormatter::isPerDevice($format);
        $deviceCode = $device->code ?? 'SRV';
        $seriesKey = $perDevice ? $deviceCode : '';
        $sequence = $this->sequence($documentType, $period, $format, $seriesKey);
        $storeCode = $storeId ? Store::query()->whereKey($storeId)->value('code') : null;

        // Skip numbers that might already exist (e.g. after manual data fixes).
        do {
            $seq = $sequence->next_number;
            $sequence->next_number = $seq + 1;
            $number = DocumentNumberFormatter::format($format, $seq, $date, $deviceCode, $storeCode, $this->fyStartMonth());
        } while (DocumentRegister::query()->where('document_type', $documentType)->where('number', $number)->exists());
        $sequence->save();

        return ['number' => $number, 'sequence' => $seq, 'period' => $period];
    }

    /**
     * Accept the number a device issued, or assign a final one. Returns the final number and
     * whether it differs from what the device printed.
     *
     * @return array{number: string, reassigned: bool, provisional: ?string}
     */
    public function finalize(
        string $documentType,
        string $entityType,
        string $entityId,
        ?string $clientNumber,
        ?string $numberStatus,
        ?string $blockId,
        ?int $sequenceNumber,
        string $date,
        ?Device $device,
        ?string $storeId = null,
    ): array {
        $existing = DocumentRegister::query()->where('entity_type', $entityType)->where('entity_id', $entityId)->first();
        if ($existing) {
            return ['number' => $existing->number, 'reassigned' => $existing->number !== $clientNumber, 'provisional' => $existing->provisional_number];
        }

        if ($clientNumber && $numberStatus === 'final' && $this->isValidBlockNumber($documentType, $clientNumber, $blockId, $sequenceNumber, $date, $device, $storeId)) {
            $this->register($documentType, $clientNumber, $sequenceNumber, $entityType, $entityId, $device, $blockId, null);

            return ['number' => $clientNumber, 'reassigned' => false, 'provisional' => null];
        }

        $allocated = $this->allocate($documentType, $date, $device, $storeId);
        $this->register($documentType, $allocated['number'], $allocated['sequence'], $entityType, $entityId, $device, null, $clientNumber, $allocated['period']);

        return ['number' => $allocated['number'], 'reassigned' => $clientNumber !== null && $clientNumber !== $allocated['number'], 'provisional' => $clientNumber];
    }

    private function isValidBlockNumber(string $documentType, string $number, ?string $blockId, ?int $sequenceNumber, string $date, ?Device $device, ?string $storeId): bool
    {
        if (! $blockId || ! $sequenceNumber || ! $device) {
            return false;
        }
        $block = InvoiceNumberBlock::query()->whereKey($blockId)->first();
        if (! $block || $block->device_id !== $device->id || $block->document_type !== $documentType) {
            return false;
        }
        if ($sequenceNumber < $block->start_number || $sequenceNumber > $block->end_number) {
            return false;
        }
        if (DocumentNumberFormatter::period($block->format, $date, $this->fyStartMonth()) !== $block->period) {
            return false;
        }
        $storeCode = $storeId ? Store::query()->whereKey($storeId)->value('code') : null;
        $expected = DocumentNumberFormatter::format($block->format, $sequenceNumber, $date, $device->code, $storeCode, $this->fyStartMonth());
        if ($expected !== $number) {
            return false;
        }

        return ! DocumentRegister::query()->where('document_type', $documentType)->where('number', $number)->exists();
    }

    public function register(string $documentType, string $number, ?int $sequence, string $entityType, string $entityId, ?Device $device, ?string $blockId, ?string $provisional, ?string $period = null): void
    {
        DocumentRegister::query()->create([
            'document_type' => $documentType,
            'number' => $number,
            'sequence_number' => $sequence,
            'period' => $period,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'device_id' => $device?->id,
            'block_id' => $blockId,
            'provisional_number' => $provisional,
            'status' => 'issued',
            'issued_at' => now(),
        ]);
    }

    public function markCancelled(string $entityType, string $entityId): void
    {
        DocumentRegister::query()->where('entity_type', $entityType)->where('entity_id', $entityId)->update(['status' => 'cancelled']);
    }
}
