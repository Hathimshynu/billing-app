<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Api\V1\Concerns\RunsOperations;
use App\Http\Controllers\Controller;
use App\Models\Sale;
use App\Models\SaleReturn;
use App\Support\ApiResponse;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SaleController extends Controller
{
    use RunsOperations;

    public function __construct(private readonly TenantContext $tenant) {}

    public function index(Request $request): JsonResponse
    {
        $query = Sale::query()->with(['items', 'payments', 'creator'])->orderByDesc('occurred_at');
        if (! $this->tenant->can('sales.view_all')) {
            $query->where('created_by', $this->tenant->userId());
        }
        foreach (['doc_type', 'status', 'customer_id', 'store_id', 'payment_status'] as $filter) {
            if ($value = $request->query($filter)) {
                $query->where($filter, $value);
            }
        }
        if ($from = $request->query('from')) {
            $query->where('invoice_date', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->where('invoice_date', '<=', $to);
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $query->where(fn ($q) => $q->where('invoice_number', 'like', "%{$search}%")->orWhere('customer_name', 'like', "%{$search}%")->orWhere('customer_phone', 'like', "%{$search}%"));
        }

        return ApiResponse::paginated($query->paginate(min((int) $request->query('per_page', 50), 200)), fn (Sale $s) => $s->toSyncArray());
    }

    public function show(string $id): JsonResponse
    {
        $sale = Sale::query()->findOrFail($id);
        if (! $this->tenant->can('sales.view_all') && $sale->created_by !== $this->tenant->userId()) {
            return ApiResponse::error('You do not have permission to view this sale.', 403);
        }

        return ApiResponse::ok($sale->toSyncArray() + [
            'returns' => SaleReturn::query()->where('sale_id', $sale->id)->get()->map->toSyncArray()->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        return $this->runOperation('CREATE_SALE', 'sale', $request->input('id'), $request->except('id'), 201);
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        Sale::query()->findOrFail($id);
        $request->validate(['reason' => ['nullable', 'string', 'max:500']]);

        return $this->runOperation('CANCEL_SALE', 'sale', $id, ['reason' => $request->input('reason')]);
    }

    public function storeReturn(Request $request, string $id): JsonResponse
    {
        Sale::query()->findOrFail($id);

        return $this->runOperation('CREATE_SALE_RETURN', 'sale_return', $request->input('id'), ['sale_id' => $id] + $request->except('id'), 201);
    }
}
