'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EnrollmentWithPerson } from '@/lib/types';
import { cachedLookupRows, invalidateLookupTables } from '@/lib/cached-query';
import type { LookupTable } from '@/lib/cache/service';
import { classIdsOf } from '@/lib/class-multi';

export const ALL = 'all';

/**
 * Columns the list screens (and their view/edit modals) actually use.
 * Audit columns (created_by / edited_*) are excluded — ~30% smaller rows.
 */
/** enrollments.kind (migration 0042): children by default; 'servant' = mirror rows of servant accounts. */
export type EnrollmentKind = 'child' | 'servant' | 'all';

export const ENROLLMENT_LIST_SELECT =
  'id, person_id, church_id, service_id, class_id, attendance_count, points, created_at, kind, servant_id, status, ' +
  'person:persons(id, national_id, name, birthdate, gender, phone, address, notes, image_url)';

export interface ScopeSelection {
  church?: string; // ALL | uuid
  service?: string;
  class?: string;
  /** MULTI-select of classes (empty / undefined = no narrowing); wins over `class` */
  classes?: string[];
}

/** narrow an enrollments query to the chosen class(es) — `classes` list or legacy single `class` */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyClassScope<Q extends { eq: (c: string, v: string) => Q; in: (c: string, v: string[]) => Q }>(q: Q, scope: ScopeSelection, column = 'class_id'): Q {
  const ids = classIdsOf(scope);
  if (ids.length === 1) return q.eq(column, ids[0]);
  if (ids.length > 1) return q.in(column, ids);
  return q;
}

/** Hard cap so a runaway query can never pull the whole diocese. */
export const PAGE_SIZE = 200;

/**
 * Fetch enrollments (with the embedded person) for the selected scope,
 * paginated. Filtering happens IN THE DATABASE (indexed columns), so a class
 * servant transfers ~30 rows instead of the entire table.
 *
 * `search` uses PostgREST `or` over the FK-embedded table via `!inner`, so
 * name / phone / national-id search is also server-side.
 */
export async function fetchEnrollmentsPage(
  supabase: SupabaseClient,
  scope: ScopeSelection,
  opts: { page?: number; pageSize?: number; search?: string; kind?: EnrollmentKind; status?: 'active' | 'stopped' | 'all' } = {}
): Promise<{ rows: EnrollmentWithPerson[]; hasMore: boolean }> {
  const page = opts.page ?? 0;
  const size = opts.pageSize ?? PAGE_SIZE;
  const search = (opts.search ?? '').trim();
  const kind = opts.kind ?? 'child';
  const status = opts.status ?? 'all';

  const select = search
    ? ENROLLMENT_LIST_SELECT.replace('person:persons(', 'person:persons!inner(')
    : ENROLLMENT_LIST_SELECT;

  let q = supabase.from('enrollments').select(select);
  if (kind !== 'all') q = q.eq('kind', kind);
  if (status !== 'all') q = q.eq('status', status);
  if (scope.church && scope.church !== ALL) q = q.eq('church_id', scope.church);
  if (scope.service && scope.service !== ALL) q = q.eq('service_id', scope.service);
  q = applyClassScope(q, scope);
  if (search) {
    const s = search.replace(/[,()]/g, ' ');
    // Filters on an embedded resource address it by its ALIAS (`person`).
    q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,national_id.ilike.%${s}%`, {
      referencedTable: 'person',
    });
  }
  // Server-side sort by class then person name keeps the per-class groups
  // contiguous; fetch one extra row to know whether there is a next page.
  // `person(name)` orders the PARENT rows by the to-one embedded column
  // (PostgREST ≥ 9); `id` last makes the order total → stable pagination.
  q = q
    .order('class_id')
    .order('person(name)')
    .order('id')
    .range(page * size, page * size + size);

  const { data, error } = await q;
  if (error) throw error;
  const list = ((data ?? []) as unknown as EnrollmentWithPerson[]).filter((e) => e.person);
  const hasMore = list.length > size;
  return { rows: hasMore ? list.slice(0, size) : list, hasMore };
}

/**
 * ---------- Shepherds module (الأشابين, migration 0025) ----------
 * The enrollment ids of MY group. Bounded (a servant's group is small) and
 * RLS-scoped: only when the module is granted to me. Returns an empty set
 * when the migration is missing so callers degrade gracefully.
 */
export async function fetchMyGroupIds(
  supabase: SupabaseClient,
  servantId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('shepherd_groups')
    .select('enrollment_id')
    .eq('servant_id', servantId)
    .limit(2000);
  if (error) return new Set();
  return new Set(((data ?? []) as { enrollment_id: string }[]).map((r) => r.enrollment_id));
}

/**
 * Fetch the enrollments (with person) of MY group, optionally narrowed by
 * the scope selectors + search. Runs in the DB via `in(...)` over the
 * group's ids (chunked so the URL stays short).
 */
export async function fetchMyGroupEnrollments(
  supabase: SupabaseClient,
  groupIds: Set<string>,
  scope: ScopeSelection,
  search = '',
  kind: EnrollmentKind = 'child'
): Promise<EnrollmentWithPerson[]> {
  const ids = Array.from(groupIds);
  if (ids.length === 0) return [];
  const s = search.trim().replace(/[,()]/g, ' ');
  const select = s
    ? ENROLLMENT_LIST_SELECT.replace('person:persons(', 'person:persons!inner(')
    : ENROLLMENT_LIST_SELECT;
  const out: EnrollmentWithPerson[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    let q = supabase.from('enrollments').select(select).in('id', ids.slice(i, i + 100));
    if (kind !== 'all') q = q.eq('kind', kind);
    if (scope.church && scope.church !== ALL) q = q.eq('church_id', scope.church);
    if (scope.service && scope.service !== ALL) q = q.eq('service_id', scope.service);
    q = applyClassScope(q, scope);
    if (s) {
      q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,national_id.ilike.%${s}%`, {
        referencedTable: 'person',
      });
    }
    const { data, error } = await q.order('class_id').order('person(name)').order('id');
    if (error) throw error;
    out.push(...((data ?? []) as unknown as EnrollmentWithPerson[]).filter((e) => e.person));
  }
  return out;
}

