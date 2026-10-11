import { create } from 'zustand';
import { toast } from 'sonner';
import { uuidv7, type Business, type Device, type Store } from '@shopdesk/shared';
import { ApiError, NetworkError, apiData, setApiContext, setUnauthorizedHandler } from '@/lib/api';
import { createVerifier, verifyPassword } from '@/lib/auth/offline';
import { getMeta, openBusinessDb, setCurrentDb, setMeta, type BusinessDb } from '@/lib/db/business';
import { getGlobalMeta, globalDb, setGlobalMeta, type Account, type Membership } from '@/lib/db/global';
import { setRuntime, patchRuntime } from '@/lib/runtime';
import { syncEngine } from '@/lib/sync/engine';
import { useSyncStore } from '@/lib/sync/store';

interface AuthPayload {
  token: string;
  user: { id: string; name: string; email: string; phone: string | null };
  businesses: Membership[];
}

export type SessionStatus = 'loading' | 'signed_out' | 'signed_in';

interface SessionState {
  status: SessionStatus;
  account: Account | null;
  businessId: string | null;
  membership: Membership | null;
  /** Business database open and initial download complete. */
  businessReady: boolean;
  setupError: string | null;
  /** Server rejected our token; the user can keep working offline but must sign in to sync. */
  authExpired: boolean;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ offline: boolean }>;
  register: (input: { name: string; email: string; phone: string | null; password: string; password_confirmation: string }) => Promise<void>;
  logout: () => Promise<void>;
  selectBusiness: (businessId: string) => Promise<void>;
  closeBusiness: () => void;
  refreshMemberships: () => Promise<void>;
  addMembership: (membership: Membership) => Promise<void>;
  retrySetup: () => Promise<void>;
}

function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
}

async function saveAccount(payload: AuthPayload, password: string): Promise<Account> {
  const existing = await globalDb.accounts.get(payload.user.id);
  const account: Account = {
    user_id: payload.user.id,
    email: payload.user.email,
    name: payload.user.name,
    phone: payload.user.phone,
    token: payload.token,
    verifier: await createVerifier(password),
    memberships: payload.businesses,
    last_business_id: existing?.last_business_id ?? null,
    updated_at: new Date().toISOString(),
  };
  await globalDb.accounts.put(account);
  await setGlobalMeta('current_user_id', account.user_id);
  return account;
}

/** Open the business database, set runtime context and start syncing. */
async function openBusiness(account: Account, membership: Membership): Promise<BusinessDb> {
  const business = membership.business;
  const database = openBusinessDb(business.id);
  await database.open();
  setCurrentDb(database);

  // Each business gets its own device id on this installation (devices are per business).
  let deviceId = await getMeta<string>('device_id', database);
  if (!deviceId) {
    deviceId = uuidv7();
    await setMeta('device_id', deviceId, database);
  }
  const deviceCode = (await getMeta<string>('device_code', database)) ?? `X${deviceId.slice(-4).toUpperCase()}`;
  const stored = await database.business.get(business.id);
  const biz: Business = stored ?? business;
  const store = await resolveStore(database, membership);

  setApiContext({ token: account.token, businessId: business.id, deviceId, deviceSecret: (await getMeta<string>('device_secret', database)) ?? null });
  setRuntime({
    businessId: business.id,
    userId: account.user_id,
    userName: account.name,
    deviceId,
    deviceCode,
    storeId: store?.id ?? (await getMeta<string>('store_id', database)) ?? '',
    storeCode: store?.code ?? 'MAIN',
    timezone: biz.timezone || 'Asia/Kolkata',
    fyStartMonth: biz.fy_start_month || 4,
    currency: biz.currency || 'INR',
    currencyDecimals: biz.currency_decimals ?? 2,
    locale: biz.locale || 'en-IN',
    stateCode: biz.state_code ?? null,
  });

  syncEngine.start({
    database,
    businessId: business.id,
    deviceId,
    ensureDevice: async () => {
      // Registered devices hold a secret; devices registered before secrets existed get one now.
      if ((await getMeta<boolean>('device_registered', database)) && (await getMeta<string>('device_secret', database))) return;
      const device = await apiData<Device & { device_secret?: string }>('/devices/register', {
        body: { device_id: deviceId, name: deviceName(), platform: navigator.platform || null, store_id: (await getMeta<string>('store_id', database)) ?? null },
      });
      if (device.device_secret) {
        await setMeta('device_secret', device.device_secret, database);
        setApiContext({ deviceSecret: device.device_secret });
      }
      await setMeta('device_code', device.code, database);
      await setMeta('device_registered', true, database);
      if (device.store_id) await setMeta('store_id', device.store_id, database);
      patchRuntime({ deviceCode: device.code, ...(device.store_id ? { storeId: device.store_id } : {}) });
    },
    onAuthError: () => useSession.setState({ authExpired: true }),
    onAccessRevoked: () => void revokeLocalAccess(account.user_id, business.id),
  });
  return database;
}

