// ---------------------------------------------------------------------
// Phase 2 reads — statistics · dashboard counts · follow-up roster ·
// owner persons — on top of the Phase 1 cachedQuery
// ---------------------------------------------------------------------
// NOT a second cache. Everything here is a thin layer that decides, per
// read, WHICH KEY, WHICH BUS TABLES and WHICH TTL to hand to the one
// `query()` of the Phase 1 service (identity namespace, in-flight dedupe,
// bus invalidation, generation guard, bus-liveness trust all live there).
//
// Framework-free like service.ts: `query` is injected, so the rules are
// unit-tested with the real service + a fake bus (see __tests__/reads.test.ts).
// `src/lib/cached-reads.ts` binds it to the app singleton.
//
// RULES
//  • KEY = rpc name + canonical JSON of the COMPLETE argument object sent to
//    the database (keys sorted, `undefined` dropped exactly as the request
//    body drops it). A parameter that reaches the server can therefore never
//    be missing from the key: pagination, search, kind, scope, period,
//    bucket, order, limit… all separate entries. The signed-in identity
//    (uid · role · status · active place · scopes) is prefixed by the cache.
//  • ONLY registered RPCs can be cached (RPC_READS). A write RPC is not in
//    the registry, so it cannot reach the cache by accident.
//  • DEPENDENCIES: every entry lists the bus tables it reads (RPC_READS /
//    the table lists below) PLUS the permission tables — events, causes,
//    call_feedbacks and data_change_requests SELECT policies call
//    activity_item_can(), and a definer RPC may too. A bus message for any
//    of them drops the entry (Phase 1 invalidateTables). Permissions
//    themselves are never cached here.
//  • MEMORY ONLY (persist:false): names, phones and counts of people never
//    reach sessionStorage. No stale-while-revalidate (staleMs:0): none of the
//    callers has an onRevalidated hook, so a stale answer would never reach
//    the screen — after the TTL the call simply waits for fresh data.
//  • FRESH WHEN IT MATTERS: `force` drops the key first and fetches (realtime
//    reloads, resume, the «تحديث» buttons, reload after the owner's own
//    writes); `bypass` neither reads nor writes the cache (select-all for a
//    bulk delete, the merge-candidate search).
//  • ERRORS ARE NEVER CACHED. `rpc` rethrows exactly what the old code threw
//    (prefixed Error for the stats RPCs, the raw PostgREST error for the
//    owner RPCs); the `*Soft` / count / roster helpers keep the old «ignore
//    the error» behaviour (null / 0 / []) and also cache nothing.
//  • Results are cloned on the way out: a screen that mutates its rows can
//    never change what the next screen receives.
// ---------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';
import { PERMISSION_TABLES } from './service.ts';
import type { CachedQueryOptions } from './query-cache.ts';

export type QueryFn = <T>(key: string, fetcher: () => Promise<T>, opts?: CachedQueryOptions<T>) => Promise<T>;

export interface ReadOpts {
  /** drop this key first and fetch (realtime reload · manual refresh · after a write) */
  force?: boolean;
  /** do not read, write or share the cache for this call */
  bypass?: boolean;
}

// ---------- TTLs (upper bounds; a bus message drops the entry long before) ----------
const MIN = 60_000;
export const TTL = {
  /** stats_* RPCs: every table they read is on the bus */
  stats: 5 * MIN,
  /** dashboard counters / pending approvals / next-event count */
  dashboard: 2 * MIN,
  /** follow-up roster · attended · contacted */
  followUp: 2 * MIN,
  /** owner header counters */
  ownerCounts: 2 * MIN,
  /**
   * owner list. Short on purpose: it embeds `has_password`
   * (person_credentials has NO bus trigger — a child changing his password in
   * the portal sends no message), so the bus alone cannot bound its staleness.
   */
  ownerPage: 1 * MIN,
} as const;

// ---------- dependencies ----------
/** everything the stats_* family reads (directly or through stats_scope_enrollments / stats_expected_occurrences) */
export const STATS_TABLES = [
  'attendance_log', 'points_log', 'contact_log', 'enrollments', 'persons', 'events', 'causes',
  'call_feedbacks', 'classes', 'services', 'churches', 'servant_enrollments',
] as const;

/** owner_persons_page / owner_persons_counts (person_credentials: no bus trigger — see TTL.ownerPage) */
export const OWNER_PERSON_TABLES = [
  'persons', 'enrollments', 'servant_enrollments', 'servant_scopes', 'servant_scope_requests', 'priests', 'person_credentials',
] as const;

const DASHBOARD_TABLES = ['enrollments', 'attendance_log', 'servant_enrollments', 'churches', 'services', 'classes'] as const;
const DATA_REQUEST_TABLES = ['data_change_requests', 'persons', 'enrollments'] as const;
const FOLLOW_UP_ROSTER_TABLES = ['enrollments', 'persons'] as const;
const FOLLOW_UP_ATTENDED_TABLES = ['attendance_log', 'enrollments'] as const;
const FOLLOW_UP_CONTACTED_TABLES = ['contact_log', 'enrollments'] as const;
const PENDING_SERVANT_TABLES = ['servant_enrollments'] as const;

