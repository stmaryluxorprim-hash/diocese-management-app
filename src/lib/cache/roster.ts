// ---------------------------------------------------------------------
// roster — Phase 4: the selected scope's enrollments, in memory, so a scan
// can be IDENTIFIED without a round trip.
// ---------------------------------------------------------------------
// WHAT IT IS: a read-only index  national_id → enrollments(+person)  of the scope the
// servant picked (church / service / class), loaded once through fetchEnrollmentsPage
// (injected) and kept honest by the realtime bus.
//
// WHAT IT IS NOT — the security rules (tested in roster.test.ts / roster-wiring.test.ts):
//   • It identifies WHO was scanned. It never decides whether a scan is ACCEPTED: the
//     duplicate check, the stopped check, the event-scope check and the attendance / points
//     writes stay on the server (unique index, triggers, RLS). Nothing here stores
//     «already attended», an attendance or points result, a permission or a session token.
//   • A local «hit» is used only when every guard below holds; ANY doubt → the caller asks
//     the server exactly as before (the existing RPC, same validation, same messages).
//     A miss is never remembered (no negative cache).
//   • Not a second query cache: a roster index with its own freshness rules, bound to the
//     SAME identity namespace and bus-trust signal as the Phase 1 cache (injected), dropped
//     the moment either changes. Memory only — never written to storage.
//
// GUARDS before a local hit (resolve):
//   identity   — namespace() === the namespace the roster was loaded under (null → never)
//   scope      — the scope the scan runs in === the scope loaded
//   trust      — bus connected AND past the settle window, and it stayed so during the load
//   fresh      — younger than ttlMs (10 min, like Phase 1)
//   complete   — every page loaded; a scope over maxRows is NOT used at all
//   settled    — no bus INSERT is waiting for its rows to be fetched
//   clean      — no bus message touched the person's rows since the load (so points · status ·
//                class · name are live values); touched rows go to the server until the next reload
//   not stopped— a stopped enrollment is always decided by the server
//   valid id   — empty / oversized / control-character identifiers go to the server
//   unused     — a row handed to a write is marked dirty at once: a repeat or simultaneous scan
//                of the same person is always server-fresh
// ---------------------------------------------------------------------

import { SECURITY_TABLES } from './service.ts';

export interface RosterRow {
  id: string;
  person_id: string;
  church_id: string;
  service_id: string;
  class_id: string;
  status?: string;
  /** the RPC answers ORDER BY created_at; the multi-enrollment picker shows that order, so a local hit keeps it */
  created_at?: string;
  person: { id: string; national_id: string };
}

/** `classes` = MULTI-select (empty / undefined = all); wins over the legacy single `class` */
export interface RosterScope { church?: string; service?: string; class?: string; classes?: string[] }
export const ROSTER_ALL = 'all';
/** the class ids a roster scope narrows to ([] = every class) */
export const rosterClassIds = (s: RosterScope): string[] =>
  s.classes && s.classes.length > 0 ? s.classes : s.class && s.class !== ROSTER_ALL ? [s.class] : [];
export const scopeKey = (s: RosterScope): string => {
  const ids = rosterClassIds(s);
  return `${s.church ?? ROSTER_ALL}/${s.service ?? ROSTER_ALL}/${ids.length ? [...ids].sort().join('+') : ROSTER_ALL}`;
};

export interface RosterBusMessage { op: string; ids?: string[]; n?: number }

export interface RosterEnv<T extends RosterRow, C = unknown> {
  fetchPage(client: C, scope: RosterScope, page: number, size: number): Promise<{ rows: T[]; hasMore: boolean }>;
  fetchByIds(client: C, ids: string[]): Promise<T[]>;
  /** identity namespace of the Phase 1 cache (null = signed out / suspended) */
  namespace(): string | null;
  /** bus connected and past the settle window (Phase 1 service.busTrusted) */
  trusted(): boolean;
  bus: {
    onTable(table: string, fn: (m: RosterBusMessage) => void): () => void;
    /** fires when trust is gained / lost */
    onTrust(fn: (ok: boolean) => void): () => void;
    /** «the app may have missed something» */
    onResume(fn: () => void): () => void;
    /** fires when the identity namespace changes (account / place switch, sign-out) */
    onIdentity(fn: (ns: string | null) => void): () => void;
  };
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  pageSize?: number;
  maxRows?: number;
  ttlMs?: number;
  /** drop everything this long after the scanner page was left */
  idleMs?: number;
  insertDebounceMs?: number;
  updateDebounceMs?: number;
  /** minimum gap between two load attempts after a failure */
  retryGapMs?: number;
  /** minimum gap between two event-driven reloads */
  reloadGapMs?: number;
  /** minimum gap between two «the server knew a person the roster did not» reloads */
  missReloadGapMs?: number;
}