/**
 * The server says this user lost access to the business (removed or disabled). Forget the business
 * on this device for that user and drop the offline sign-in verifier when no business is left, so a
 * former employee cannot keep working offline. Unsynced records stay in the business database and
 * sync when an authorised user opens the business here.
 */
async function revokeLocalAccess(userId: string, businessId: string): Promise<void> {
  const account = await globalDb.accounts.get(userId);
  if (account) {
    const memberships = account.memberships.filter((m) => m.business.id !== businessId);
    await globalDb.accounts.put({ ...account, memberships, verifier: memberships.length ? account.verifier : null, last_business_id: null });
  }
  const session = useSession.getState();
  if (session.businessId === businessId) {
    session.closeBusiness();
    useSession.setState({
      account: session.account ? { ...session.account, memberships: session.account.memberships.filter((m) => m.business.id !== businessId) } : null,
      setupError: null,
    });
  }
  toast.error('Your access to this business was removed by an administrator. Changes not yet synced stay on this device.', { duration: 15000 });
}

async function resolveStore(database: BusinessDb, membership: Membership): Promise<Store | undefined> {
  const preferred = await getMeta<string>('store_id', database);
  const stores = await database.stores.toArray();
  const allowed = membership.store_ids?.length ? stores.filter((s) => membership.store_ids!.includes(s.id)) : stores;
  return allowed.find((s) => s.id === preferred) ?? allowed.find((s) => s.is_default) ?? allowed[0];
}

