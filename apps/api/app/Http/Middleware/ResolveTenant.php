<?php

namespace App\Http\Middleware;

use App\Models\Business;
use App\Models\BusinessUser;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the business from the X-Business-Id header and verifies the authenticated user is an
 * active member. Every tenant query is then scoped to that business (BusinessScope).
 */
class ResolveTenant
{
    public function __construct(private readonly TenantContext $tenant) {}

    public function handle(Request $request, Closure $next): Response
    {
        /** @var User|null $user */
        $user = $request->user();
        $businessId = (string) $request->header('X-Business-Id', '');
        if (! $user || ! preg_match('/^[0-9a-f-]{36}$/i', $businessId)) {
            return response()->json(['success' => false, 'message' => 'Select a business (X-Business-Id header).', 'errors' => (object) []], 400);
        }

        $member = BusinessUser::query()->withoutGlobalScopes()
            ->with(['role' => fn ($q) => $q->withoutGlobalScopes()->with('permissions')])
            ->where('business_id', $businessId)
            ->where('user_id', $user->id)
            ->first();
        $business = $member ? Business::query()->find($businessId) : null;
        if (! $member || ! $business || ! $member->isActive() || $business->status !== 'active') {
            // Same response for "not found" and "not a member" so business ids cannot be probed.
            return response()->json(['success' => false, 'message' => 'You do not have access to this business.', 'errors' => (object) []], 403);
        }

        $this->tenant->set($business, $user, $member, $member->effectivePermissions());

        return $next($request);
    }
}
