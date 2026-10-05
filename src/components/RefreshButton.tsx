'use client';

// ---------- «تحديث» header button (20261011120000) ----------
// The child / priest portals no longer poll in the background (every poll
// was a logged API request on the Supabase «Logs Ingest» meter). Every data
// block in those portals already refetches on hidden→visible, so one tap
// here — which fires that same event — refreshes everything that is mounted
// without a page reload and without wiring each page separately.

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

export function refreshEverything() {
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
}

export default function RefreshButton({ id = 'refresh-btn', className = '' }: { id?: string; className?: string }) {
  const [spinning, setSpinning] = useState(false);
  return (
    <button
      type="button"
      id={id}
      aria-label="تحديث"
      title="تحديث"
      disabled={spinning}
      onClick={() => { setSpinning(true); refreshEverything(); setTimeout(() => setSpinning(false), 1500); }}
      className={`rounded-full p-2 transition hover:bg-white/15 disabled:opacity-70 ${className}`}
    >
      <RefreshCw className={`h-6 w-6 ${spinning ? 'animate-spin' : ''}`} />
    </button>
  );
}
