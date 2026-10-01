'use client';

// ---------- بوابة الدعوة — 20261004120000 ----------
// صفحات التسجيل (خادم · مخدوم · كاهن) لا تُفتح إلا بـ ?invite=<token> صالح.
// يتحقق من الدعوة عبر signup_invite_check ويعرض رسالة عربية عند غيابها/انتهائها.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Ticket, LogIn } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type AccountKind, type InviteCheck, checkSignupInvite } from '@/lib/accounts';

const KIND_LABEL: Record<AccountKind, string> = { servant: 'خادم', child: 'مخدوم', priest: 'كاهن' };
const WHO: Record<AccountKind, string> = {
  servant: 'مسؤول الخدمة',
  child: 'خادم الفصل',
  priest: 'مالك التطبيق',
};

export function useSignupInvite(supabase: SupabaseClient, token: string | null, kind: AccountKind) {
  const [invite, setInvite] = useState<InviteCheck | null>(null);
  useEffect(() => {
    let alive = true;
    setInvite(null);
    checkSignupInvite(supabase, token, kind).then((r) => { if (alive) setInvite(r); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, kind]);
  return invite; // null = جارٍ التحقق
}

/** يُغلّف صفحة التسجيل: يعرض محمّلاً أثناء التحقق، أو رسالة الرفض، أو المحتوى عند صلاحية الدعوة */
export default function InviteGate({ invite, kind, token, children }: { invite: InviteCheck | null; kind: AccountKind; token: string | null; children: React.ReactNode }) {
  if (invite === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }
  if (!invite.valid) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
        <section id="invite-blocked" className="card w-full max-w-md text-center space-y-4">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-50 text-amber-600">
            <Ticket className="h-8 w-8" />
          </span>
          <h1 className="text-xl font-extrabold">التسجيل بالدعوة فقط</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            {token
              ? `رابط دعوة ${KIND_LABEL[kind]} هذا غير صالح أو انتهت صلاحيته أو استُنفد عدد استخداماته.`
              : `لا يمكن فتح صفحة تسجيل ${KIND_LABEL[kind]} مباشرة.`}
            <br />
            اطلب رابط دعوة جديدًا (أو امسح QR الدعوة) من {WHO[kind]}.
          </p>
          <Link href="/login" className="btn-primary inline-flex items-center justify-center gap-2">
            <LogIn className="h-4 w-4" /> لديّ حساب — تسجيل الدخول
          </Link>
        </section>
      </main>
    );
  }
  return <>{children}</>;
}
