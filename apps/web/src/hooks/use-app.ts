import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { hasPermission, type Business, type ModuleKey, type Permission } from '@shopdesk/shared';
import { db, hasDb } from '@/lib/db/business';
import { maybeRuntime } from '@/lib/runtime';
import { useSession } from '@/stores/session';
import { useSyncStore } from '@/lib/sync/store';

/** The open business (live from IndexedDB, falling back to the cached membership). */
export function useBusiness(): Business | undefined {
  const membership = useSession((s) => s.membership);
  const live = useLiveQuery(async () => {
    const rt = maybeRuntime();
    return rt && hasDb() ? db().business.get(rt.businessId) : undefined;
  }, [membership?.business.id]);
  return live ?? membership?.business;
}

/** Effective permissions of the signed-in user (server-provided; re-synced on role changes). */
export function usePermissions(): string[] {
  const membership = useSession((s) => s.membership);
  const userId = useSession((s) => s.account?.user_id);
  const member = useLiveQuery(async () => (userId && hasDb() ? db().users.get(userId) : undefined), [userId, membership?.business.id]);
  return member?.permissions ?? membership?.permissions ?? [];
}

export function useCan(): (permission: Permission | Permission[]) => boolean {
  const permissions = usePermissions();
  return (permission) => hasPermission(permissions, permission);
}

export function useModules(): (module: ModuleKey) => boolean {
  const business = useBusiness();
  return (module) => (business?.modules ?? []).includes(module);
}

export function useOnline(): boolean {
  return useSyncStore((s) => s.online);
}

export interface HotkeyMap {
  [key: string]: (event: KeyboardEvent) => void;
}

/** Normalise a KeyboardEvent to "Ctrl+K", "F2", "Escape"... */
export function eventCombo(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey && event.key.length > 1) parts.push('Shift');
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key);
  return parts.join('+');
}

/** Global keyboard shortcuts; handlers receive the event (call preventDefault as needed). */
export function useHotkeys(map: HotkeyMap, enabled = true): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const handler = ref.current[eventCombo(event)];
      if (handler) handler(event);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
