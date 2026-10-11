import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { MonitorIcon, MoonIcon, PencilIcon, PlusIcon, SmartphoneIcon, SunIcon } from 'lucide-react';
import { INDIAN_STATES, storeSchema, type Device, type Store } from '@shopdesk/shared';
import { apiData, errorMessage } from '@/lib/api';
import { db } from '@/lib/db/business';
import { useFormat } from '@/lib/format';
import { LANGUAGES, setLanguage } from '@/lib/i18n';
import { runtime } from '@/lib/runtime';
import { syncEngine } from '@/lib/sync/engine';
import { useCan, useOnline } from '@/hooks/use-app';
import { useThemeStore, type ThemePreference } from '@/stores/theme';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { confirm } from '@/components/common/confirm';
import { FormGrid, FormRow } from '@/components/common/form';
import { Section } from '@/components/common/page';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';

export function StoresTab() {
  const { t } = useTranslation();
  const can = useCan();
  const online = useOnline();
  const stores = useLiveQuery(() => db().stores.filter((s) => !s.deleted_at).toArray(), []);
  const [editing, setEditing] = useState<Partial<Store> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!editing) return;
    const parsed = storeSchema.safeParse({ name: editing.name ?? '', code: (editing.code ?? '').toUpperCase(), address: editing.address ?? null, phone: editing.phone || null, gstin: editing.gstin || null, state_code: editing.state_code ?? null });
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    setSaving(true);
    try {
      if (editing.id) await apiData(`/stores/${editing.id}`, { method: 'PUT', body: { ...parsed.data, active: editing.active ?? true } });
      else await apiData('/stores', { method: 'POST', body: parsed.data });
      await syncEngine.syncNow();
      toast.success(t('stores.saved', 'Store saved'));
      setEditing(null);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title={t('stores.title', 'Stores / branches')}
      description={t('stores.hint', 'Each store has its own stock. Adding stores needs an internet connection.')}
      actions={
        can('stores.manage') ? (
          <Button size="sm" onClick={() => { setErrors({}); setEditing({ active: true, state_code: runtime().stateCode }); }} disabled={!online}>
            <PlusIcon /> {t('stores.add', 'Add store')}
          </Button>
        ) : null
      }
    >
      <ul className="divide-y rounded-lg border">
        {(stores ?? []).map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <div className="flex-1">
              <p className="font-medium">
                {s.name} <span className="font-mono text-xs text-muted-foreground">{s.code}</span> {s.is_default ? <Badge variant="secondary">{t('stores.default', 'Main')}</Badge> : null} {s.id === runtime().storeId ? <Badge>{t('stores.this', 'This device')}</Badge> : null} {!s.active ? <Badge variant="outline">{t('product.inactive', 'Inactive')}</Badge> : null}
              </p>
              <p className="text-xs text-muted-foreground">{[s.address, s.phone, s.gstin].filter(Boolean).join(' · ')}</p>
            </div>
            {can('stores.manage') ? (
              <Button size="icon-sm" variant="ghost" disabled={!online} onClick={() => { setErrors({}); setEditing(s); }} aria-label={t('common.edit', 'Edit')}>
                <PencilIcon />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <ResponsiveDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} dismissible={!saving} title={editing?.id ? t('stores.edit', 'Edit store') : t('stores.add', 'Add store')} footer={<Button onClick={() => void save()} disabled={saving}>{t('common.save', 'Save')}</Button>}>
        {editing ? (
          <FormGrid>
            <FormRow label={t('catalog.name', 'Name')} error={errors.name} required>
              <Input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </FormRow>
            <FormRow label={t('catalog.code', 'Code')} error={errors.code} required description={t('stores.code_hint', 'Short code used in document numbers ({STORE}).')}>
              <Input value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} />
            </FormRow>
            <FormRow label={t('customer.address', 'Address')} className="sm:col-span-2">
              <Input value={editing.address ?? ''} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            </FormRow>
            <FormRow label={t('customer.phone', 'Phone')} error={errors.phone}>
              <Input value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            </FormRow>
            <FormRow label="GSTIN" error={errors.gstin}>
              <Input value={editing.gstin ?? ''} onChange={(e) => setEditing({ ...editing, gstin: e.target.value.toUpperCase() })} />
            </FormRow>
            <FormRow label={t('customer.state', 'State')}>
              <select className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={editing.state_code ?? ''} onChange={(e) => setEditing({ ...editing, state_code: e.target.value || null })}>
                <option value="">—</option>
                {INDIAN_STATES.map((st) => (
                  <option key={st.code} value={st.code}>
                    {st.name}
                  </option>
                ))}
              </select>
            </FormRow>
          </FormGrid>
        ) : null}
      </ResponsiveDialog>
    </Section>
  );
}

