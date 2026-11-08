import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createQueryService, type BusPort } from '../service.ts';
import { QueryCache } from '../query-cache.ts';
import { createDevTracer, redactKey } from '../trace.ts';

class FakeBus implements BusPort {
  up = true;
  tables = new Map<string, Set<() => void>>();
  conn = new Set<(ok: boolean) => void>();
  onTable(t: string, fn: () => void) {
    let s = this.tables.get(t); if (!s) { s = new Set(); this.tables.set(t, s); }
    s.add(fn); return () => { s!.delete(fn); };
  }
  onConnection(fn: (ok: boolean) => void) { this.conn.add(fn); return () => { this.conn.delete(fn); }; }
  connected() { return this.up; }
  onResume() { return () => {}; }
  emit(t: string) { Array.from(this.tables.get(t) ?? []).forEach((f) => f()); }
}

const SECRET_UID = 'uid-7f3a9c-SECRET';
const IDENT = { uid: SECRET_UID, role: 'owner', status: 'approved', scopes: [] as { church_id: string | null }[] };

function rig() {
  const clock = { t: 9_000_000 };
  const bus = new FakeBus();
  const lines: string[] = [];
  const tracer = createDevTracer({ sink: (l) => lines.push(l), now: () => clock.t });
  const timers: { fn: () => void; at: number; live: boolean; id: number }[] = [];
  let seq = 0;
  const svc = createQueryService({
    bus, now: () => clock.t, trace: tracer.trace,
    schedule: (fn, ms) => { const t = { fn, at: clock.t + ms, live: true, id: ++seq }; timers.push(t); return t.id; },
    cancel: (h) => { const t = timers.find((x) => x.id === h); if (t) t.live = false; },
  });
  const advance = (ms: number) => {
    clock.t += ms;
    timers.filter((t) => t.live && t.at <= clock.t).forEach((t) => { t.live = false; t.fn(); });
  };
  const events = () => tracer.records().map((r) => r.event);
  return { svc, bus, tracer, lines, clock, advance, events };
}

const deferred = <T,>() => { let res!: (v: T) => void; const p = new Promise<T>((r) => { res = r; }); return { p, res }; };

describe('cache tracing — event semantics', () => {
  test('MISS → HIT → (after TTL) MISS(expired)', async () => {
    const { svc, tracer, clock, advance } = rig();
    svc.setIdentity(IDENT); advance(5_000);
    let n = 0;
    const f = async () => ++n;
    await svc.query('k', f, { tables: ['t'], ttlMs: 1_000, staleMs: 0 });
    await svc.query('k', f, { tables: ['t'], ttlMs: 1_000, staleMs: 0 });
    clock.t += 2_000;
    await svc.query('k', f, { tables: ['t'], ttlMs: 1_000, staleMs: 0 });
    assert.deepEqual(tracer.records().map((r) => [r.event, r.reason]),
      [['MISS', 'cold'], ['HIT', 'verified'], ['MISS', 'expired']]);
    assert.equal(n, 2);
  });

  test('concurrent identical calls → one MISS, the rest DEDUPED, one fetch', async () => {
    const { svc, events, advance } = rig();
    svc.setIdentity(IDENT); advance(5_000);
    const d = deferred<number>(); let n = 0;
    const f = () => { n++; return d.p; };
    const all = [svc.query('k', f), svc.query('k', f), svc.query('k', f)];
    d.res(1);
    await Promise.all(all);
    assert.deepEqual(events(), ['MISS', 'DEDUPED', 'DEDUPED']);
    assert.equal(n, 1);
  });

  test('SEQUENTIAL identical call after the first one finished → HIT, not a second fetch', async () => {
    const { svc, events, advance } = rig();
    svc.setIdentity(IDENT); advance(5_000);
    let n = 0; const f = async () => ++n;
    await svc.query('k', f, { tables: ['t'] });
    await svc.query('k', f, { tables: ['t'] });
    assert.deepEqual(events(), ['MISS', 'HIT']); assert.equal(n, 1);
  });

  test('bus message → INVALIDATED (table + count), next read is a MISS', async () => {
    const { svc, bus, tracer, advance } = rig();
    svc.setIdentity(IDENT); advance(5_000);
    await svc.query('a', async () => 1, { tables: ['persons'] });
    await svc.query('b', async () => 2, { tables: ['persons', 'priests'] });
    bus.emit('persons');
    await svc.query('a', async () => 3, { tables: ['persons'] });
    const inv = tracer.records().find((r) => r.event === 'INVALIDATED')!;
    assert.equal(inv.reason, 'table:persons'); assert.equal(inv.count, 2);
    assert.equal(tracer.records().at(-1)!.event, 'MISS');
  });

  test('STALE + REVALIDATE for a verified entry past its TTL; a 2nd caller during revalidation → DEDUPED', async () => {
    const { svc, tracer, clock, advance } = rig();
    svc.setIdentity(IDENT); advance(5_000);
    await svc.query('k', async () => 'v1', { tables: ['t'], ttlMs: 1_000 });
    clock.t += 1_500;
    const d = deferred<string>();
    await svc.query('k', () => d.p, { tables: ['t'], ttlMs: 1_000 });
    await svc.query('k', () => d.p, { tables: ['t'], ttlMs: 1_000 });
    d.res('v2'); await Promise.resolve();
    assert.deepEqual(tracer.records().map((r) => r.event), ['MISS', 'STALE', 'REVALIDATE', 'STALE', 'DEDUPED']);
  });

  test('identity change / sign-out → one INVALIDATED(identity); no identity → BYPASS', async () => {
    const { svc, tracer, advance } = rig();
    svc.setIdentity(IDENT); advance(5_000);
    await svc.query('k', async () => 1, { tables: ['t'] });
    svc.suspend();
    await svc.query('k', async () => 1, { tables: ['t'] });
    assert.deepEqual(tracer.records().map((r) => [r.event, r.reason]),
      [['MISS', 'cold'], ['INVALIDATED', 'identity'], ['BYPASS', 'no-identity']]);
  });

  test('force → INVALIDATED(force) then MISS', async () => {
    const { svc, tracer, advance } = rig();
    svc.setIdentity(IDENT); advance(5_000);
    await svc.query('k', async () => 1, { tables: ['t'] });
    await svc.query('k', async () => 2, { tables: ['t'], force: true });
    assert.deepEqual(tracer.records().map((r) => [r.event, r.reason]),
      [['MISS', 'cold'], ['INVALIDATED', 'force'], ['MISS', 'cold']]);
  });
});

