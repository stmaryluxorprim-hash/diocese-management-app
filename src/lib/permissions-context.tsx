'use client';

// ---------- Permissions context (الصلاحيات) — migration 0037 ----------
// Loads the permission PROFILES (readable by every approved servant) and the
// caller's GRANTS (`permissions` rows, RLS: own + managed), resolves the key
// set of the signed-in servant and keeps it fresh in realtime — the moment
// the owner edits a profile or a manager grants one, every device reacts.

import {
  createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useDebouncedRealtime } from '@/lib/realtime';
import { hasKey, resolvePermissionKeys, activityItemCan, type ActivityItem, type ActivityAction } from '@/lib/permissions';
import type { PermissionGrant, PermissionProfile } from '@/lib/types';

interface PermissionsState {
  /** every permission profile (owner-made) */
  profiles: PermissionProfile[];
  /** grant rows visible to the caller (own + servants he manages) */
  grants: PermissionGrant[];
  /** resolved keys of the signed-in servant ('*' = owner) */
  keys: Set<string>;
  has: (key: string) => boolean;
  /**
   * Activity items (مناسبات · أسباب · نتائج افتقاد · طلبات بيانات) — mirror of SQL
   * `activity_item_can`: managers everything, class servant views by default
   * and needs a profile (fine or legacy key) for writes.
   */
  activityCan: (item: ActivityItem, action: ActivityAction) => boolean;
  /** profiles held by the signed-in servant */
  myProfiles: PermissionProfile[];
  loading: boolean;
  reload: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsState>({
  profiles: [],
  grants: [],
  keys: new Set(),
  has: () => false,
  activityCan: () => false,
  myProfiles: [],
  loading: true,
  reload: async () => {},
});

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const [profiles, setProfiles] = useState<PermissionProfile[]>([]);
  const [grants, setGrants] = useState<PermissionGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const approved = profile?.status === 'approved';

  const reload = useCallback(async () => {
    if (!approved) { setProfiles([]); setGrants([]); setLoading(false); return; }
    const [{ data: pp, error: e1 }, { data: gr, error: e2 }] = await Promise.all([
      supabase.from('permission_profiles').select('*').order('sort_order').order('name'),
      supabase.from('permissions').select('*'),
    ]);
    // Migration 0037 not applied yet → tables missing. Fail closed (owner
    // still has everything through his role).
    setProfiles(e1 ? [] : ((pp ?? []) as PermissionProfile[]));
    setGrants(e2 ? [] : ((gr ?? []) as PermissionGrant[]));
    setLoading(false);
  }, [supabase, approved]);

  useEffect(() => { reload(); }, [reload]);

  useDebouncedRealtime(
    supabase, 'permissions-ctx',
    [{ table: 'permission_profiles' }, { table: 'permissions' }],
    reload, { enabled: approved, delayMs: 500 }
  );

  const value = useMemo<PermissionsState>(() => {
    const mine = profile ? grants.filter((g) => g.servant_id === profile.id) : [];
    const keys = resolvePermissionKeys(profile?.role, mine, profiles);
    const mineIds = new Set(mine.map((g) => g.permission_profile_id));
    return {
      profiles,
      grants,
      keys,
      has: (key) => hasKey(keys, key),
      activityCan: (item, action) => activityItemCan(profile?.role, keys, item, action),
      myProfiles: profiles.filter((p) => mineIds.has(p.id)),
      loading,
      reload,
    };
  }, [profiles, grants, profile, loading, reload]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export const usePermissions = () => useContext(PermissionsContext);

/** `true` when the servant holds the key (owner always); `null` while loading. */
export function useHasPermission(key: string): boolean | null {
  const { has, loading } = usePermissions();
  if (loading) return null;
  return has(key);
}
