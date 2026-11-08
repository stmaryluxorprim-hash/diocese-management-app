// ---------------------------------------------------------------------
// QueryCache — the framework-free core of `cachedQuery` (Phase 1)
// ---------------------------------------------------------------------
// No imports on purpose: the clock, the storage and the realtime bus are
// injected, so every rule below is unit-testable with `node --test` and the
// module can never pull React / Supabase into a test.
//
// The app wires one instance in `src/lib/cached-query.ts`.
//
// RULES (each one has a test in __tests__/query-cache.test.ts)
//
//  1. IDENTITY FIRST. Nothing is read from or written to the cache until an
//     identity (namespace) is set. With no identity `query()` is a plain
//     pass-through: no storage, no sharing, no dedupe. Changing the identity
//     (sign-out, another uid, another active place / scope set / role)
//     drops every in-memory entry, abandons every in-flight request (its
//     result is returned to its own caller but NEVER stored) and purges
//     every persisted entry that does not belong to the new identity.
//
//  2. DEDUPE. Concurrent calls for one key share one fetch.
//
//  3. FRESHNESS. An entry is
//        verified   — fetched while the realtime bus was continuously
//                     connected, for a query that declared bus `tables`:
//                     every change to those tables since then reached us
//                     and would have invalidated it. Trusted for `ttlMs`.
//        unverified — anything else (bus down, no tables, restored from
//                     sessionStorage, bus dropped or the app resumed after
//                     a long suspension since the fetch). We cannot know
//                     what we missed, so only the short `fallbackTtlMs`.
//
//  4. STALE-WHILE-REVALIDATE. A verified entry older than `ttlMs` but
//     younger than `ttlMs + staleMs` is returned at once and refreshed in
//     the background (deduped, failures keep the old value and back off).
//     An unverified entry gets the same treatment only when the caller
//     passed `onRevalidated` (it can show the late update); otherwise it is
//     refetched before use, because serving unverified data silently could
//     show a change that was already made elsewhere.
//
//  5. INVALIDATION IS HARD. A bus message for a table deletes every entry
//     (memory + storage) that listed it and supersedes any in-flight fetch
//     of those entries, so a response that was already on the wire when the
//     change happened is never cached as fresh.
//
//  6. ERRORS ARE NEVER CACHED. A failed fetch rejects every waiter, stores
//     nothing and the next call retries. With `staleIfError` a blocking
//     failure falls back to the expired value instead of throwing.
//
//  7. PERSISTENCE is opt-in per query, goes to sessionStorage only (dies
//     with the tab, never shared between tabs), is keyed by a hash of the
//     identity and re-validated on restore. Persisted entries are restored
//     as UNVERIFIED.
// ---------------------------------------------------------------------

export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Development tracing (see src/lib/cache/trace.ts). The core only REPORTS
 * what it decided; it never reports data, identities or namespaces.
 */
export type TraceEvent = 'HIT' | 'MISS' | 'DEDUPED' | 'STALE' | 'REVALIDATE' | 'INVALIDATED' | 'BYPASS';
export interface TraceInfo {
  event: TraceEvent;
  /** the cache key (callers redact it before printing) */
  key?: string;
  /** why: verified / fallback-ttl / cold / expired / revalidating / table:x / all / identity / force / no-identity */
  reason?: string;
  /** INVALIDATED: how many entries / in-flight fetches were dropped */
  count?: number;
}

export interface QueryCacheEnv {
  now?: () => number;
  /** optional tracer — undefined in production (zero cost, no behaviour change) */
  trace?: (info: TraceInfo) => void;
  /** sessionStorage (or a fake). Omit / null → no persistence at all. */
  storage?: StorageLike | null;
  /** subscribe to «table X changed»; returns the unsubscribe fn */
  subscribeTable?: (table: string, onChange: () => void) => () => void;
}

