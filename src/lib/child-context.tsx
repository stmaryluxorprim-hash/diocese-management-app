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
  childLogin, childLogout, fetchChildBootstrap,
  childErrorMessage, fetchChildExams, fetchChildOnlineClasses, type ChildProfile, type ChildExam, type ChildOnlineClass,
  fetchChildShops, fetchChildStoreRequests, type ChildShop, type ChildStoreRequest,
} from '@/lib/child-portal';
import { fetchChildChatOverview, type ChildChatOverview } from '@/lib/chat';
import { fetchChildAchievements, type ChildAchievements } from '@/lib/achievements';
import { fetchChildOccasions, type ChildOccasion } from '@/lib/occasions';
import { fetchChildNotifications, type InboxItem } from '@/lib/notifications';
import { fetchChildLibrary, setChildFavorite, type ChildLibrary } from '@/lib/library';

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

  // ---- module blocks (shared by every portal page) ----
  const [exams, setExams] = useState<ChildExam[] | null>(null);
  const [conversations, setConversations] = useState<ChildChatOverview[] | null>(null);
  const [onlineClasses, setOnlineClasses] = useState<ChildOnlineClass[] | null>(null);
  const [achievements, setAchievements] = useState<ChildAchievements | null>(null);
  const [occasions, setOccasions] = useState<ChildOccasion[] | null>(null);
  const [notifications, setNotifications] = useState<InboxItem[] | null>(null);
  const [library, setLibrary] = useState<ChildLibrary | null>(null);
  const [shops, setShops] = useState<ChildShop[] | null>(null);
  const [storeRequests, setStoreRequests] = useState<ChildStoreRequest[] | null>(null);

  const clearBlocks = () => {
    setExams(null); setConversations(null); setOnlineClasses(null); setAchievements(null); setOccasions(null);
    setNotifications(null); setLibrary(null); setShops(null); setStoreRequests(null);
  };

  /** session expired / code gone → log the child out */
  const isFatal = (e: unknown) => {
    const raw = ((e as { message?: string } | null)?.message ?? '');
    const msg = childErrorMessage(e);
    return raw.includes('session_expired') || raw.includes('unknown_code') || raw.includes('invalid_code') || raw.includes('account_stopped')
      || msg.includes('غير مسجل') || msg.includes('غير صالح');
  };
  const dropSession = useCallback((e?: unknown) => {
    clearChildToken();
    setToken(null);
    setProfile(null);
    clearBlocks();
    if (e !== undefined) setError(childErrorMessage(e));
  }, []);

  /**
   * 20261015120000 — ONE request opens the portal. `child_portal_bootstrap`
   * touches the session and returns the profile + every module block; a
   * block that fails on the server (module not granted / migration missing)
   * arrives as null and is shown empty. Before: 10 RPCs on open and 10 more
   * on every tab focus — the «every open» cost of the «Logs Ingest» meter.
   * When the RPC itself is missing we fall back to the separate fetches.
   */
  const loadAll = useCallback(async (t: string) => {
    try {
      const b = await fetchChildBootstrap(supabase, t);
      if (b) {
        setProfile(b.profile);
        setExams(b.exams ?? []);
        setConversations(b.conversations ?? []);
        setOnlineClasses(b.online_classes ?? []);
        setAchievements(b.achievements ?? { earned: [], progress: [] });
        setOccasions(b.occasions ?? []);
        setNotifications(b.notifications ?? []);
        setLibrary(b.library ?? { subjects: [], books: [], lectures: [], favorites: [] });
        setShops(b.shops ?? []);
        setStoreRequests(b.store_requests ?? []);
        setError(null);
        return;
      }
      // fallback: RPC not deployed yet → the old separate calls
      const p = await fetchChildProfile(supabase, t);
      setProfile(p);
      setError(null);
      const settle = <T,>(pr: Promise<T>, empty: T) => pr.catch(() => empty);
      const [ex, cv, oc, ac, occ, nt, lb, sh, sr] = await Promise.all([
        settle(fetchChildExams(supabase, t), [] as ChildExam[]),
        settle(fetchChildChatOverview(supabase, t), [] as ChildChatOverview[]),
        settle(fetchChildOnlineClasses(supabase, t), [] as ChildOnlineClass[]),
        settle(fetchChildAchievements(supabase, t), { earned: [], progress: [] } as ChildAchievements),
        settle(fetchChildOccasions(supabase, t), [] as ChildOccasion[]),
        settle(fetchChildNotifications(supabase, t, 80), [] as InboxItem[]),
        settle(fetchChildLibrary(supabase, t), { subjects: [], books: [], lectures: [], favorites: [] } as ChildLibrary),
        settle(fetchChildShops(supabase, t), [] as ChildShop[]),
        settle(fetchChildStoreRequests(supabase, t), [] as ChildStoreRequest[]),
      ]);
      setExams(ex); setConversations(cv); setOnlineClasses(oc); setAchievements(ac); setOccasions(occ);
      setNotifications(nt); setLibrary(lb); setShops(sh); setStoreRequests(sr);
    } catch (e) {
      if (isFatal(e)) dropSession(e); else setError(childErrorMessage(e));
    }
  }, [supabase, dropSession]);

  // boot: read the token, then ONE bootstrap call (it also extends the session)
  useEffect(() => {
    const t = getChildToken();
    setToken(t);
    if (!t) { setLoading(false); return; }
    (async () => {
      await loadAll(t);
      setLoading(false);
    })();
  }, [loadAll]);

  // tab back → one bootstrap call (session touch + every block). No timers:
  // the portal never polls in the background (20261011120000).
  useEffect(() => {
    if (!token) return;
    const onVisible = () => { if (document.visibilityState === 'visible') void loadAll(token); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [token, loadAll]);

  // service worker «push arrived» → refresh the inbox only
  useEffect(() => {
    if (!token) return;
    const hasSw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
    if (!hasSw) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onSw = (e: MessageEvent) => {
      if (e.data?.type !== 'push') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { fetchChildNotifications(supabase, token, 80).then(setNotifications).catch(() => {}); }, 700);
    };
    navigator.serviceWorker.addEventListener('message', onSw);
    return () => { if (timer) clearTimeout(timer); navigator.serviceWorker.removeEventListener('message', onSw); };
  }, [token, supabase]);

  const refresh = useCallback(async () => {
    if (token) await loadAll(token);
  }, [token, loadAll]);

  const login = useCallback(
    async (code: string, password: string, remember = false): Promise<string | null> => {
      const clean = code.trim();
      if (!clean) return 'أدخل الكود';
      if (!password) return 'أدخل كلمة المرور';
      try {
        const r = await childLogin(supabase, clean, password, remember);
        setChildToken(r.token, remember);
        setToken(r.token);
        await loadAll(r.token);
        return null;
      } catch (e) {
        return childErrorMessage(e);
      }
    },
    [supabase, loadAll]
  );

  const logout = useCallback(() => {
    const t = getChildToken();
    if (t) childLogout(supabase, t).catch(() => {});
    dropSession();
    setError(null);
  }, [supabase, dropSession]);

  // ---- per-block reloads (after an action on that screen) — one small RPC each ----
  const reloadMessages = useCallback(() => { if (token) fetchChildChatOverview(supabase, token).then(setConversations).catch(() => {}); }, [supabase, token]);
  const reloadOnline = useCallback(() => { if (token) fetchChildOnlineClasses(supabase, token).then(setOnlineClasses).catch(() => {}); }, [supabase, token]);
  const reloadAchievements = useCallback(() => { if (token) fetchChildAchievements(supabase, token).then(setAchievements).catch(() => {}); }, [supabase, token]);
  const reloadOccasions = useCallback(() => { if (token) fetchChildOccasions(supabase, token).then(setOccasions).catch(() => {}); }, [supabase, token]);
  const reloadNotifications = useCallback(() => { if (token) fetchChildNotifications(supabase, token, 80).then(setNotifications).catch(() => {}); }, [supabase, token]);
  const patchNotifications = useCallback((fn: (l: InboxItem[]) => InboxItem[]) => setNotifications((l) => (l ? fn(l) : l)), []);
  const reloadLibrary = useCallback(() => { if (token) fetchChildLibrary(supabase, token).then(setLibrary).catch(() => {}); }, [supabase, token]);
  const reloadShops = useCallback(() => {
    if (!token) return;
    Promise.all([fetchChildShops(supabase, token), fetchChildStoreRequests(supabase, token)])
      .then(([s, r]) => { setShops(s); setStoreRequests(r); }).catch(() => {});
  }, [supabase, token]);

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
    catch { reloadLibrary(); }
  }, [token, library, supabase, reloadLibrary]);

  const value = useMemo(
    () => ({ token, profile, loading, error, refresh, login, logout, exams, conversations, reloadMessages, onlineClasses, reloadOnline, achievements, reloadAchievements, occasions, reloadOccasions, notifications, reloadNotifications, patchNotifications, library, reloadLibrary, toggleLibraryFavorite, shops, storeRequests, reloadShops }),
    [token, profile, loading, error, refresh, login, logout, exams, conversations, reloadMessages, onlineClasses, reloadOnline, achievements, reloadAchievements, occasions, reloadOccasions, notifications, reloadNotifications, patchNotifications, library, reloadLibrary, toggleLibraryFavorite, shops, storeRequests, reloadShops]
  );

  return <ChildContext.Provider value={value}>{children}</ChildContext.Provider>;
}

export const useChild = () => useContext(ChildContext);
