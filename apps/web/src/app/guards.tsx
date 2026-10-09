import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CloudDownloadIcon, LockIcon, StoreIcon, WifiOffIcon } from 'lucide-react';
import type { Permission } from '@shopdesk/shared';
import { useSession } from '@/stores/session';
import { useSyncStore } from '@/lib/sync/store';
import { useCan } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState, FullScreenLoader, Page } from '@/components/common/page';

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'signed_out') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}

function SetupScreen() {
  const { t } = useTranslation();
  const progress = useSyncStore((s) => s.progress);
  const membership = useSession((s) => s.membership);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <CloudDownloadIcon />
        </div>
        <div>
          <h1 className="text-lg font-semibold">{t('setup.preparing', 'Preparing offline data')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('setup.preparing_body', 'Downloading {{name}} to this device so it keeps working without internet.', { name: membership?.business.name ?? '' })}
          </p>
        </div>
        <Progress value={progress?.phase === 'pull' ? Math.min(95, 10 + (progress.done / 50)) : progress?.phase === 'blocks' ? 97 : 5} />
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3" />
          {progress?.phase === 'pull' ? t('setup.records', '{{count}} records downloaded', { count: progress.done }) : t('setup.connecting', 'Connecting…')}
        </p>
      </div>
    </div>
  );
}

export function RequireBusiness({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { account, businessId, businessReady, setupError, retrySetup, selectBusiness } = useSession();
  if (!account) return <FullScreenLoader />;
  if (account.memberships.length === 0) return <Navigate to="/setup" replace />;
  if (!businessId) {
    if (account.memberships.length === 1) {
      void selectBusiness(account.memberships[0]!.business.id);
      return <FullScreenLoader />;
    }
    return <Navigate to="/select-business" replace />;
  }
  if (setupError) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-md">
          <EmptyState
            icon={WifiOffIcon}
            title={t('setup.cannot_open', 'Cannot open the business yet')}
            description={setupError}
            action={
              <div className="flex gap-2">
                <Button onClick={() => void retrySetup()}>{t('common.retry', 'Retry')}</Button>
                {account.memberships.length > 1 ? (
                  <Button variant="outline" asChild>
                    <a href="/select-business">
                      <StoreIcon /> {t('setup.switch', 'Switch business')}
                    </a>
                  </Button>
                ) : null}
              </div>
            }
          />
        </div>
      </div>
    );
  }
  if (!businessReady) return <SetupScreen />;
  return <>{children}</>;
}

export function RequirePermission({ permission, children }: { permission: Permission | Permission[]; children: ReactNode }) {
  const { t } = useTranslation();
  const can = useCan();
  const list = Array.isArray(permission) ? permission : [permission];
  if (!list.some((p) => can(p))) {
    return (
      <Page>
        <EmptyState icon={LockIcon} title={t('common.no_access', 'You do not have access to this page')} description={t('common.no_access_body', 'Ask the business owner to update your role.')} />
      </Page>
    );
  }
  return <>{children}</>;
}
