<?php

use App\Http\Controllers\Api\V1\AdminController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\BusinessController;
use App\Http\Controllers\Api\V1\DeviceController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\InventoryController;
use App\Http\Controllers\Api\V1\MemberController;
use App\Http\Controllers\Api\V1\PartyController;
use App\Http\Controllers\Api\V1\ProductController;
use App\Http\Controllers\Api\V1\PurchaseController;
use App\Http\Controllers\Api\V1\ReportController;
use App\Http\Controllers\Api\V1\RoleController;
use App\Http\Controllers\Api\V1\SaleController;
use App\Http\Controllers\Api\V1\StoreController;
use App\Http\Controllers\Api\V1\SyncController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| ShopDesk API v1
|--------------------------------------------------------------------------
| Authentication: Sanctum bearer tokens. Tenant: X-Business-Id header. Device: X-Device-Id header
| (required for sync). See docs/API.md.
*/

Route::prefix('v1')->group(function () {
    Route::get('health', HealthController::class)->name('health');

    Route::middleware('throttle:auth')->group(function () {
        Route::post('auth/register', [AuthController::class, 'register']);
        Route::post('auth/login', [AuthController::class, 'login']);
    });

    Route::middleware(['auth:sanctum', 'throttle:api'])->group(function () {
        Route::get('auth/me', [AuthController::class, 'me']);
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::post('auth/password', [AuthController::class, 'changePassword']);
        Route::post('businesses', [BusinessController::class, 'store']);

        Route::middleware('tenant')->group(function () {
            Route::get('business', [BusinessController::class, 'show']);
            Route::put('business', [BusinessController::class, 'update'])->middleware('permission:settings.manage');
            Route::post('devices/register', [DeviceController::class, 'register']);

            // Synchronization (registered device required).
            Route::middleware(['device', 'throttle:sync'])->group(function () {
                Route::post('sync/push', [SyncController::class, 'push']);
                Route::post('sync/pull', [SyncController::class, 'pull']);
                Route::get('sync/status', [SyncController::class, 'status']);
                Route::post('devices/number-blocks', [DeviceController::class, 'numberBlocks']);
            });

            Route::middleware('device:optional')->group(function () {
                Route::get('sync/conflicts', [SyncController::class, 'conflicts'])->middleware('permission:sync.manage');

                // Administration (online only)
                Route::get('devices', [DeviceController::class, 'index'])->middleware('permission:devices.manage');
                Route::post('devices/{id}/revoke', [DeviceController::class, 'revoke'])->middleware('permission:devices.manage');
                Route::get('members', [MemberController::class, 'index'])->middleware('permission:users.manage');
                Route::post('members', [MemberController::class, 'store'])->middleware('permission:users.manage');
                Route::put('members/{userId}', [MemberController::class, 'update'])->middleware('permission:users.manage');
                Route::get('roles', [RoleController::class, 'index'])->middleware('permission:roles.manage|users.manage');
                Route::post('roles', [RoleController::class, 'store'])->middleware('permission:roles.manage');
                Route::put('roles/{id}', [RoleController::class, 'update'])->middleware('permission:roles.manage');
                Route::get('stores', [StoreController::class, 'index']);
                Route::post('stores', [StoreController::class, 'store'])->middleware('permission:stores.manage');
                Route::put('stores/{id}', [StoreController::class, 'update'])->middleware('permission:stores.manage');
                Route::get('audit-logs', [AdminController::class, 'auditLogs'])->middleware('permission:audit.view');
                Route::get('backup/export', [AdminController::class, 'export'])->middleware('permission:backup.manage');
                Route::post('attachments', [AdminController::class, 'uploadAttachment'])->middleware('permission:expenses.create');

                // Catalogue
                Route::get('products', [ProductController::class, 'index'])->middleware('permission:products.view');
                Route::get('products/{id}', [ProductController::class, 'show'])->middleware('permission:products.view');
                Route::post('products', [ProductController::class, 'store'])->middleware('permission:products.create');
                Route::put('products/{id}', [ProductController::class, 'update'])->middleware('permission:products.edit');
                Route::delete('products/{id}', [ProductController::class, 'destroy'])->middleware('permission:products.delete');
                Route::get('categories', [ProductController::class, 'categories'])->middleware('permission:products.view');
                Route::post('categories', [ProductController::class, 'storeCategory'])->middleware('permission:products.create');

                // Customers & suppliers
                Route::where(['type' => 'customers|suppliers'])->group(function () {
                    Route::get('{type}', [PartyController::class, 'index'])->middleware('permission:customers.view|suppliers.view');
                    Route::post('{type}', [PartyController::class, 'store'])->middleware('permission:customers.create|suppliers.create');
                    Route::get('{type}/{id}', [PartyController::class, 'show'])->middleware('permission:customers.view|suppliers.view');
                    Route::put('{type}/{id}', [PartyController::class, 'update'])->middleware('permission:customers.edit|suppliers.edit');
                    Route::delete('{type}/{id}', [PartyController::class, 'destroy'])->middleware('permission:customers.delete|suppliers.delete');
                    Route::get('{type}/{id}/ledger', [PartyController::class, 'ledger'])->middleware('permission:customers.view|suppliers.view');
                });

                // Sales
                Route::get('sales', [SaleController::class, 'index'])->middleware('permission:sales.view');
                Route::get('sales/{id}', [SaleController::class, 'show'])->middleware('permission:sales.view');
                Route::post('sales', [SaleController::class, 'store'])->middleware('permission:sales.create');
                Route::post('sales/{id}/cancel', [SaleController::class, 'cancel'])->middleware('permission:sales.delete');
                Route::post('sales/{id}/returns', [SaleController::class, 'storeReturn'])->middleware('permission:sales.refund');

                // Purchases
                Route::get('purchases', [PurchaseController::class, 'index'])->middleware('permission:purchases.view');
                Route::get('purchases/{id}', [PurchaseController::class, 'show'])->middleware('permission:purchases.view');
                Route::post('purchases', [PurchaseController::class, 'store'])->middleware('permission:purchases.create');
                Route::post('purchases/{id}/receive', [PurchaseController::class, 'receive'])->middleware('permission:purchases.edit');
                Route::post('purchases/{id}/cancel', [PurchaseController::class, 'cancel'])->middleware('permission:purchases.delete');
                Route::post('purchases/{id}/returns', [PurchaseController::class, 'storeReturn'])->middleware('permission:purchases.return');

                // Inventory & expenses
                Route::get('inventory', [InventoryController::class, 'index'])->middleware('permission:inventory.view');
                Route::get('inventory/{productId}/movements', [InventoryController::class, 'movements'])->middleware('permission:inventory.view');
                Route::post('inventory/adjustments', [InventoryController::class, 'adjust'])->middleware('permission:inventory.adjust');
                Route::post('inventory/transfers', [InventoryController::class, 'transfer'])->middleware('permission:inventory.transfer');
                Route::get('expenses', [InventoryController::class, 'expenses'])->middleware('permission:expenses.view');
                Route::post('expenses', [InventoryController::class, 'storeExpense'])->middleware('permission:expenses.create');

                // Reports
                Route::middleware('permission:reports.view')->prefix('reports')->group(function () {
                    Route::get('dashboard', [ReportController::class, 'dashboard']);
                    Route::get('sales', [ReportController::class, 'sales']);
                    Route::get('top-products', [ReportController::class, 'topProducts']);
                    Route::get('payments', [ReportController::class, 'payments']);
                    Route::get('tax', [ReportController::class, 'tax']);
                    Route::get('profit', [ReportController::class, 'profit'])->middleware('permission:reports.financial');
                });
            });
        });
    });
});
