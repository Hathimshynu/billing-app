<?php

namespace App\Models;

use Illuminate\Support\Facades\Storage;

class Expense extends SyncModel
{
    protected $casts = ['amount' => 'float', 'version' => 'integer'];

    public static function syncEntityType(): string
    {
        return 'expense';
    }

    /** @return array<string, mixed> */
    public function toSyncArray(): array
    {
        return [
            'id' => $this->id,
            'business_id' => $this->business_id,
            'store_id' => $this->store_id,
            'device_id' => $this->device_id,
            'register_id' => $this->register_id,
            'category_id' => $this->category_id,
            'category_name' => $this->category_name,
            'expense_number' => $this->expense_number,
            'amount' => $this->amount,
            'payment_method' => $this->payment_method,
            'expense_date' => self::date($this->expense_date),
            'reference' => $this->reference,
            'notes' => $this->notes,
            'attachment_url' => $this->attachment_path ? Storage::disk('public')->url($this->attachment_path) : null,
            'status' => $this->status,
            'created_by' => $this->created_by,
            'version' => $this->version,
            'created_at' => self::iso($this->created_at),
            'updated_at' => self::iso($this->updated_at),
        ];
    }
}
