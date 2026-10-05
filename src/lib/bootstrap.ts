'use client';

// ---------- app_bootstrap() — one request to open the app (20261015120000) ----------
// AuthProvider calls the RPC once per sign-in / profile reload and publishes
// the CONFIG blocks (module_access · permission_profiles · permissions ·
// app_settings) here; ModulesProvider / PermissionsProvider /
// CustomizationProvider read them instead of running their own queries.
// Every realtime refresh of those providers still does its own small query
// (that is the exceptional path); only the «open the app» path is bundled.
//
// If the RPC is missing (migration not applied) `fetchBootstrap` returns
// null and every provider falls back to its separate queries — exactly the
// behaviour before this change.

import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import type { ServantEnrollment, Person, Church, Service, ScopeRef } from '@/lib/types';

export interface BootstrapConfig {
  module_access: unknown[];
  permission_profiles: unknown[];
  permissions: unknown[];
  app_settings: { key: string; value: unknown }[];
}

export interface Bootstrap {
  profile: ServantEnrollment | null;
  scopes: ScopeRef[];
  person: Person | null;
  church: Church | null;
  service: Service | null;
  active_place: ScopeRef | null;
  /** present only for an approved servant */
  config: BootstrapConfig | null;
}

export async function fetchBootstrap(supabase: SupabaseClient): Promise<Bootstrap | null> {
  const { data, error } = await supabase.rpc('app_bootstrap');
  if (error || !data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const hasConfig = Array.isArray(d.module_access);
  return {
    profile: (d.profile as ServantEnrollment | null) ?? null,
    scopes: ((d.scopes as ScopeRef[] | null) ?? []),
    person: (d.person as Person | null) ?? null,
    church: (d.church as Church | null) ?? null,
    service: (d.service as Service | null) ?? null,
    active_place: (d.active_place as ScopeRef | null) ?? null,
    config: hasConfig
      ? {
          module_access: (d.module_access as unknown[]) ?? [],
          permission_profiles: (d.permission_profiles as unknown[]) ?? [],
          permissions: (d.permissions as unknown[]) ?? [],
          app_settings: (d.app_settings as { key: string; value: unknown }[]) ?? [],
        }
      : null,
  };
}

// ---------- tiny store for the config blocks ----------
// `version` bumps on every bootstrap so the providers re-apply the fresh
// blocks (a sign-in after a sign-out, a profile reload after approval …).
let current: { uid: string; config: BootstrapConfig; version: number } | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function publishBootstrapConfig(uid: string, config: BootstrapConfig | null) {
  current = config ? { uid, config, version: ++version } : null;
  listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
}

export function clearBootstrapConfig() { publishBootstrapConfig('', null); }

/**
 * The config blocks of the LAST bootstrap (null before the first one or when
 * the RPC is unavailable). Re-renders when a new bootstrap is published.
 */
export function useBootstrapConfig(): { config: BootstrapConfig | null; version: number } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((x) => x + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return { config: current?.config ?? null, version: current?.version ?? 0 };
}
