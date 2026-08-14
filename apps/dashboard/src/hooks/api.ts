'use client';

import { useEffect, useState } from 'react';
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
  capabilities: {
    streaming?: boolean;
    toolCalling?: boolean;
    vision?: boolean;
    audio?: boolean;
    speech?: boolean;
    embeddings?: boolean;
    reasoning?: boolean;
    jsonMode?: boolean;
    maxOutputTokens?: number;
    maxInputTokens?: number;
    supportedModalities?: string[];
  };
  pricing?: { inputPer1K: number; outputPer1K: number; currency: string };
  updatedAt: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  endpoints: { total: number; healthy: number; degraded: number; open: number };
  uptime: number;
}

export interface RoutingEndpoint {
  id: string;
  providerId: string;
  displayName: string;
  baseUrl: string;
  health: 'healthy' | 'degraded' | 'unhealthy' | 'circuit_open' | 'unknown';
  priority: number;
  weight: number;
  region?: string;
  tags: string[];
  timeoutMs?: number;
  maxRetries?: number;
  concurrencyLimit?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface EndpointsResponse {
  endpoints: RoutingEndpoint[];
}

export function useProviders() {
  return useSWR<Provider[]>('/api/v1/providers', fetcher, { refreshInterval: 5000 });
}

export function useEndpoints() {
  return useSWR<EndpointsResponse>('/api/v1/endpoints', fetcher, { refreshInterval: 8000 });
}

export function useHealth() {
  return useSWR<HealthResponse>('/api/health', fetcher, { refreshInterval: 3000 });
}

export function useLiveEvents(): any[] {
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => {
    let disposed = false;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);
      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          setEvents((prev) => [event, ...prev].slice(0, 100));
        } catch {
          /* ignore malformed frames */
        }
      };
      // Swallow transport errors: the live feed is best-effort and SSE/REST
      // are used elsewhere, so a dropped socket must never surface as a
      // console error.
      ws.onerror = () => {};
      // Only close once the socket is actually open. If the effect is cleaned
      // up while the socket is still CONNECTING (e.g. React StrictMode's
      // mount→unmount→remount in dev), closing it mid-handshake logs
      // "WebSocket is closed before the connection is established". Deferring
      // the close until OPEN avoids that spurious error.
      ws.onopen = () => {
        if (disposed) ws?.close();
      };
    } catch {
      /* WebSocket unsupported — degrade silently */
    }
    return () => {
      disposed = true;
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, []);
  return events;
}
