'use client';

import { useEffect, useRef } from 'react';
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
 * so the 84 call sites in the app did not change: the hook decides per
 * table whether to listen on the bus or on classic `postgres_changes`.
 *
 * SAFETY NET. If the bus is not connected (migration not applied yet,
 * realtime down, token trouble) every bus listener falls back to a slow
 * poll (45 s while visible) and a refresh when the tab becomes visible —
 * the screen stays correct, only less instant.
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

/** Tables whose changes travel on the broadcast bus (mirror of 0046 §2). */
export const BUS_TABLES: ReadonlySet<string> = new Set([
  'attendance_log', 'points_log', 'contact_log', 'enrollments', 'persons',
  'notification_recipients', 'chat_messages', 'chat_read_state', 'store_orders',
  'card_print_requests', 'user_achievements', 'servant_enrollments', 'servant_scopes',
  'activity_log',
]);

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
  /** PostgREST-style filter, e.g. `church_id=eq.<uuid>` (postgres_changes only; ignored on the bus) */
  filter?: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
}

/**
 * Poll period used when a bus table has no live connection.
 *
 * LOG INGEST (20261010120000): every poll is one PostgREST request = one
 * API-gateway log line on the Supabase «Logs Ingest» meter. With dozens of
 * open screens a 45 s fallback poll on 5–10 listeners each produced
 * thousands of requests an hour whenever the bus was down. The fallback
 * now polls every 2 minutes; the visibility-change refresh still gives an
 * instant update whenever the user comes back to the tab.
 */
const FALLBACK_POLL_MS = 120_000;

/**
 * Shared poll periods for the portals (child / priest) that cannot join the
 * private broadcast topics. One place to tune the API request volume.
 */
export const PORTAL_POLL_MS = {
  /** profile · achievements · store (was 45 s) */
  default: 120_000,
  /** chat overview · store requests · appointments / visits (was 30 s) */
  fast: 60_000,
  /** notifications inbox (web push is the instant path; was 60 s) */
  slow: 180_000,
  /** rarely changing lists: areas tree, confession / family blocks (was 60–120 s) */
  rare: 300_000,
  /** an OPEN chat thread (was 10 s) */
  thread: 20_000,
  /** a pending signup request waiting for approval (was 15 s) */
  signup: 30_000,
} as const;

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
 *   • if the bus is down the hot tables fall back to a slow poll.
 */
export function useDebouncedRealtime(
  supabase: SupabaseClient,
  channelName: string,
  tables: RealtimeTableSpec[],
  reload: () => Promise<unknown> | void,
  opts: { enabled?: boolean; delayMs?: number } = {}
) {
  const { enabled = true, delayMs = 1200 } = opts;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  // Stable key for the table spec so effect deps don't churn on re-render
  const specKey = JSON.stringify(tables);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let pending = false;
    let disposed = false;

    const run = async () => {
      if (disposed) return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
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
      timer = setTimeout(run, delayMs);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible' && pending) {
        pending = false;
        schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    const specs = JSON.parse(specKey) as RealtimeTableSpec[];
    const busSpecs = specs.filter((t) => BUS_TABLES.has(t.table));
    const pgSpecs = specs.filter((t) => !BUS_TABLES.has(t.table));

    // ---- hot tables → shared bus ----
    const unsubs: (() => void)[] = [];
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => { if (document.visibilityState === 'visible') schedule(); }, FALLBACK_POLL_MS);
    };
    const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
    if (busSpecs.length > 0) {
      busSpecs.forEach((t) => {
        unsubs.push(onBusTable(t.table, (m) => {
          if (t.event && t.event !== '*' && m.op !== t.event) return;
          schedule();
        }));
      });
      // fallback: poll while the bus is not connected; refresh when it (re)connects
      if (!busConnected()) startPoll();
      unsubs.push(onBusConnection((ok) => {
        if (ok) { stopPoll(); schedule(); } else startPoll();
      }));
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
        channel = channel!.on(
          'postgres_changes',
          { event: t.event ?? '*', schema: 'public', table: t.table, ...(t.filter ? { filter: t.filter } : {}) },
          schedule
        );
      });
      channel.subscribe();
    }

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      stopPoll();
      unsubs.forEach((u) => u());
      document.removeEventListener('visibilitychange', onVisible);
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, channelName, specKey, enabled, delayMs]);
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
