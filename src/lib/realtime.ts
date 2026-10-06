'use client';

import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

/**
 * ===================================================================
 * Realtime — one shared BROADCAST bus for the hot tables (0046)
 * ===================================================================
 *
 * WHY. With 60–80 servants online every open app held 8–18
 * `postgres_changes` subscriptions (bells · contexts · page · widgets).
 * For `postgres_changes` Supabase re-runs the table's RLS policy ONCE PER
 * CHANGE × PER SUBSCRIBER; one scan touches 2–4 rows → thousands of
 * policy queries per scan → the database saturated and the app hung.
 *
 * HOW. Migration 0046 removed the hot tables from the publication and
 * added STATEMENT-level triggers that `realtime.send()` one tiny message
 * per statement on a per-church topic:
 *     scope:all              (owner)
 *     scope:church:<uuid>    (everyone serving in that church)
 *     user:<uid>             (personal rows: notifications · chats · own enrollment)
 * Authorization happens ONCE at channel join (RLS on realtime.messages).
 *
 * The browser opens ONE channel per topic (2–4 per device, whatever the
 * number of screens/widgets) and fans each message out to every listener
 * that registered for that table. `useDebouncedRealtime` keeps its API,
 * so the 85 call sites in the app did not change.
 *
 * 20261016120000 — EVERYTHING rides the bus. Until now 60 "cold" tables
 * stayed on classic `postgres_changes`; 58 hook sites each opened a
 * channel that the Realtime server polls continuously
 * (`realtime.list_changes`: 3 M calls / month in pg_stat_statements —
 * the single largest consumer) and re-created it on every navigation
 * (`realtime.subscription`: 81 k inserts). The migration gives every
 * table a statement-level bus trigger and empties the publication, so
 * the hook now listens on the bus for ANY table and never opens a
 * `postgres_changes` channel. Server-side `filter`s are not needed: a bus
 * message only says "table X changed (ids…)" and each screen reloads its
 * own, already-scoped query. Per device: 2–4 channels, total, forever.
 *
 * SAFETY NET. If the bus is not connected (realtime down, token trouble)
 * there is no poll (see below) — the header shows «غير متصل» and every
 * screen refetches when the bus returns or the tab regains focus.
 */

// ---------- Topics ----------
/**
 * Realtime channel topics MUST be unique per subscription.
 *
 * `supabase.channel(topic)` returns the EXISTING channel when one with the
 * same topic is already registered on the (singleton) browser client. If that
 * channel has already been `subscribe()`d, calling `.on('postgres_changes')`
 * on it throws — which used to crash pages when two components shared a
 * topic. `uniqueTopic('child-msgs')` → `child-msgs-<time>-<n>`.
 */
let topicSeq = 0;
export function uniqueTopic(base: string): string {
  topicSeq += 1;
  return `${base}-${Date.now().toString(36)}-${topicSeq}`;
}

/**
 * Tables whose bus messages carry row ids (`BusMessage.ids`) — the
 * per-enrollment log tables (0046 §2) and every church-scoped table
 * (20261016120000, `rt_trg_scoped_nullable`). Informational: since
 * 20261016120000 EVERY public table is on the bus, so the hook no longer
 * consults this set to decide between bus and `postgres_changes`.
 */
export const BUS_TABLES: ReadonlySet<string> = new Set([
  'attendance_log', 'points_log', 'contact_log', 'enrollments', 'persons',
  'notification_recipients', 'chat_messages', 'chat_read_state', 'store_orders',
  'card_print_requests', 'user_achievements', 'servant_enrollments', 'servant_scopes',
  'activity_log',
  'app_settings', 'module_access', 'permission_profiles', 'permissions',
]);

/**
 * 20261016120000: the `supabase_realtime` publication is empty — nothing
 * is delivered through `postgres_changes` any more. Kept as a switch so a
 * table can be moved back if ever needed (add it here).
 */
const PG_CHANGES_TABLES: ReadonlySet<string> = new Set([]);

export interface BusMessage {
  /** table */
  t: string;
  /** INSERT | UPDATE | DELETE */
  op: string;
  /** affected row count of the statement */
  n?: number;
  /** first 50 affected ids (enrollment ids for the log tables) */
  ids?: string[];
}

type BusListener = (m: BusMessage) => void;