export const ROSTER_PAGE_SIZE = 500;       // + 1 probe row stays under PostgREST max_rows (1000)
export const ROSTER_MAX_ROWS = 3_000;      // 6 requests; bigger scopes are not worth holding in a phone
export const ROSTER_TTL_MS = 10 * 60_000;
export const ROSTER_IDLE_MS = 5 * 60_000;
export const ROSTER_RETRY_GAP_MS = 15_000;
export const ROSTER_RELOAD_GAP_MS = 3_000;
export const ROSTER_MISS_RELOAD_GAP_MS = 60_000;
export const MAX_NATIONAL_ID_LENGTH = 128;

export type LoadResult = 'ready' | 'too-large' | 'failed' | 'stale' | 'skipped' | 'waiting';
export type MissReason =
  | 'no-roster' | 'identity' | 'scope' | 'untrusted' | 'expired' | 'blocked'
  | 'invalid-id' | 'unknown' | 'dirty' | 'stopped';
export type Resolution<T> = { hit: true; rows: T[] } | { hit: false; reason: MissReason };

export interface ScannerRoster<T extends RosterRow, C = unknown> {
  load(client: C, scope: RosterScope, opts?: { force?: boolean }): Promise<LoadResult>;
  resolve(nationalId: string, scope: RosterScope): Resolution<T>;
  /** the server answered a scan the roster could not: compare, mark, maybe reload (never writes rows) */
  learn(nationalId: string, scope: RosterScope, serverRows: T[]): void;
  markUsed(rows: { id: string }[]): void;
  refreshIfNeeded(reason: MissReason, client: C, scope: RosterScope): void;
  release(): void;
  dispose(): void;
  readonly size: number;
  readonly state: 'none' | 'loading' | 'ready' | 'invalid';
  readonly verified: boolean;
  readonly stats: { loads: number; pages: number; byIdFetches: number };
}

interface State<T extends RosterRow, C> {
  ns: string;
  key: string;
  scope: RosterScope;
  client: C;
  rows: Map<string, T>;
  byNid: Map<string, Set<string>>;
  byPerson: Map<string, Set<string>>;
  dirty: Set<string>;          // enrollment ids touched since load
  dirtyPersons: Set<string>;   // person ids touched since load
  status: 'loading' | 'ready' | 'invalid';
  verified: boolean;
  loadedAt: number;
  pendingInserts: number;      // INSERT ids announced by the bus whose rows are not in yet
  buffer: { table: 'enrollments' | 'persons'; m: RosterBusMessage }[];
}

