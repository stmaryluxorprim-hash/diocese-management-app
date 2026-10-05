'use client';

// ---------- Child portal session ----------
// Holds the scanned token + the loaded profile. Pages under /child/* use
// `useChild()`; `ChildShell` redirects to /child/login when no token.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  clearChildToken, fetchChildProfile, getChildToken, setChildToken,
  childLogin, childLogout, childSessionTouch,
  childErrorMessage, fetchChildExams, fetchChildOnlineClasses, type ChildProfile, type ChildExam, type ChildOnlineClass,
  fetchChildShops, fetchChildStoreRequests, type ChildShop, type ChildStoreRequest,
} from '@/lib/child-portal';
import { fetchChildChatOverview, type ChildChatOverview } from '@/lib/chat';
import { fetchChildAchievements, type ChildAchievements } from '@/lib/achievements';
import { fetchChildOccasions, type ChildOccasion } from '@/lib/occasions';
import { fetchChildNotifications, type InboxItem } from '@/lib/notifications';
import { fetchChildLibrary, setChildFavorite, type ChildLibrary } from '@/lib/library';
import { uniqueTopic } from '@/lib/realtime';

/**
 * 0046 — the child portal has no auth session, so it cannot join the private
 * broadcast topics that replaced `postgres_changes` on the hot tables.
 *
 * 20261011120000 — NO background polling any more. Every poll was one API
 * request on the Supabase «Logs Ingest» meter (free plan ≈ 1 GB / month) and
 * portal tabs left open were the single biggest consumer. Every block below
 * refreshes on hidden→visible (and the pages have their own reload buttons);
 * web push stays the instant path for notifications. The only timers in the
 * portal are inside a LIVE screen (open chat thread / live class room).
 */

interface ChildState {
  token: string | null;
  profile: ChildProfile | null;
  loading: boolean;
  error: string | null;
  /** (re)load profile for the current token */
  refresh: () => Promise<void>;
  /** code + password → session token (migration 0042); returns error text or null */
  login: (code: string, password: string, remember?: boolean) => Promise<string | null>;
  logout: () => void;
  /**
   * Modules data shared by every child page (fetched ONCE here, not by each
   * header / menu / page — see useChildExams / useChildMessages).
   * `null` while loading; `[]` when the module isn't granted.
   */
  exams: ChildExam[] | null;
  conversations: ChildChatOverview[] | null;
  reloadMessages: () => void;
  /** online classes (0030): scheduled / live / recent — realtime on online_classes */
  onlineClasses: ChildOnlineClass[] | null;
  reloadOnline: () => void;
  /** achievements (0031): earned cards + attendance progress — realtime on user_achievements */
  achievements: ChildAchievements | null;
  reloadAchievements: () => void;
  /** occasions (0032): board of published occasions + my registrations — realtime on occasions / registrations / notifications */
  occasions: ChildOccasion[] | null;
  reloadOccasions: () => void;
  /** notifications (0034): my inbox rows — realtime on notification_recipients + SW push messages */
  notifications: InboxItem[] | null;
  reloadNotifications: () => void;
  /** optimistic local patch (mark read) */
  patchNotifications: (fn: (l: InboxItem[]) => InboxItem[]) => void;
  /** library (0039): subjects · books · lectures · my ⭐ — realtime on library_* */
  library: ChildLibrary | null;
  reloadLibrary: () => void;
  toggleLibraryFavorite: (kind: 'book' | 'lecture', id: string) => Promise<void>;
  /** store shops (20261001120000): the ACTIVE shops connected to my places + my purchase requests — realtime on store_shops / targets, poll for requests */
  shops: ChildShop[] | null;
  storeRequests: ChildStoreRequest[] | null;
  reloadShops: () => void;
}

