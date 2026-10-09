<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Api\V1\Concerns\RunsOperations;
use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductVariant;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    use RunsOperations;

    public function index(Request $request): JsonResponse
    {
        $query = Product::query()->with(['variants', 'extraBarcodes', 'priceTiers'])->orderBy('name');
        if ($search = trim((string) $request->query('search', ''))) {
            $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $search).'%';
            $variantProducts = ProductVariant::query()->where('barcode', $search)->orWhere('sku', $search)->pluck('product_id');
            $barcodeProducts = ProductBarcode::query()->where('barcode', $search)->pluck('product_id');
            $query->where(fn ($q) => $q->where('name', 'like', $like)
                ->orWhere('sku', $search)
                ->orWhere('barcode', $search)
                ->orWhereIn('id', $variantProducts)
                ->orWhereIn('id', $barcodeProducts));
        }
        if ($category = $request->query('category_id')) {
            $query->where('category_id', $category);
        }
        if ($request->has('active')) {
            $query->where('active', $request->boolean('active'));
        }

        return ApiResponse::paginated($query->paginate(min((int) $request->query('per_page', 50), 200)), fn (Product $p) => $p->toSyncArray());
    }

    public function show(string $id): JsonResponse
    {
        return ApiResponse::ok(Product::query()->findOrFail($id)->toSyncArray());
    }

    public function store(Request $request): JsonResponse
    {
        return $this->runOperation('CREATE_PRODUCT', 'product', $request->input('id'), $request->except('id'), 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        Product::query()->findOrFail($id);

        return $this->runOperation('UPDATE_PRODUCT', 'product', $id, [
            'changes' => $request->input('changes', $request->except(['base', 'base_version'])),
            'base' => $request->input('base', []),
        ], 200, $request->has('base_version') ? (int) $request->input('base_version') : null);
    }

    public function destroy(string $id): JsonResponse
    {
        Product::query()->findOrFail($id);

        return $this->runOperation('DELETE_PRODUCT', 'product', $id, []);
    }

    public function categories(): JsonResponse
    {
        return ApiResponse::ok(Category::query()->orderBy('sort_order')->orderBy('name')->get()->map->toSyncArray()->values());
    }

    public function storeCategory(Request $request): JsonResponse
    {
        return $this->runOperation('CREATE_CATEGORY', 'category', $request->input('id'), $request->except('id'), 201);
    }
}
