import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';
import './index.css';
import i18n from './lib/i18n';
import { router } from './app/router';
import { initTheme } from './stores/theme';
import { useSession } from './stores/session';
import { ConfirmHost } from './components/common/confirm';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';

initTheme();
document.documentElement.lang = i18n.language;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false, networkMode: 'offlineFirst' },
    mutations: { networkMode: 'offlineFirst' },
  },
});

void useSession.getState().init();

// Service worker: app shell precaching for offline start, update prompt when a new version ships.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast(i18n.t('pwa.update_available', 'A new version is available'), {
        description: i18n.t('pwa.update_body', 'Reload to update. Unsynced work is kept safely.'),
        duration: Infinity,
        action: { label: i18n.t('pwa.reload', 'Reload'), onClick: () => void updateSW(true) },
      });
    },
    onOfflineReady() {
      toast.success(i18n.t('pwa.offline_ready', 'Ready to work offline'));
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <Toaster position="top-center" richColors closeButton />
        <ConfirmHost />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
