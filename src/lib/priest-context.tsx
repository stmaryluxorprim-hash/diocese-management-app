'use client';

// ---------- Priest portal session (بوابة الكاهن) ----------
// Holds the token + the loaded profile + the shared lists (confessors ·
// appointments · areas · families · visits) so header / menu / pages fetch ONCE. `PriestShell`
// redirects to /login?as=priest when there is no token.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  clearPriestToken, fetchPriestProfile, getPriestToken, priestLogout, priestSessionTouch, priestErrorMessage,
  fetchConfessors, fetchAppointments, type PriestProfile, type Confessor, type Appointment,
} from '@/lib/priest-portal';
import { fetchAreasTree, fetchPriestFamilies, fetchVisits, type AreasTree, type PriestFamily, type Visit } from '@/lib/priest-families';

interface PriestState {
  token: string | null;
  profile: PriestProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => void;
  confessors: Confessor[] | null;
  reloadConfessors: () => void;
  appointments: Appointment[] | null;
  reloadAppointments: () => void;
  /** الافتقاد الأسري — areas tree · families · visits (migration 20260928120000) */
  areas: AreasTree | null;
  reloadAreas: () => void;
  families: PriestFamily[] | null;
  reloadFamilies: () => void;
  visits: Visit[] | null;
  reloadVisits: () => void;
  /** reload everything (profile counters + every list) */
  reloadAll: () => void;
}

const Ctx = createContext<PriestState>({
  token: null, profile: null, loading: true, error: null,
  refresh: async () => {}, logout: () => {},
  confessors: null, reloadConfessors: () => {},
  appointments: null, reloadAppointments: () => {},
  areas: null, reloadAreas: () => {},
  families: null, reloadFamilies: () => {},
  visits: null, reloadVisits: () => {},
  reloadAll: () => {},
});

// 20261011120000: NO background polling — every poll was a logged API
// request on the Supabase «Logs Ingest» meter. Each block refreshes on
// hidden→visible; the pages keep their reload buttons.

export function PriestProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<PriestProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dropSession = useCallback(() => {
    clearPriestToken();
    setToken(null);
    setProfile(null);
  }, []);

  const load = useCallback(async (t: string) => {
    try {
      const p = await fetchPriestProfile(supabase, t);
      setProfile(p);
      setError(null);
    } catch (e) {
      const raw = ((e as { message?: string } | null)?.message ?? '');
      if (raw.includes('session_expired') || raw.includes('account_stopped') || raw.includes('invalid_code')) dropSession();
      setError(priestErrorMessage(e));
    }
  }, [supabase, dropSession]);

  useEffect(() => {
    const t = getPriestToken();
    setToken(t);
    if (!t) { setLoading(false); return; }
    (async () => {
      try { await priestSessionTouch(supabase, t); }
      catch (e) {
        const raw = ((e as { message?: string } | null)?.message ?? '');
        if (raw.includes('session_expired') || raw.includes('account_stopped') || raw.includes('invalid_code')) {
          dropSession(); setError(priestErrorMessage(e)); setLoading(false); return;
        }
      }
      await load(t);
      setLoading(false);
    })();
  }, [load, supabase, dropSession]);

  useEffect(() => {
    if (!token) return;
    const onVisible = () => { if (document.visibilityState === 'visible') { priestSessionTouch(supabase, token).catch(() => {}); load(token); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); };
  }, [token, supabase, load]);

  const refresh = useCallback(async () => { if (token) await load(token); }, [token, load]);

  const logout = useCallback(() => {
    const t = getPriestToken();
    if (t) priestLogout(supabase, t).catch(() => {});
    dropSession();
    setError(null);
  }, [supabase, dropSession]);

  // ---- confessors
  const [confessors, setConfessors] = useState<Confessor[] | null>(null);
  const [cTick, setCTick] = useState(0);
  const reloadConfessors = useCallback(() => setCTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setConfessors(null); return; }
    let cancelled = false;
    const run = () => fetchConfessors(supabase, token).then((r) => { if (!cancelled) setConfessors(r); }).catch(() => {});
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, [token, supabase, cTick]);

  // ---- appointments (pending + upcoming)
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [aTick, setATick] = useState(0);
  const reloadAppointments = useCallback(() => setATick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setAppointments(null); return; }
    let cancelled = false;
    const run = () => fetchAppointments(supabase, token).then((r) => { if (!cancelled) setAppointments(r); }).catch(() => {});
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, [token, supabase, aTick]);

  // ---- areas tree (church → areas → streets → buildings)
  const [areas, setAreas] = useState<AreasTree | null>(null);
  const [arTick, setArTick] = useState(0);
  const reloadAreas = useCallback(() => setArTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setAreas(null); return; }
    let cancelled = false;
    const run = () => fetchAreasTree(supabase, token).then((r) => { if (!cancelled) setAreas(r); }).catch(() => {});
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, [token, supabase, arTick]);

  // ---- families (with their members · last visit · next visit)
  const [families, setFamilies] = useState<PriestFamily[] | null>(null);
  const [fTick, setFTick] = useState(0);
  const reloadFamilies = useCallback(() => setFTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setFamilies(null); return; }
    let cancelled = false;
    const run = () => fetchPriestFamilies(supabase, token).then((r) => { if (!cancelled) setFamilies(r); }).catch(() => {});
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, [token, supabase, fTick]);

  // ---- visits (pending requests + upcoming)
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [vTick, setVTick] = useState(0);
  const reloadVisits = useCallback(() => setVTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setVisits(null); return; }
    let cancelled = false;
    const run = () => fetchVisits(supabase, token).then((r) => { if (!cancelled) setVisits(r); }).catch(() => {});
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, [token, supabase, vTick]);

  const reloadAll = useCallback(() => { refresh(); reloadConfessors(); reloadAppointments(); reloadAreas(); reloadFamilies(); reloadVisits(); },
    [refresh, reloadConfessors, reloadAppointments, reloadAreas, reloadFamilies, reloadVisits]);

  const value = useMemo(() => ({
    token, profile, loading, error, refresh, logout, confessors, reloadConfessors, appointments, reloadAppointments,
    areas, reloadAreas, families, reloadFamilies, visits, reloadVisits, reloadAll,
  }), [token, profile, loading, error, refresh, logout, confessors, reloadConfessors, appointments, reloadAppointments,
    areas, reloadAreas, families, reloadFamilies, visits, reloadVisits, reloadAll]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePriest = () => useContext(Ctx);
