'use client';

// ---------- Child portal — الرئيسية ----------
// Name, picture, attendance and points (totals + per enrollment), plus
// quick links to the other tabs and a peek at the latest activity.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CalendarCheck, Star, ChevronLeft, School, Layers, Church, Sparkles, Database, GraduationCap, MessageCircle, Video, Trophy, Tent, Library, Cross, UsersRound, ShoppingBag,
} from 'lucide-react';
import { useChildConfession } from '@/components/child/ConfessionBits';
import { useChildFamily } from '@/components/child/FamilyBits';
import ChildShell, { useChildExams, useChildMessages, useChildOnline, useChildAchievements, useChildOccasions, useChildLibrary, useChildShops } from '@/components/child/ChildShell';
import { Avatar, Kpi, fmtDateTime, usePortalList } from '@/components/child/ChildBits';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import {
  fetchChildAttendance, fetchChildPoints, ageFromBirthdate, sumBy,
  type ChildAttendanceRow, type ChildPointsRow,
} from '@/lib/child-portal';
import { GENDER_LABELS } from '@/lib/types';
import BirthdayBanner from '@/components/child/BirthdayBanner';
import { fetchChildBirthday, type ChildBirthday } from '@/lib/child-portal';

export default function ChildHomePage() {
  return (
    <ChildShell>
      <HomeContent />
    </ChildShell>
  );
}

