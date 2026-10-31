// ---------- Login throttle · login rush handling (20261019120000) ----------
// The three login RPCs (account_login · child_login · priest_login) no longer
// RAISE on a wrong password — they RETURN a payload so the attempt counter
// survives the statement:
//   { error: 'wrong_password', remaining }            → tries left before a lock
//   { error: 'too_many_attempts', retry_after }       → locked for N seconds
// `throwIfThrottled` turns such a payload back into the Error the pages
// already know how to display (message contains the key — the error maps in
// accounts.ts / child-portal.ts / priest-portal.ts match on `includes`).
//
// LOGIN RUSH: when 60–80 people open the app in the same minute the gateway
// answers some of them with 429 / 5xx or the socket drops. `withLoginRetry`
// retries those (and only those) with a jittered back-off, so the user sees
// «جارٍ المحاولة…» instead of a failure. A wrong password / a lock / an
// unknown code is NEVER retried — that would double-count the attempt.

export class LoginThrottledError extends Error {
  retryAfter: number;
  constructor(retryAfter: number) {
    super(`too_many_attempts:${Math.max(1, Math.round(retryAfter))}`);
    this.name = 'LoginThrottledError';
    this.retryAfter = Math.max(1, Math.round(retryAfter));
  }
}

export class WrongPasswordError extends Error {
  remaining: number | null;
  constructor(remaining: number | null) {
    super('wrong_password');
    this.name = 'WrongPasswordError';
    this.remaining = remaining;
  }
}

/** payload → Error (wrong_password / too_many_attempts); otherwise returns the data untouched */
export function throwIfThrottled<T>(data: T): T {
  const d = data as { error?: unknown; retry_after?: unknown; remaining?: unknown } | null;
  if (d && typeof d === 'object' && !Array.isArray(d) && typeof d.error === 'string') {
    if (d.error === 'too_many_attempts') throw new LoginThrottledError(Number(d.retry_after) || 60);
    if (d.error === 'wrong_password') throw new WrongPasswordError(typeof d.remaining === 'number' ? d.remaining : null);
    throw new Error(d.error);
  }
  return data;
}

/** seconds the user must wait when `err` is a lock (0 when it is not) */
export function retryAfterOf(err: unknown): number {
  if (err instanceof LoginThrottledError) return err.retryAfter;
  const msg = (err as { message?: string } | null)?.message ?? '';
  const m = /too_many_attempts:(\d+)/.exec(msg);
  return m ? Number(m[1]) : msg.includes('too_many_attempts') ? 60 : 0;
}

/** «محاولات كثيرة خاطئة — حاول بعد ٣ دقائق» */
export function lockMessage(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 90) return `محاولات كثيرة خاطئة — حاول مجدداً بعد ${s} ثانية`;
  const m = Math.ceil(s / 60);
  if (m < 90) return `محاولات كثيرة خاطئة — حاول مجدداً بعد ${m} دقيقة`;
  return `محاولات كثيرة خاطئة — حاول مجدداً بعد ${Math.ceil(m / 60)} ساعة`;
}

export function remainingMessage(remaining: number | null): string {
  if (remaining == null || remaining > 2) return 'بيانات الدخول غير صحيحة، تأكد من الكود وكلمة المرور';
  if (remaining <= 0) return 'بيانات الدخول غير صحيحة — المحاولة التالية الخاطئة تقفل الدخول مؤقتاً';
  return `بيانات الدخول غير صحيحة — متبقٍ ${remaining === 1 ? 'محاولة واحدة' : 'محاولتان'} قبل القفل المؤقت`;
}

/** the message for any login error: lock → countdown text · wrong password → remaining · else null */
export function throttleMessage(err: unknown): string | null {
  const wait = retryAfterOf(err);
  if (wait > 0) return lockMessage(wait);
  if (err instanceof WrongPasswordError) return remainingMessage(err.remaining);
  return null;
}

// ---------- the rush: retry only transient failures ----------
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
const FINAL_KEYS = /too_many_attempts|wrong_password|unknown_code|no_account|pending_approval|password_unknown|account_stopped|account_rejected|not_priest|invalid_code|session_expired|scope_not_allowed|no_such_account/;

export function isTransientLoginError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof LoginThrottledError || err instanceof WrongPasswordError) return false;
  const e = err as { status?: unknown; code?: unknown; message?: unknown; name?: unknown };
  const msg = String(e.message ?? '').toLowerCase();
  if (FINAL_KEYS.test(msg)) return false;
  const status = typeof e.status === 'number' ? e.status : Number(e.code);
  if (Number.isFinite(status) && TRANSIENT_STATUS.has(status)) return true;
  // fetch() network failures / aborted sockets / gateway pages
  if (e.name === 'TypeError' && /fetch|network/.test(msg)) return true;
  if (/failed to fetch|networkerror|network request failed|load failed|timeout|timed out|econnreset|socket hang up|rate limit|too many requests|upstream|cloudflare|bad gateway|service unavailable|gateway time-?out|connection terminated|remaining connection slots|too many connections|no more connections|pool/.test(msg)) return true;
  // PostgREST / Postgres: pool exhausted · statement timeout · cannot connect · serialization
  const code = typeof e.code === 'string' ? e.code : '';
  if (/^(53\d{3}|57014|57P0[1-3]|08\d{3}|40001|40P01|PGRST00[0-3])$/.test(code)) return true;
  return false;
}

export interface LoginRetryOptions {
  /** how many extra tries after the first (default 4) */
  retries?: number;
  /** base wait in ms — doubled every try with ±40 % jitter (default 700) */
  baseMs?: number;
  /** longest single wait (default 8 s) */
  maxMs?: number;
  /** called before each wait: attempt number (1-based), ms to wait */
  onRetry?: (attempt: number, waitMs: number, err: unknown) => void;
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
  });

/** run `fn`; on a TRANSIENT failure wait and run it again (jittered exponential back-off) */
export async function withLoginRetry<T>(fn: () => Promise<T>, opts: LoginRetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const base = opts.baseMs ?? 700;
  const max = opts.maxMs ?? 8000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isTransientLoginError(err)) throw err;
      attempt += 1;
      const jitter = 0.6 + Math.random() * 0.8;
      const wait = Math.min(max, Math.round(base * 2 ** (attempt - 1) * jitter));
      opts.onRetry?.(attempt, wait, err);
      await sleep(wait, opts.signal);
    }
  }
}

// ---------- same-device guard ----------
// A finger that taps «تسجيل الدخول» five times in a second fires five RPCs —
// each one a bcrypt on the server. One in flight per tab is enough.
let inflight: Promise<unknown> | null = null;
export function singleFlight<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight) return inflight as Promise<T>;
  const p = fn().finally(() => { if (inflight === p) inflight = null; });
  inflight = p;
  return p;
}

/** countdown helper: seconds left until an absolute unlock time (ms epoch) */
export function secondsUntil(ts: number): number {
  return Math.max(0, Math.ceil((ts - Date.now()) / 1000));
}