interface BusState {
  supabase: SupabaseClient | null;
  /** current topics (from the signed-in servant's scopes) */
  topics: string[];
  channels: Map<string, RealtimeChannel>;
  listeners: Map<string, Set<BusListener>>; // table → listeners
  /** true once at least one topic channel reports SUBSCRIBED */
  connected: boolean;
  connListeners: Set<(ok: boolean) => void>;
}

const bus: BusState = {
  supabase: null,
  topics: [],
  channels: new Map(),
  listeners: new Map(),
  connected: false,
  connListeners: new Set(),
};

function setConnected(ok: boolean) {
  if (bus.connected === ok) return;
  bus.connected = ok;
  bus.connListeners.forEach((fn) => { try { fn(ok); } catch { /* ignore */ } });
}

function dispatch(m: BusMessage) {
  const set = bus.listeners.get(m.t);
  if (!set) return;
  set.forEach((fn) => { try { fn(m); } catch { /* listener error must not break the bus */ } });
}

function openTopic(supabase: SupabaseClient, topic: string, attempt = 0) {
  if (bus.channels.has(topic)) return;
  const ch = supabase.channel(topic, { config: { private: true } });
  ch.on('broadcast', { event: 'change' }, (msg: { payload?: unknown }) => {
    const p = msg?.payload as BusMessage | undefined;
    if (p && typeof p.t === 'string') dispatch(p);
  });
  bus.channels.set(topic, ch);
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') { setConnected(true); return; }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      // any other topic still up? keep "connected"
      const anyUp = Array.from(bus.channels.values()).some((c) => c !== ch && c.state === 'joined');
      if (!anyUp) setConnected(false);
      // A private topic is refused when the socket had no JWT yet (race at
      // login) or the migration isn't applied (topic policy missing). Retry
      // with back-off a few times, then leave the pollers in charge.
      if (status !== 'CLOSED' && attempt < 4 && bus.channels.get(topic) === ch) {
        bus.channels.delete(topic);
        supabase.removeChannel(ch).catch(() => {});
        const delay = 2_000 * Math.pow(2, attempt) + Math.random() * 1_000;
        setTimeout(() => {
          if (bus.topics.includes(topic) && !bus.channels.has(topic)) openTopic(supabase, topic, attempt + 1);
        }, delay);
      }
    }
  });
}

function closeTopic(topic: string) {
  const ch = bus.channels.get(topic);
  if (!ch) return;
  bus.channels.delete(topic);
  bus.supabase?.removeChannel(ch).catch(() => {});
  if (bus.channels.size === 0) setConnected(false);
}

/**
 * Called by AuthProvider whenever the signed-in servant (or his scopes)
 * change. Computes the topics and reconciles the open channels.
 *   owner            → scope:all + user:<uid>
 *   servant          → scope:church:<id> for each distinct church + user:<uid>
 *   signed out       → nothing
 */
export function configureRealtimeBus(
  supabase: SupabaseClient,
  me: { uid: string; role: string; churchIds: string[] } | null,
) {
  bus.supabase = supabase;
  const want: string[] = [];
  if (me) {
    want.push(`user:${me.uid}`);
    if (me.role === 'owner') want.push('scope:all');
    else Array.from(new Set(me.churchIds.filter(Boolean))).forEach((c) => want.push(`scope:church:${c}`));
  }
  const wantSet = new Set(want);
  Array.from(bus.channels.keys()).forEach((t) => { if (!wantSet.has(t)) closeTopic(t); });
  bus.topics = want;
  // let the «غير متصل» chip re-evaluate (it ignores the bus until someone wants it)
  bus.connListeners.forEach((fn) => { try { fn(bus.connected); } catch { /* ignore */ } });
  if (want.length === 0) return;
  // Make sure the socket carries the session JWT BEFORE joining private
  // topics (RLS on realtime.messages needs auth.uid()).
  supabase.realtime.setAuth().catch(() => {}).then(() => {
    if (bus.topics !== want) return; // superseded meanwhile
    want.forEach((t) => openTopic(supabase, t));
  });
}

/** Subscribe to bus messages of one table. Returns the unsubscribe fn. */
export function onBusTable(table: string, fn: BusListener): () => void {
  let set = bus.listeners.get(table);
  if (!set) { set = new Set(); bus.listeners.set(table, set); }
  set.add(fn);
  return () => { set?.delete(fn); if (set && set.size === 0) bus.listeners.delete(table); };
}

