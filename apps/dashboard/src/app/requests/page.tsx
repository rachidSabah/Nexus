'use client';

import { EventFeed } from '@/components/EventFeed';
import { useLiveEvents } from '@/hooks/api';

export default function RequestsPage() {
  const events = useLiveEvents();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <p className="text-sm text-white/50">Live stream of all gateway requests, routing decisions, and provider calls.</p>
      </div>
      <div className="card">
        <EventFeed events={events} />
      </div>
    </div>
  );
}
