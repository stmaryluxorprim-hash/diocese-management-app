// ---------------------------------------------------------------------
// Query service — the QueryCache wired to «who is signed in» + the bus
// ---------------------------------------------------------------------
// Still framework-free: the realtime bus is an injected PORT, so the rules
// below are unit-tested with a fake bus (see __tests__/service.test.ts).
// `src/lib/cached-query.ts` binds it to the real realtime bus.
//
// WHAT THIS ADDS ON TOP OF THE CORE
//  • identity from the signed-in servant (uid · role · status · active
//    place · scope set) → a different value empties the cache;
//  • bus liveness → «verified» entries (long TTL) only while the broadcast
//    bus is up AND has had time to join the NEW identity's topics;
//  • resume → trust withdrawn after a long suspension / manual «تحديث»;
//  • SECURITY TABLES — a change to a servant's scopes / active place /
//    enrollment (role, status) empties the whole cache at once, without
//    waiting for AuthProvider's debounced profile reload;
//  • PERMISSION TABLES — permission-gated lookups (events · causes ·
//    call_feedbacks: their RLS calls activity_item_can()) list the
//    permission tables as dependencies and are never persisted;
//  • the lookup / single-row helpers the screens use.
// ---------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  QueryCache, buildNamespace,
  type CachedQueryOptions, type NamespaceParts, type QueryCacheEnv, type QueryState, type StorageLike,
} from './query-cache.ts';

export interface BusPort {
  onTable(table: string, fn: () => void): () => void;
  onConnection(fn: (ok: boolean) => void): () => void;
  connected(): boolean;
  /** «the app may have missed something» (long suspension, bus drop while hidden, manual refresh) */
  onResume(fn: () => void): () => void;
}

/** a change here changes WHAT RLS lets the signed-in servant read → everything goes */
export const SECURITY_TABLES = ['servant_scopes', 'servant_active_places', 'servant_enrollments'] as const;
/** what activity_item_can() reads → permission-gated lookups depend on these */
export const PERMISSION_TABLES = ['permissions', 'permission_profiles'] as const;

/**
 * After an identity change the bus may still be «connected» through the
 * previous user's channels while the new topics are joining (the flag only
 * drops when NO channel is left). Entries fetched inside this window are
 * not trusted for the long TTL.
 */
export const BUS_SETTLE_MS = 4_000;

export type LookupTable = 'churches' | 'services' | 'classes' | 'events' | 'causes' | 'call_feedbacks';
/** churches · services · classes carry a MANUAL order (20260928130000) — every list follows it */
const MANUAL_ORDER_TABLES: ReadonlySet<string> = new Set(['churches', 'services', 'classes']);
/** SELECT policy calls activity_item_can() → permission-dependent */
const PERMISSION_GATED: ReadonlySet<string> = new Set(['events', 'causes', 'call_feedbacks']);
const LOOKUP_TABLES: readonly LookupTable[] = ['churches', 'services', 'classes', 'events', 'causes', 'call_feedbacks'];

export interface OrderBy { column: string; ascending?: boolean; nullsFirst?: boolean }

