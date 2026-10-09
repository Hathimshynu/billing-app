import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRightIcon, PlusIcon } from 'lucide-react';
import { BUSINESS_TYPE_DEFS } from '@shopdesk/shared';
import { useSession } from '@/stores/session';
import { Button } from '@/components/ui/button';
import { BUSINESS_ICONS } from './business-icons';

export default function SelectBusinessPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { account, selectBusiness, logout } = useSession();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">{t('select.title', 'Choose a business')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('select.subtitle', 'You can switch at any time from the sidebar.')}</p>
        <div className="mt-5 space-y-2">
          {account?.memberships.map((m) => {
            const Icon = BUSINESS_ICONS[m.business.business_type] ?? BUSINESS_ICONS.general;
            return (
              <button
                key={m.business.id}
                type="button"
                onClick={() => {
                  void selectBusiness(m.business.id);
                  navigate('/');
                }}
                className="flex w-full items-center gap-3 rounded-xl border p-3 text-left hover:border-primary/60 hover:bg-muted/40"
              >
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.business.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {BUSINESS_TYPE_DEFS[m.business.business_type]?.label} · {m.role_name}
                  </span>
                </span>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex justify-between">
          <Button variant="ghost" onClick={() => void logout().then(() => navigate('/login'))}>
            {t('auth.sign_out', 'Sign out')}
          </Button>
          <Button variant="outline" onClick={() => navigate('/setup')}>
            <PlusIcon /> {t('shell.new_business', 'Create another business')}
          </Button>
        </div>
      </div>
    </div>
  );
}
