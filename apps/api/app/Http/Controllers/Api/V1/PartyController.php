<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Api\V1\Concerns\RunsOperations;
use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\CustomerLedgerEntry;
use App\Models\Supplier;
use App\Models\SupplierLedgerEntry;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Customers and suppliers (REST). Routes pass the party type.
 */
class PartyController extends Controller
{
    use RunsOperations;

    private function model(string $type): string
    {
        return $type === 'suppliers' ? Supplier::class : Customer::class;
    }

    private function entity(string $type): string
    {
        return $type === 'suppliers' ? 'supplier' : 'customer';
    }

    public function index(Request $request, string $type): JsonResponse
    {
        $class = $this->model($type);
        $query = $class::query()->orderBy('name');
        if ($search = trim((string) $request->query('search', ''))) {
            $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $search).'%';
            $query->where(fn ($q) => $q->where('name', 'like', $like)->orWhere('phone', 'like', $like)->orWhere('gstin', $search));
        }
        if ($request->boolean('with_balance')) {
            $query->where('balance', '!=', 0);
        }

        return ApiResponse::paginated($query->paginate(min((int) $request->query('per_page', 50), 200)), fn ($m) => $m->toSyncArray());
    }

    public function show(string $type, string $id): JsonResponse
    {
        $class = $this->model($type);

        return ApiResponse::ok($class::query()->findOrFail($id)->toSyncArray());
    }

    public function store(Request $request, string $type): JsonResponse
    {
        $entity = $this->entity($type);

        return $this->runOperation('CREATE_'.strtoupper($entity), $entity, $request->input('id'), $request->except('id'), 201);
    }

    public function update(Request $request, string $type, string $id): JsonResponse
    {
        $class = $this->model($type);
        $class::query()->findOrFail($id);
        $entity = $this->entity($type);

        return $this->runOperation('UPDATE_'.strtoupper($entity), $entity, $id, [
            'changes' => $request->input('changes', $request->except(['base', 'base_version'])),
            'base' => $request->input('base', []),
        ], 200, $request->has('base_version') ? (int) $request->input('base_version') : null);
    }

    public function destroy(string $type, string $id): JsonResponse
    {
        $class = $this->model($type);
        $class::query()->findOrFail($id);
        $entity = $this->entity($type);

        return $this->runOperation('DELETE_'.strtoupper($entity), $entity, $id, []);
    }

    public function ledger(string $type, string $id): JsonResponse
    {
        $class = $this->model($type);
        $party = $class::query()->findOrFail($id);
        $entries = ($type === 'suppliers' ? SupplierLedgerEntry::query()->where('supplier_id', $id) : CustomerLedgerEntry::query()->where('customer_id', $id))
            ->orderBy('occurred_at')->orderBy('created_at')->get();
        $running = 0.0;
        $rows = $entries->map(function ($e) use (&$running, $type) {
            $running += $type === 'suppliers' ? ((float) $e->credit - (float) $e->debit) : ((float) $e->debit - (float) $e->credit);

            return $e->toSyncArray() + ['balance' => round($running, 2)];
        });

        return ApiResponse::ok(['party' => $party->toSyncArray(), 'entries' => $rows->values(), 'balance' => round($running, 2)]);
    }
}
