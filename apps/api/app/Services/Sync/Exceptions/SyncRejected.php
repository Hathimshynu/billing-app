<?php

namespace App\Services\Sync\Exceptions;

use RuntimeException;

/**
 * An operation the server will not apply. Retryable rejections (e.g. a referenced record has not
 * been synced yet) are not stored, so the device retries them; permanent ones are recorded and
 * shown in the device's Sync Center for the user to fix.
 */
class SyncRejected extends RuntimeException
{
    /** @param array<string, list<string>>|null $errors */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly ?array $errors = null,
        public readonly bool $retryable = false,
    ) {
        parent::__construct($message);
    }

    public static function dependency(string $what): self
    {
        return new self('dependency_missing', "{$what} has not been synced yet.", null, true);
    }

    public static function forbidden(string $permission): self
    {
        return new self('forbidden', "Permission denied: {$permission}.");
    }

    /** @param array<string, list<string>> $errors */
    public static function invalid(array $errors, string $message = 'The operation payload is invalid.'): self
    {
        return new self('validation_failed', $message, $errors);
    }
}
