import { create } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'shopdesk.theme';

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function resolve(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'system') return media?.matches ? 'dark' : 'light';
  return preference;
}

function apply(preference: ThemePreference) {
  const resolved = resolve(preference);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#18181b' : '#4f46e5');
}

interface ThemeState {
  preference: ThemePreference;
  theme: 'light' | 'dark';
  setPreference: (preference: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => {
  const preference = read();
  media?.addEventListener('change', () => {
    const current = useThemeStore.getState().preference;
    if (current === 'system') {
      apply('system');
      set({ theme: resolve('system') });
    }
  });
  return {
    preference,
    theme: resolve(preference),
    setPreference: (next) => {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // storage unavailable (private mode): preference applies to this session only
      }
      apply(next);
      set({ preference: next, theme: resolve(next) });
    },
  };
});

export function initTheme(): void {
  apply(useThemeStore.getState().preference);
}