export interface ServiceEnv {
  cache?: QueryCache;
  /** development tracer (HIT / MISS / DEDUPED / STALE / REVALIDATE / INVALIDATED) — omit in production */
  trace?: QueryCacheEnv['trace'];
  storage?: StorageLike | null;
  now?: () => number;
  bus?: BusPort | null;
  /** setTimeout seam for the settle window (tests) */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export function createQueryService(env: ServiceEnv = {}) {
  const bus = env.bus ?? null;
  const cacheEnv: QueryCacheEnv = {
    now: env.now,
    trace: env.trace,
    storage: env.storage ?? null,
    subscribeTable: bus ? (t, fn) => bus.onTable(t, fn) : undefined,
  };
  const cache = env.cache ?? new QueryCache(cacheEnv);
  const schedule = env.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = env.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  // ---- bus liveness (with the settle window) ----
  let settling = false;
  let settleHandle: unknown = null;
  const applyLive = () => cache.setBusLive(!!bus && bus.connected() && !settling);
  if (bus) {
    bus.onConnection(() => applyLive());
    bus.onResume(() => cache.markUnverified());
  }
  applyLive();

  // ---- security-table subscriptions: only while an identity is set ----
  let securityOffs: (() => void)[] = [];
  const dropSecurity = () => { securityOffs.forEach((off) => { try { off(); } catch { /* ignore */ } }); securityOffs = []; };
  const watchSecurity = () => {
    if (!bus || securityOffs.length > 0) return;
    securityOffs = SECURITY_TABLES.map((t) => bus.onTable(t, () => cache.invalidateAll()));
  };

  function setIdentity(parts: NamespaceParts | null): boolean {
    const ns = parts ? buildNamespace(parts) : null;
    const changed = cache.setIdentity(ns);
    if (ns === null) {
      dropSecurity();
      if (settleHandle !== null) { cancel(settleHandle); settleHandle = null; }
      settling = false;
      applyLive();
      return changed;
    }
    watchSecurity();
    if (changed) {
      settling = true;
      applyLive();
      if (settleHandle !== null) cancel(settleHandle);
      settleHandle = schedule(() => { settleHandle = null; settling = false; applyLive(); }, BUS_SETTLE_MS);
    }
    return changed;
  }

  /** disable the cache until the next setIdentity() — sign-out / account switch / place switch in progress */
  function suspend(): void { setIdentity(null); }

  // ---- lookups (churches · services · classes · events · causes · call_feedbacks) ----
  function lookupKey(table: LookupTable, o: OrderBy): string {
    return `lookup:${table}:${o.column}:${o.ascending ?? true}:${o.nullsFirst === undefined ? '-' : o.nullsFirst}`;
  }

  /**
   * Same contract as the old cachedLookup: rows of a small reference table,
   * ordered; an error yields `[]` (as before) — but is never cached.
   */
  async function lookup<T>(
    supabase: SupabaseClient,
    table: LookupTable,
    orderBy: OrderBy = { column: 'name' },
    force = false,
    extra: { onRevalidated?: (rows: T[]) => void } = {},
  ): Promise<T[]> {
    const gated = PERMISSION_GATED.has(table);
    const manual = MANUAL_ORDER_TABLES.has(table) && orderBy.column === 'name';
    try {
      return await cache.query<T[]>(
        lookupKey(table, orderBy),
        async () => {
          // structural tables: the manager's order first, the name only breaks ties
          let q = supabase.from(table).select('*');
          if (manual) q = q.order('sort_order');
          const { data, error } = await q.order(orderBy.column, { ascending: orderBy.ascending ?? true, nullsFirst: orderBy.nullsFirst });
          if (error) throw error;
          return (data ?? []) as T[];
        },
        {
          tables: gated ? [table, ...PERMISSION_TABLES] : [table],
          ttlMs: 10 * 60_000,
          persist: !gated,          // permission-gated rows never reach storage
          staleIfError: !gated,
          force,
          onRevalidated: extra.onRevalidated,
        },
      );
    } catch {
      return [];
    }
  }

  /** one row by id (null when missing / unreadable); only a FOUND row is cached */
  async function row<T>(supabase: SupabaseClient, table: 'churches' | 'services' | 'classes', id: string, columns = '*'): Promise<T | null> {
    try {
      return await cache.query<T | null>(
        `row:${table}:${columns}:${id}`,
        async () => {
          const { data, error } = await supabase.from(table).select(columns).eq('id', id).maybeSingle();
          if (error) throw error;
          return (data ?? null) as T | null;
        },
        { tables: [table], ttlMs: 10 * 60_000, shouldCache: (d) => d !== null, staleIfError: true },
      );
    } catch {
      return null;
    }
  }

  function invalidateLookup(table?: string): void {
    cache.invalidateTables(table ? [table] : LOOKUP_TABLES);
  }

  function dispose(): void {
    dropSecurity();
    if (settleHandle !== null) cancel(settleHandle);
    cache.dispose();
  }

  return {
    cache,
    setIdentity,
    suspend,
    belongsTo: (uid: string) => cache.belongsTo(uid),
    query: <T>(key: string, fetcher: () => Promise<T>, opts?: CachedQueryOptions<T>) => cache.query(key, fetcher, opts),
    peek: <T>(key: string, opts?: CachedQueryOptions<T>): { state: QueryState; data?: T } => cache.peek<T>(key, opts),
    invalidateKey: (key: string) => cache.invalidateKey(key),
    invalidateTables: (tables: string | readonly string[]) => cache.invalidateTables(tables),
    invalidateAll: () => cache.invalidateAll(),
    lookup, row, invalidateLookup, dispose,
  };
}

export type QueryService = ReturnType<typeof createQueryService>;
