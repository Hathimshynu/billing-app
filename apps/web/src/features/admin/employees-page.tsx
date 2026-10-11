import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { PencilIcon, PlusIcon, ShieldIcon, UserPlusIcon, UsersIcon, WifiOffIcon } from 'lucide-react';
import { PERMISSION_GROUPS, PERMISSION_LABELS, type BusinessMember, type Permission, type Role } from '@shopdesk/shared';
import { apiData, errorMessage } from '@/lib/api';
import { db } from '@/lib/db/business';
import { syncEngine } from '@/lib/sync/engine';
import { useCan, useOnline } from '@/hooks/use-app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/common/data-table';
import { FormGrid, FormRow } from '@/components/common/form';
import { Page, PageHeader } from '@/components/common/page';
import { ResponsiveDialog } from '@/components/common/responsive-dialog';

/** Employees and roles are managed on the server (online only); the lists are cached for offline viewing. */
export default function EmployeesPage() {
  const { t } = useTranslation();
  const can = useCan();
  const online = useOnline();
  return (
    <Page>
      <PageHeader title={t('emp.title', 'Employees & roles')} description={t('emp.description', 'Permissions are enforced by the server on every request and every synced change.')} />
      {!online ? (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <WifiOffIcon className="size-4" /> {t('emp.offline', 'You are offline. Employee and role changes need an internet connection.')}
        </p>
      ) : null}
      <Tabs defaultValue={can('users.manage') ? 'members' : 'roles'}>
        <TabsList className="mb-4">
          {can('users.manage') ? <TabsTrigger value="members">{t('emp.members', 'Employees')}</TabsTrigger> : null}
          <TabsTrigger value="roles">{t('emp.roles', 'Roles')}</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <Members />
        </TabsContent>
        <TabsContent value="roles">
          <Roles />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

async function refresh() {
  await syncEngine.syncNow();
}

function Members() {
  const { t } = useTranslation();
  const online = useOnline();
  const members = useLiveQuery(() => db().users.toArray(), []);
  const roles = useLiveQuery(() => db().roles.toArray(), []);
  const stores = useLiveQuery(() => db().stores.filter((s) => !s.deleted_at).toArray(), []);
  const [editing, setEditing] = useState<BusinessMember | 'new' | null>(null);

  const columns: Column<BusinessMember>[] = [
    { id: 'name', header: t('customer.name', 'Name'), cell: (m) => <span className="font-medium">{m.name}</span>, value: (m) => m.name },
    { id: 'email', header: t('customer.email', 'Email'), cell: (m) => m.email, value: (m) => m.email, hideOnMobile: true },
    { id: 'role', header: t('emp.role', 'Role'), cell: (m) => <Badge variant="secondary">{m.role_name}</Badge>, value: (m) => m.role_name },
    { id: 'stores', header: t('emp.stores', 'Stores'), cell: (m) => (m.store_ids?.length ? m.store_ids.map((id) => stores?.find((s) => s.id === id)?.name ?? '—').join(', ') : t('emp.all_stores', 'All stores')), sortable: false, hideOnMobile: true },
    { id: 'status', header: t('sales.status', 'Status'), cell: (m) => <Badge variant={m.status === 'active' ? 'outline' : 'destructive'}>{m.status}</Badge>, value: (m) => m.status },
    {
      id: 'edit',
      header: '',
      sortable: false,
      cell: (m) =>
        m.role_key !== 'owner' ? (
          <Button size="icon-sm" variant="ghost" disabled={!online} onClick={() => setEditing(m)} aria-label={t('common.edit', 'Edit')}>
            <PencilIcon />
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')} disabled={!online}>
          <UserPlusIcon /> {t('emp.add', 'Add employee')}
        </Button>
      </div>
      <DataTable data={members} columns={columns} rowKey={(m) => m.id} searchText={(m) => `${m.name} ${m.email}`} exportName="employees" empty={{ icon: UsersIcon, title: t('emp.empty', 'No employees') }} />
      <MemberDialog member={editing} roles={roles ?? []} stores={stores ?? []} onClose={() => setEditing(null)} />
    </div>
  );
}

function MemberDialog({ member, roles, stores, onClose }: { member: BusinessMember | 'new' | null; roles: Role[]; stores: Array<{ id: string; name: string }>; onClose: () => void }) {
  const { t } = useTranslation();
  const isNew = member === 'new';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [status, setStatus] = useState<'active' | 'disabled'>('active');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!member) return;
    if (member === 'new') {
      setName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setRoleId(roles.find((r) => r.key === 'cashier')?.id ?? '');
      setStatus('active');
      setStoreIds([]);
    } else {
      setName(member.name);
      setEmail(member.email);
      setPhone(member.phone ?? '');
      setRoleId(member.role_id);
      setStatus(member.status === 'disabled' ? 'disabled' : 'active');
      setStoreIds(member.store_ids ?? []);
    }
  }, [member, roles]);

  const save = async () => {
    setSaving(true);
    try {
      if (isNew) {
        await apiData('/members', { method: 'POST', body: { name, email, phone: phone || null, role_id: roleId, password: password || null, store_ids: storeIds.length ? storeIds : null } });
      } else if (member) {
        await apiData(`/members/${member.id}`, { method: 'PUT', body: { name, phone: phone || null, role_id: roleId, status, store_ids: storeIds.length ? storeIds : null } });
      }
      toast.success(t('emp.saved', 'Saved'));
      await refresh();
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog open={!!member} onOpenChange={(o) => !o && onClose()} dismissible={!saving} title={isNew ? t('emp.add', 'Add employee') : t('emp.edit', 'Edit employee')} footer={<Button onClick={() => void save()} disabled={saving}>{t('common.save', 'Save')}</Button>}>
      <FormGrid>
        <FormRow label={t('customer.name', 'Name')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormRow>
        <FormRow label={t('customer.email', 'Email')} required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!isNew} />
        </FormRow>
        <FormRow label={t('customer.phone', 'Phone')}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </FormRow>
        {isNew ? (
          <FormRow label={t('emp.password', 'Initial password')} description={t('emp.password_hint', 'Needed for new accounts. At least 8 characters with letters and numbers.')}>
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormRow>
        ) : (
          <FormRow label={t('sales.status', 'Status')}>
            <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'disabled')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t('emp.active', 'Active')}</SelectItem>
                <SelectItem value="disabled">{t('emp.disabled', 'Disabled (cannot sign in)')}</SelectItem>
              </SelectContent>
            </Select>
          </FormRow>
        )}
        <FormRow label={t('emp.role', 'Role')} required>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles
                .filter((r) => r.key !== 'owner')
                .map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </FormRow>
        {stores.length > 1 ? (
          <FormRow label={t('emp.stores', 'Stores')} description={t('emp.stores_hint', 'Leave empty for access to all stores.')} className="sm:col-span-2">
            <div className="flex flex-wrap gap-3">
              {stores.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={storeIds.includes(s.id)} onCheckedChange={(c) => setStoreIds((ids) => (c ? [...ids, s.id] : ids.filter((x) => x !== s.id)))} />
                  {s.name}
                </label>
              ))}
            </div>
          </FormRow>
        ) : null}
      </FormGrid>
    </ResponsiveDialog>
  );
}