export function createScannerRoster<T extends RosterRow, C = unknown>(env: RosterEnv<T, C>): ScannerRoster<T, C> {
  const now = env.now ?? Date.now;
  const schedule = env.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = env.cancel ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const pageSize = env.pageSize ?? ROSTER_PAGE_SIZE;
  const maxRows = env.maxRows ?? ROSTER_MAX_ROWS;
  const ttlMs = env.ttlMs ?? ROSTER_TTL_MS;
  const idleMs = env.idleMs ?? ROSTER_IDLE_MS;
  const insertDebounce = env.insertDebounceMs ?? 300;
  const updateDebounce = env.updateDebounceMs ?? 3_000;
  const retryGap = env.retryGapMs ?? ROSTER_RETRY_GAP_MS;
  const reloadGap = env.reloadGapMs ?? ROSTER_RELOAD_GAP_MS;
  const missReloadGap = env.missReloadGapMs ?? ROSTER_MISS_RELOAD_GAP_MS;

  let st: State<T, C> | null = null;
  let flight: { ns: string; key: string; inval: number; p: Promise<LoadResult> } | null = null;
  let generation = 0;
  let invalSeq = 0;          // bumped by every invalidation
  let wanted = false;
  let want: { client: C; scope: RosterScope } | null = null;
  let lastFailAt = -Infinity;
  let lastLoadAt = -Infinity;
  let lastMissReloadAt = -Infinity;
  let tooLarge: { ns: string; key: string } | null = null;
  let dataOffs: (() => void)[] = [];
  let controlOffs: (() => void)[] = [];
  let idleTimer: unknown = null;
  let insertTimer: unknown = null;
  let updateTimer: unknown = null;
  let reloadTimer: unknown = null;
  let insertIds = new Set<string>();
  let updateIds = new Set<string>();
  const stats = { loads: 0, pages: 0, byIdFetches: 0 };

  // ---------------- index ----------------
  const unindex = (s: State<T, C>, id: string) => {
    const r = s.rows.get(id); if (!r) return;
    s.rows.delete(id);
    const a = s.byNid.get(r.person.national_id); if (a) { a.delete(id); if (!a.size) s.byNid.delete(r.person.national_id); }
    const b = s.byPerson.get(r.person_id); if (b) { b.delete(id); if (!b.size) s.byPerson.delete(r.person_id); }
  };
  const addRow = (s: State<T, C>, r: T) => {
    unindex(s, r.id);
    s.rows.set(r.id, r);
    const nid = r.person.national_id;
    let a = s.byNid.get(nid); if (!a) { a = new Set(); s.byNid.set(nid, a); } a.add(r.id);
    let b = s.byPerson.get(r.person_id); if (!b) { b = new Set(); s.byPerson.set(r.person_id, b); } b.add(r.id);
  };
  const removeRow = (s: State<T, C>, id: string) => { unindex(s, id); s.dirty.delete(id); };
  const clearRows = (s: State<T, C>) => { s.rows.clear(); s.byNid.clear(); s.byPerson.clear(); s.dirty.clear(); s.dirtyPersons.clear(); };
  const inScope = (scope: RosterScope, r: RosterRow) =>
    (!scope.church || scope.church === ROSTER_ALL || r.church_id === scope.church) &&
    (!scope.service || scope.service === ROSTER_ALL || r.service_id === scope.service) &&
    (rosterClassIds(scope).length === 0 || rosterClassIds(scope).includes(r.class_id));
  const validId = (id: string) => !!id && id.length <= MAX_NATIONAL_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(id);
  const bulk = (m: RosterBusMessage) => !m.ids || m.ids.length === 0 || (typeof m.n === 'number' && m.n > m.ids.length);

  // ---------------- lifecycle ----------------
  const offAll = (arr: (() => void)[]) => { arr.forEach((o) => { try { o(); } catch { /* ignore */ } }); };
  function clearTimers(): void {
    for (const h of [insertTimer, updateTimer, reloadTimer]) if (h !== null) cancel(h);
    insertTimer = updateTimer = reloadTimer = null; insertIds = new Set(); updateIds = new Set();
  }
  /** forget the data (and stop listening to the tables); the control listeners stay */
  function resetData(): void {
    generation++;
    st = null; flight = null;
    clearTimers();
    offAll(dataOffs); dataOffs = [];
  }
  function dispose(): void {
    wanted = false; want = null; tooLarge = null;
    if (idleTimer !== null) { cancel(idleTimer); idleTimer = null; }
    resetData();
    offAll(controlOffs); controlOffs = [];
  }
  /** the data can no longer be trusted → reload when somebody is using the scanner */
  function invalidate(reload: boolean): void {
    invalSeq++;
    if (st) { st.status = 'invalid'; st.verified = false; }
    if (reload && wanted && want) scheduleReload();
  }
  function scheduleReload(): void {
    if (reloadTimer !== null) return;
    const wait = Math.max(0, reloadGap - (now() - lastLoadAt));
    reloadTimer = schedule(() => {
      reloadTimer = null;
      if (wanted && want) void load(want.client, want.scope, { force: true });
    }, wait);
  }

  function ensureControl(): void {
    if (controlOffs.length) return;
    controlOffs.push(env.bus.onTrust((ok) => {
      if (st) {
        if (!ok) st.verified = false;
        else if (st.status === 'ready' && !st.verified) invalidate(true);   // messages may have been missed while it was down
      }
      if (ok && wanted && want && (!st || st.status === 'invalid')) void load(want.client, want.scope, { force: true });
    }));
    controlOffs.push(env.bus.onIdentity(() => {
      resetData(); tooLarge = null;                                         // another account / place: nothing of the old one survives
      if (wanted && want && env.namespace() !== null) void load(want.client, want.scope, { force: true });
    }));
  }
  function ensureData(): void {
    if (dataOffs.length) return;
    dataOffs.push(env.bus.onTable('enrollments', onEnrollments));
    dataOffs.push(env.bus.onTable('persons', onPersons));
    for (const t of SECURITY_TABLES) dataOffs.push(env.bus.onTable(t, () => {   // what RLS lets this servant read changed
      generation++;
      if (st) clearRows(st);
      invalidate(true);
    }));
    dataOffs.push(env.bus.onResume(() => invalidate(true)));
  }

  // ---------------- bus messages ----------------
  function onEnrollments(m: RosterBusMessage): void {
    const s = st; if (!s) return;
    if (s.status === 'loading') { s.buffer.push({ table: 'enrollments', m }); return; }
    if (s.status !== 'ready') return;
    if (bulk(m)) { invalidate(true); return; }
    const ids = m.ids as string[];
    if (m.op === 'DELETE') { ids.forEach((id) => removeRow(s, id)); return; }
    const unknown: string[] = [];
    for (const id of ids) { if (s.rows.has(id)) s.dirty.add(id); else unknown.push(id); }
    if (!unknown.length) return;
    if (m.op === 'INSERT') {
      // a new person may be the very next scan → block local hits until the rows are in
      for (const id of unknown) if (!insertIds.has(id)) { insertIds.add(id); s.pendingInserts++; }
      if (insertTimer === null) insertTimer = schedule(() => { void flushInserts(); }, insertDebounce);
    } else {
      // UPDATE of a row we do not hold: it may have MOVED INTO the scope (rare; never blocks)
      if (unknown.length > 200) { invalidate(true); return; }
      unknown.forEach((id) => updateIds.add(id));
      if (updateTimer === null) updateTimer = schedule(() => { void flushUpdates(); }, updateDebounce);
    }
  }
  function onPersons(m: RosterBusMessage): void {
    const s = st; if (!s) return;
    if (s.status === 'loading') { s.buffer.push({ table: 'persons', m }); return; }
    if (s.status !== 'ready') return;
    if (bulk(m)) { invalidate(true); return; }
    for (const pid of m.ids as string[]) if (s.byPerson.has(pid)) s.dirtyPersons.add(pid);
  }
  async function mergeByIds(s: State<T, C>, ids: string[]): Promise<boolean> {
    if (ids.length > 500) { invalidate(true); return false; }
    const gen = generation;
    try {
      stats.byIdFetches++;
      const rows = await env.fetchByIds(s.client, ids);
      if (gen !== generation || st !== s) return false;
      for (const r of rows) if (inScope(s.scope, r)) addRow(s, r);
      return true;
    } catch {
      if (gen === generation && st === s) invalidate(true);
      return false;
    }
  }
  async function flushInserts(): Promise<void> {
    insertTimer = null;
    const s = st; const ids = Array.from(insertIds); insertIds = new Set();
    if (!s || s.status !== 'ready' || !ids.length) return;
    const ok = await mergeByIds(s, ids);
    if (ok && st === s) s.pendingInserts = Math.max(0, s.pendingInserts - ids.length);
  }
  async function flushUpdates(): Promise<void> {
    updateTimer = null;
    const s = st; const ids = Array.from(updateIds); updateIds = new Set();
    if (!s || s.status !== 'ready' || !ids.length) return;
    await mergeByIds(s, ids);
  }

  // ---------------- loading ----------------
  async function run(client: C, scope: RosterScope, ns: string, key: string): Promise<LoadResult> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const gen = ++generation;
      const s: State<T, C> = {
        ns, key, scope, client, rows: new Map(), byNid: new Map(), byPerson: new Map(),
        dirty: new Set(), dirtyPersons: new Set(), status: 'loading', verified: false, loadedAt: 0, pendingInserts: 0, buffer: [],
      };
      st = s; ensureData();
      lastLoadAt = now();
      let trustedAll = env.trusted();
      const offTrust = env.bus.onTrust((ok) => { if (!ok) trustedAll = false; });
      let pages = 0; let more = true;
      try {
        for (let page = 0; more; page++) {
          if (page * pageSize >= maxRows) break;
          stats.pages++;
          const r = await env.fetchPage(client, scope, page, pageSize);
          if (gen !== generation || env.namespace() !== ns) { offTrust(); return 'stale'; }
          pages++;
          for (const row of r.rows) addRow(s, row);
          more = r.hasMore;
          if (s.rows.size > maxRows) { more = true; break; }   // over the cap: stop paging, never keep a partial roster
        }
      } catch {
        offTrust();
        if (gen !== generation) return 'stale';
        s.status = 'invalid'; lastFailAt = now();
        return 'failed';
      }
      offTrust();
      if (gen !== generation) return 'stale';
      if (more) { clearRows(s); s.status = 'invalid'; tooLarge = { ns, key }; return 'too-large'; }
      // offset pagination over a live table: any change during a multi-page load can skip a row → load again
      if (pages > 1 && s.buffer.length > 0) {
        if (attempt < 2) continue;
        s.status = 'invalid'; lastFailAt = now();
        return 'failed';
      }
      if (!trustedAll && env.trusted() && attempt < 2) continue;      // the bus dropped and came back mid-load
      s.status = 'ready';
      s.loadedAt = now();
      s.verified = trustedAll && env.trusted();
      const buffered = s.buffer; s.buffer = [];
      for (const b of buffered) { if (b.table === 'persons') onPersons(b.m); else onEnrollments(b.m); }
      return 'ready';
    }
    return 'failed';
  }

  /**
   * Make sure the roster of (current identity, scope) is loaded or loading. Idempotent: a ready, fresh,
   * verified roster of the same identity + scope is reused (no request); concurrent calls share one load.
   * No load while the bus is not trusted (a roster nobody can keep fresh is not worth loading).
   */
  function load(client: C, scope: RosterScope, opts: { force?: boolean } = {}): Promise<LoadResult> {
    wanted = true; want = { client, scope };
    if (idleTimer !== null) { cancel(idleTimer); idleTimer = null; }
    ensureControl();
    const ns = env.namespace();
    if (ns === null) { resetData(); return Promise.resolve('skipped'); }
    if (st && st.ns !== ns) resetData();
    const key = scopeKey(scope);
    if (!opts.force && tooLarge && tooLarge.ns === ns && tooLarge.key === key) return Promise.resolve('too-large');
    if (!env.trusted()) return Promise.resolve('waiting');
    if (flight && flight.ns === ns && flight.key === key && (!opts.force || flight.inval === invalSeq)) return flight.p;
    if (!opts.force && st && st.ns === ns && st.key === key && st.status === 'ready' && st.verified && now() - st.loadedAt < ttlMs) return Promise.resolve('ready');
    if (!opts.force && now() - lastFailAt < retryGap) return Promise.resolve('failed');
    stats.loads++;
    const p: Promise<LoadResult> = run(client, scope, ns, key).finally(() => { if (flight && flight.p === p) flight = null; });
    flight = { ns, key, inval: invalSeq, p };
    return p;
  }

  /** the scanner page was left: keep the data for a quick return, drop it after idleMs */
  function release(): void {
    wanted = false;
    if (idleTimer !== null) cancel(idleTimer);
    idleTimer = schedule(() => { idleTimer = null; if (!wanted) dispose(); }, idleMs);
  }

  // ---------------- resolving ----------------
  function resolve(nationalId: string, scope: RosterScope): Resolution<T> {
    const miss = (reason: MissReason): Resolution<T> => ({ hit: false, reason });
    const s = st;
    if (!s || s.status !== 'ready') return miss('no-roster');
    const ns = env.namespace();
    if (ns === null || ns !== s.ns) return miss('identity');
    if (scopeKey(scope) !== s.key) return miss('scope');
    if (!s.verified || !env.trusted()) return miss('untrusted');
    if (now() - s.loadedAt >= ttlMs) return miss('expired');
    if (s.pendingInserts > 0) return miss('blocked');
    if (!validId(nationalId)) return miss('invalid-id');
    const ids = s.byNid.get(nationalId);
    if (!ids || ids.size === 0) return miss('unknown');
    const rows: T[] = [];
    for (const id of Array.from(ids)) {
      const r = s.rows.get(id) as T;
      if (s.dirty.has(id) || s.dirtyPersons.has(r.person_id)) return miss('dirty');
      if (r.status === 'stopped') return miss('stopped');
      rows.push(r);
    }
    rows.sort((x, y) => (x.created_at ?? '') < (y.created_at ?? '') ? -1 : (x.created_at ?? '') > (y.created_at ?? '') ? 1 : x.id < y.id ? -1 : 1);
    return { hit: true, rows };
  }

  /** a row was handed to a write: the next scan of this person must come from the server */
  function markUsed(rows: { id: string }[]): void {
    const s = st; if (!s) return;
    for (const r of rows) if (s.rows.has(r.id)) s.dirty.add(r.id);
  }

  /**
   * The server answered a scan the roster could not. The server stays the authority and the roster
   * never copies its answer in: it only notices disagreement.
   *   • rows the roster holds for this id that the server no longer returns in scope → dirty
   *   • in-scope rows the server has and the roster does not → the roster is behind → reload (rate limited)
   * An id the server does not know in scope (typo, other class, garbage) changes nothing.
   */
  function learn(nationalId: string, scope: RosterScope, serverRows: T[]): void {
    const s = st;
    if (!s || s.status !== 'ready' || env.namespace() !== s.ns || scopeKey(scope) !== s.key || !validId(nationalId)) return;
    const server = new Set(serverRows.filter((r) => r.person && r.person.national_id === nationalId && inScope(s.scope, r)).map((r) => r.id));
    const mine = s.byNid.get(nationalId) ?? new Set<string>();
    for (const id of Array.from(mine)) if (!server.has(id)) s.dirty.add(id);
    let behind = false;
    server.forEach((id) => { if (!s.rows.has(id)) behind = true; });
    if (behind && now() - lastMissReloadAt >= missReloadGap) { lastMissReloadAt = now(); invalidate(true); }
  }

  function refreshIfNeeded(reason: MissReason, client: C, scope: RosterScope): void {
    if (reason === 'no-roster' || reason === 'expired' || reason === 'identity' || reason === 'untrusted' || reason === 'scope') void load(client, scope);
  }

  return {
    load, resolve, learn, markUsed, release, dispose, refreshIfNeeded,
    get size(): number { return st?.rows.size ?? 0; },
    get state() { return st ? st.status : 'none'; },
    get verified(): boolean { return !!st && st.verified; },
    stats,
  };
}

