<?php

namespace App\Services\Sync;

use App\Models\Device;

/**
 * One operation pushed by a device, as seen by an operation handler.
 */
final class OperationContext
{
    /** @param array<string, mixed> $payload */
    public function __construct(
        public readonly string $operationId,
        public readonly string $operation,
        public readonly string $entityType,
        public readonly string $entityId,
        public readonly array $payload,
        public readonly ?int $baseVersion,
        public readonly ?string $clientCreatedAt,
        public readonly string $userId,
        public readonly ?Device $device,
    ) {}

    public function deviceId(): ?string
    {
        return $this->device?->id;
    }
}
