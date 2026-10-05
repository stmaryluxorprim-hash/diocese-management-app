'use client';

// ---------- «غير متصل» chip (20261011120000) ----------
// The staff app no longer polls when the realtime bus is down (every poll
// was a logged API request on the Supabase «Logs Ingest» meter). Instead
// this chip tells the servant that the screen may be stale and lets him
// refresh with one tap. Shown only after the bus has been down for a few
// seconds (the join at login takes 1–3 s — no flicker) and only when the
// signed-in user actually wants a bus (owner / approved servant).

import { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useBusState } from '@/lib/realtime';
import { refreshEverything } from '@/components/RefreshButton';

/** how long the bus must be down before we say so */
const GRACE_MS = 8_000;

export default function LiveStatusChip() {
  const { connected, wanted } = useBusState();
  const [show, setShow] = useState(false);
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    if (connected || !wanted) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), GRACE_MS);
    return () => clearTimeout(t);
  }, [connected, wanted]);

  if (!show) return null;

  const refresh = () => {
    setSpinning(true);
    refreshEverything();
    setTimeout(() => setSpinning(false), 1200);
  };

  return (
    <button
      type="button"
      id="live-status-chip"
      onClick={refresh}
      title="التحديث المباشر متوقف مؤقتًا — اضغط لتحديث الشاشة"
      aria-label="غير متصل — اضغط للتحديث"
      className="flex items-center gap-1 rounded-full bg-amber-400/90 px-2 py-1 text-[11px] font-extrabold text-amber-950 shadow hover:bg-amber-300"
    >
      {spinning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <WifiOff className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">غير متصل</span>
    </button>
  );
}