/**
 * PostgREST caps every response at `max_rows` (1000 on Supabase). A page
 * request MUST stay strictly below it: `fetchEnrollmentsPage` asks for
 * `size + 1` rows to detect a next page, so with `size = 1000` the 1001st
 * row was silently dropped → `hasMore` was always false → the printing tabs
 * showed exactly 1000 children and nothing more. 500 (+1 probe) is well
 * under the cap and keeps each payload light.
 */
export const FETCH_ALL_PAGE = 500;

/** Safety net so a broken loop can never spin forever (≈ 100k rows). */
const FETCH_ALL_MAX_PAGES = 200;

/**
 * Fetch ALL enrollments of a scope (used by the printing tabs, which
 * genuinely need the complete scoped set — a church-wide print must
 * include every child, not the first thousand). Pages of `FETCH_ALL_PAGE`
 * are fetched sequentially until the server reports no more rows; still
 * filtered server-side by church / service / class.
 *
 * `onProgress(loadedSoFar)` lets the caller show a counter while a big
 * scope is streaming in.
 */
export async function fetchAllEnrollments(
  supabase: SupabaseClient,
  scope: ScopeSelection,
  opts: { kind?: EnrollmentKind; onProgress?: (loaded: number) => void } = {}
): Promise<EnrollmentWithPerson[]> {
  const kind = opts.kind ?? 'child';
  const out: EnrollmentWithPerson[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < FETCH_ALL_MAX_PAGES; page++) {
    const { rows, hasMore } = await fetchEnrollmentsPage(supabase, scope, { page, pageSize: FETCH_ALL_PAGE, kind });
    // rows are ordered totally (class, name, id) so duplicates across pages
    // only appear if a row is inserted mid-way; skip them defensively.
    for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
    opts.onProgress?.(out.length);
    if (!hasMore) break;
  }
  return out;
}

/**
 * Page through ANY PostgREST query until it runs dry. `build(from, to)` must
 * return the query with its filters + a TOTAL order (end with `.order('id')`)
 * — `.range()` is applied here. Used where the complete set is genuinely
 * needed (print queues, exports) and a bare `select()` would be silently cut
 * at PostgREST's `max_rows` (1000).
 */
export async function fetchAllRows<T extends { id: string }>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  pageSize = FETCH_ALL_PAGE
): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < FETCH_ALL_MAX_PAGES; page++) {
    const from = page * pageSize;
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
    if (rows.length < pageSize) break;
  }
  return out;
}

/**
 * 20261013120000: re-read ONLY the enrollments named by a realtime message
 * (same select as the list) so the children page can patch rows in place
 * instead of re-downloading every page on every device for every scan /
 * counter update. One request per 100 ids.
 */
export async function fetchEnrollmentsByIds(supabase: SupabaseClient, ids: string[]): Promise<EnrollmentWithPerson[]> {
  const out: EnrollmentWithPerson[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('enrollments').select(ENROLLMENT_LIST_SELECT).in('id', ids.slice(i, i + 100));
    if (error) throw error;
    out.push(...((data ?? []) as unknown as EnrollmentWithPerson[]).filter((e) => e.person));
  }
  return out;
}

/**
 * Tiny lookup tables (churches / services / classes / events / causes /
 * call_feedbacks) rarely change, so they are cached — now by the shared
 * `cachedQuery` layer (src/lib/cached-query.ts, Phase 1 of the performance
 * plan) instead of a table-name-keyed Map. What that changes, without
 * changing this function's signature or result:
 *   • the cache belongs to the signed-in identity (uid · role · active place
 *     · scopes) and is emptied on sign-out / account / place switch;
 *   • concurrent callers share ONE request;
 *   • the realtime bus drops an entry the moment its table changes, so it can
 *     live for minutes without ever being stale (fallback: 60 s while the bus
 *     is down);
 *   • each ordering has its own entry (it used to be one entry per table, so
 *     the first page to load decided the order for all the others);
 *   • a failed read is NOT cached (it used to cache `[]` for 10 minutes);
 *   • church / service / class lists survive a reload (sessionStorage);
 *     events / causes / call_feedbacks are permission-gated by RLS and stay
 *     in memory only.
 * Every edit screen still calls invalidateLookup() after a write.
 */
export async function cachedLookup<T>(
  supabase: SupabaseClient,
  table: LookupTable,
  orderBy: { column: string; ascending?: boolean; nullsFirst?: boolean } = { column: 'name' },
  force = false
): Promise<T[]> {
  return cachedLookupRows<T>(supabase, table, orderBy, force);
}

export function invalidateLookup(table?: string) {
  invalidateLookupTables(table);
}