export interface CachedQueryOptions<T> {
  /** bus tables whose change invalidates this entry. No tables → never «verified». */
  tables?: readonly string[];
  /** how long a VERIFIED entry is fresh (default 10 min) */
  ttlMs?: number;
  /** how long an UNVERIFIED entry is fresh (default 60 s) */
  fallbackTtlMs?: number;
  /** extra window after the TTL in which stale data is served while revalidating (default 5 min) */
  staleMs?: number;
  /** also keep the entry in sessionStorage (never for permission-gated data) */
  persist?: boolean;
  /** drop the key first and fetch fresh (after a write) */
  force?: boolean;
  /** a blocking fetch that fails returns the expired value instead of throwing */
  staleIfError?: boolean;
  /** return false to keep a result out of the cache (e.g. a missing row) */
  shouldCache?: (data: T) => boolean;
  /** called when a background revalidation produced new data (same identity only) */
  onRevalidated?: (data: T) => void;
}

export const DEFAULT_TTL_MS = 10 * 60_000;
export const DEFAULT_FALLBACK_TTL_MS = 60_000;
export const DEFAULT_STALE_MS = 5 * 60_000;
/** after a failed background revalidation, wait this long before trying again */
export const REVALIDATE_RETRY_MS = 5_000;
export const STORAGE_PREFIX = 'dma:qc:v1:';
export const MAX_ENTRIES = 300;
export const MAX_PERSIST_BYTES = 200_000;

interface Entry {
  at: number;
  data: unknown;
  tables: string[];
  verified: boolean;
  persist: boolean;
}

interface Flight {
  promise: Promise<unknown>;
  tables: string[];
  liveAtStart: boolean;
  epochAtStart: number;
}

export type QueryState = 'fresh' | 'stale' | 'missing';

/** 53-bit string hash (cyrb53) — storage keys never contain the raw uid. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface NamespaceParts {
  uid: string;
  role: string;
  status: string;
  /** the scopes the SESSION sees (the active place, or all his places) */
  scopes: ReadonlyArray<{ church_id: string | null; service_id?: string | null; class_id?: string | null }>;
  /** the place chosen for this login (null = all his places) */
  activePlace?: { church_id: string | null; service_id?: string | null; class_id?: string | null } | null;
}

const placeSig = (p: { church_id: string | null; service_id?: string | null; class_id?: string | null }) =>
  `${p.church_id ?? '-'}/${p.service_id ?? '-'}/${p.class_id ?? '-'}`;

/**
 * Everything RLS keys a servant's reads on: uid, role, status and the scope
 * set (+ the active place). Two sessions with equal namespaces get equal
 * rows from the same query; any difference means a different cache.
 */
export function buildNamespace(p: NamespaceParts): string {
  const scopes = p.scopes.map(placeSig).sort().join(',');
  const active = p.activePlace ? placeSig(p.activePlace) : 'all';
  return `${p.uid}|${p.role}|${p.status}|${active}|${scopes}`;
}

export class QueryCache {
  private readonly now: () => number;
  private readonly storage: StorageLike | null;
  private readonly subscribeTable: ((table: string, onChange: () => void) => () => void) | null;
  private readonly tracer: ((info: TraceInfo) => void) | null;

  private ns: string | null = null;
  private nsHash = '';
  /** bumped on every identity change — a response from an older generation is never stored */
  private gen = 0;
  /** bumped when the bus state changes or trust is withdrawn */
  private epoch = 0;
  private live = false;

  private entries = new Map<string, Entry>();
  private flights = new Map<string, Flight>();
  private failedAt = new Map<string, number>();
  private subs = new Map<string, () => void>();

  constructor(env: QueryCacheEnv = {}) {
    this.now = env.now ?? (() => Date.now());
    this.storage = env.storage ?? null;
    this.subscribeTable = env.subscribeTable ?? null;
    this.tracer = env.trace ?? null;
  }

  private emit(event: TraceEvent, key?: string, reason?: string, count?: number): void {
    if (!this.tracer) return;
    try { this.tracer({ event, key, reason, count }); } catch { /* a tracer must never affect the cache */ }
  }

  // ------------------------------------------------------------------
  // identity
  // ------------------------------------------------------------------
  /** the current namespace (null = no identity → pass-through) */
  get namespace(): string | null { return this.ns; }

  belongsTo(uid: string): boolean {
    return this.ns !== null && this.ns.startsWith(`${uid}|`);
  }

