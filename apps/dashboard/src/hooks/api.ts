'use client';

import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface Provider {
  id: string;
  providerId: string;
  displayName: string;
  health: 'healthy' | 'degraded' | 'unhealthy' | 'circuit_open' | 'unknown';
  priority: number;
  weight: number;
  region?: string;
  tags: string[];
  capabilities: Record<string, unknown>;
  pricing?: { inputPer1K: number; outputPer1K: number; currency: string };
  updatedAt: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  endpoints: { total: number; healthy: number; degraded: number; open: number };
  uptime: number;
}

export function useProviders() {
  return useSWR<Provider[]>('/api/v1/providers', fetcher, { refreshInterval: 5000 });
}

export function useHealth() {
  return useSWR<HealthResponse>('/api/health', fetcher, { refreshInterval: 3000 });
}

export function useLiveEvents(): any[] {
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => {
    const ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/ws`);
    ws.onmessage = (e) => {
      const event = JSON.parse(e.data);
      setEvents((prev) => [event, ...prev].slice(0, 100));
    };
    return () => ws.close();
  }, []);
  return events;
}

import { useEffect, useState } from 'react';