function HomeContent() {
  const { token, profile } = useChild();
  const supabase = useMemo(() => createClient(), []);
  const { exams, openCount, pendingCount } = useChildExams();
  const { conversations, unread } = useChildMessages();
  const { classes: onlineList, liveCount, upcomingCount } = useChildOnline();
  const { hasAny: hasAchievements, earnedCount, inProgress, data: achData } = useChildAchievements();
  const { list: occList, upcoming: occUpcoming, open: occOpen, withTicket } = useChildOccasions();
  const { hasAny: hasConfession, mine: myPriest, pending: confPending, upcoming: confUpcoming } = useChildConfession();
  const { data: famData, hasFamily, hasPriests: hasFamilyPriests, pending: famPending, upcoming: famUpcoming } = useChildFamily();
  const { hasAny: hasLibrary, subjects: libSubjects, books: libBooks, lectures: libLectures } = useChildLibrary();
  const { hasAny: hasShops, shops: shopList, shopCount, pending: shopPending } = useChildShops();

  const { rows: attendance } = usePortalList<ChildAttendanceRow>(
    token ? () => fetchChildAttendance(supabase, token) : null,
    `att-${token}-${profile?.enrollments.map((e) => e.attendance_count).join(',')}`
  );
  const { rows: points } = usePortalList<ChildPointsRow>(
    token ? () => fetchChildPoints(supabase, token) : null,
    `pts-${token}-${profile?.enrollments.map((e) => e.points).join(',')}`
  );

  // birthday banner (module 0028) — silent when the migration isn't there
  const [birthday, setBirthday] = useState<ChildBirthday | null>(null);
  useEffect(() => {
    if (!token) return;
    fetchChildBirthday(supabase, token).then(setBirthday).catch(() => setBirthday(null));
  }, [supabase, token]);

  if (!profile) return null;
  const { person, enrollments } = profile;
  const totalAttendance = sumBy(enrollments, (e) => e.attendance_count);
  const totalPoints = sumBy(enrollments, (e) => e.points);
  const age = ageFromBirthdate(person.birthdate);
  const lastAtt = attendance?.[0];
  const lastPts = points?.[0];

  return (
    <>
      {/* Identity card */}
      <section id="child-identity" className="card mb-4 overflow-hidden !p-0">
        <div className="bg-gradient-to-l from-primary-600 to-accent-600 px-4 pt-4 pb-10 text-white">
          <p className="text-xs font-bold text-indigo-100">أهلاً بك 👋</p>
          <h2 className="text-xl font-extrabold">{person.name}</h2>
        </div>
        <div className="-mt-8 flex items-end gap-3 px-4 pb-4">
          <Avatar person={person} size={80} className="ring-4 ring-white shadow-lg" />
          <div className="min-w-0 flex-1 pb-1 text-xs font-bold text-slate-500">
            <p className="truncate">
              {person.gender ? GENDER_LABELS[person.gender] : '—'}
              {age !== null && ` · ${age} سنة`}
            </p>
            <p className="truncate">
              {enrollments.length === 1
                ? `${enrollments[0].service_name} · ${enrollments[0].class_name}`
                : `${enrollments.length} تسجيلات`}
            </p>
          </div>
        </div>
      </section>

      <BirthdayBanner data={birthday} person={person} />

      {/* KPIs */}
      <section className="mb-4 grid grid-cols-2 gap-3">
        <Link href="/child/attendance">
          <Kpi
            label="مرات الحضور"
            value={totalAttendance}
            tone="bg-emerald-50 border-emerald-100"
            icon={<CalendarCheck className="h-6 w-6 text-emerald-600" />}
          />
        </Link>
        <Link href="/child/points">
          <Kpi
            label="رصيد النقاط"
            value={totalPoints}
            tone="bg-gold-50 border-gold-100"
            icon={<Star className="h-6 w-6 text-gold-600" />}
          />
        </Link>
      </section>

      {/* Enrollments */}
      <section className="mb-4">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">تسجيلاتي</h3>
        <div className="space-y-2">
          {enrollments.map((e) => (
            <div key={e.id} className="card flex items-center gap-3 !py-3">
              <span className="rounded-xl bg-primary-50 p-2 text-primary-600">
                <School className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold text-sm">{e.class_name}</p>
                <p className="truncate text-xs text-slate-500 flex items-center gap-1">
                  <Layers className="h-3 w-3" /> {e.service_name}
                  <span className="text-slate-300">·</span>
                  <Church className="h-3 w-3" /> {e.church_name}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="badge bg-emerald-100 text-emerald-700">
                  <CalendarCheck className="h-3 w-3" /> {e.attendance_count}
                </span>
                <span className="badge bg-gold-100 text-gold-700">
                  <Star className="h-3 w-3" /> {e.points}
                </span>
              </div>
            </div>
          ))}
          {enrollments.length === 0 && (
            <div className="card text-center text-sm font-bold text-slate-400">لا توجد تسجيلات بعد</div>
          )}
        </div>
      </section>

      {/* Online classes (الفصول الأونلاين) — only when the module is granted and there is something */}
      {onlineList && onlineList.length > 0 && (
        <section className="mb-4">
          <Link id="child-home-online" href={liveCount > 0 ? `/child/online/${onlineList.find((c) => c.status === 'live')!.id}` : '/child/online'}
            className={`card flex items-center gap-3 !p-3 transition hover:bg-red-50/40 ${liveCount > 0 ? 'ring-2 ring-red-300' : ''}`}>
            <span className={`rounded-xl p-2.5 text-white ${liveCount > 0 ? 'bg-red-600' : 'bg-slate-500'}`}><Video className="h-6 w-6" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold">الفصول الأونلاين</span>
              <span className="block truncate text-xs text-slate-500">
                {liveCount > 0 ? `فصل مباشر الآن — ادخل!` : upcomingCount > 0 ? `${upcomingCount} فصل قادم` : 'فصولك السابقة ونتائج حضورك'}
              </span>
            </span>
            {liveCount > 0 && <span className="flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-xs font-extrabold text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> مباشر</span>}
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
        </section>
      )}

      {/* Store shops (المتجر) — only when an ACTIVE shop is connected to one of his places */}
      {hasShops && (
        <section className="mb-4">
          <Link id="child-home-store" href={shopCount === 1 && shopList?.[0] ? `/child/store/${shopList[0].id}` : '/child/store'}
            className={`card flex items-center gap-3 !p-3 transition hover:bg-orange-50/40 ${shopPending > 0 ? 'ring-2 ring-orange-200' : ''}`}>
            <span className="rounded-xl bg-orange-500 p-2.5 text-white"><ShoppingBag className="h-6 w-6" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold">{shopCount === 1 && shopList?.[0] ? shopList[0].name : 'المتجر'}</span>
              <span className="block truncate text-xs text-slate-500">
                {shopPending > 0 ? `لديك ${shopPending} طلب بانتظار الخادم — اذهب إليه بكارتك للاستلام` : shopCount > 1 ? `${shopCount} متاجر — استبدل نقاطك بأصناف` : `استبدل نقاطك (${totalPoints}) بأصناف من المتجر`}
              </span>
            </span>
            {shopPending > 0 && <span className="rounded-full bg-orange-600 px-2.5 py-1 text-xs font-extrabold text-white tabular-nums">{shopPending}</span>}
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
        </section>
      )}

      {/* Confession (الاعتراف) — only when the child's church has an approved priest */}
      {hasConfession && (
        <section className="mb-4">
          <Link id="child-home-confession" href="/child/confession" className={`card flex items-center gap-3 !p-3 transition hover:bg-violet-50/40 ${confUpcoming > 0 ? 'ring-2 ring-violet-200' : ''}`}>
            <span className="rounded-xl bg-violet-600 p-2.5 text-white"><Cross className="h-6 w-6" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold">الاعتراف</span>
              <span className="block truncate text-xs text-slate-500">
                {confUpcoming > 0 ? 'لديك موعد اعتراف مؤكَّد' : confPending > 0 ? 'طلبك بانتظار موافقة الكاهن' : myPriest ? `أب اعترافك: ${myPriest.title ? `${myPriest.title} ` : ''}${myPriest.name}${myPriest.last_confession ? '' : ' — اطلب موعدًا'}` : 'اطلب موعد اعتراف من كاهن كنيستك'}
              </span>
            </span>
            {(confPending > 0 || confUpcoming > 0) && <span className="rounded-full bg-violet-600 px-2.5 py-1 text-xs font-extrabold text-white tabular-nums">{confUpcoming > 0 ? confUpcoming : confPending}</span>}
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
        </section>
      )}

      {/* My family (عائلتي) — when the child is in a family or his church has priests */}
      {(hasFamily || hasFamilyPriests) && (
        <section className="mb-4">
          <Link id="child-home-family" href="/child/family" className={`card flex items-center gap-3 !p-3 transition hover:bg-violet-50/40 ${famUpcoming > 0 ? 'ring-2 ring-violet-200' : ''}`}>
            <span className="rounded-xl bg-fuchsia-600 p-2.5 text-white"><UsersRound className="h-6 w-6" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold">عائلتي</span>
              <span className="block truncate text-xs text-slate-500">
                {famUpcoming > 0 ? 'زيارة الكاهن لعائلتك مرتَّبة' : famPending > 0 ? 'طلب الزيارة بانتظار موافقة الكاهن' : famData?.family ? `${famData.family.name}${famData.priests[0] ? ` — كاهن منطقتك: ${famData.priests[0].title ? `${famData.priests[0].title} ` : ''}${famData.priests[0].name}` : ''}` : 'كاهن كنيستك — اتصل به'}
              </span>
            </span>
            {(famPending > 0 || famUpcoming > 0) && <span className="rounded-full bg-violet-600 px-2.5 py-1 text-xs font-extrabold text-white tabular-nums">{famUpcoming > 0 ? famUpcoming : famPending}</span>}
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
        </section>
      )}

      {/* Occasions (الفعاليات) — only when the module is granted and there is something */}
      {occList && occList.length > 0 && (
        <section className="mb-4">
          <Link id="child-home-occasions" href="/child/occasions" className={`card flex items-center gap-3 !p-3 transition hover:bg-cyan-50/40 ${occOpen > 0 ? 'ring-2 ring-cyan-200' : ''}`}>
            <span className="rounded-xl bg-cyan-600 p-2.5 text-white"><Tent className="h-6 w-6" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold">الفعاليات</span>
              <span className="block truncate text-xs text-slate-500">
                {occOpen > 0 ? `${occOpen} فعالية مفتوحة للتسجيل — أنا مشارك!` : withTicket > 0 ? `لديك ${withTicket} تذكرة جاهزة` : occUpcoming > 0 ? `${occUpcoming} فعالية قادمة` : 'رحلات ومؤتمرات وأنشطة فصلك'}
              </span>
            </span>
            {(occOpen > 0 || withTicket > 0) && <span className="rounded-full bg-cyan-600 px-2.5 py-1 text-xs font-extrabold text-white tabular-nums">{occOpen > 0 ? occOpen : withTicket}</span>}
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
        </section>
      )}

      {/* Library (المكتبة) — only when the module is granted and there are subjects */}
      {hasLibrary && (
        <section className="mb-4">
          <Link id="child-home-library" href="/child/library" className="card flex items-center gap-3 !p-3 transition hover:bg-lime-50/40">
            <span className="rounded-xl bg-lime-700 p-2.5 text-white"><Library className="h-6 w-6" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold">المكتبة</span>
              <span className="block truncate text-xs text-slate-500">{libSubjects} موضوع · {libBooks} كتاب · {libLectures} محاضرة</span>
            </span>
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
        </section>
      )}

      {/* Achievements (الإنجازات) — only when the module is granted and there is something to show */}
      {hasAchievements && (
        <section className="mb-4">
          <Link id="child-home-achievements" href="/child/achievements" className="card flex items-center gap-3 !p-3 transition hover:bg-amber-50/40">
            <span className="rounded-xl bg-amber-500 p-2.5 text-white"><Trophy className="h-6 w-6" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold">الإنجازات</span>
              <span className="block truncate text-xs text-slate-500">
                {earnedCount > 0
                  ? `حصلت على ${earnedCount} ${earnedCount === 1 ? 'إنجاز' : earnedCount === 2 ? 'إنجازين' : earnedCount <= 10 ? 'إنجازات' : 'إنجازاً'}${inProgress > 0 ? ` · ${inProgress} في الطريق` : ''}`
                  : achData?.progress[0]
                    ? `${achData.progress[0].name}: ${Math.min(achData.progress[0].current, achData.progress[0].target)} / ${achData.progress[0].target}`
                    : 'إنجازاتك وتقدمك في الحضور'}
              </span>
            </span>
            {earnedCount > 0 && <span className="rounded-full bg-amber-500 px-2.5 py-1 text-xs font-extrabold text-white tabular-nums">{earnedCount}</span>}
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
        </section>
      )}

      {/* Messages (الرسائل) — only when the module is granted to one of his classes */}
      {conversations && conversations.length > 0 && (
        <section className="mb-4">
          <Link id="child-home-messages" href="/child/messages" className={`card flex items-center gap-3 !p-3 transition hover:bg-sky-50/40 ${unread > 0 ? 'ring-2 ring-sky-200' : ''}`}>
            <span className="rounded-xl bg-sky-600 p-2.5 text-white"><MessageCircle className="h-6 w-6" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold">الرسائل</span>
              <span className="block truncate text-xs text-slate-500">
                {unread > 0 ? `لديك ${unread} رسالة جديدة من خدامك` : 'اكتب لخدامك أو اقرأ إعلانات فصلك'}
              </span>
            </span>
            {unread > 0 && <span className="rounded-full bg-sky-600 px-2.5 py-1 text-xs font-extrabold text-white tabular-nums">{unread}</span>}
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
        </section>
      )}

      {/* Exams (الامتحانات) — only when the module is granted and something is published */}
      {exams && exams.length > 0 && (
        <section className="mb-4">
          <Link id="child-home-exams" href="/child/exams" className={`card flex items-center gap-3 !p-3 transition hover:bg-violet-50/40 ${pendingCount > 0 ? 'ring-2 ring-violet-200' : ''}`}>
            <span className="rounded-xl bg-violet-600 p-2.5 text-white"><GraduationCap className="h-6 w-6" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold">الامتحانات</span>
              <span className="block truncate text-xs text-slate-500">
                {pendingCount > 0
                  ? `لديك ${pendingCount} امتحان متاح للحل الآن`
                  : openCount > 0 ? `${openCount} امتحان متاح — أكملتها كلها` : 'نتائج امتحاناتك السابقة'}
              </span>
            </span>
            {pendingCount > 0 && <span className="rounded-full bg-violet-600 px-2.5 py-1 text-xs font-extrabold text-white">ابدأ</span>}
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
        </section>
      )}

      {/* Latest activity */}
      <section className="mb-4">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">آخر نشاط</h3>
        <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          <Link href="/child/attendance" className="flex items-center gap-3 px-4 py-3 hover:bg-indigo-50/50">
            <span className="rounded-xl bg-emerald-50 p-2 text-emerald-600"><CalendarCheck className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">آخر حضور</span>
              <span className="block truncate text-xs text-slate-400">
                {lastAtt ? `${lastAtt.event_name ?? 'مناسبة'} — ${fmtDateTime(lastAtt.created_at)}` : attendance ? 'لا يوجد حضور مسجل' : '…'}
              </span>
            </span>
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
          <Link href="/child/points" className="flex items-center gap-3 px-4 py-3 hover:bg-indigo-50/50">
            <span className="rounded-xl bg-gold-50 p-2 text-gold-600"><Sparkles className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">آخر نقاط</span>
              <span className="block truncate text-xs text-slate-400">
                {lastPts
                  ? `${lastPts.delta > 0 ? '+' : ''}${lastPts.delta} — ${lastPts.reason ?? (lastPts.source === 'attendance' ? 'حضور' : 'نقاط')} — ${fmtDateTime(lastPts.created_at)}`
                  : points ? 'لا توجد نقاط مسجلة' : '…'}
              </span>
            </span>
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
          <Link href="/child/data" className="flex items-center gap-3 px-4 py-3 hover:bg-indigo-50/50">
            <span className="rounded-xl bg-primary-50 p-2 text-primary-600"><Database className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">بياناتي وكارتي</span>
              <span className="block truncate text-xs text-slate-400">كود الـ QR، الصورة، وطلب تعديل البيانات</span>
            </span>
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
        </div>
      </section>
    </>
  );
}