  /**
   * Set the identity. A different value drops everything that belonged to
   * the previous one; the same value is a no-op. `null` = signed out /
   * unknown → the cache is disabled and every persisted entry is purged.
   * Returns true when the identity actually changed.
   */
  setIdentity(ns: string | null): boolean {
    if (ns === this.ns) return false;
    const dropped = this.entries.size + this.flights.size;
    if (dropped > 0) this.emit('INVALIDATED', undefined, 'identity', dropped);
    this.ns = ns;
    this.nsHash = ns === null ? '' : hashString(ns);
    this.gen++;
    this.epoch++;
    this.entries.clear();
    this.flights.clear();
    this.failedAt.clear();
    this.purgeStorage(ns === null ? null : this.nsHash);
    if (ns !== null) this.adoptPersisted();
    this.syncSubscriptions();
    return true;
  }

  /** disable the cache until the next `setIdentity(ns)` (account / place switch in progress) */
  suspend(): void { this.setIdentity(null); }

  // ------------------------------------------------------------------
  // bus state / trust
  // ------------------------------------------------------------------
  /** the realtime bus connected / dropped. A drop withdraws trust from every entry. */
  setBusLive(ok: boolean): void {
    if (ok === this.live) return;
    this.live = ok;
    this.epoch++;
    if (!ok) this.markUnverified();
  }

  /**
   * Withdraw trust from every entry (app resumed after a long suspension,
   * bus dropped…). Entries stay usable for `fallbackTtlMs`, then refetch.
   */
  markUnverified(): void {
    this.epoch++;
    this.entries.forEach((e) => { e.verified = false; });
  }

  // ------------------------------------------------------------------
  // reading
  // ------------------------------------------------------------------
  async query<T>(key: string, fetcher: () => Promise<T>, opts: CachedQueryOptions<T> = {}): Promise<T> {
    if (this.ns === null) { this.emit('BYPASS', key, 'no-identity'); return fetcher(); } // no identity → never cache, never share
    const gen = this.gen;
    if (opts.force) this.invalidateKey(key, 'force');

    const entry = this.entries.get(key);
    if (entry) {
      const state = this.classify(entry, opts);
      if (state === 'fresh') {
        this.emit('HIT', key, entry.verified ? 'verified' : 'fallback-ttl');
        return entry.data as T;
      }
      if (state === 'stale') {
        this.emit('STALE', key, entry.verified ? 'verified' : 'unverified');
        this.revalidate(key, fetcher, opts);
        return entry.data as T;
      }
    }
    if (this.flights.has(key)) this.emit('DEDUPED', key, 'in-flight');
    else this.emit('MISS', key, entry ? 'expired' : 'cold');
    try {
      return await this.fetchShared(key, fetcher, opts);
    } catch (err) {
      if (opts.staleIfError && entry && this.gen === gen) return entry.data as T;
      throw err;
    }
  }

  /** synchronous look — lets a screen paint without a loading flash */
  peek<T>(key: string, opts: CachedQueryOptions<T> = {}): { state: QueryState; data?: T } {
    if (this.ns === null) return { state: 'missing' };
    const entry = this.entries.get(key);
    if (!entry) return { state: 'missing' };
    const s = this.classify(entry, opts);
    if (s === 'expired') return { state: 'missing' };
    return { state: s, data: entry.data as T };
  }

  // ------------------------------------------------------------------
  // invalidation
  // ------------------------------------------------------------------
  invalidateKey(key: string, reason = 'key'): void {
    const dropped = (this.entries.delete(key) ? 1 : 0) + (this.flights.delete(key) ? 1 : 0);
    if (dropped > 0) this.emit('INVALIDATED', key, reason, dropped);
    // an in-flight response may predate the change → never stored (flight removed above)
    this.failedAt.delete(key);
    this.removeStored(key);
    this.syncSubscriptions();
  }

  invalidateTables(tables: string | readonly string[]): void {
    const set = new Set(typeof tables === 'string' ? [tables] : tables);
    const hit = (list: string[]) => list.some((t) => set.has(t));
    const keys: string[] = [];
    this.entries.forEach((e, k) => { if (hit(e.tables)) keys.push(k); });
    this.flights.forEach((f, k) => { if (hit(f.tables)) keys.push(k); });
    const distinct = new Set(keys);
    if (distinct.size > 0) this.emit('INVALIDATED', undefined, `table:${Array.from(set).join(',')}`, distinct.size);
    keys.forEach((k) => {
      this.entries.delete(k);
      this.flights.delete(k);
      this.failedAt.delete(k);
      this.removeStored(k);
    });
    // persisted entries that were never read in this page session
    this.scanStored((key, payload) => { if (payload && hit(payload.tables)) this.storage?.removeItem(key); });
    this.syncSubscriptions();
  }

