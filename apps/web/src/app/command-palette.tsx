import { useDeferredValue, useState } from 'react';
import { useNavigate } from 'react-router';
import { create } from 'zustand';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import {
  BarChart3Icon,
  CloudIcon,
  FileTextIcon,
  PackageIcon,
  PackagePlusIcon,
  ReceiptIcon,
  SettingsIcon,
  ShoppingCartIcon,
  SmartphoneIcon,
  TruckIcon,
  UserPlusIcon,
  UserIcon,
} from 'lucide-react';
import { db, hasDb } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { syncEngine } from '@/lib/sync/engine';
import { useHotkeys } from '@/hooks/use-app';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { toast } from 'sonner';

export const useCommandPalette = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

function useSearch(query: string) {
  return useLiveQuery(async () => {
    const q = query.trim().toLowerCase();
    if (!hasDb() || q.length < 2) return { products: [], customers: [], sales: [], serials: [] };
    const database = db();
    const [products, customers, sales, serials] = await Promise.all([
      database.products.filter((p) => !p.deleted_at && ((p.search ?? '').includes(q) || (p.codes ?? []).includes(q))).limit(6).toArray(),
      database.customers.filter((c) => !c.deleted_at && (c.search ?? '').includes(q)).limit(5).toArray(),
      database.sales.filter((s) => s.invoice_number.toLowerCase().includes(q) || (s.customer_name ?? '').toLowerCase().includes(q)).limit(5).toArray(),
      database.product_serials.filter((s) => s.serial_no.toLowerCase().includes(q) || (s.imei1 ?? '').includes(q)).limit(3).toArray(),
    ]);
    return { products, customers, sales, serials };
  }, [query]);
}

export function CommandPalette() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const { open, setOpen } = useCommandPalette();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const results = useSearch(deferred);

  useHotkeys({
    'Ctrl+K': (e) => {
      e.preventDefault();
      setOpen(!useCommandPalette.getState().open);
    },
  });

  const go = (path: string) => {
    setOpen(false);
    setQuery('');
    navigate(path);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t('palette.title', 'Command palette')} description={t('palette.description', 'Search or run a command')}>
      <CommandInput placeholder={t('palette.placeholder', 'Type a command or search…')} value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{t('palette.empty', 'No results found.')}</CommandEmpty>
        {results && results.products.length > 0 ? (
          <CommandGroup heading={t('nav.products', 'Products')}>
            {results.products.map((p) => (
              <CommandItem key={p.id} value={`product ${p.name} ${p.sku ?? ''} ${p.barcode ?? ''}`} onSelect={() => go(`/products/${p.id}`)}>
                <PackageIcon /> <span className="truncate">{p.name}</span>
                <CommandShortcut>{fmt.money(p.selling_price)}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {results && results.customers.length > 0 ? (
          <CommandGroup heading={t('nav.customers', 'Customers')}>
            {results.customers.map((c) => (
              <CommandItem key={c.id} value={`customer ${c.name} ${c.phone ?? ''}`} onSelect={() => go(`/customers/${c.id}`)}>
                <UserIcon /> {c.name} <CommandShortcut>{c.phone}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {results && results.sales.length > 0 ? (
          <CommandGroup heading={t('palette.invoices', 'Invoices')}>
            {results.sales.map((s) => (
              <CommandItem key={s.id} value={`invoice ${s.invoice_number} ${s.customer_name ?? ''}`} onSelect={() => go(`/sales/${s.id}`)}>
                <ReceiptIcon /> {s.invoice_number} <CommandShortcut>{fmt.money(s.grand_total)}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {results && results.serials.length > 0 ? (
          <CommandGroup heading={t('palette.imei', 'IMEI / Serial')}>
            {results.serials.map((s) => (
              <CommandItem key={s.id} value={`imei ${s.serial_no} ${s.imei1 ?? ''}`} onSelect={() => go(`/warranty?q=${encodeURIComponent(s.serial_no)}`)}>
                <SmartphoneIcon /> {s.serial_no} <CommandShortcut>{s.status}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandSeparator />
        <CommandGroup heading={t('palette.commands', 'Commands')}>
          <CommandItem value="new sale pos" onSelect={() => go('/pos')}>
            <ShoppingCartIcon /> {t('palette.new_sale', 'New Sale')} <CommandShortcut>POS</CommandShortcut>
          </CommandItem>
          <CommandItem value="new product" onSelect={() => go('/products/new')}>
            <PackagePlusIcon /> {t('palette.new_product', 'New Product')}
          </CommandItem>
          <CommandItem value="new customer" onSelect={() => go('/customers?new=1')}>
            <UserPlusIcon /> {t('palette.new_customer', 'New Customer')}
          </CommandItem>
          <CommandItem value="new purchase" onSelect={() => go('/purchases/new')}>
            <TruckIcon /> {t('palette.new_purchase', 'New Purchase')}
          </CommandItem>
          <CommandItem value="search invoice sales" onSelect={() => go('/sales')}>
            <FileTextIcon /> {t('palette.search_invoice', 'Search Invoice')}
          </CommandItem>
          <CommandItem value="search product catalog" onSelect={() => go('/products')}>
            <PackageIcon /> {t('palette.search_product', 'Search Product')}
          </CommandItem>
          <CommandItem value="open reports" onSelect={() => go('/reports')}>
            <BarChart3Icon /> {t('palette.open_reports', 'Open Reports')}
          </CommandItem>
          <CommandItem value="open settings" onSelect={() => go('/settings')}>
            <SettingsIcon /> {t('palette.open_settings', 'Open Settings')}
          </CommandItem>
          <CommandItem
            value="sync now"
            onSelect={() => {
              setOpen(false);
              toast.promise(syncEngine.syncNow(), {
                loading: t('sync.syncing', 'Syncing…'),
                success: t('sync.done', 'Sync finished'),
                error: t('sync.failed', 'Sync failed'),
              });
            }}
          >
            <CloudIcon /> {t('palette.sync_now', 'Sync Now')}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
