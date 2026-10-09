<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\Reports\ReportService;
use App\Support\ApiResponse;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class ReportController extends Controller
{
    public function __construct(private readonly ReportService $reports, private readonly TenantContext $tenant) {}

    /** @return array{0: string, 1: string} */
    private function range(Request $request): array
    {
        $data = $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $tz = $this->tenant->business()->timezone;
        $to = $data['to'] ?? Carbon::now($tz)->toDateString();
        $from = $data['from'] ?? Carbon::parse($to)->subDays(29)->toDateString();

        return [$from, $to];
    }

    public function dashboard(): JsonResponse
    {
        $now = Carbon::now($this->tenant->business()->timezone);

        return ApiResponse::ok($this->reports->dashboard($now->toDateString(), $now->copy()->subDay()->toDateString()));
    }

    public function sales(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        return ApiResponse::ok($this->reports->salesSummary($from, $to, (string) $request->query('group_by', 'day'), $request->query('store_id')));
    }

    public function topProducts(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        return ApiResponse::ok($this->reports->topProducts($from, $to, min((int) $request->query('limit', 10), 100)));
    }

    public function payments(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        return ApiResponse::ok($this->reports->payments($from, $to));
    }

    public function tax(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        return ApiResponse::ok($this->reports->tax($from, $to));
    }

    public function profit(Request $request): JsonResponse
    {
        [$from, $to] = $this->range($request);

        return ApiResponse::ok($this->reports->profit($from, $to));
    }
}
