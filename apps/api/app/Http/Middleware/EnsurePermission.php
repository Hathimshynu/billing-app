<?php

namespace App\Http\Middleware;

use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route-level RBAC: `permission:products.create` or `permission:sales.view|sales.view_all` (any).
 * Never trust the client: every protected endpoint is checked on the server.
 */
class EnsurePermission
{
    public function __construct(private readonly TenantContext $tenant) {}

    public function handle(Request $request, Closure $next, string $permissions): Response
    {
        foreach (explode('|', $permissions) as $permission) {
            if ($this->tenant->can($permission)) {
                return $next($request);
            }
        }

        return response()->json([
            'success' => false,
            'message' => 'You do not have permission to perform this action.',
            'errors' => (object) [],
        ], 403);
    }
}
