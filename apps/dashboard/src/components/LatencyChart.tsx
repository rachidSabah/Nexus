'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export function LatencyChart({ events }: { events: Array<{ type: string; payload: any }> }) {
  const data = events
    .filter((e) => e.type === 'provider.request.succeeded')
    .slice(0, 50)
    .reverse()
    .map((e, i) => ({ idx: i, latency: e.payload?.latencyMs ?? 0 }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
        <XAxis dataKey="idx" stroke="#ffffff30" tick={{ fontSize: 10 }} />
        <YAxis stroke="#ffffff30" tick={{ fontSize: 10 }} />
        <Tooltip
          contentStyle={{
            background: '#0a0a0f',
            border: '1px solid #ffffff20',
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Line
          type="monotone"
          dataKey="latency"
          stroke="#6a7aff"
          strokeWidth={2}
          dot={false}
          name="Latency (ms)"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
