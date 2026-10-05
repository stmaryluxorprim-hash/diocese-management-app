'use client';

// ---------- بوابة المخدوم → عائلتي (migration 20260928120000) ----------
// `useChildFamily()` — my family (members · place), the priests of my AREA
// (or of my church when the area has none), the family's visits.

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useChild } from '@/lib/child-context';
import { fetchChildFamily, type ChildFamily } from '@/lib/priest-families';

export function useChildFamily() {
  const { token } = useChild();
  const [supabase] = useState(() => createClient());
  const [data, setData] = useState<ChildFamily | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setData(null); return; }
    let cancelled = false;
    const run = () => fetchChildFamily(supabase, token)
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setData({ family: null, me: { id: '', name: '' }, priests: [], priests_fallback: true, visits: [], server_today: '' }); });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, [token, supabase, tick]);
  const pending = (data?.visits ?? []).filter((v) => v.status === 'pending').length;
  const upcoming = (data?.visits ?? []).filter((v) => v.status === 'approved' && v.on >= (data?.server_today ?? '')).length;
  return { data, reload, hasFamily: !!data?.family, hasPriests: (data?.priests.length ?? 0) > 0, pending, upcoming };
}
