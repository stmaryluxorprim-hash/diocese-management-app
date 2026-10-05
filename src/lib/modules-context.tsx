'use client';

// ---------- Modules visibility context ----------
// Loads the `module_access` grants (RLS already trims them to what concerns
// the caller), computes which module keys are visible for the signed-in
// profile and keeps them fresh in realtime — the moment the owner grants or
// revokes a module, the side menu / settings / module pages react.

import {
  createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useDebouncedRealtime } from '@/lib/realtime';
import { useBootstrapConfig } from '@/lib/bootstrap';
import { MODULES, visibleModuleKeys, type AppModule, type ModuleAccess, type ModuleKey } from '@/lib/modules';

interface ModulesState {
  /** raw grant rows visible to the caller */
  grants: ModuleAccess[];
  /** modules the caller may use, in registry order */
  visibleModules: AppModule[];
  isVisible: (key: ModuleKey | string) => boolean;
  loading: boolean;
  reload: () => Promise<void>;
}

const ModulesContext = createContext<ModulesState>({
  grants: [],
  visibleModules: [],
  isVisible: () => false,
  loading: true,
  reload: async () => {},
});

export function ModulesProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const [grants, setGrants] = useState<ModuleAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const approved = profile?.status === 'approved';

  const reload = useCallback(async () => {
    if (!approved) { setGrants([]); setLoading(false); return; }
    const { data, error } = await supabase.from('module_access').select('*');
    // Migration 0024 not applied yet → table missing. Fail open for the
    // owner (he needs the owner module to fix it) and closed for others.
    setGrants(error ? [] : ((data ?? []) as ModuleAccess[]));
    setLoading(false);
  }, [supabase, approved]);

  // 20261015120000: the rows arrive with app_bootstrap() — no own request on
  // open. `reload()` (own query) is the realtime / fallback path only.
  const { config: boot, version: bootVersion } = useBootstrapConfig();
  useEffect(() => {
    if (!approved) { setGrants([]); setLoading(false); return; }
    if (boot) { setGrants(boot.module_access as ModuleAccess[]); setLoading(false); return; }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approved, bootVersion, reload]);

  useDebouncedRealtime(
    supabase, 'module-access', [{ table: 'module_access' }], reload,
    { enabled: approved, delayMs: 500 }
  );

  const keys = useMemo(() => visibleModuleKeys(grants, profile), [grants, profile]);

  const value = useMemo<ModulesState>(() => ({
    grants,
    visibleModules: MODULES.filter((m) => keys.has(m.key)),
    isVisible: (key) => keys.has(key),
    loading,
    reload,
  }), [grants, keys, loading, reload]);

  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>;
}

export const useModules = () => useContext(ModulesContext);

/** `true` when the module is visible; `null` while grants are still loading. */
export function useModuleVisible(key: ModuleKey | string): boolean | null {
  const { isVisible, loading } = useModules();
  if (loading) return null;
  return isVisible(key);
}
