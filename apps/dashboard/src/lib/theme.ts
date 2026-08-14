'use client';

/**
 * Single authoritative theme source (Phase: Universal Perf §7/§8).
 *
 * Previously the theme was duplicated across the server-rendered
 * `className="dark"` on <html> and a `useState(true)` in Topbar that raced a
 * localStorage-restore effect on mount — producing the dark→light→dark flicker
 * and "cycling" the audit reported. Now there is exactly ONE stored value
 * (`anx-theme` ∈ { light | dark | system }) and ONE place that applies it.
 *
 * The actual DOM mutation is done by the inline no-flicker script in
 * layout.tsx so the correct class is present before first paint. This module
 * only reads/writes the canonical value and notifies subscribers.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'anx-theme';
const EVENT = 'anx-theme-change';

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return 'dark';
  }
  return mode;
}

export function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark';
}

export function setTheme(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, mode);
  const resolved = resolve(mode);
  const html = document.documentElement;
  html.classList.toggle('dark', resolved === 'dark');
  html.style.colorScheme = resolved;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}

export function currentResolved(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Subscribe to theme changes (returns an unsubscribe fn). */
export function onThemeChange(cb: (mode: ThemeMode) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<ThemeMode>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
