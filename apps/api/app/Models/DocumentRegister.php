<?php

namespace App\Models;

use App\Models\Concerns\BelongsToBusiness;
use Illuminate\Database\Eloquent\Model;

/**
 * Register of every final document number issued (table `invoices`). Lets auditors verify that
 * numbering has no unexplained gaps and see which provisional numbers were reassigned.
 */
class DocumentRegister extends Model
{
    use BelongsToBusiness;

    protected $table = 'invoices';

    protected $guarded = [];

    protected $casts = ['issued_at' => 'datetime', 'sequence_number' => 'integer'];
}