  /** hard-clear everything of the current identity (role / scope / permission changed) */
  invalidateAll(): void {
    const dropped = this.entries.size + this.flights.size;
    if (dropped > 0) this.emit('INVALIDATED', undefined, 'all', dropped);
    this.epoch++;
    this.entries.clear();
    this.flights.clear();
    this.failedAt.clear();
    this.purgeStorage(null);
    this.syncSubscriptions();
  }

  /** drop the bus subscriptions (tests / hot reload) */
  dispose(): void {
    this.subs.forEach((off) => { try { off(); } catch { /* ignore */ } });
    this.subs.clear();
  }

  /** diagnostics + tests */
  stats(): { entries: number; flights: number; subscriptions: number } {
    return { entries: this.entries.size, flights: this.flights.size, subscriptions: this.subs.size };
  }

  // ------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------
  private classify(
    entry: Entry,
    opts: { ttlMs?: number; fallbackTtlMs?: number; staleMs?: number; onRevalidated?: unknown },
  ): 'fresh' | 'stale' | 'expired' {
    const ttl0 = opts.ttlMs ?? DEFAULT_TTL_MS;
    const fb = opts.fallbackTtlMs ?? DEFAULT_FALLBACK_TTL_MS;
    const stale = opts.staleMs ?? DEFAULT_STALE_MS;
    const age = this.now() - entry.at;
    if (age < 0) return 'expired'; // the clock went backwards — trust nothing
    const ttl = entry.verified ? ttl0 : Math.min(ttl0, fb);
    if (age < ttl) return 'fresh';
    const canServeStale = entry.verified || !!opts.onRevalidated;
    if (canServeStale && age < ttl + stale) return 'stale';
    return 'expired';
  }

  private fetchShared<T>(key: string, fetcher: () => Promise<T>, opts: CachedQueryOptions<T>): Promise<T> {
    const existing = this.flights.get(key);
    if (existing) return existing.promise as Promise<T>;

    const gen = this.gen;
    const tables = opts.tables ? Array.from(new Set(opts.tables)) : [];
    const flight: Flight = {
      promise: undefined as unknown as Promise<unknown>,
      tables,
      liveAtStart: this.live,
      epochAtStart: this.epoch,
    };
    // registered BEFORE the fetcher runs: a synchronous throw must not leave a dead flight behind
    this.flights.set(key, flight);
    this.ensureSubscribed(tables);

    const run = async (): Promise<T> => {
      try {
        const data = await fetcher();
        if (this.gen === gen && this.flights.get(key) === flight) {
          if (!opts.shouldCache || opts.shouldCache(data)) {
            this.store(key, data, tables, opts.persist === true,
              tables.length > 0 && flight.liveAtStart && flight.epochAtStart === this.epoch);
          }
          this.failedAt.delete(key);
        }
        return data;
      } catch (err) {
        if (this.gen === gen && this.flights.get(key) === flight) this.failedAt.set(key, this.now());
        throw err;
      } finally {
        if (this.flights.get(key) === flight) this.flights.delete(key);
        this.syncSubscriptions();
      }
    };
    flight.promise = run();
    return flight.promise as Promise<T>;
  }

  private revalidate<T>(key: string, fetcher: () => Promise<T>, opts: CachedQueryOptions<T>): void {
    if (this.flights.has(key)) { this.emit('DEDUPED', key, 'revalidating'); return; }
    const failed = this.failedAt.get(key);
    if (failed !== undefined && this.now() - failed < REVALIDATE_RETRY_MS) return;
    const gen = this.gen;
    this.emit('REVALIDATE', key);
    this.fetchShared(key, fetcher, opts).then(
      (data) => { if (this.gen === gen) opts.onRevalidated?.(data); },
      () => { /* the stale value stays; failedAt backs the next attempt off */ },
    );
  }

