import Dexie, { type EntityTable } from 'dexie';
import type { Business } from '@shopdesk/shared';

/**
 * Installation-wide database: signed-in accounts (tokens + offline password verifiers) and the
 * cached list of businesses each account can open. Business data lives in per-business databases
 * (see business.ts) so switching businesses never mixes data.
 */

export interface OfflineVerifier {
  salt: string;
  hash: string;
  iterations: number;
}

export interface Membership {
  business: Business;
  role_key: string | null;
  role_name: string | null;
  permissions: string[];
  store_ids: string[] | null;
}

export interface Account {
  user_id: string;
  email: string;
  name: string;
  phone: string | null;
  /** API token, null when signed in offline (sync resumes after an online sign-in). */
  token: string | null;
  verifier: OfflineVerifier | null;
  memberships: Membership[];
  last_business_id: string | null;
  updated_at: string;
}

export interface GlobalMeta {
  key: string;
  value: unknown;
}

export class GlobalDb extends Dexie {
  accounts!: EntityTable<Account, 'user_id'>;
  meta!: EntityTable<GlobalMeta, 'key'>;

  constructor() {
    super('shopdesk');
    this.version(1).stores({
      accounts: '&user_id, &email',
      meta: '&key',
    });
  }
}

export const globalDb = new GlobalDb();

export async function getGlobalMeta<T>(key: string): Promise<T | undefined> {
  return (await globalDb.meta.get(key))?.value as T | undefined;
}

export async function setGlobalMeta(key: string, value: unknown): Promise<void> {
  await globalDb.meta.put({ key, value });
}
