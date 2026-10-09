<?php

/*
| The web app is normally served from the same origin as the API (reverse proxy /api), in which
| case CORS is not involved. For split deployments list the frontend origins in
| CORS_ALLOWED_ORIGINS (comma separated). Bearer tokens are used, so credentials are not needed.
*/

return [
    'paths' => ['api/*'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => array_values(array_filter(array_map('trim', explode(',', (string) env('CORS_ALLOWED_ORIGINS', env('FRONTEND_URL', 'http://localhost:5173')))))),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['Authorization', 'Content-Type', 'Accept', 'X-Business-Id', 'X-Device-Id', 'Idempotency-Key', 'X-Requested-With'],

    'exposed_headers' => [],

    'max_age' => 3600,

    'supports_credentials' => false,
];
