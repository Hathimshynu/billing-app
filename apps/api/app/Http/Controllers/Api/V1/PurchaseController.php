<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Api\V1\Concerns\RunsOperations;
use App\Http\Controllers\Controller;
use App\Models\Purchase;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PurchaseController extends Controller
{
    use RunsOperations;

    public function index(Request $request): JsonResponse
    {
        $query = Purchase::query()->with(['items', 'payments'])->orderByDesc('purchase_date')->orderByDesc('created_at');
        foreach (['doc_type', 'status', 'supplier_id', 'store_id', 'payment_status'] as $filter) {
            if ($value = $request->query($filter)) {
                $query->where($filter, $value);
            }
        }
        if ($from = $request->query('from')) {
            $query->where('purchase_date', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->where('purchase_date', '<=', $to);
        }

        return ApiResponse::paginated($query->paginate(min((int) $request->query('per_page', 50), 200)), fn (Purchase $p) => $p->toSyncArray());
    }

    public function show(string $id): JsonResponse
    {
        return ApiResponse::ok(Purchase::query()->findOrFail($id)->toSyncArray());
    }

    public function store(Request $request): JsonResponse
    {
        return $this->runOperation('CREATE_PURCHASE', 'purchase', $request->input('id'), $request->except('id'), 201);
    }

    public function receive(Request $request, string $id): JsonResponse
    {
        Purchase::query()->findOrFail($id);

        return $this->runOperation('RECEIVE_PURCHASE', 'purchase', $id, $request->all());
    }

    public function cancel(string $id): JsonResponse
    {
        Purchase::query()->findOrFail($id);

        return $this->runOperation('CANCEL_PURCHASE', 'purchase', $id, []);
    }

    public function storeReturn(Request $request, string $id): JsonResponse
    {
        Purchase::query()->findOrFail($id);

        return $this->runOperation('CREATE_PURCHASE_RETURN', 'purchase_return', $request->input('id'), ['purchase_id' => $id] + $request->except('id'), 201);
    }
}