interface RpcSpec { tables: readonly string[]; ttlMs: number }
const stats: RpcSpec = { tables: STATS_TABLES, ttlMs: TTL.stats };

/**
 * The ONLY RPCs that may be cached. Every one is a pure read. Writes
 * (owner_bulk_enroll / _unenroll / _delete_persons, owner_merge_persons,
 * owner_add_*, attendance, points, duplicate checks…) are deliberately absent.
 */
export const RPC_READS = {
  // lib/stats.ts
  stats_scope_summary: stats,
  stats_day_summary: stats,
  stats_attendance_by_event: stats,
  stats_points_by_cause: stats,
  stats_attendance_timeline: stats,
  stats_points_timeline: stats,
  stats_attendance_by_class: stats,
  stats_leaderboard_scoped: stats,
  stats_weekday_profile: stats,
  // lib/stats-period.ts
  stats_calls_summary: stats,
  stats_calls_by_servant: stats,
  stats_calls_by_class: stats,
  stats_calls_by_feedback: stats,
  stats_calls_timeline: stats,
  stats_calls_persons: stats,
  stats_attendance_period_summary: stats,
  stats_attendance_distribution: stats,
  stats_attendance_hour_profile: stats,
  stats_attendance_by_class_period: stats,
  stats_attendance_persons: stats,
  stats_points_period_summary: stats,
  stats_points_distribution: stats,
  stats_points_by_class_period: stats,
  stats_points_by_servant: stats,
  stats_points_persons: stats,
  // dashboard
  dashboard_counts: { tables: DASHBOARD_TABLES, ttlMs: TTL.dashboard },
  pending_data_requests_count: { tables: DATA_REQUEST_TABLES, ttlMs: TTL.dashboard },
  // owner persons
  owner_persons_page: { tables: OWNER_PERSON_TABLES, ttlMs: TTL.ownerPage },
  owner_persons_counts: { tables: OWNER_PERSON_TABLES, ttlMs: TTL.ownerCounts },
} as const;

export type RegisteredRpc = keyof typeof RPC_READS;

/** every table any Phase 2 read depends on — for «something bypassed the bus» (backup restore) */
export const ALL_READ_TABLES: readonly string[] = Array.from(new Set<string>([
  ...Object.values(RPC_READS).flatMap((s) => Array.from(s.tables)),
  ...FOLLOW_UP_ROSTER_TABLES, ...FOLLOW_UP_ATTENDED_TABLES, ...FOLLOW_UP_CONTACTED_TABLES, ...PENDING_SERVANT_TABLES,
  ...PERMISSION_TABLES,
]));

// ---------- keys ----------
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = canonical(o[k]); // undefined is not sent → not keyed
    return out;
  }
  return v;
}

/** canonical JSON of an argument object: key order and `undefined` do not matter, `null` and every value do */
export function stableArgs(args: Record<string, unknown> | undefined): string {
  return JSON.stringify(canonical(args ?? {}));
}

export function rpcKey(name: string, args?: Record<string, unknown>): string {
  return `rpc:${name}:${stableArgs(args)}`;
}

function clone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  return typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
}

// ---------- row shapes of the follow-up roster ----------
export interface FollowUpRosterRow {
  id: string;
  person: { name: string; phone: string | null; image_url: string | null } | null;
}

export interface RpcReadOpts extends ReadOpts {
  /** throw `new Error("<rpc>: <message>")` like lib/stats.ts always did (default: the raw error) */
  prefixErrors?: boolean;
}

