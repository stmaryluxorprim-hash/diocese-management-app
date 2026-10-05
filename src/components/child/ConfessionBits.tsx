'use client';

// ---------- بوابة المخدوم → الاعتراف (migration 20260927130000) ----------
// `useChildConfession()` — the child's priest(s) + his appointment requests
// (fetched on mount, refetched on focus + a light poll). Hidden everywhere
// when his church has no approved priest.

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useChild } from '@/lib/child-context';
import { fetchChildConfession, type ChildConfession } from '@/lib/priest-portal';

export function useChildConfession() {
  const { token } = useChild();
  const [supabase] = useState(() => createClient());
  const [data, setData] = useState<ChildConfession | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setData(null); return; }
    let cancelled = false;
    const run = () => fetchChildConfession(supabase, token)
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setData({ priests: [], appointments: [], server_today: '' }); });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, [token, supabase, tick]);
  const pending = (data?.appointments ?? []).filter((a) => a.status === 'pending').length;
  const upcoming = (data?.appointments ?? []).filter((a) => a.status === 'approved' && a.on >= (data?.server_today ?? '')).length;
  const mine = (data?.priests ?? []).find((p) => p.is_mine) ?? null;
  return { data, reload, hasAny: (data?.priests.length ?? 0) > 0, pending, upcoming, mine };
}
