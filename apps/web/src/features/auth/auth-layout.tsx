import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudOffIcon, ShieldCheckIcon, StoreIcon, ZapIcon } from 'lucide-react';
import { config } from '@/lib/config';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <StoreIcon className="size-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">{config.appName}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
          {footer ? <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-primary to-indigo-900 p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-end">
        <div className="max-w-md space-y-6">
          <p className="text-3xl leading-tight font-semibold">{t('auth.hero', 'Billing that keeps working, even when the internet does not.')}</p>
          <ul className="space-y-3 text-sm text-primary-foreground/85">
            <li className="flex gap-3">
              <CloudOffIcon className="size-5 shrink-0" /> {t('auth.hero_offline', 'Full POS offline — sales, stock and receipts sync automatically later.')}
            </li>
            <li className="flex gap-3">
              <ZapIcon className="size-5 shrink-0" /> {t('auth.hero_fast', 'Built for barcode scanners, keyboards and touch screens.')}
            </li>
            <li className="flex gap-3">
              <ShieldCheckIcon className="size-5 shrink-0" /> {t('auth.hero_gst', 'GST-ready invoices for supermarkets, pharmacies, jewellers, restaurants and more.')}
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
