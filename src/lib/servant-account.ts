// ---------- Client helpers for /api/servants/account (migration 0042) ----------
// Reset a servant's login password / change his code through the
// service-role API route. Errors are mapped to Arabic.

export type ServantAccountError =
  | 'unauthorized' | 'forbidden' | 'not_found' | 'not_configured' | 'weak_password'
  | 'code_required' | 'code_taken' | 'code_is_family' | 'failed' | 'network';

const MESSAGES: Record<ServantAccountError, string> = {
  unauthorized: 'انتهت الجلسة — سجّل الدخول مجددًا',
  forbidden: 'ليس لديك صلاحية على هذا الخادم',
  not_found: 'الخادم غير موجود',
  not_configured: 'الخادم غير مُهيّأ لإدارة الحسابات (SUPABASE_SERVICE_ROLE_KEY)',
  weak_password: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
  code_required: 'الكود مطلوب',
  code_taken: 'هذا الكود مستخدم بالفعل لشخص أو خادم آخر',
  code_is_family: 'هذا الكود كود عائلة — لا يمكن استخدامه لشخص',
  failed: 'تعذر تنفيذ العملية، حاول مجددًا',
  network: 'تعذر الاتصال بالخادم',
};

export const servantAccountMessage = (e: string): string =>
  MESSAGES[(e as ServantAccountError) in MESSAGES ? (e as ServantAccountError) : 'failed'];

async function call(body: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/servants/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (data.error as string) ?? 'failed' };
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export const resetServantPassword = (servantId: string, password: string) =>
  call({ action: 'reset_password', servant_id: servantId, password });

export const changeServantCode = (servantId: string, code: string) =>
  call({ action: 'change_code', servant_id: servantId, code });
