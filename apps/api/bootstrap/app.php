<?php

use App\Exceptions\ApiException;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\ResetTenant;
use App\Http\Middleware\ResolveDevice;
use App\Http\Middleware\ResolveTenant;
use App\Http\Middleware\SecurityHeaders;
use App\Services\Sync\Exceptions\SyncRejected;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'tenant' => ResolveTenant::class,
            'device' => ResolveDevice::class,
            'permission' => EnsurePermission::class,
        ]);
        $middleware->prepend(ResetTenant::class);
        $middleware->append(SecurityHeaders::class);
        $middleware->trustProxies(at: '*');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->dontFlash(['current_password', 'password', 'password_confirmation', 'token']);
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        $json = fn (string $message, int $status, array $errors = [], array $extra = []) => response()->json(
            ['success' => false, 'message' => $message, 'errors' => (object) $errors] + $extra,
            $status,
        );
        $isApi = fn (Request $request) => $request->is('api/*') || $request->expectsJson();

        $exceptions->render(function (ValidationException $e, Request $request) use ($json, $isApi) {
            return $isApi($request) ? $json($e->getMessage(), $e->status, $e->errors()) : null;
        });
        $exceptions->render(function (AuthenticationException $e, Request $request) use ($json, $isApi) {
            return $isApi($request) ? $json('Unauthenticated.', 401) : null;
        });
        $exceptions->render(function (AuthorizationException|AccessDeniedHttpException $e, Request $request) use ($json, $isApi) {
            return $isApi($request) ? $json($e->getMessage() ?: 'This action is unauthorized.', 403) : null;
        });
        $exceptions->render(function (ModelNotFoundException|NotFoundHttpException $e, Request $request) use ($json, $isApi) {
            return $isApi($request) ? $json('Resource not found.', 404) : null;
        });
        $exceptions->render(function (ThrottleRequestsException $e, Request $request) use ($json, $isApi) {
            return $isApi($request) ? $json('Too many requests. Please slow down.', 429) : null;
        });
        $exceptions->render(function (ApiException $e, Request $request) use ($json) {
            return $json($e->getMessage(), $e->status(), $e->errors());
        });
        $exceptions->render(function (SyncRejected $e, Request $request) use ($json) {
            $status = match ($e->errorCode) {
                'forbidden' => 403,
                'dependency_missing' => 409,
                default => 422,
            };

            return $json($e->getMessage(), $status, $e->errors ?? [], ['code' => $e->errorCode]);
        });
        $exceptions->render(function (HttpExceptionInterface $e, Request $request) use ($json, $isApi) {
            return $isApi($request) ? $json($e->getMessage() ?: 'Request failed.', $e->getStatusCode()) : null;
        });
        $exceptions->render(function (Throwable $e, Request $request) use ($json, $isApi) {
            if (! $isApi($request)) {
                return null;
            }

            return $json(config('app.debug') ? $e->getMessage() : 'Server error. Please try again.', 500);
        });
    })->create();
