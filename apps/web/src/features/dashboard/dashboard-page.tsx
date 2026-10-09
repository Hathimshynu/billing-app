import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangleIcon, ArrowRightIcon, BanknoteIcon, PackageIcon, ReceiptIcon, ShoppingCartIcon, TrendingUpIcon, UsersIcon, WalletIcon } from 'lucide-react';
import { addDays, businessDate, PAYMENT_METHOD_LABELS, startOfMonth } from '@shopdesk/shared';
import { useFormat } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { useAlerts } from '@/lib/alerts';
import { byPaymentMethod, byProduct, customerDues, dailySeries, expensesInRange, salesInRange, summarize, supplierDues } from '@/lib/reports';
import { useBusiness, useCan } from '@/hooks/use-app';
import { useSession } from '@/stores/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingRows, Page, PageHeader, Section, StatCard } from '@/components/common/page';

const pct = (current: number, previous: number) => (previous > 0 ? ((current - previous) / previous) * 100 : null);

export default function DashboardPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const navigate = useNavigate();
  const business = useBusiness();
  const userName = useSession((s) => s.account?.name);
  const alerts = useAlerts();
  const timezone = business?.timezone ?? runtime().timezone;
  const today = businessDate(new Date(), timezone);

  const stats = useLiveQuery(async () => {
    const yesterday = addDays(today, -1);
    const monthStart = startOfMonth(today);
    const trendFrom = addDays(today, -29);
    const [todaySales, yesterdaySales, monthSales, trendSales, monthExpenses, receivable, payable] = await Promise.all([
      salesInRange({ from: today, to: today }),
      salesInRange({ from: yesterday, to: yesterday }),
      salesInRange({ from: monthStart, to: today }),
      salesInRange({ from: trendFrom, to: today }),
      expensesInRange({ from: monthStart, to: today }),
      customerDues(),
      supplierDues(),
    ]);
    const mine = can('sales.view_all') ? todaySales : todaySales.filter((s) => s.created_by === runtime().userId);
    return {
      today: summarize(mine),
      yesterday: summarize(yesterdaySales),
      month: summarize(monthSales),
      monthExpenses: monthExpenses.reduce((s, e) => s + e.amount, 0),
      trend: dailySeries(trendSales, { from: trendFrom, to: today }),
      payments: byPaymentMethod(mine),
      top: byProduct(mine)
        .sort((a, b) => b.total - a.total)
        .slice(0, 6),
      receivable: receivable.reduce((s, c) => s + c.balance, 0),
      receivableCount: receivable.length,
      payable: payable.reduce((s, c) => s + c.balance, 0),
      recent: todaySales.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 6),
    };
  }, [today]);

  const chart = useMemo(() => (stats?.trend ?? []).map((d) => ({ ...d, label: fmt.date(d.date).slice(0, 5) })), [stats, fmt]);
  const greeting = new Date().getHours() < 12 ? t('dash.morning', 'Good morning') : new Date().getHours() < 17 ? t('dash.afternoon', 'Good afternoon') : t('dash.evening', 'Good evening');

  return (
    <Page>
      <PageHeader
        title={`${greeting}${userName ? `, ${userName.split(' ')[0]}` : ''}`}
        description={`${business?.name ?? ''} · ${fmt.date(today)}`}
        actions={
          can('sales.create') ? (
            <Button asChild size="lg">
              <Link to="/pos">
                <ShoppingCartIcon /> {t('dash.new_sale', 'New sale')}
              </Link>
            </Button>
          ) : null
        }
      />

      {!stats ? (
        <LoadingRows rows={6} />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('dash.today_sales', "Today's sales")} value={fmt.money(stats.today.total)} icon={TrendingUpIcon} trend={pct(stats.today.total, stats.yesterday.total) !== null ? { value: pct(stats.today.total, stats.yesterday.total)!, label: t('dash.vs_yesterday', 'vs yesterday') } : null} hint={t('dash.no_yesterday', 'No sales yesterday')} />
            <StatCard label={t('dash.bills', 'Bills today')} value={stats.today.count} icon={ReceiptIcon} hint={`${t('dash.avg', 'Avg')} ${fmt.money(stats.today.average)}`} />
            <StatCard label={t('dash.month_sales', 'This month')} value={fmt.money(stats.month.total)} icon={BanknoteIcon} hint={`${stats.month.count} ${t('dash.bills_short', 'bills')} · ${t('dash.expenses', 'expenses')} ${fmt.money(stats.monthExpenses)}`} />
            <StatCard label={t('dash.receivable', 'To collect')} value={fmt.money(stats.receivable)} icon={UsersIcon} hint={`${stats.receivableCount} ${t('dash.customers', 'customers')} · ${t('dash.payable', 'to pay')} ${fmt.money(stats.payable)}`} />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Section title={t('dash.trend', 'Sales — last 30 days')} className="lg:col-span-2">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                    <Tooltip formatter={(v) => fmt.money(Number(v))} labelFormatter={(l) => String(l)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Area type="monotone" dataKey="total" name={t('dash.sales', 'Sales')} stroke="var(--color-primary)" strokeWidth={2} fill="url(#salesFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Section>

            <Section title={t('dash.payments', 'Payments today')}>
              {stats.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('dash.no_sales_today', 'No sales yet today.')}</p>
              ) : (
                <ul className="space-y-2">
                  {stats.payments.map((p) => (
                    <li key={p.method} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <WalletIcon className="size-4 text-muted-foreground" />
                        {PAYMENT_METHOD_LABELS[p.method]}
                        <span className="text-xs text-muted-foreground">×{p.count}</span>
                      </span>
                      <span className="money font-medium">{fmt.money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Section title={t('dash.top_products', 'Top products today')}>
              {stats.top.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('dash.no_sales_today', 'No sales yet today.')}</p>
              ) : (
                <ol className="space-y-2">
                  {stats.top.map((p, i) => (
                    <li key={p.key} className="flex items-center gap-2 text-sm">
                      <span className="flex size-5 items-center justify-center rounded bg-muted text-xs">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{fmt.qty(p.quantity)}</span>
                      <span className="money w-24 text-right font-medium">{fmt.money(p.total)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            <Section
              title={t('dash.recent', 'Recent bills')}
              actions={
                can('sales.view') ? (
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/sales">
                      {t('common.view_all', 'View all')} <ArrowRightIcon />
                    </Link>
                  </Button>
                ) : null
              }
            >
              {stats.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('dash.no_sales_today', 'No sales yet today.')}</p>
              ) : (
                <ul className="divide-y">
                  {stats.recent.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="flex w-full items-center gap-2 py-2 text-left text-sm hover:bg-muted/40" onClick={() => navigate(`/sales/${s.id}`)}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{s.invoice_number}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {s.customer_name ?? t('pos.walk_in', 'Walk-in customer')} · {fmt.time(s.occurred_at)}
                          </span>
                        </span>
                        {s._pending ? <Badge variant="outline">{t('sync.pending_short', 'pending')}</Badge> : null}
                        <span className="money font-medium">{fmt.money(s.grand_total)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t('dash.attention', 'Needs attention')}>
              {!alerts ? (
                <LoadingRows rows={3} />
              ) : alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('dash.all_good', 'All good — nothing needs your attention.')}</p>
              ) : (
                <ul className="space-y-2">
                  {alerts.slice(0, 6).map((a) => (
                    <li key={a.id}>
                      <Link to={a.link} className="flex items-start gap-2 rounded-lg p-1.5 text-sm hover:bg-muted">
                        {a.severity === 'critical' ? <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" /> : <PackageIcon className="mt-0.5 size-4 shrink-0 text-warning" />}
                        <span>
                          <span className="block font-medium">{a.title}</span>
                          {a.body ? <span className="block text-xs text-muted-foreground">{a.body}</span> : null}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      )}
    </Page>
  );
}