describe('cache tracing — privacy', () => {
  test('no uid, namespace, key id, filter value or result ever reaches the output', async () => {
    const { svc, bus, lines, advance, tracer } = rig();
    svc.setIdentity(IDENT); advance(5_000);
    const secretRows = [{ name: 'SECRET-PERSON-NAME', national_id: '29901011234567' }];
    await svc.query('rpc:persons:search=SECRET-SEARCH:church=11111111-2222-3333-4444-555555555555', async () => secretRows, { tables: ['persons'] });
    await svc.query('row:churches:*:99999999-aaaa-bbbb-cccc-dddddddddddd', async () => secretRows, { tables: ['churches'] });
    bus.emit('persons');
    await svc.lookup({ from: () => { throw new Error('boom SECRET-ERROR'); } } as never, 'churches');
    tracer.request('rpc owner_persons_page', { page: 0, search: true }, ['SECRET-SEARCH', 'church-id']);
    svc.suspend();
    const out = lines.join('\n') + JSON.stringify(tracer.records()) + JSON.stringify(tracer.summary());
    for (const secret of [SECRET_UID, 'SECRET-PERSON-NAME', '29901011234567', 'SECRET-SEARCH', '11111111-2222', '99999999-aaaa', 'SECRET-ERROR', 'owner|approved']) {
      assert.ok(!out.includes(secret), `leaked: ${secret}`);
    }
    assert.ok(out.length > 0);
  });

  test('redactKey keeps kind + table, replaces the rest with a short hash', () => {
    assert.match(redactKey('lookup:churches:name:true:-'), /^lookup:churches#[0-9a-z]{1,6}$/);
    assert.equal(redactKey('row:services:*:abc-123').startsWith('row:services#'), true);
    assert.ok(!redactKey('row:services:*:abc-123').includes('abc-123'));
    assert.notEqual(redactKey('row:services:*:a'), redactKey('row:services:*:b'));
    assert.equal(redactKey(undefined), '-');
  });
});

describe('cache tracing — never changes behaviour', () => {
  test('same fetch count and results with and without a tracer', async () => {
    const run = async (withTracer: boolean) => {
      const bus = new FakeBus(); const clock = { t: 1_000_000 };
      const svc = createQueryService({ bus, now: () => clock.t, trace: withTracer ? createDevTracer({ sink: () => {} }).trace : undefined, schedule: () => 0, cancel: () => {} });
      svc.setIdentity(IDENT);
      let n = 0; const out: number[] = [];
      const f = async () => ++n;
      out.push(await svc.query('k', f, { tables: ['t'] }));
      out.push(await svc.query('k', f, { tables: ['t'] }));
      bus.emit('t');
      out.push(await svc.query('k', f, { tables: ['t'] }));
      return { n, out };
    };
    assert.deepEqual(await run(true), await run(false));
  });

  test('a tracer that throws cannot break the cache', async () => {
    const cache = new QueryCache({ trace: () => { throw new Error('tracer bug'); } });
    cache.setIdentity('ns');
    assert.equal(await cache.query('k', async () => 5), 5);
    assert.equal(await cache.query('k', async () => 6), 5);
  });

  test('a throwing sink cannot break the app', () => {
    const t = createDevTracer({ sink: () => { throw new Error('console gone'); } });
    t.trace({ event: 'HIT', key: 'k' });
    t.request('x', {}, null);
    assert.equal(t.records().length, 2);
  });
});

describe('request tracing — identical-parameter detector (direct RPCs)', () => {
  test('the same params twice → NETWORK then NETWORK-REPEAT with the gap; different params → not a repeat', () => {
    const clock = { t: 1_000 };
    const lines: string[] = [];
    const t = createDevTracer({ sink: (l) => lines.push(l), now: () => clock.t });
    const fp = ['', 'all', null, null, null, null, 'all', 0, 100];
    t.request('rpc owner_persons_page', { page: 0, scopeMode: 'all' }, fp);
    clock.t += 1_210;
    t.request('rpc owner_persons_page', { page: 0, scopeMode: 'all' }, fp);
    t.request('rpc owner_persons_page', { page: 1, scopeMode: 'all' }, [...fp.slice(0, 7), 1, 100]);
    assert.deepEqual(t.records().map((r) => r.event), ['NETWORK', 'NETWORK-REPEAT', 'NETWORK']);
    assert.match(t.records()[1].reason!, /identical params to #1, 1210ms earlier/);
    assert.match(lines[1], /NETWORK-REPEAT/);
  });
});

describe('persons screen model — the three lookups', () => {
  const tables = ['churches', 'services', 'classes'] as const;
  const sb = () => {
    const reads: string[] = [];
    const client = {
      from(t: string) {
        const b = { select: () => b, order: () => b, then: (res: (v: unknown) => unknown) => { reads.push(t); return Promise.resolve({ data: [], error: null }).then(res); } };
        return b;
      },
    };
    return { client: client as never, reads };
  };

  test('first mount: 3 distinct keys → 3 requests (1 each); the 2nd mount (client navigation) → 0 requests', async () => {
    const { svc, tracer, advance } = rig();
    svc.setIdentity(IDENT); advance(5_000);
    const { client, reads } = sb();
    const mount = () => Promise.all(tables.map((t) => svc.lookup(client, t)));
    await mount();
    assert.deepEqual(reads.sort(), ['churches', 'classes', 'services']);
    await mount();
    assert.equal(reads.length, 3, 'second mount served from the cache');
    assert.deepEqual(tracer.records().map((r) => r.event), ['MISS', 'MISS', 'MISS', 'HIT', 'HIT', 'HIT']);
  });

  test('two components asking in the same tick → one request per table (DEDUPED)', async () => {
    const { svc, tracer, advance } = rig();
    svc.setIdentity(IDENT); advance(5_000);
    const { client, reads } = sb();
    await Promise.all([...tables, ...tables].map((t) => svc.lookup(client, t)));
    assert.equal(reads.length, 3);
    assert.equal(tracer.records().filter((r) => r.event === 'DEDUPED').length, 3);
  });

  test('a lookup fetched during the 4 s identity-settle window is only «fallback-ttl» fresh (60 s), then refetched once', async () => {
    const { svc, tracer, advance } = rig();
    svc.setIdentity(IDENT);                       // cold load: no advance → still settling
    const { client, reads } = sb();
    await svc.lookup(client, 'churches');
    await svc.lookup(client, 'churches');
    assert.equal(tracer.records()[1].reason, 'fallback-ttl');
    advance(61_000);                              // fallback TTL over AND the settle timer fires
    await svc.lookup(client, 'churches');
    assert.equal(reads.length, 2);
    await svc.lookup(client, 'churches');         // this one was fetched after the bus settled → verified
    assert.equal(tracer.records().at(-1)!.reason, 'verified');
  });
});