export function onBusConnection(fn: (ok: boolean) => void): () => void {
  bus.connListeners.add(fn);
  return () => { bus.connListeners.delete(fn); };
}

export function busConnected(): boolean { return bus.connected; }

// ---------- The hook ----------
export interface RealtimeTableSpec {
  table: string;
  /**
   * PostgREST-style filter, e.g. `church_id=eq.<uuid>`. Only meaningful for
   * `postgres_changes` (none since 20261016120000) — the bus ignores it.
   * Kept in the type so the 20 call sites that pass one still compile; it
   * is stripped from `specKey` so a filter that changes when the profile
   * finishes loading does NOT tear the listener down and re-register it.
   */
  filter?: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
}

/**
 * ===================================================================
 * NO BACKGROUND POLLING (20261011120000)
 * ===================================================================
 * Every poll is one PostgREST request = one API-gateway line on the
 * Supabase «Logs Ingest» meter (which cannot be switched off). The free
 * plan is ~1 GB a month ≈ 20–30 k requests a day; a few dozen portal tabs
 * left open used to burn that on their own. So:
 *
 *   • The staff app has NO fallback poll any more. When the broadcast bus
 *     is down the screens simply keep what they have, the header shows an
 *     «غير متصل» chip (useBusState) and everything refetches the moment
 *     the bus reconnects or the tab regains focus.
 *   • The child / priest portals (no auth session → no bus) refresh ONLY on
 *     focus (useFocusRefresh) — never on a timer. Web push remains the
 *     instant path for notifications.
 *   • The only timers left are for screens where something is LIVE right
 *     now and the user is looking at it: the open online-class room and
 *     an open chat thread (useLivePoll — see LIVE_POLL_MS). They stop as
 *     soon as the screen is hidden or the live thing ends.
 */
export const LIVE_POLL_MS = {
  /** an OPEN chat thread the child is reading right now */
  thread: 20_000,
  /** the online-class room while the class is live */
  liveRoom: 15_000,
  /** a pending signup request the applicant is staring at */
  signup: 45_000,
} as const;

/**
 * Refresh-on-focus helper for the portals: runs `fn` when the tab becomes
 * visible again (and, optionally, once on mount). No timer. Returns stop().
 * The pages keep their own «reload» buttons / pull-to-refresh for the
 * «I am looking at it and want the latest» case.
 */
