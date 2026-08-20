'use client';

import { useEffect } from 'react';

/**
 * Registers the dashboard service worker for PWA installability (WS5 Phase 3).
 * The SW itself enforces the safety contract: it never intercepts /api/*, so
 * all gateway telemetry stays live (no stale-cache masking of real data).
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return; // avoid SW caching in dev
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* registration failures are non-fatal — app still works without PWA */
      });
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}
