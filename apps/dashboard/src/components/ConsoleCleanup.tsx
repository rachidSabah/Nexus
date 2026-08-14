'use client';

import { useEffect } from 'react';

/**
 * Dev-only console hygiene.
 *
 * React's development build emits an informational banner
 * ("Download the React DevTools for a better development experience") via
 * `console.info` whenever `NODE_ENV !== 'production'`. It is harmless but
 * clutters the dev console. We suppress ONLY that exact message — every other
 * log, warning and error passes through untouched. This component is a no-op
 * in production builds (the banner does not exist there).
 */
export function ConsoleCleanup() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const TARGET = 'Download the React DevTools for a better development experience';
    const original = console.info;
    console.info = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes(TARGET)) return;
      original.apply(console, args as []);
    };
    return () => {
      console.info = original;
    };
  }, []);
  return null;
}