const ChildContext = createContext<ChildState>({
  token: null,
  profile: null,
  loading: true,
  error: null,
  refresh: async () => {},
  login: async () => null,
  logout: () => {},
  exams: null,
  conversations: null,
  reloadMessages: () => {},
  onlineClasses: null,
  reloadOnline: () => {},
  achievements: null,
  reloadAchievements: () => {},
  occasions: null,
  reloadOccasions: () => {},
  notifications: null,
  reloadNotifications: () => {},
  patchNotifications: () => {},
  library: null,
  reloadLibrary: () => {},
  toggleLibraryFavorite: async () => {},
  shops: null,
  storeRequests: null,
  reloadShops: () => {},
});

export function ChildProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (t: string) => {
      try {
        const p = await fetchChildProfile(supabase, t);
        setProfile(p);
        setError(null);
      } catch (e) {
        const raw = ((e as { message?: string } | null)?.message ?? '');
        const msg = childErrorMessage(e);
        // an expired session / unknown or deleted code should log the child out
        if (
          raw.includes('session_expired') || raw.includes('unknown_code') || raw.includes('invalid_code') ||
          msg.includes('غير مسجل') || msg.includes('غير صالح')
        ) {
          clearChildToken();
          setToken(null);
          setProfile(null);
        }
        setError(msg);
      }
    },
    [supabase]
  );

  // boot: read token from storage, validate/extend the session, then load
  useEffect(() => {
    const t = getChildToken();
    setToken(t);
    if (!t) { setLoading(false); return; }
    (async () => {
      try {
        await childSessionTouch(supabase, t);
      } catch (e) {
        const raw = ((e as { message?: string } | null)?.message ?? '');
        if (raw.includes('session_expired') || raw.includes('invalid_code')) {
          clearChildToken();
          setToken(null);
          setProfile(null);
          setError(childErrorMessage(e));
          setLoading(false);
          return;
        }
        // network hiccup → still try the profile (offline cache friendly)
      }
      await load(t);
      setLoading(false);
    })();
  }, [load, supabase]);

  // keep a «remember me» session alive when the tab comes back
  useEffect(() => {
    if (!token) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') childSessionTouch(supabase, token).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [token, supabase]);

  const refresh = useCallback(async () => {
    if (token) await load(token);
  }, [token, load]);

  const login = useCallback(
    async (code: string, password: string, remember = false): Promise<string | null> => {
      const clean = code.trim();
      if (!clean) return 'أدخل الكود';
      if (!password) return 'أدخل كلمة المرور';
      try {
        const r = await childLogin(supabase, clean, password, remember);
        const p = await fetchChildProfile(supabase, r.token);
        setChildToken(r.token, remember);
        setToken(r.token);
        setProfile(p);
        setError(null);
        return null;
      } catch (e) {
        return childErrorMessage(e);
      }
    },
    [supabase]
  );

  const logout = useCallback(() => {
    const t = getChildToken();
    if (t) childLogout(supabase, t).catch(() => {});
    clearChildToken();
    setToken(null);
    setProfile(null);
    setError(null);
  }, [supabase]);

  // Realtime: counters / photo / data change for this person's enrollments
  // (anon can subscribe; RLS on realtime may hide payloads — we only use it
  // as a trigger to refetch via the RPC, so an empty payload is fine).
  useEffect(() => {
    if (!token || !profile) return;
    const ids = profile.enrollments.map((e) => e.id);
    if (ids.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(token), 1200);
    };

    // also refresh when the tab becomes visible again
    const onVis = () => { if (document.visibilityState === 'visible') schedule(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, profile?.person.id, supabase, load]);

  // ---- modules: exams (0027) — one fetch for the whole portal, refetch on focus
  const [exams, setExams] = useState<ChildExam[] | null>(null);
  useEffect(() => {
    if (!token) { setExams(null); return; }
    let cancelled = false;
    const run = () => fetchChildExams(supabase, token)
      .then((r) => { if (!cancelled) setExams(r); })
      .catch(() => { if (!cancelled) setExams([]); });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, [token, supabase]);

  // ---- modules: messages (0029) — one fetch + ONE realtime subscription.
  // Before, header + side menu + home page each opened `child-msgs-<token>`;
  // the shared browser client returned the same (already subscribed) channel
  // and `.on()` threw → the portal crashed on open.
  const [conversations, setConversations] = useState<ChildChatOverview[] | null>(null);
  const [msgTick, setMsgTick] = useState(0);
  const reloadMessages = useCallback(() => setMsgTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setConversations(null); return; }
    let cancelled = false;
    const run = () => fetchChildChatOverview(supabase, token)
      .then((r) => { if (!cancelled) setConversations(r); })
      .catch(() => { if (!cancelled) setConversations([]); });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [token, supabase, msgTick]);

  // ---- modules: online classes (0030) — one fetch + one realtime subscription
  // on online_classes (status flips scheduled → live → ended), refetch on focus.
  const [onlineClasses, setOnlineClasses] = useState<ChildOnlineClass[] | null>(null);
  const [onlineTick, setOnlineTick] = useState(0);
  const reloadOnline = useCallback(() => setOnlineTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setOnlineClasses(null); return; }
    let cancelled = false;
    const run = () => fetchChildOnlineClasses(supabase, token)
      .then((r) => { if (!cancelled) setOnlineClasses(r); })
      .catch(() => { if (!cancelled) setOnlineClasses([]); });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase.channel(uniqueTopic('child-online'));
    try {
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'online_classes' }, () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(run, 600);
        })
        .subscribe();
    } catch { /* realtime unavailable → polling on focus only */ }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(channel);
    };
  }, [token, supabase, onlineTick]);

  // ---- modules: achievements (0031) — one fetch + realtime on user_achievements
  const [achievements, setAchievements] = useState<ChildAchievements | null>(null);
  const [achTick, setAchTick] = useState(0);
  const reloadAchievements = useCallback(() => setAchTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setAchievements(null); return; }
    let cancelled = false;
    const run = () => fetchChildAchievements(supabase, token)
      .then((r) => { if (!cancelled) setAchievements(r); })
      .catch(() => { if (!cancelled) setAchievements({ earned: [], progress: [] }); });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [token, supabase, achTick]);

  // ---- modules: occasions (0032) — one fetch + realtime on occasions / registrations / notifications
  const [occasions, setOccasions] = useState<ChildOccasion[] | null>(null);
  const [occTick, setOccTick] = useState(0);
  const reloadOccasions = useCallback(() => setOccTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setOccasions(null); return; }
    let cancelled = false;
    const run = () => fetchChildOccasions(supabase, token)
      .then((r) => { if (!cancelled) setOccasions(r); })
      .catch(() => { if (!cancelled) setOccasions([]); });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (timer) clearTimeout(timer); timer = setTimeout(run, 800); };
    const channel = supabase.channel(uniqueTopic('child-occasions'));
    try {
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'occasions' }, bump)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'occasion_registrations' }, bump)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'occasion_notifications' }, bump)
        .subscribe();
    } catch { /* realtime unavailable → polling on focus only */ }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(channel);
    };
  }, [token, supabase, occTick]);

  // ---- modules: notifications (0034) — one fetch + realtime on notification_recipients
  // + the service worker's «push arrived» message; refetch on focus.
  const [notifications, setNotifications] = useState<InboxItem[] | null>(null);
  const [notifTick, setNotifTick] = useState(0);
  const reloadNotifications = useCallback(() => setNotifTick((t) => t + 1), []);
  const patchNotifications = useCallback((fn: (l: InboxItem[]) => InboxItem[]) => setNotifications((l) => (l ? fn(l) : l)), []);
  useEffect(() => {
    if (!token) { setNotifications(null); return; }
    let cancelled = false;
    const run = () => fetchChildNotifications(supabase, token, 80)
      .then((r) => { if (!cancelled) setNotifications(r); })
      .catch(() => { if (!cancelled) setNotifications([]); });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (timer) clearTimeout(timer); timer = setTimeout(run, 700); };
    const onSw = (e: MessageEvent) => { if (e.data?.type === 'push') bump(); };
    const hasSw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
    if (hasSw) navigator.serviceWorker.addEventListener('message', onSw);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      if (hasSw) navigator.serviceWorker.removeEventListener('message', onSw);
    };
  }, [token, supabase, notifTick]);

  // ---- modules: library (0039) — one fetch + realtime on library_* ; ⭐ optimistic
  const [library, setLibrary] = useState<ChildLibrary | null>(null);
  const [libTick, setLibTick] = useState(0);
  const reloadLibrary = useCallback(() => setLibTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setLibrary(null); return; }
    let cancelled = false;
    const run = () => fetchChildLibrary(supabase, token)
      .then((r) => { if (!cancelled) setLibrary(r); })
      .catch(() => { if (!cancelled) setLibrary({ subjects: [], books: [], lectures: [], favorites: [] }); });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (timer) clearTimeout(timer); timer = setTimeout(run, 800); };
    const channel = supabase.channel(uniqueTopic('child-library'));
    try {
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'library_subjects' }, bump)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'library_books' }, bump)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'library_lectures' }, bump)
        .subscribe();
    } catch { /* realtime unavailable → polling on focus only */ }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(channel);
    };
  }, [token, supabase, libTick]);
  const toggleLibraryFavorite = useCallback(async (kind: 'book' | 'lecture', id: string) => {
    if (!token || !library) return;
    const on = !library.favorites.some((f) => (kind === 'book' ? f.book_id === id : f.lecture_id === id));
    setLibrary((l) => l && ({
      ...l,
      favorites: on
        ? [...l.favorites, { book_id: kind === 'book' ? id : null, lecture_id: kind === 'lecture' ? id : null }]
        : l.favorites.filter((f) => !(kind === 'book' ? f.book_id === id : f.lecture_id === id)),
    }));
    try { await setChildFavorite(supabase, token, kind === 'book' ? { book_id: id } : { lecture_id: id }, on); }
    catch { setLibTick((t) => t + 1); }
  }, [token, library, supabase]);

  // ---- modules: store shops (20261001120000) — shops + my requests; realtime
  // on store_shops / store_shop_targets (cold tables), poll for the requests
  // (store_requests is broadcast-only → the child has no auth session)
  const [shops, setShops] = useState<ChildShop[] | null>(null);
  const [storeRequests, setStoreRequests] = useState<ChildStoreRequest[] | null>(null);
  const [shopTick, setShopTick] = useState(0);
  const reloadShops = useCallback(() => setShopTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setShops(null); setStoreRequests(null); return; }
    let cancelled = false;
    const run = () => Promise.all([fetchChildShops(supabase, token), fetchChildStoreRequests(supabase, token)])
      .then(([s, r]) => { if (!cancelled) { setShops(s); setStoreRequests(r); } })
      .catch(() => { if (!cancelled) { setShops([]); setStoreRequests([]); } });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (timer) clearTimeout(timer); timer = setTimeout(run, 800); };
    const channel = supabase.channel(uniqueTopic('child-shops'));
    try {
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'store_shops' }, bump)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'store_shop_targets' }, bump)
        .subscribe();
    } catch { /* realtime unavailable → polling on focus only */ }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(channel);
    };
  }, [token, supabase, shopTick]);

  const value = useMemo(
    () => ({ token, profile, loading, error, refresh, login, logout, exams, conversations, reloadMessages, onlineClasses, reloadOnline, achievements, reloadAchievements, occasions, reloadOccasions, notifications, reloadNotifications, patchNotifications, library, reloadLibrary, toggleLibraryFavorite, shops, storeRequests, reloadShops }),
    [token, profile, loading, error, refresh, login, logout, exams, conversations, reloadMessages, onlineClasses, reloadOnline, achievements, reloadAchievements, occasions, reloadOccasions, notifications, reloadNotifications, patchNotifications, library, reloadLibrary, toggleLibraryFavorite, shops, storeRequests, reloadShops]
  );

  return <ChildContext.Provider value={value}>{children}</ChildContext.Provider>;
}

export const useChild = () => useContext(ChildContext);
