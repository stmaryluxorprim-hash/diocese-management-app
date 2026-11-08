// ---------------------------------------------------------------------
// Characterization test — WHEN does useDebouncedRealtime schedule a reload?
// ---------------------------------------------------------------------
// Runs the REAL src/lib/realtime.ts (bus, hook, resume gate). Only `react`
// (a 15-line hook runtime) and the Supabase client (a fake channel factory)
// are stubbed. No production code is changed by this file.
//
// It exists to answer one question from the network investigation:
//   «the persons screen called owner_persons_page + owner_persons_counts
//    twice with IDENTICAL parameters — which trigger fires the 2nd load?»
//
// It documents CURRENT behaviour; if the hook is ever changed on purpose,
// update the expectations (see the investigation report).
// ---------------------------------------------------------------------

import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------- a minimal hook runtime ----------
type Cleanup = (() => void) | void;
let refs: { current: unknown }[] = [];
let refIdx = 0;
let pendingEffects: (() => Cleanup)[] = [];
let cleanups: (() => void)[] = [];

mock.module('react', {
  namedExports: {
    useRef: (init: unknown) => { const r = (refs[refIdx] ??= { current: init }); refIdx++; return r; },
    useEffect: (fn: () => Cleanup) => { pendingEffects.push(fn); },
    useState: (init: unknown) => [init, () => {}],
  },
});

function mountHook(run: () => void) {
  refs = []; refIdx = 0; pendingEffects = []; cleanups = [];
  run();
  for (const e of pendingEffects) { const c = e(); if (typeof c === 'function') cleanups.push(c); }
  return () => cleanups.forEach((c) => c());
}

// ---------- fake DOM bits the module touches ----------
const doc = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
(globalThis as unknown as { document: unknown }).document = doc;

// ---------- fake supabase (channel factory only) ----------
type StatusCb = (s: string) => void;
function fakeSupabase() {
  const channels: { topic: string; state: string; cb?: StatusCb; onChange?: (m: { payload: unknown }) => void }[] = [];
  const sb = {
    realtime: { setAuth: async () => {}, isConnected: () => true },
    channel(topic: string) {
      const ch: { topic: string; state: string; cb?: StatusCb; onChange?: (m: { payload: unknown }) => void; on: (type: string, f: unknown, h?: (m: { payload: unknown }) => void) => unknown; subscribe: (cb: StatusCb) => unknown } = {
        topic, state: 'joined',
        on(_type: string, _f: unknown, h?: (m: { payload: unknown }) => void) { ch.onChange = h; return ch; },
        subscribe(cb: StatusCb) { ch.cb = cb; return ch; },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel: async () => {},
  };
  return {
    sb, channels,
    joinAll: () => channels.forEach((c) => c.cb?.('SUBSCRIBED')),
    deliver: (t: string, op = 'UPDATE') => channels.forEach((c) => c.onChange?.({ payload: { t, op, n: 1 } })),
  };
}

let seq = 0;
async function freshRealtime() {
  // a fresh module instance → fresh bus singleton per scenario
  return (await import(`../../realtime.ts?scenario=${++seq}`)) as typeof import('../../realtime.ts');
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

const TABLES = [{ table: 'persons' }, { table: 'enrollments' }, { table: 'servant_enrollments' }, { table: 'priests' }];

beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_790_000_000_000 }); doc.visibilityState = 'visible'; });
afterEach(() => { mock.timers.reset(); });

test('COLD LOAD: screen mounts before the bus has joined → ONE extra reload ~1.2 s later (identical params)', async () => {
  const rt = await freshRealtime();
  const { sb, joinAll } = fakeSupabase();
  let reloads = 0;

  // AuthProvider: setProfile() renders the screen, configureRealtimeBus() runs right after;
  // the channels have NOT joined when the screen's effect subscribes.
  rt.configureRealtimeBus(sb as never, { uid: 'u', role: 'owner', churchIds: [] });
  const unmount = mountHook(() => rt.useDebouncedRealtime(sb as never, 'owner-persons', TABLES, () => { reloads++; }, { enabled: true }));
  assert.equal(rt.busConnected(), false);

  await flush();
  joinAll();                                   // the bus reports SUBSCRIBED
  assert.equal(rt.busConnected(), true);
  mock.timers.tick(1_199);
  assert.equal(reloads, 0, 'debounced');
  mock.timers.tick(1);
  assert.equal(reloads, 1, 'the first join of the bus triggers a reload although nothing was missed');
  unmount();
});

test('CLIENT-SIDE NAVIGATION: bus already joined when the screen mounts → NO extra reload', async () => {
  const rt = await freshRealtime();
  const { sb, joinAll } = fakeSupabase();
  let reloads = 0;
  rt.configureRealtimeBus(sb as never, { uid: 'u', role: 'owner', churchIds: [] });
  await flush();
  joinAll();
  assert.equal(rt.busConnected(), true);

  const unmount = mountHook(() => rt.useDebouncedRealtime(sb as never, 'owner-persons', TABLES, () => { reloads++; }, { enabled: true }));
  mock.timers.tick(10_000);
  assert.equal(reloads, 0);
  unmount();
});

test('a real bus drop and rejoin → exactly one catch-up reload', async () => {
  const rt = await freshRealtime();
  const { sb, channels, joinAll } = fakeSupabase();
  let reloads = 0;
  rt.configureRealtimeBus(sb as never, { uid: 'u', role: 'owner', churchIds: [] });
  await flush();
  joinAll();
  const unmount = mountHook(() => rt.useDebouncedRealtime(sb as never, 'owner-persons', TABLES, () => { reloads++; }, { enabled: true }));
  channels.forEach((c) => { c.state = 'closed'; c.cb?.('CLOSED'); });   // socket drop
  assert.equal(rt.busConnected(), false);
  channels.forEach((c) => { c.state = 'joined'; c.cb?.('SUBSCRIBED'); }); // phoenix rejoin
  mock.timers.tick(1_200);
  assert.equal(reloads, 1);
  unmount();
});

test('a burst of bus messages for the watched tables collapses into ONE reload', async () => {
  const rt = await freshRealtime();
  const { sb, joinAll, deliver } = fakeSupabase();
  let reloads = 0;
  rt.configureRealtimeBus(sb as never, { uid: 'u', role: 'owner', churchIds: [] });
  await flush();
  joinAll();
  const unmount = mountHook(() => rt.useDebouncedRealtime(sb as never, 'owner-persons', TABLES, () => { reloads++; }, { enabled: true }));
  deliver('persons'); deliver('enrollments'); deliver('persons');
  mock.timers.tick(1_200);
  assert.equal(reloads, 1);
  deliver('some_unwatched_table');
  mock.timers.tick(5_000);
  assert.equal(reloads, 1, 'tables the screen does not watch never reload it');
  unmount();
});

test('a manual refresh (triggerAppResume) reloads the screen once, with identical params', async () => {
  const rt = await freshRealtime();
  const { sb, joinAll } = fakeSupabase();
  let reloads = 0;
  rt.configureRealtimeBus(sb as never, { uid: 'u', role: 'owner', churchIds: [] });
  await flush();
  joinAll();
  const unmount = mountHook(() => rt.useDebouncedRealtime(sb as never, 'owner-persons', TABLES, () => { reloads++; }, { enabled: true }));
  rt.triggerAppResume();
  mock.timers.tick(1_200);
  assert.equal(reloads, 1);
  unmount();
});
