<?php

namespace App\Providers;

use App\Services\Sync\ChangeLogger;
use App\Support\Tenancy\BusinessLock;
use App\Support\Tenancy\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Events\TransactionCommitted;
use Illuminate\Database\Events\TransactionRolledBack;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Request-scoped state (safe for Octane / queue workers).
        $this->app->scoped(TenantContext::class);
        $this->app->scoped(BusinessLock::class);
        $this->app->scoped(ChangeLogger::class);
    }

    public function boot(): void
    {
        Model::shouldBeStrict(false);

        Event::listen(TransactionCommitted::class, fn () => $this->app->make(BusinessLock::class)->release());
        Event::listen(TransactionRolledBack::class, fn () => $this->app->make(BusinessLock::class)->release());

        RateLimiter::for('auth', function (Request $request) {
            $email = strtolower((string) $request->input('email'));

            return [
                Limit::perMinute(10)->by('auth-ip:'.$request->ip()),
                Limit::perMinute(5)->by('auth-email:'.$email.'|'.$request->ip()),
            ];
        });
        RateLimiter::for('api', fn (Request $request) => Limit::perMinute(300)->by($request->user()?->id ?: $request->ip()));
        RateLimiter::for('sync', fn (Request $request) => Limit::perMinute(240)->by('sync:'.($request->header('X-Device-Id') ?: $request->ip())));
    }
}
