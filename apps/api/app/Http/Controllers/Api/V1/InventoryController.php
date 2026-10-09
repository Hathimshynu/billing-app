<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Api\V1\Concerns\RunsOperations;
use App\Http\Controllers\Controller;
use App\Models\Expense;
use App\Models\InventoryMovement;
use App\Models\Product;
use App\Models\StockLevel;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class InventoryController extends Controller
{
    use RunsOperations;

    public function index(Request $request): JsonResponse
    {
        $query = StockLevel::query()
            ->join('products', 'products.id', '=', 'inventory.product_id')
            ->select('inventory.*', 'products.name as product_name', 'products.sku as product_sku', 'products.reorder_level')
            ->orderBy('products.name');
        if ($store = $request->query('store_id')) {
            $query->where('inventory.store_id', $store);
        }
        if ($product = $request->query('product_id')) {
            $query->where('inventory.product_id', $product);
        }
        if ($request->boolean('low_stock')) {
            $query->whereColumn('inventory.qty', '<=', 'products.reorder_level');
        }

        return ApiResponse::paginated($query->paginate(min((int) $request->query('per_page', 100), 500)), fn (StockLevel $s) => $s->toSyncArray() + [
            'product_name' => $s->getAttribute('product_name'),
            'product_sku' => $s->getAttribute('product_sku'),
            'reorder_level' => (float) $s->getAttribute('reorder_level'),
            'value' => round((float) $s->qty * (float) $s->avg_cost, 2),
        ]);
    }

    public function movements(Request $request, string $productId): JsonResponse
    {
        Product::withTrashed()->findOrFail($productId);
        $query = InventoryMovement::query()->where('product_id', $productId)->orderBy('occurred_at')->orderBy('created_at');
        if ($store = $request->query('store_id')) {
            $query->where('store_id', $store);
        }

        return ApiResponse::paginated($query->paginate(min((int) $request->query('per_page', 100), 500)), fn (InventoryMovement $m) => $m->toSyncArray());
    }

    public function adjust(Request $request): JsonResponse
    {
        return $this->runOperation('CREATE_STOCK_ADJUSTMENT', 'stock_adjustment', $request->input('id'), $request->except('id'), 201);
    }

    public function transfer(Request $request): JsonResponse
    {
        return $this->runOperation('CREATE_STOCK_TRANSFER', 'stock_transfer', $request->input('id'), $request->except('id'), 201);
    }

    public function expenses(Request $request): JsonResponse
    {
        $query = Expense::query()->orderByDesc('expense_date');
        if ($from = $request->query('from')) {
            $query->where('expense_date', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->where('expense_date', '<=', $to);
        }

        return ApiResponse::paginated($query->paginate(min((int) $request->query('per_page', 50), 200)), fn (Expense $e) => $e->toSyncArray());
    }

    public function storeExpense(Request $request): JsonResponse
    {
        return $this->runOperation('CREATE_EXPENSE', 'expense', $request->input('id'), $request->except('id'), 201);
    }
}