export function startFocusRefresh(fn: () => void): () => void {
  const onVis = () => { if (document.visibilityState === 'visible') fn(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', onVis);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('focus', onVis);
  };
}

/**
 * Poll ONLY while `active` is true and the tab is visible — for the few
 * screens that show something live. Pauses while hidden, refreshes once on
 * return. Returns stop().
 */
export function startLivePoll(fn: () => void, everyMs: number, active: () => boolean = () => true): () => void {
  let t: ReturnType<typeof setInterval> | null = null;
  const start = () => { if (t === null) t = setInterval(() => { if (active() && document.visibilityState === 'visible') fn(); }, everyMs); };
  const stop = () => { if (t !== null) { clearInterval(t); t = null; } };
  const onVis = () => {
    if (document.visibilityState === 'visible') { if (active()) fn(); start(); } else stop();
  };
  document.addEventListener('visibilitychange', onVis);
  if (document.visibilityState === 'visible') start();
  return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
}

/**
 * React view of the bus — drives the «غير متصل» chip in the header.
 * `wanted` = the signed-in user needs a bus at all (owner / approved
 * servant); `connected` = at least one topic is joined.
 */
export function useBusState(): { connected: boolean; wanted: boolean } {
  const [st, setSt] = useState(() => ({ connected: bus.connected, wanted: bus.topics.length > 0 }));
  useEffect(() => {
    const update = () => setSt({ connected: bus.connected, wanted: bus.topics.length > 0 });
    update();
    return onBusConnection(update);
  }, []);
  return st;
}



/**
 * Debounced realtime subscription.
 *
 *   • coalesces bursts of events into ONE reload (trailing debounce),
 *   • never overlaps reloads (a reload that arrives while one is in flight
 *     is queued as a single follow-up),
 *   • pauses while the tab is hidden and does a single refresh on return,
 *   • HOT tables (BUS_TABLES) listen on the shared broadcast bus — no
 *     per-subscriber RLS work on the server; the others keep classic
 *     `postgres_changes` with optional server-side `filter`,
 *   • if the bus is down there is NO poll (20261011120000) — the screen
 *     refetches when the bus comes back and on every hidden→visible.
 */
export function useDebouncedRealtime(
  supabase: SupabaseClient,
  channelName: string,
  tables: RealtimeTableSpec[],
  reload: () => Promise<unknown> | void,
  opts: {
    enabled?: boolean;
    delayMs?: number;
    /**
     * 20261014120000: rate limit for AGGREGATE reloads (stats RPCs, counts)
     * that cannot be patched from the message ids. During a scan burst the
     * trailing debounce alone fires once per quiet gap — i.e. once per scan
     * when scans are 3–10 s apart — on every open device. With a
     * minIntervalMs the reload runs at most once per interval; the last
     * message of the burst is still honoured (trailing run) so the screen
     * ends up exact.
     */
    minIntervalMs?: number;
  } = {}
) {
  const { enabled = true, delayMs = 1200, minIntervalMs = 0 } = opts;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const tablesRef = useRef(tables); tablesRef.current = tables;

  // Stable key for the table spec so effect deps don't churn on re-render.
  // `filter` is irrelevant on the bus → excluded, so a filter derived from
  // the (late-arriving) profile does not re-run the effect.
  const specKey = JSON.stringify(tables.map((t) => ({ table: t.table, event: t.event ?? '*' })));

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let pending = false;
    let disposed = false;

    let lastRunAt = 0;
    const run = async () => {
      if (disposed) return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      lastRunAt = Date.now();
      try {
        await reloadRef.current();
      } finally {
        inFlight = false;
        if (pending && !disposed) {
          pending = false;
          schedule();
        }
      }
    };

    const schedule = () => {
      if (document.visibilityState === 'hidden') { pending = true; return; }
      if (timer) clearTimeout(timer);
      // not before delayMs (debounce) and not before the rate-limit window closes
      const wait = Math.max(delayMs, minIntervalMs > 0 ? lastRunAt + minIntervalMs - Date.now() : 0);
      timer = setTimeout(run, wait);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible' && pending) {
        pending = false;
        schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    const specs = JSON.parse(specKey) as RealtimeTableSpec[];
    const busSpecs = specs.filter((t) => !PG_CHANGES_TABLES.has(t.table));
    const pgSpecs = specs.filter((t) => PG_CHANGES_TABLES.has(t.table));

    // ---- hot tables → shared bus ----
    const unsubs: (() => void)[] = [];
    if (busSpecs.length > 0) {
      busSpecs.forEach((t) => {
        unsubs.push(onBusTable(t.table, (m) => {
          if (t.event && t.event !== '*' && m.op !== t.event) return;
          schedule();
        }));
      });
      // bus (re)connected → one refetch to catch what happened meanwhile.
      // No poll while it is down (the header chip tells the user).
      unsubs.push(onBusConnection((ok) => { if (ok) schedule(); }));
      // a hidden→visible transition always refreshes bus-backed screens
      // (cheap, and covers messages missed while the socket was asleep)
      const onVisBus = () => { if (document.visibilityState === 'visible') schedule(); };
      document.addEventListener('visibilitychange', onVisBus);
      unsubs.push(() => document.removeEventListener('visibilitychange', onVisBus));
    }

    // ---- cold tables → classic postgres_changes ----
    let channel: RealtimeChannel | null = null;
    if (pgSpecs.length > 0) {
      channel = supabase.channel(uniqueTopic(channelName));
      pgSpecs.forEach((t) => {
        const filter = tablesRef.current.find((x) => x.table === t.table)?.filter;
        channel = channel!.on(
          'postgres_changes',
          { event: t.event ?? '*', schema: 'public', table: t.table, ...(filter ? { filter } : {}) },
          schedule
        );
      });
      channel.subscribe();
    }

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubs.forEach((u) => u());
      document.removeEventListener('visibilitychange', onVisible);
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, channelName, specKey, enabled, delayMs]);
}

