'use client';

import { useProviders } from '@/hooks/api';
import { ProviderTable } from '@/components/ProviderTable';

export default function ProvidersPage() {
  const { data: providers, isLoading } = useProviders();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Providers</h1>
        <p className="text-sm text-white/50">All configured provider endpoints and their current health.</p>
      </div>
      <div className="card">
        {isLoading ? <div className="py-8 text-center text-sm text-white/40">Loading…</div> : <ProviderTable providers={providers ?? []} />}
      </div>
    </div>
  );
}