export function createReads(deps: { query: QueryFn }) {
  const { query } = deps;

  async function run<T>(
    key: string, base: readonly string[], ttlMs: number, o: ReadOpts,
    fetcher: () => Promise<T>, shouldCache?: (d: T) => boolean,
  ): Promise<T> {
    if (o.bypass) return fetcher();
    const out = await query<T>(key, fetcher, {
      tables: [...base, ...PERMISSION_TABLES],
      ttlMs,
      staleMs: 0,          // no stale answers: callers have no onRevalidated
      persist: false,      // people's data never reaches storage
      force: o.force,
      shouldCache,
    });
    return clone(out);
  }

  /** a registered RPC, cached under name + the complete argument object */
  async function rpc<T = unknown>(
    supabase: SupabaseClient, name: RegisteredRpc, args: Record<string, unknown> = {}, o: RpcReadOpts = {},
    shouldCache?: (d: T) => boolean,
  ): Promise<T> {
    const spec = (RPC_READS as Record<string, RpcSpec | undefined>)[name];
    if (!spec) throw new Error(`rpc ${String(name)} is not registered for cached reads`);
    const fetcher = async (): Promise<T> => {
      const { data, error } = await supabase.rpc(name, args);
      if (error) throw o.prefixErrors ? new Error(`${name}: ${error.message}`) : error;
      return data as T;
    };
    return run<T>(rpcKey(name, args), spec.tables, spec.ttlMs, o, fetcher, shouldCache);
  }

  /** same, but an error (or an empty answer) yields null — the old «ignore the error» callers; never cached */
  async function rpcSoft<T = unknown>(
    supabase: SupabaseClient, name: RegisteredRpc, args: Record<string, unknown> = {}, o: ReadOpts = {},
  ): Promise<T | null> {
    try {
      const d = await rpc<T | null>(supabase, name, args, o, (x) => x !== null && x !== undefined);
      return d ?? null;
    } catch {
      return null;
    }
  }

  // ---- dashboard ----
  /** servant_enrollments WHERE status = 'pending' (head count) — error → 0, as before */
  async function pendingServantsCount(supabase: SupabaseClient, o: ReadOpts = {}): Promise<number> {
    try {
      return await run<number>(
        'read:servant_enrollments:pending-count', PENDING_SERVANT_TABLES, TTL.dashboard, o,
        async () => {
          const { count, error } = await supabase.from('servant_enrollments').select('id', { count: 'exact', head: true }).eq('status', 'pending');
          if (error) throw error;
          return count ?? 0;
        },
      );
    } catch { return 0; }
  }

  /** attendance rows of ONE event on ONE day (next-event widget) — error → 0, as before */
  async function eventAttendanceCount(supabase: SupabaseClient, eventId: string, day: string, o: ReadOpts = {}): Promise<number> {
    try {
      return await run<number>(
        `read:attendance_log:event-count:${stableArgs({ event: eventId, day })}`, FOLLOW_UP_ATTENDED_TABLES, TTL.dashboard, o,
        async () => {
          const { count, error } = await supabase.from('attendance_log').select('id', { count: 'exact', head: true }).eq('event_id', eventId).eq('attended_on', day);
          if (error) throw error;
          return count ?? 0;
        },
      );
    } catch { return 0; }
  }

  // ---- follow-up roster (3 reads, 3 keys, 3 dependency sets) ----
  const ROSTER_LIMIT = 1000;
  const LOG_LIMIT = 2000;

  async function followUpRoster(
    supabase: SupabaseClient, scope: { church: string; service?: string | null; class?: string | null; classes?: string[] | null }, o: ReadOpts = {},
  ): Promise<FollowUpRosterRow[]> {
    try {
      return await run<FollowUpRosterRow[]>(
        `read:enrollments:roster:${stableArgs({ church: scope.church, service: scope.service ?? null, class: scope.classes && scope.classes.length ? [...scope.classes].sort() : scope.class ?? null, limit: ROSTER_LIMIT })}`,
        FOLLOW_UP_ROSTER_TABLES, TTL.followUp, o,
        async () => {
          let q = supabase.from('enrollments').select('id, person:persons(name, phone, image_url)').eq('church_id', scope.church).limit(ROSTER_LIMIT);
          if (scope.service) q = q.eq('service_id', scope.service);
          if (scope.classes && scope.classes.length > 1) q = q.in('class_id', scope.classes);
          else if (scope.classes && scope.classes.length === 1) q = q.eq('class_id', scope.classes[0]);
          else if (scope.class) q = q.eq('class_id', scope.class);
          const { data, error } = await q;
          if (error) throw error;
          return (data ?? []) as unknown as FollowUpRosterRow[];
        },
      );
    } catch { return []; }
  }

  /** enrollment ids that attended `eventId` on `day` */
  async function followUpAttendedIds(supabase: SupabaseClient, eventId: string, day: string, o: ReadOpts = {}): Promise<string[]> {
    try {
      return await run<string[]>(
        `read:attendance_log:attended-ids:${stableArgs({ event: eventId, day, limit: LOG_LIMIT })}`, FOLLOW_UP_ATTENDED_TABLES, TTL.followUp, o,
        async () => {
          const { data, error } = await supabase.from('attendance_log').select('enrollment_id').eq('event_id', eventId).eq('attended_on', day).limit(LOG_LIMIT);
          if (error) throw error;
          return ((data ?? []) as { enrollment_id: string }[]).map((r) => r.enrollment_id);
        },
      );
    } catch { return []; }
  }

  /** enrollment ids that were called for `eventId` on `day` */
  async function followUpContactedIds(supabase: SupabaseClient, eventId: string, day: string, o: ReadOpts = {}): Promise<string[]> {
    try {
      return await run<string[]>(
        `read:contact_log:contacted-ids:${stableArgs({ event: eventId, day, limit: LOG_LIMIT })}`, FOLLOW_UP_CONTACTED_TABLES, TTL.followUp, o,
        async () => {
          const { data, error } = await supabase.from('contact_log').select('enrollment_id').eq('event_id', eventId).eq('occurrence_on', day).limit(LOG_LIMIT);
          if (error) throw error;
          return ((data ?? []) as { enrollment_id: string }[]).map((r) => r.enrollment_id);
        },
      );
    } catch { return []; }
  }

  return { rpc, rpcSoft, pendingServantsCount, eventAttendanceCount, followUpRoster, followUpAttendedIds, followUpContactedIds };
}

export type Reads = ReturnType<typeof createReads>;
