// ---------------------------------------------------------------------
// Development-only cache / request tracing
// ---------------------------------------------------------------------
// TEMPORARY diagnostics for the «why does the Network tab show N requests»
// investigation. Framework-free (no imports from the app, no env access):
// `src/lib/cached-query.ts` decides whether to create it — only when
// NODE_ENV !== 'production' — so a production bundle never contains a
// tracer instance and the cache core pays one `if (!tracer)` per decision.
//
// PRIVACY RULES (unit-tested):
//  • never prints query RESULTS, uids, namespaces, tokens, filter values or
//    search text — the tracer is only ever handed keys and counters;
//  • keys are shown as `<kind>:<table>#<hash>` — the first two segments
//    (a code-defined name) plus a short hash of the full key, so two
//    different keys are distinguishable without revealing ids / filters;
//  • request fingerprints (to detect «identical params») are compared as
//    hashes and never printed; callers pass a SAFE `shape` for display
//    (booleans / counts / enum values — no free text, no ids).
// ---------------------------------------------------------------------

import { hashString } from './query-cache.ts';
import type { TraceInfo } from './query-cache.ts';

export type TraceSink = (line: string) => void;

export interface TraceRecord {
  seq: number;
  /** ms since the tracer was created */
  t: number;
  event: string;
  /** redacted label, e.g. `lookup:churches#k3j2h1` */
  label: string;
  reason?: string;
  count?: number;
}

/** `lookup:churches:name:true:-` → `lookup:churches#a1b2c3d` (no ids / filters / values leak) */
export function redactKey(key: string | undefined): string {
  if (!key) return '-';
  const head = key.split(':').slice(0, 2).join(':').replace(/[^\w:.-]/g, '_').slice(0, 40);
  return `${head}#${hashString(key).slice(0, 6)}`;
}

export interface DevTracer {
  /** pass as `QueryCacheEnv.trace` */
  trace: (info: TraceInfo) => void;
  /** a request that goes to the network WITHOUT the cache (direct RPC / select) */
  request: (name: string, shape: Record<string, string | number | boolean | null>, fingerprint: unknown) => void;
  records: () => readonly TraceRecord[];
  /** counts per redacted label — «who is being fetched how often» */
  summary: () => Record<string, Record<string, number>>;
  reset: () => void;
}

export function createDevTracer(opts: { sink?: TraceSink; now?: () => number; max?: number } = {}): DevTracer {
  const sink = opts.sink ?? ((line: string) => { if (typeof console !== 'undefined') console.debug(line); });
  const now = opts.now ?? (() => Date.now());
  const max = opts.max ?? 500;
  const t0 = now();
  let seq = 0;
  let log: TraceRecord[] = [];
  /** fingerprint hash → { seq, at } of the previous identical request */
  let lastReq = new Map<string, { seq: number; at: number }>();

  const push = (r: TraceRecord, line: string) => {
    log.push(r);
    if (log.length > max) log = log.slice(-max);
    try { sink(line); } catch { /* a sink must never break the app */ }
  };

  return {
    trace(info) {
      const label = redactKey(info.key);
      const rec: TraceRecord = { seq: ++seq, t: now() - t0, event: info.event, label, reason: info.reason, count: info.count };
      const tail = [info.reason, info.count !== undefined ? `x${info.count}` : ''].filter(Boolean).join(' ');
      push(rec, `[cache] #${rec.seq} +${rec.t}ms ${info.event.padEnd(11)} ${info.key ? label : (tail ? '' : '-')} ${tail}`.replace(/\s+$/, ''));
    },

    request(name, shape, fingerprint) {
      const fp = hashString(JSON.stringify(fingerprint ?? null));
      const at = now();
      const prev = lastReq.get(fp);
      lastReq.set(fp, { seq: seq + 1, at });
      const rec: TraceRecord = {
        seq: ++seq, t: at - t0, event: prev ? 'NETWORK-REPEAT' : 'NETWORK',
        label: name, reason: prev ? `identical params to #${prev.seq}, ${at - prev.at}ms earlier` : undefined,
      };
      const shapeText = Object.entries(shape).map(([k, v]) => `${k}=${v}`).join(' ');
      push(rec, `[net]   #${rec.seq} +${rec.t}ms ${rec.event.padEnd(14)} ${name} ${shapeText}${rec.reason ? `  ← ${rec.reason}` : ''}`);
    },

    records: () => log,

    summary() {
      const out: Record<string, Record<string, number>> = {};
      for (const r of log) {
        const bucket = (out[r.label] ??= {});
        bucket[r.event] = (bucket[r.event] ?? 0) + 1;
      }
      return out;
    },

    reset() { log = []; lastReq = new Map(); seq = 0; },
  };
}