// ---------------------------------------------------------------------
// identifyScan — the ONLY place the scanner decides «local or server» for the
// national-id step. Everything after it (scope filter, stopped check, event /
// scope rules, the attendance / points writes, 23505 duplicate handling) is the
// page's existing code, unchanged and server-validated.
// ---------------------------------------------------------------------
export interface ScanServerAnswer<T> { data: T[] | null; error: unknown }
export type ScanIdentity<T> =
  | { source: 'local'; rows: T[] }
  | { source: 'server'; error: boolean; rows: T[]; reason: MissReason };

export async function identifyScan<T extends RosterRow, C>(
  roster: ScannerRoster<T, C>,
  client: C,
  nationalId: string,
  scope: RosterScope,
  inScope: (r: T) => boolean,
  server: (nationalId: string) => PromiseLike<ScanServerAnswer<T>>,
): Promise<ScanIdentity<T>> {
  const local = roster.resolve(nationalId, scope);
  if (local.hit) {
    const mine = local.rows.filter(inScope);
    if (mine.length > 0) {
      roster.markUsed(mine);                 // synchronously: a simultaneous second scan of this person goes to the server
      return { source: 'local', rows: mine };
    }
  }
  const reason: MissReason = local.hit ? 'scope' : local.reason;
  const { data, error } = await server(nationalId);
  if (error) return { source: 'server', error: true, rows: [], reason };
  const rows = ((data ?? []) as T[]).filter((e) => e.person);
  roster.learn(nationalId, scope, rows.filter(inScope));
  roster.refreshIfNeeded(reason, client, scope);
  return { source: 'server', error: false, rows, reason };
}
