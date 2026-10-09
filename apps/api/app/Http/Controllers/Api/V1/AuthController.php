<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\BusinessUser;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    public function register(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'email' => ['required', 'email', 'max:190', 'unique:users,email'],
            'phone' => ['nullable', 'string', 'max:20'],
            'password' => ['required', 'confirmed', Password::min(8)->letters()->numbers()],
            'device_name' => ['nullable', 'string', 'max:100'],
        ]);
        $user = User::query()->create([
            'name' => $data['name'],
            'email' => strtolower($data['email']),
            'phone' => $data['phone'] ?? null,
            'password' => $data['password'],
            'last_login_at' => now(),
        ]);
        $token = $user->createToken($data['device_name'] ?? 'web', ['*'], $this->expiry())->plainTextToken;
        $this->audit->log('USER_REGISTERED', 'user', $user->id, null, ['email' => $user->email], $user->id);
        Log::channel('security')->info('register', ['user' => $user->id, 'ip' => $request->ip()]);

        return ApiResponse::created([
            'token' => $token,
            'user' => $user->toPublicArray(),
            'businesses' => [],
        ], 'Account created.');
    }

    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string', 'max:200'],
            'device_name' => ['nullable', 'string', 'max:100'],
        ]);
        $user = User::query()->where('email', strtolower($data['email']))->first();
        if (! $user || ! Hash::check($data['password'], $user->password) || $user->status !== 'active') {
            Log::channel('security')->warning('login_failed', ['email' => strtolower($data['email']), 'ip' => $request->ip()]);
            throw ValidationException::withMessages(['email' => ['These credentials do not match our records.']]);
        }
        $user->forceFill(['last_login_at' => now()])->save();
        $token = $user->createToken($data['device_name'] ?? 'web', ['*'], $this->expiry())->plainTextToken;
        $this->audit->log('LOGIN', 'user', $user->id, null, ['device' => $data['device_name'] ?? null], $user->id);
        Log::channel('security')->info('login', ['user' => $user->id, 'ip' => $request->ip()]);

        return ApiResponse::ok([
            'token' => $token,
            'user' => $user->toPublicArray(),
            'businesses' => $this->memberships($user),
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        return ApiResponse::ok([
            'user' => $user->toPublicArray(),
            'businesses' => $this->memberships($user),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $user->currentAccessToken()?->delete();
        $this->audit->log('LOGOUT', 'user', $user->id, null, null, $user->id);

        return ApiResponse::ok(null, 'Logged out.');
    }

    public function changePassword(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $data = $request->validate([
            'current_password' => ['required', 'current_password:sanctum'],
            'password' => ['required', 'confirmed', Password::min(8)->letters()->numbers()],
        ]);
        $user->password = $data['password'];
        $user->save();
        $this->audit->log('PASSWORD_CHANGED', 'user', $user->id, null, null, $user->id);

        return ApiResponse::ok(null, 'Password updated.');
    }

    /** @return list<array<string, mixed>> */
    private function memberships(User $user): array
    {
        return BusinessUser::query()->withoutGlobalScopes()
            ->with(['business', 'role' => fn ($q) => $q->withoutGlobalScopes()->with('permissions')])
            ->where('user_id', $user->id)
            ->where('status', 'active')
            ->get()
            ->filter(fn (BusinessUser $m) => $m->business !== null)
            ->map(fn (BusinessUser $m) => [
                'business' => $m->business->toSyncArray(),
                'role_key' => $m->role?->key,
                'role_name' => $m->role?->name,
                'permissions' => $m->effectivePermissions(),
                'store_ids' => $m->store_ids,
            ])->values()->all();
    }

    private function expiry(): ?\DateTimeInterface
    {
        $minutes = config('sanctum.expiration');

        return $minutes ? now()->addMinutes((int) $minutes) : null;
    }
}