  private store(key: string, data: unknown, tables: string[], persist: boolean, verified: boolean): void {
    const entry: Entry = { at: this.now(), data, tables, verified, persist };
    this.entries.delete(key); // re-insert → Map order = age order
    this.entries.set(key, entry);
    if (persist) this.writeStored(key, entry);
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
      this.removeStored(oldest);
    }
  }

  // ---- bus subscriptions: one per table, only while something needs it ----
  private ensureSubscribed(tables: readonly string[]): void {
    if (!this.subscribeTable) return;
    for (const t of tables) {
      if (this.subs.has(t)) continue;
      this.subs.set(t, this.subscribeTable(t, () => this.invalidateTables(t)));
    }
  }

  private syncSubscriptions(): void {
    if (this.subs.size === 0) return;
    const used = new Set<string>();
    this.entries.forEach((e) => e.tables.forEach((t) => used.add(t)));
    this.flights.forEach((f) => f.tables.forEach((t) => used.add(t)));
    Array.from(this.subs.keys()).forEach((t) => {
      if (used.has(t)) return;
      const off = this.subs.get(t);
      this.subs.delete(t);
      try { off?.(); } catch { /* ignore */ }
    });
  }

  // ---- sessionStorage ----
  private storageKey(key: string): string {
    return `${STORAGE_PREFIX}${this.nsHash}:${encodeURIComponent(key)}`;
  }

  private writeStored(key: string, e: Entry): void {
    if (!this.storage || this.ns === null) return;
    try {
      const json = JSON.stringify({ v: 1, ns: this.nsHash, key, at: e.at, tables: e.tables, data: e.data });
      if (json.length > MAX_PERSIST_BYTES) { this.storage.removeItem(this.storageKey(key)); return; }
      this.storage.setItem(this.storageKey(key), json);
    } catch {
      // quota / private mode — persistence is best-effort
      try { this.storage.removeItem(this.storageKey(key)); } catch { /* ignore */ }
    }
  }

  private removeStored(key: string): void {
    if (!this.storage || this.ns === null) return;
    try { this.storage.removeItem(this.storageKey(key)); } catch { /* ignore */ }
  }

  /** visit every persisted entry of this cache (any identity); payload is null when unreadable */
  private scanStored(fn: (storageKey: string, payload: { ns: string; key: string; at: number; tables: string[]; data: unknown } | null) => void): void {
    const st = this.storage;
    if (!st) return;
    const keys: string[] = [];
    try {
      for (let i = 0; i < st.length; i++) {
        const k = st.key(i);
        if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
      }
    } catch { return; }
    for (const k of keys) {
      let payload: { v?: number; ns?: string; key?: string; at?: number; tables?: unknown; data?: unknown } | null = null;
      try {
        const raw = st.getItem(k);
        payload = raw ? JSON.parse(raw) : null;
      } catch { payload = null; }
      const ok = payload && payload.v === 1 && typeof payload.ns === 'string' && typeof payload.key === 'string'
        && typeof payload.at === 'number' && Array.isArray(payload.tables);
      try {
        fn(k, ok ? (payload as { ns: string; key: string; at: number; tables: string[]; data: unknown }) : null);
      } catch { /* ignore */ }
    }
  }

  /** remove every persisted entry except those of `keepHash` (null → remove all) */
  private purgeStorage(keepHash: string | null): void {
    const st = this.storage;
    if (!st) return;
    const prefix = keepHash === null ? null : `${STORAGE_PREFIX}${keepHash}:`;
    const doomed: string[] = [];
    try {
      for (let i = 0; i < st.length; i++) {
        const k = st.key(i);
        if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
        if (prefix === null || !k.startsWith(prefix)) doomed.push(k);
      }
      doomed.forEach((k) => st.removeItem(k));
    } catch { /* ignore */ }
  }

  /**
   * Load this identity's persisted entries into memory — as UNVERIFIED (what
   * changed while the page was closed never reached the bus). Eager rather
   * than lazy so their tables are subscribed from the start: a change
   * arriving before the first read must still invalidate them.
   */
  private adoptPersisted(): void {
    const now = this.now();
    this.scanStored((storageKey, p) => {
      const mine = p && p.ns === this.nsHash && storageKey.startsWith(`${STORAGE_PREFIX}${this.nsHash}:`);
      if (!p || !mine || p.at > now + 60_000 || p.at < 0) { this.storage?.removeItem(storageKey); return; }
      this.entries.set(p.key, { at: p.at, data: p.data, tables: p.tables.filter((t) => typeof t === 'string'), verified: false, persist: true });
      this.ensureSubscribed(p.tables);
    });
  }
}