export function DevicesTab() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const can = useCan();
  const online = useOnline();
  const devices = useLiveQuery(() => db().devices.toArray(), []);
  const stores = useLiveQuery(() => db().stores.toArray(), []);

  const revoke = async (device: Device) => {
    const { confirmed } = await confirm({ title: t('devices.revoke_title', 'Revoke {{name}}?', { name: device.name }), description: t('devices.revoke_hint', 'The device can no longer sync. Its unsynced data stays on that device.'), destructive: true, confirmLabel: t('devices.revoke', 'Revoke') });
    if (!confirmed) return;
    try {
      await apiData(`/devices/${device.id}/revoke`, { method: 'POST' });
      await syncEngine.syncNow();
      toast.success(t('devices.revoked', 'Device revoked'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Section title={t('devices.title', 'Devices')} description={t('devices.hint', 'Every browser or tablet that bills gets its own device code used in offline invoice numbers.')}>
      <ul className="divide-y rounded-lg border">
        {(devices ?? []).map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <SmartphoneIcon className="size-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="font-medium">
                {d.name} <span className="font-mono text-xs">{d.code}</span> {d.id === runtime().deviceId ? <Badge>{t('stores.this', 'This device')}</Badge> : null} {d.status === 'revoked' ? <Badge variant="destructive">{t('devices.revoked_badge', 'Revoked')}</Badge> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {[stores?.find((s) => s.id === d.store_id)?.name, d.platform, d.last_sync_at ? `${t('sync.last', 'Last sync')} ${fmt.relative(d.last_sync_at)}` : null].filter(Boolean).join(' · ')}
              </p>
            </div>
            {can('devices.manage') && d.status === 'active' && d.id !== runtime().deviceId ? (
              <Button size="sm" variant="outline" disabled={!online} onClick={() => void revoke(d)}>
                {t('devices.revoke', 'Revoke')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function AppearanceTab() {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const { preference, setPreference } = useThemeStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [saving, setSaving] = useState(false);
  const themes: Array<{ value: ThemePreference; label: string; icon: typeof SunIcon }> = [
    { value: 'light', label: t('theme.light', 'Light'), icon: SunIcon },
    { value: 'dark', label: t('theme.dark', 'Dark'), icon: MoonIcon },
    { value: 'system', label: t('theme.system', 'System'), icon: MonitorIcon },
  ];

  const changePassword = async () => {
    if (next !== confirmPw) return toast.error(t('account.mismatch', 'New passwords do not match.'));
    setSaving(true);
    try {
      await apiData('/auth/password', { method: 'POST', body: { current_password: current, password: next, password_confirmation: confirmPw } });
      toast.success(t('account.changed', 'Password changed. Use it next time you sign in (also offline).'));
      setCurrent('');
      setNext('');
      setConfirmPw('');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Section title={t('settings.appearance', 'Appearance')}>
        <div className="flex flex-wrap gap-2">
          {themes.map((th) => (
            <Button key={th.value} variant={preference === th.value ? 'default' : 'outline'} onClick={() => setPreference(th.value)}>
              <th.icon /> {th.label}
            </Button>
          ))}
        </div>
      </Section>
      <Section title={t('settings.language', 'Language')}>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <Button key={l.code} variant={i18n.language === l.code ? 'default' : 'outline'} onClick={() => setLanguage(l.code)}>
              {l.label}
            </Button>
          ))}
        </div>
      </Section>
      <Section title={t('account.password', 'Change password')} description={online ? undefined : t('settings.online_only', 'Connect to the internet to edit.')}>
        <fieldset disabled={!online || saving} className="grid max-w-md gap-3">
          <Input type="password" autoComplete="current-password" placeholder={t('account.current', 'Current password')} value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Input type="password" autoComplete="new-password" placeholder={t('account.new', 'New password')} value={next} onChange={(e) => setNext(e.target.value)} />
          <Input type="password" autoComplete="new-password" placeholder={t('account.confirm', 'Confirm new password')} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          <Button className="justify-self-start" onClick={() => void changePassword()} disabled={!current || next.length < 8}>
            {t('account.update', 'Update password')}
          </Button>
        </fieldset>
      </Section>
    </div>
  );
}
