'use client';

import type { ReactNode } from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: ReactNode;
  tone?: 'emerald' | 'amber' | 'rose' | 'nexus' | 'fuchsia';
}

const TONES: Record<string, string> = {
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  rose: 'text-rose-400',
  nexus: 'text-nexus-400',
  fuchsia: 'text-fuchsia-400',
};

export function MetricCard({ label, value, subtext, icon, tone = 'nexus' }: MetricCardProps) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <span className="stat-label">{label}</span>
        {icon && <span className={TONES[tone]}>{icon}</span>}
      </div>
      <div className={`mt-2 stat-value ${TONES[tone]}`}>{value}</div>
      {subtext && <div className="mt-1 text-xs text-white/40">{subtext}</div>}
    </div>
  );
}
