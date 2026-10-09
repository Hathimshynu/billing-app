import { useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';

interface ConfirmRequest {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** Ask for a reason (e.g. cancelling an invoice). */
  reason?: { label: string; required?: boolean };
  resolve: (value: { confirmed: boolean; reason: string }) => void;
}

const useConfirmStore = create<{ request: ConfirmRequest | null; set: (r: ConfirmRequest | null) => void }>((set) => ({
  request: null,
  set: (request) => set({ request }),
}));

/** Promise based confirmation: `if ((await confirm({...})).confirmed) ...` */
export function confirm(options: Omit<ConfirmRequest, 'resolve'>): Promise<{ confirmed: boolean; reason: string }> {
  return new Promise((resolve) => useConfirmStore.getState().set({ ...options, resolve }));
}

export function ConfirmHost() {
  const { t } = useTranslation();
  const request = useConfirmStore((s) => s.request);
  const setRequest = useConfirmStore((s) => s.set);
  const [reason, setReason] = useState('');
  const close = (confirmed: boolean) => {
    request?.resolve({ confirmed, reason: reason.trim() });
    setRequest(null);
    setReason('');
  };
  const blocked = !!request?.reason?.required && reason.trim().length < 3;
  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          {request?.description ? <AlertDialogDescription>{request.description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {request?.reason ? (
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="confirm-reason">
              {request.reason.label}
            </label>
            <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={blocked}
            onClick={() => close(true)}
            className={request?.destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
          >
            {request?.confirmLabel ?? t('common.confirm', 'Confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
