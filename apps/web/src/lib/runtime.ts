/**
 * Who/where the app is operating as. Set when a business is opened; used by repositories to stamp
 * operations (user_id, device_id) and by numbering (device / store codes).
 */
export interface Runtime {
  businessId: string;
  userId: string;
  userName: string;
  deviceId: string;
  deviceCode: string;
  storeId: string;
  storeCode: string;
  timezone: string;
  fyStartMonth: number;
  currency: string;
  currencyDecimals: number;
  locale: string;
  stateCode: string | null;
}

let current: Runtime | null = null;
const listeners = new Set<(rt: Runtime | null) => void>();

export function setRuntime(next: Runtime | null): void {
  current = next;
  listeners.forEach((l) => l(current));
}

export function patchRuntime(patch: Partial<Runtime>): void {
  if (!current) return;
  setRuntime({ ...current, ...patch });
}

export function runtime(): Runtime {
  if (!current) throw new Error('Runtime not initialised (no business open).');
  return current;
}

export function maybeRuntime(): Runtime | null {
  return current;
}

export function onRuntimeChange(listener: (rt: Runtime | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
