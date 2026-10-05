'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ServantEnrollment, Church, Service, Person, ScopeRef } from '@/lib/types';
import { SERVANTS_TABLE, SERVANT_SCOPES_TABLE, allScopesOf } from '@/lib/types';
import type { User } from '@supabase/supabase-js';
import { servantSessionStale, clearServantRememberFlags } from '@/lib/session';
import { configureRealtimeBus, onBusTable } from '@/lib/realtime';
import { logActivity } from '@/lib/activity';
import { fetchBootstrap, publishBootstrapConfig, clearBootstrapConfig } from '@/lib/bootstrap';

interface AuthState {
  user: User | null;
  /** the signed-in servant's enrollment (table `servant_enrollments`, 0037) */
  profile: ServantEnrollment | null;
  /** the servant's identity row in `persons` (code = national_id) */
  person: Person | null;
  /**
   * 0045: EVERY place the servant serves in — primary scope first, then the
   * `servant_scopes` rows. Empty for the owner / a servant without a scope.
   */
  scopes: ScopeRef[];
  /** true when the SESSION covers more than one place */
  multiScope: boolean;
  /** 20261004120000: EVERY place of the servant (regardless of the active one) */
  allScopes: ScopeRef[];
  /** the place chosen for this login — null = all his places */
  activePlace: ScopeRef | null;
  church: Church | null;
  service: Service | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  person: null,
  scopes: [],
  multiScope: false,
  allScopes: [],
  activePlace: null,
  church: null,
  service: null,
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ServantEnrollment | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [scopes, setScopes] = useState<ScopeRef[]>([]);
  const [allScopes, setAllScopes] = useState<ScopeRef[]>([]);
  const [activePlace, setActivePlace] = useState<ScopeRef | null>(null);
  const [church, setChurch] = useState<Church | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);

  // ONE browser client for the whole app (createBrowserClient is a
  // singleton in the browser, but keep the reference stable anyway).
  const [supabase] = useState(() => createClient());

  // Drop stale responses when a newer load started (fast re-auth / realtime)
  const loadSeq = useRef(0);

  const loadProfile = useCallback(
    async (uid: string) => {
      const seq = ++loadSeq.current;

      // 20261015120000: ONE request — app_bootstrap() returns the profile,
      // scopes, person, church, service, active place AND the config blocks
      // of the three other providers (module_access · permission_profiles ·
      // permissions · app_settings). Every open of the app used to be ~10
      // requests on the Supabase API gateway (each one a log line). When the
      // RPC is not there yet the old separate queries run below.
      const boot = await fetchBootstrap(supabase);
      if (seq !== loadSeq.current) return;

      let prof: ServantEnrollment | null;
      let extraScopes: ScopeRef[] = [];
      let personRow: Person | null = null;
      let churchRow: Church | null = null;
      let serviceRow: Service | null = null;
      let active: ScopeRef | null = null;

      if (boot) {
        prof = boot.profile;
        extraScopes = boot.scopes;
        personRow = boot.person;
        churchRow = boot.church;
        serviceRow = boot.service;
        active = boot.active_place;
        publishBootstrapConfig(uid, boot.config);
      } else {
        clearBootstrapConfig();
        // 0037: servant_enrollments. Fall back to the old `profiles` table when
        // the migration has not been applied yet (identical columns).
        let { data: p, error } = await supabase
          .from(SERVANTS_TABLE)
          .select('*')
          .eq('id', uid)
          .maybeSingle();
        if (error) {
          const res = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
          p = res.data;
        }
        if (seq !== loadSeq.current) return;
        prof = (p ?? null) as ServantEnrollment | null;
        if (prof) {
          // Everything else in PARALLEL — was 4 sequential round-trips before
          const [extraRes, perRes, chRes, svRes, activeRes] = await Promise.all([
            supabase.from(SERVANT_SCOPES_TABLE).select('church_id, service_id, class_id').eq('servant_id', uid),
            prof.person_id
              ? supabase.from('persons').select('*').eq('id', prof.person_id).maybeSingle()
              : Promise.resolve({ data: null }),
            prof.church_id
              ? supabase.from('churches').select('*').eq('id', prof.church_id).maybeSingle()
              : Promise.resolve({ data: null }),
            prof.service_id
              ? supabase.from('services').select('*').eq('id', prof.service_id).maybeSingle()
              : Promise.resolve({ data: null }),
            // 20261004120000: the place chosen for THIS login (null = all his places)
            supabase.from('servant_active_places').select('church_id, service_id, class_id').eq('servant_id', uid).maybeSingle(),
          ]);
          if (seq !== loadSeq.current) return;
          extraScopes = (((extraRes as { data: ScopeRef[] | null }).data ?? []) as ScopeRef[]);
          personRow = ((perRes as { data: Person | null }).data ?? null);
          churchRow = ((chRes as { data: Church | null }).data ?? null);
          serviceRow = ((svRes as { data: Service | null }).data ?? null);
          active = ((activeRes as { data: ScopeRef | null }).data ?? null);
        }
      }

      if (!prof) {
        setProfile(null); setScopes([]); setAllScopes([]); setActivePlace(null); setPerson(null); setChurch(null); setService(null);
        configureRealtimeBus(supabase, { uid, role: 'pending', churchIds: [] });
        return;
      }

      const every = allScopesOf(prof, extraScopes);
      const activeMatch = active?.church_id
        ? every.find((x) => x.church_id === active.church_id && (x.service_id ?? null) === (active.service_id ?? null) && (x.class_id ?? null) === (active.class_id ?? null)) ?? null
        : null;
      // the SESSION works on one place when one is chosen — the RLS does the same
      const all = activeMatch ? [activeMatch] : every;
      setProfile(activeMatch ? { ...prof, church_id: activeMatch.church_id, service_id: activeMatch.service_id ?? null, class_id: activeMatch.class_id ?? null } : prof);
      setAllScopes(every);
      setActivePlace(activeMatch);
      setScopes(all);
      setPerson(personRow);
      if (activeMatch && (activeMatch.church_id !== prof.church_id || (activeMatch.service_id ?? null) !== (prof.service_id ?? null))) {
        // the church / service objects follow the ACTIVE place
        const [c2, s2] = await Promise.all([
          supabase.from('churches').select('*').eq('id', activeMatch.church_id).maybeSingle(),
          activeMatch.service_id ? supabase.from('services').select('*').eq('id', activeMatch.service_id).maybeSingle() : Promise.resolve({ data: null }),
        ]);
        if (seq !== loadSeq.current) return;
        setChurch(((c2 as { data: Church | null }).data ?? null));
        setService(((s2 as { data: Service | null }).data ?? null));
      } else {
        setChurch(churchRow);
        setService(serviceRow);
      }

      // 0046: join the broadcast topics of my scopes (owner → scope:all)
      // (a pending servant may only join his own user:<uid> topic — the
      // church topics are RLS-denied until he is approved)
      const approved = prof.status === 'approved';
      configureRealtimeBus(supabase, {
        uid,
        role: approved ? prof.role : 'pending',
        churchIds: approved ? (all.map((s) => s.church_id).filter(Boolean) as string[]) : [],
      });
    },
    [supabase]
  );

  const clearAll = useCallback(() => {
    clearBootstrapConfig();
    setProfile(null);
    setPerson(null);
    setScopes([]);
    setAllScopes([]);
    setActivePlace(null);
    setChurch(null);
    setService(null);
    configureRealtimeBus(supabase, null);
  }, [supabase]);

  const refresh = useCallback(async () => {
    // «تذكرني» not ticked → the session was tab-only; drop it on a cold start
    if (servantSessionStale()) {
      clearServantRememberFlags();
      await supabase.auth.signOut();
      setUser(null);
      clearAll();
      setLoading(false);
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
      return;
    }
    // Local session first (no network) — getUser() is a round-trip to the
    // Auth server and is rate-limited; the middleware already validated the
    // cookie for this navigation.
    const { data: { session } } = await supabase.auth.getSession();
    const u = session?.user ?? null;
    setUser(u);
    if (u) await loadProfile(u.id);
    else clearAll();
    setLoading(false);
  }, [supabase, loadProfile, clearAll]);

  useEffect(() => {
    refresh();
    let lastUid: string | null = null;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      // TOKEN_REFRESHED fires every ~55 min on EVERY device; the profile did
      // not change — reloading it there was 5 queries × all users at once.
      if (event === 'TOKEN_REFRESHED') return;
      if (u) {
        if (event === 'INITIAL_SESSION' && lastUid === u.id) return;
        if (event === 'SIGNED_IN' && lastUid === u.id) return; // tab focus re-emits SIGNED_IN
        lastUid = u.id;
        loadProfile(u.id);
      } else {
        lastUid = null;
        clearAll();
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime (0046 bus, topic user:<uid>): my enrollment was approved /
  // changed, or a manager added / removed one of my places → reload.
  useEffect(() => {
    if (!user) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => loadProfile(user.id), 600); };
    const offA = onBusTable('servant_enrollments', bump);
    const offB = onBusTable('servant_scopes', bump);
    const offC = onBusTable('servant_active_places', bump);
    return () => { if (t) clearTimeout(t); offA(); offB(); offC(); };
  }, [user, loadProfile]);

  const signOut = useCallback(async () => {
    clearServantRememberFlags();
    configureRealtimeBus(supabase, null);
    // 0047: leave a trace before the session is gone (never blocks sign-out)
    await Promise.race([logActivity(supabase, 'auth.logout'), new Promise((r) => setTimeout(r, 1500))]);
    await supabase.auth.signOut();
    window.location.href = '/login';
  }, [supabase]);

  return (
    <AuthContext.Provider value={{ user, profile, person, scopes, multiScope: scopes.length > 1, allScopes, activePlace, church, service, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