/**
 * ===================================================================
 * useBusIds — react to WHICH rows changed, not just THAT something changed
 * ===================================================================
 * 20261013120000. Every bus message carries the first 50 affected
 * enrollment / row ids (`BusMessage.ids`). `useDebouncedRealtime` ignores
 * them and lets the screen refetch EVERYTHING, which is right for small
 * lists but was the amplifier behind the «Logs Ingest» spike on follow-up
 * evenings: one servant records a call feedback → every open device
 * re-reads the feedback rows of all 300 children (3 batched requests) plus
 * the home widget's 3 queries → ~240 logged API requests per phone call.
 *
 * This hook collects the ids of every message that arrives within the
 * debounce window and calls `onIds(ids, op)` once — the screen patches
 * only those rows (one tiny request, or none at all). Messages WITHOUT ids
 * (n > 50, or a table that does not carry them) call `onIds([], op)` so
 * the caller can fall back to a full reload. Paused while hidden; a
 * hidden→visible transition hands the collected ids over (or, when nothing
 * is pending, triggers `onVisible` so the caller can do its usual refresh).
 */
export function useBusIds(
  table: string,
  /** `n` = total affected rows of the collected messages (ids are capped at 50 per message, n is not) */
  onIds: (ids: string[], op: string, n: number) => Promise<unknown> | void,
  opts: { enabled?: boolean; delayMs?: number; onVisible?: () => void } = {},
) {
  const { enabled = true, delayMs = 800 } = opts;
  const cbRef = useRef(onIds); cbRef.current = onIds;
  const visRef = useRef(opts.onVisible); visRef.current = opts.onVisible;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingIds = new Set<string>();
    let pendingOp = '';
    let pendingAll = false; // a message without ids arrived → the caller must reload everything
    let pendingN = 0;
    let hasPending = false;

    const flush = () => {
      timer = null;
      if (!hasPending) return;
      const ids = pendingAll ? [] : Array.from(pendingIds);
      const op = pendingOp; const n = pendingN;
      pendingIds = new Set(); pendingOp = ''; pendingAll = false; pendingN = 0; hasPending = false;
      try { void cbRef.current(ids, op, n); } catch { /* ignore */ }
    };
    const schedule = () => {
      if (document.visibilityState === 'hidden') return; // flushed on return
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    };
    const off = onBusTable(table, (m) => {
      hasPending = true;
      // mixed ops in one window → treat as the heavier one (not a pure INSERT)
      pendingOp = pendingOp && pendingOp !== m.op ? 'MIXED' : m.op;
      pendingN += m.n ?? (m.ids?.length ?? 1);
      if (m.ids && m.ids.length) m.ids.forEach((id) => pendingIds.add(id)); else pendingAll = true;
      schedule();
    });
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (hasPending) schedule(); else visRef.current?.();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { off(); if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [table, enabled, delayMs]);
}

/**
 * Build the realtime filter that matches the caller's own scope, so the
 * server only pushes changes he can actually see. Returns undefined for the
 * owner (sees everything) or when the column is not scoped.
 * (Used by the remaining postgres_changes tables; bus tables ignore it.)
 */
export function scopeFilter(
  profile: {
    role: string;
    church_id: string | null;
    service_id: string | null;
    class_id: string | null;
  } | null,
  /**
   * 0045: every place of the caller (useAuth().scopes). A servant bound to
   * SEVERAL places cannot be expressed as one `col=eq.` filter — the caller
   * then gets the unfiltered stream (RLS still decides what he receives);
   * with one common church / service we narrow to that column instead.
   */
  scopes?: { church_id: string; service_id: string | null; class_id: string | null }[],
): string | undefined {
  if (!profile || profile.role === 'owner') return undefined;
  if (scopes && scopes.length > 1) {
    const classes = new Set(scopes.map((s) => s.class_id ?? ''));
    if (classes.size === 1 && !classes.has('')) return `class_id=eq.${scopes[0].class_id}`;
    const services = new Set(scopes.map((s) => s.service_id ?? ''));
    if (services.size === 1 && !services.has('')) return `service_id=eq.${scopes[0].service_id}`;
    const churches = new Set(scopes.map((s) => s.church_id));
    if (churches.size === 1) return `church_id=eq.${scopes[0].church_id}`;
    return undefined;
  }
  if (profile.class_id) return `class_id=eq.${profile.class_id}`;
  if (profile.service_id) return `service_id=eq.${profile.service_id}`;
  if (profile.church_id) return `church_id=eq.${profile.church_id}`;
  return undefined;
}
