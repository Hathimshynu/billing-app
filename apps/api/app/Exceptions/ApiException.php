<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Domain error rendered as the standard API error envelope:
 * { "success": false, "message": "...", "errors": {} }
 */
class ApiException extends RuntimeException
{
    /** @param array<string, list<string>> $errors */
    public function __construct(string $message, private readonly int $status = 422, private readonly array $errors = [])
    {
        parent::__construct($message);
    }

    public function status(): int
    {
        return $this->status;
    }

    /** @return array<string, list<string>> */
    public function errors(): array
    {
        return $this->errors;
    }
}