/** Wait for the first complete download of the business data. */
async function waitForInitialSync(database: BusinessDb): Promise<void> {
  if (await getMeta<boolean>('initial_sync_done', database)) return;
  useSyncStore.getState().set({ initialSyncing: true });
  try {
    // Another tab may hold the sync lock; poll until the download completes or clearly fails.
    for (let attempt = 0; attempt < 240; attempt++) {
      await syncEngine.syncNow();
      if (await getMeta<boolean>('initial_sync_done', database)) return;
      const { status, lastError } = useSyncStore.getState();
      if (status === 'offline') {
        throw new Error('You are offline. Connect to the internet once to download your business data to this device.');
      }
      if (status === 'auth' || status === 'error') throw new Error(lastError ?? 'Could not download business data.');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Downloading business data is taking longer than expected. Please try again.');
  } finally {
    useSyncStore.getState().set({ initialSyncing: false });
  }
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  account: null,
  businessId: null,
  membership: null,
  businessReady: false,
  setupError: null,
  authExpired: false,

  init: async () => {
    setUnauthorizedHandler(() => set({ authExpired: true }));
    const userId = await getGlobalMeta<string>('current_user_id');
    const account = userId ? await globalDb.accounts.get(userId) : undefined;
    if (!account) {
      set({ status: 'signed_out' });
      return;
    }
    setApiContext({ token: account.token });
    set({ status: 'signed_in', account });
    const lastBusiness = account.last_business_id ?? (account.memberships.length === 1 ? account.memberships[0]!.business.id : null);
    if (lastBusiness && account.memberships.some((m) => m.business.id === lastBusiness)) {
      await get().selectBusiness(lastBusiness);
    }
    void get().refreshMemberships();
  },

  login: async (email, password) => {
    try {
      const payload = await apiData<AuthPayload>('/auth/login', { body: { email, password, device_name: deviceName() } });
      const account = await saveAccount(payload, password);
      setApiContext({ token: account.token });
      set({ status: 'signed_in', account, authExpired: false });
      // Re-auth while a business is open: resume syncing with the fresh token.
      if (get().businessId) {
        setApiContext({ token: account.token });
        void syncEngine.syncNow();
      }
      return { offline: false };
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      const account = await globalDb.accounts.where('email').equalsIgnoreCase(email.trim()).first();
      if (!account?.verifier) {
        throw new Error('You are offline. The first sign-in on this device needs an internet connection.', { cause: error });
      }
      if (!(await verifyPassword(password, account.verifier))) {
        throw new ApiError('These credentials do not match our records.', 422, { email: ['These credentials do not match our records.'] });
      }
      await setGlobalMeta('current_user_id', account.user_id);
      setApiContext({ token: account.token });
      set({ status: 'signed_in', account });
      return { offline: true };
    }
  },

  register: async (input) => {
    const payload = await apiData<AuthPayload>('/auth/register', { body: { ...input, device_name: deviceName() } });
    const account = await saveAccount(payload, input.password);
    setApiContext({ token: account.token });
    set({ status: 'signed_in', account });
  },

  logout: async () => {
    const { account } = get();
    try {
      if (account?.token) await apiData('/auth/logout', { body: {}, timeoutMs: 4000 });
    } catch {
      // Offline logout still ends the local session; the token expires server-side.
    }
    if (account) await globalDb.accounts.update(account.user_id, { token: null });
    await setGlobalMeta('current_user_id', null);
    get().closeBusiness();
    setApiContext({ token: null, businessId: null, deviceId: null, deviceSecret: null });
    set({ status: 'signed_out', account: null, authExpired: false });
  },

  selectBusiness: async (businessId) => {
    const { account } = get();
    const membership = account?.memberships.find((m) => m.business.id === businessId);
    if (!account || !membership) return;
    get().closeBusiness();
    set({ businessId, membership, businessReady: false, setupError: null });
    await globalDb.accounts.update(account.user_id, { last_business_id: businessId });
    try {
      const database = await openBusiness(account, membership);
      await waitForInitialSync(database);
      // Store may only be known after the first download.
      const store = await resolveStore(database, membership);
      if (store) {
        await setMeta('store_id', (await getMeta<string>('store_id', database)) ?? store.id, database);
        patchRuntime({ storeId: (await getMeta<string>('store_id', database)) ?? store.id, storeCode: store.code });
      }
      const biz = await database.business.get(businessId);
      if (biz) {
        patchRuntime({ timezone: biz.timezone, fyStartMonth: biz.fy_start_month, currency: biz.currency, currencyDecimals: biz.currency_decimals, locale: biz.locale, stateCode: biz.state_code });
      }
      set({ businessReady: true });
    } catch (error) {
      set({ setupError: error instanceof Error ? error.message : 'Could not open the business.' });
    }
  },

  retrySetup: async () => {
    const { businessId } = get();
    if (businessId) await get().selectBusiness(businessId);
  },

  closeBusiness: () => {
    syncEngine.stop();
    setCurrentDb(null);
    setRuntime(null);
    set({ businessId: null, membership: null, businessReady: false, setupError: null });
  },

  refreshMemberships: async () => {
    const { account } = get();
    if (!account?.token) return;
    try {
      const me = await apiData<{ user: AuthPayload['user']; businesses: Membership[] }>('/auth/me', { timeoutMs: 8000 });
      const updated: Account = { ...account, name: me.user.name, phone: me.user.phone, memberships: me.businesses, updated_at: new Date().toISOString() };
      await globalDb.accounts.put(updated);
      const businessId = get().businessId;
      set({ account: updated, membership: businessId ? (me.businesses.find((m) => m.business.id === businessId) ?? get().membership) : null, authExpired: false });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) set({ authExpired: true });
    }
  },

  addMembership: async (membership) => {
    const { account } = get();
    if (!account) return;
    const updated: Account = { ...account, memberships: [...account.memberships.filter((m) => m.business.id !== membership.business.id), membership] };
    await globalDb.accounts.put(updated);
    set({ account: updated });
  },
}));
