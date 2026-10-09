<?php

use Illuminate\Support\Facades\Route;

// The API is headless; the web app is served separately (apps/web). See docs/DEPLOYMENT.md.
Route::get('/', fn () => response()->json([
    'name' => config('app.name'),
    'api' => url('/api/v1'),
    'health' => url('/api/v1/health'),
]));
