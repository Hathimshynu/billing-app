import { create } from 'zustand';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'auth' | 'setup';

export interface SyncProgress {
  phase: 'push' | 'pull' | 'blocks' | 'register' | 'attachments';
  done: number;
  total: number | null;
}

export interface SyncState {
  status: SyncStatus;
  online: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  progress: SyncProgress | null;
  nextRetryAt: number | null;
  /** True while the first full download for this business is running. */
  initialSyncing: boolean;
  set: (patch: Partial<Omit<SyncState, 'set'>>) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastSyncAt: null,
  lastError: null,
  progress: null,
  nextRetryAt: null,
  initialSyncing: false,
  set: (patch) => set(patch),
}));
