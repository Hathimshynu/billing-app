<?php

namespace App\Services\Reports;

use App\Domain\Pricing\Money;
use App\Models\Customer;
use App\Models\Expense;
use App\Models\Purchase;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SalePayment;
use App\Models\SaleReturn;
use App\Models\StockLevel;
use App\Models\Supplier;
use Illuminate\Support\Facades\DB;

/**
 * Server-side reports (online). Devices compute the same reports from IndexedDB when offline.
 */
class ReportService
{
    /** @return list<array<string, mixed>> */
    public function salesSummary(string $from, string $to, string $groupBy = 'day', ?string $storeId = null): array
    {
        $period = $groupBy === 'month' ? 'substr(invoice_date, 1, 7)' : 'invoice_date';
        $rows = Sale::query()
            ->where('doc_type', 'invoice')->where('status', 'completed')
            ->whereBetween('invoice_date', [$from, $to])
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->selectRaw("{$period} as period, count(*) as invoices, sum(gross_total) as gross, sum(discount_total) as discount, sum(tax_total) as tax, sum(grand_total) as total, sum(returned_total) as returns, sum(balance_due) as credit")
            ->groupBy(DB::raw($period))->orderBy('period')->toBase()->get();

        return $rows->map(fn ($r) => [
            'period' => (string) $r->period,
            'invoices' => (int) $r->invoices,
            'gross' => Money::round($r->gross),
            'discount' => Money::round($r->discount),
            'tax' => Money::round($r->tax),
            'total' => Money::round($r->total),
            'returns' => Money::round($r->returns),
            'net' => Money::round((float) $r->total - (float) $r->returns),
            'credit' => Money::round($r->credit),
        ])->all();
    }

    /** @return list<array<string, mixed>> */
    public function topProducts(string $from, string $to, int $limit = 10): array
    {
        return SaleItem::query()
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sales.doc_type', 'invoice')->where('sales.status', 'completed')
            ->whereBetween('sales.invoice_date', [$from, $to])
            ->selectRaw('sale_items.product_id, sale_items.name, sum(sale_items.quantity - sale_items.returned_qty) as qty, sum(sale_items.total) as revenue')
            ->groupBy('sale_items.product_id', 'sale_items.name')
            ->orderByDesc('revenue')->limit($limit)->toBase()->get()
            ->map(fn ($r) => ['product_id' => $r->product_id, 'name' => $r->name, 'quantity' => Money::qty($r->qty), 'revenue' => Money::round($r->revenue)])
            ->all();
    }

    /** @return list<array<string, mixed>> */
    public function payments(string $from, string $to): array
    {
        return SalePayment::query()
            ->join('sales', 'sales.id', '=', 'sale_payments.sale_id')
            ->where('sales.status', 'completed')
            ->whereBetween('sales.invoice_date', [$from, $to])
            ->selectRaw('sale_payments.method, count(*) as count, sum(sale_payments.amount) as amount')
            ->groupBy('sale_payments.method')->orderByDesc('amount')->toBase()->get()
            ->map(fn ($r) => ['method' => $r->method, 'count' => (int) $r->count, 'amount' => Money::round($r->amount)])
            ->all();
    }

    /** @return list<array<string, mixed>> */
    public function tax(string $from, string $to): array
    {
        $rows = [];
        Sale::query()->where('doc_type', 'invoice')->where('status', 'completed')
            ->whereBetween('invoice_date', [$from, $to])
            ->select(['id', 'tax_breakup'])->chunk(500, function ($sales) use (&$rows) {
                foreach ($sales as $sale) {
                    foreach ($sale->tax_breakup ?? [] as $t) {
                        $key = $t['code'].'|'.$t['rate'];
                        $rows[$key] ??= ['code' => $t['code'], 'rate' => (float) $t['rate'], 'taxable' => 0, 'amount' => 0];
                        $rows[$key]['taxable'] += Money::toScaled($t['taxable'], 2);
                        $rows[$key]['amount'] += Money::toScaled($t['amount'], 2);
                    }
                }
            });

        return array_values(array_map(fn ($r) => [
            'code' => $r['code'], 'rate' => $r['rate'],
            'taxable' => Money::fromScaled($r['taxable'], 2), 'amount' => Money::fromScaled($r['amount'], 2),
        ], $rows));
    }

    /** @return array<string, float> */
    public function profit(string $from, string $to): array
    {
        $sales = SaleItem::query()
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sales.doc_type', 'invoice')->where('sales.status', 'completed')
            ->whereBetween('sales.invoice_date', [$from, $to])
            ->selectRaw('sum(sale_items.taxable) as revenue, sum(sale_items.cost_price * (sale_items.quantity - sale_items.returned_qty)) as cogs, sum(sale_items.taxable * sale_items.returned_qty / sale_items.quantity) as returned')
            ->first();
        $revenue = (float) ($sales->revenue ?? 0) - (float) ($sales->returned ?? 0);
        $cogs = (float) ($sales->cogs ?? 0);
        $expenses = (float) Expense::query()->where('status', 'active')->whereBetween('expense_date', [$from, $to])->sum('amount');

        return [
            'revenue' => Money::round($revenue),
            'cogs' => Money::round($cogs),
            'gross_profit' => Money::round($revenue - $cogs),
            'expenses' => Money::round($expenses),
            'net_profit' => Money::round($revenue - $cogs - $expenses),
        ];
    }

    /** @return array<string, mixed> */
    public function dashboard(string $today, string $yesterday): array
    {
        $day = fn (string $d) => Sale::query()->where('doc_type', 'invoice')->where('status', 'completed')->where('invoice_date', $d);

        return [
            'today_sales' => Money::round($day($today)->sum('grand_total')),
            'today_orders' => $day($today)->count(),
            'yesterday_sales' => Money::round($day($yesterday)->sum('grand_total')),
            'today_returns' => Money::round(SaleReturn::query()->where('return_date', $today)->sum('total')),
            'receivables' => Money::round(Customer::query()->where('balance', '>', 0)->sum('balance')),
            'payables' => Money::round(Supplier::query()->where('balance', '>', 0)->sum('balance')),
            'purchases_today' => Money::round(Purchase::query()->where('doc_type', 'invoice')->where('purchase_date', $today)->sum('grand_total')),
            'stock_value' => Money::round((float) StockLevel::query()->where('qty', '>', 0)->selectRaw('sum(qty * avg_cost) as v')->value('v')),
        ];
    }
}
