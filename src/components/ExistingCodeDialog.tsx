'use client';

// ---------- «هذا الكود مسجّل بالفعل — هل أنت نفس الشخص؟» ----------
// migration 20261005120000 (UX). Shown by the three signup wizards (servant ·
// child · priest) when the typed / scanned code already belongs to a PERSON
// who has an account. Three ways out:
//   • نعم، أنا هو  → type the EXISTING password → person_verify_password →
//                    the wizard continues as «add an enrollment to the same
//                    person» (same password; the request is still approved
//                    by the responsible manager / owner)
//   • تغيير الكود  → back to the code field (clear it / generate another)
//   • تسجيل الدخول → /login?code=… (he already has what he is trying to make)
// `canClaim = false` (e.g. a servant signup for a code that already owns a
// servant account — one per person) hides the password path.

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, KeyRound, LogIn, IdCard, UserCheck, X, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { verifyPersonPassword, kindsLabel, type AccountKind } from '@/lib/accounts';

export default function ExistingCodeDialog({
  code, name, kinds, canClaim = true, cannotClaimReason, approverLabel = 'المسؤول',
  onVerified, onChangeCode, onClose,
}: {
  code: string;
  name: string | null | undefined;
  /** the accounts the code already owns */
  kinds: AccountKind[];
  canClaim?: boolean;
  cannotClaimReason?: string;
  /** who approves the resulting request — «خادم الفصل» · «المسؤول» · «المالك» */
  approverLabel?: string;
  onVerified: (password: string) => void;
  onChangeCode: () => void;
  onClose: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!password) return setError('اكتب كلمة المرور');
    setBusy(true);
    try {
      const ok = await verifyPersonPassword(supabase, code, password);
      if (!ok) { setError('كلمة المرور غير صحيحة — إن لم تكن أنت، غيّر الكود'); setBusy(false); return; }
      onVerified(password);
    } catch {
      setError('تعذر التحقق، حاول مجددًا');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div id="existing-code-dialog" className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold"><IdCard className="h-5 w-5 text-gold-600" /> الكود مسجّل بالفعل</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="rounded-2xl bg-gold-50 px-3 py-2.5 text-sm">
          <p className="flex items-center gap-1.5 font-extrabold text-gold-800">
            <UserCheck className="h-4 w-4" /> {name ?? 'شخص'} <span className="font-bold text-gold-600" dir="ltr">({code})</span>
          </p>
          <p className="mt-1 text-xs font-bold text-gold-700">
            {kinds.length ? `لديه حساب ${kindsLabel(kinds)}.` : 'مسجّل في النظام.'} هل أنت نفس الشخص؟
          </p>
        </div>

        {canClaim ? (
          <form onSubmit={verify} className="mt-3 space-y-2">
            <p className="text-xs text-slate-500">
              نعم، أنا هو — اكتب <b>كلمة مرورك الحالية</b> لإضافة هذا التسجيل إلى نفس حسابك. يبقى للشخص كود واحد وكلمة مرور واحدة، ويعتمد الطلب {approverLabel}.
            </p>
            <div className="flex gap-2">
              <input id="ecd-password" type={show ? 'text' : 'password'} className="input-field flex-1" dir="ltr" placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
              <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'إخفاء' : 'إظهار'} className="rounded-xl bg-slate-50 px-3 ring-1 ring-slate-200">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && <p className="flex items-start gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}</p>}
            <button id="ecd-verify" type="submit" disabled={busy} className="btn-primary flex w-full items-center justify-center gap-2 !bg-gradient-to-br !from-gold-500 !to-gold-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} نعم أنا هو — تأكيد كلمة المرور
            </button>
          </form>
        ) : (
          <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {cannotClaimReason ?? 'لا يمكن إنشاء حساب آخر من هذا النوع لنفس الكود — سجّل الدخول بحسابك.'}
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button id="ecd-change" type="button" onClick={onChangeCode} className="btn-secondary flex items-center justify-center gap-1.5 text-sm">
            <IdCard className="h-4 w-4" /> لا — تغيير الكود
          </button>
          <Link id="ecd-login" href={`/login?code=${encodeURIComponent(code)}`} className="btn-secondary flex items-center justify-center gap-1.5 text-sm">
            <LogIn className="h-4 w-4" /> تسجيل الدخول
          </Link>
        </div>
      </div>
    </div>
  );
}
