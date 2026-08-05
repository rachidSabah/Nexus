'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

export function TokenUsageChart({ events }: { events: Array<{ type: string; payload: any }> }) {
  const data = events
    .filter((e) => e.type === 'provider.request.succeeded')
    .slice(0, 50)
    .reverse()
    .map((e, i) => ({
      idx: i,
      input: e.payload?.inputTokens ?? 0,
      output: e.payload?.outputTokens ?? 0,
    }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
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
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="input" fill="#6a7aff" name="Input tokens" />
        <Bar dataKey="output" fill="#f59e0b" name="Output tokens" />
      </BarChart>
    </ResponsiveContainer>
  );
}