function Roles() {
  const { t } = useTranslation();
  const can = useCan();
  const online = useOnline();
  const roles = useLiveQuery(() => db().roles.toArray(), []);
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const editable = can('roles.manage') && online;
  return (
    <div className="space-y-3">
      {can('roles.manage') ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditing('new')} disabled={!online}>
            <PlusIcon /> {t('emp.add_role', 'Add role')}
          </Button>
        </div>
      ) : null}
      <ul className="divide-y rounded-xl border bg-card">
        {(roles ?? []).map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-3">
            <ShieldIcon className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {r.name} {r.is_system ? <Badge variant="outline">{t('emp.system', 'Built-in')}</Badge> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {r.description ?? ''} {r.permissions.length} {t('emp.permissions', 'permissions')}
              </p>
            </div>
            {editable && r.key !== 'owner' ? (
              <Button size="icon-sm" variant="ghost" onClick={() => setEditing(r)} aria-label={t('common.edit', 'Edit')}>
                <PencilIcon />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <RoleDialog role={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function RoleDialog({ role, onClose }: { role: Role | 'new' | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!role) return;
    setName(role === 'new' ? '' : role.name);
    setDescription(role === 'new' ? '' : (role.description ?? ''));
    setPerms(new Set(role === 'new' ? ['dashboard.view', 'sales.view', 'sales.create'] : role.permissions));
  }, [role]);
  const toggle = (p: string, on: boolean) => setPerms((s) => {
    const next = new Set(s);
    if (on) next.add(p);
    else next.delete(p);
    return next;
  });
  const save = async () => {
    if (!name.trim()) return toast.error(t('emp.role_name', 'Enter a role name.'));
    setSaving(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null, permissions: [...perms] };
      if (role === 'new') await apiData('/roles', { method: 'POST', body });
      else if (role) await apiData(`/roles/${role.id}`, { method: 'PUT', body });
      toast.success(t('emp.saved', 'Saved'));
      await refresh();
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <ResponsiveDialog open={!!role} onOpenChange={(o) => !o && onClose()} size="xl" dismissible={!saving} title={role === 'new' ? t('emp.add_role', 'Add role') : t('emp.edit_role', 'Edit role')} footer={<Button onClick={() => void save()} disabled={saving}>{t('common.save', 'Save')}</Button>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('emp.role_name_ph', 'Role name')} disabled={role !== 'new' && role?.is_system} />
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('jo.description', 'Description')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(PERMISSION_GROUPS).map(([group, list]) => (
            <fieldset key={group} className="rounded-lg border p-3">
              <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group.replace('_', ' ')}</legend>
              <div className="space-y-1.5">
                {(list as readonly Permission[]).map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={perms.has(p)} onCheckedChange={(c) => toggle(p, !!c)} />
                    {PERMISSION_LABELS[p]}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </div>
    </ResponsiveDialog>
  );
}
