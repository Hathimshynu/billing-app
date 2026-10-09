<?php

namespace App\Http\Middleware;

use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guarantees no tenant state leaks between requests handled by the same process
 * (long-running workers, tests). Tenant routes then resolve the context explicitly.
 */
class ResetTenant
{
    public function __construct(private readonly TenantContext $tenant) {}

    public function handle(Request $request, Closure $next): Response
    {
        $this->tenant->clear();

        return $next($request);
    }
}
