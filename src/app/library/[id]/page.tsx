'use client';

// ---------- SUBJECT PAGE (موضوع) ----------
// Subject cover + name + description, then two tabs:
//   📚 الكتب      — book cards (cover · title · author · read · ⭐)
//   🎓 المحاضرات  — lecture cards (thumbnail · title · speaker · 🎥/🎙️ · play · ⭐)
// A local search filters the open tab. Managers add / edit / delete here.

import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Search, Loader2, BookOpen, Video, X, Pencil, GraduationCap, Mic } from 'lucide-react';
import AppShell from '@/components/AppShell';
import {
  LibraryHeader, Cover, BookCard, LectureCard, MediaPlayerModal, Toast, Empty, AudienceBadge,
} from '@/components/library/LibraryBits';
import { SubjectFormModal, BookFormModal, LectureFormModal } from '@/components/library/LibraryForms';
import { useLibrary } from '@/lib/library-context';
import { createClient } from '@/lib/supabase/client';
import {
  deleteBook, deleteLecture, libraryErrorMessage, matches, audienceLabel,
  type LibraryBook, type LibraryLecture, type LectureKind,
} from '@/lib/library';
import { collapseGroups, type Grouped } from '@/lib/class-groups';

type Tab = 'books' | 'lectures';
type KindFilter = 'all' | LectureKind;

export default function SubjectPage() {
  const { id } = useParams<{ id: string }>();
  const lib = useLibrary();
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<Tab>('books');
  const [q, setQ] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [subjectForm, setSubjectForm] = useState(false);
  const [bookForm, setBookForm] = useState<{ open: boolean; item: Grouped<LibraryBook> | null }>({ open: false, item: null });
  const [lectureForm, setLectureForm] = useState<{ open: boolean; item: Grouped<LibraryLecture> | null }>({ open: false, item: null });
  const [playing, setPlaying] = useState<LibraryLecture | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const subject = lib.subjects.find((s) => s.id === id) ?? null;
  // rows sharing a group_id are ONE book / lecture covering several classes
  const booksAll = useMemo(() => collapseGroups(lib.books), [lib.books]);
  const lecturesAll = useMemo(() => collapseGroups(lib.lectures), [lib.lectures]);
  const books = useMemo(() => booksAll.filter((b) => b.subject_id === id && matches(q, b.title, b.author, b.description)), [booksAll, id, q]);
  const lectures = useMemo(
    () => lecturesAll.filter((l) => l.subject_id === id && (kindFilter === 'all' || l.kind === kindFilter) && matches(q, l.title, l.speaker, l.description)),
    [lecturesAll, id, q, kindFilter]
  );
  const totalBooks = booksAll.filter((b) => b.subject_id === id).length;
  const totalLectures = lecturesAll.filter((l) => l.subject_id === id).length;
  const manage = lib.perms.manage;

  const removeBook = async (b: Grouped<LibraryBook>) => {
    if (!confirm(`حذف الكتاب «${b.title}»؟`)) return;
    setBusy(b.id);
    try { await Promise.all(b.group_rows.map((r) => deleteBook(supabase, r.id))); b.group_rows.forEach((r) => lib.removeBook(r.id)); lib.flash('تم حذف الكتاب'); }
    catch (e) { lib.flash(libraryErrorMessage(e, 'تعذر الحذف')); }
    finally { setBusy(null); }
  };
  const removeLecture = async (l: Grouped<LibraryLecture>) => {
    if (!confirm(`حذف المحاضرة «${l.title}»؟`)) return;
    setBusy(l.id);
    try { await Promise.all(l.group_rows.map((r) => deleteLecture(supabase, r.id))); l.group_rows.forEach((r) => lib.removeLecture(r.id)); lib.flash('تم حذف المحاضرة'); }
    catch (e) { lib.flash(libraryErrorMessage(e, 'تعذر الحذف')); }
    finally { setBusy(null); }
  };

  if (lib.loading) {
    return (
      <AppShell>
        <LibraryHeader back="/library" />
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-lime-600" /></div>
      </AppShell>
    );
  }
  if (!subject) {
    return (
      <AppShell>
        <LibraryHeader back="/library" />
        <Empty icon={<BookOpen className="h-7 w-7" />} text="هذا الموضوع غير موجود أو غير متاح لك" />
      </AppShell>
    );
  }

  const addBtn = tab === 'books' ? (
    <button id="lib-add-book" type="button" onClick={() => setBookForm({ open: true, item: null })}
      className="btn-primary inline-flex items-center gap-1.5 !py-2 !px-3 text-sm !from-lime-700 !to-lime-600">
      <Plus className="h-4 w-4" /> كتاب
    </button>
  ) : (
    <button id="lib-add-lecture" type="button" onClick={() => setLectureForm({ open: true, item: null })}
      className="btn-primary inline-flex items-center gap-1.5 !py-2 !px-3 text-sm !from-rose-600 !to-rose-500">
      <Plus className="h-4 w-4" /> محاضرة
    </button>
  );

  const tabBtn = (value: Tab, label: string, icon: ReactNode, count: number, active: string) => (
    <button id={`lib-tab-${value}`} type="button" onClick={() => setTab(value)} aria-pressed={tab === value}
      className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${tab === value ? `${active} text-white shadow ring-2` : 'bg-white text-slate-600 border border-slate-200'}`}>
      {icon} {label} <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${tab === value ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
    </button>
  );

  const KIND_FILTERS: [KindFilter, string, ReactNode][] = [
    ['all', 'الكل', null],
    ['video', 'فيديو', <Video key="v" className="h-3.5 w-3.5" />],
    ['voice', 'صوت', <Mic key="m" className="h-3.5 w-3.5" />],
  ];

  return (
    <AppShell>
      <LibraryHeader back="/library" title={subject.name} right={manage && addBtn} />

      {/* subject banner */}
      <section id="lib-subject-banner" className="card relative mb-3 !p-0 overflow-hidden">
        <Cover url={subject.image_url} alt={subject.name} className="h-36 w-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4 text-white">
          <h1 className="text-xl font-extrabold drop-shadow">{subject.name}</h1>
          {subject.description && <p className="mt-0.5 line-clamp-2 text-xs font-bold text-white/85">{subject.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="badge bg-white/90 text-lime-800"><BookOpen className="h-3 w-3" /> {totalBooks} كتاب</span>
            <span className="badge bg-white/90 text-rose-700"><Video className="h-3 w-3" /> {totalLectures} محاضرة</span>
            {manage && subject.audience !== 'everyone' && <AudienceBadge audience={subject.audience} label={audienceLabel(subject, lib.lookups)} />}
          </div>
        </div>
        {manage && (
          <button type="button" aria-label="تعديل الموضوع" onClick={() => setSubjectForm(true)} className="absolute top-2 left-2 rounded-full bg-white/90 p-2 text-primary-600 shadow hover:bg-white">
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </section>

      {/* tabs */}
      <nav id="lib-subject-tabs" className="mb-3 grid grid-cols-2 gap-2">
        {tabBtn('books', 'الكتب', <BookOpen className="h-4 w-4" />, totalBooks, 'bg-lime-700 ring-lime-300')}
        {tabBtn('lectures', 'المحاضرات', <GraduationCap className="h-4 w-4" />, totalLectures, 'bg-rose-600 ring-rose-300')}
      </nav>

      {/* search + kind filter */}
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input id="lib-subject-search" className="input-field pr-9 pl-9" placeholder={tab === 'books' ? 'ابحث بالعنوان أو المؤلف…' : 'ابحث بالعنوان أو المتحدث…'} value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button type="button" aria-label="مسح" onClick={() => setQ('')} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>}
        </div>
        {tab === 'lectures' && (
          <div id="lib-kind-filter" className="flex gap-1">
            {KIND_FILTERS.map(([v, label, icon]) => (
              <button key={v} type="button" onClick={() => setKindFilter(v)} aria-pressed={kindFilter === v}
                className={`flex items-center gap-1 rounded-xl px-2.5 text-xs font-extrabold ${kindFilter === v ? 'bg-rose-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                {icon}{label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* content */}
      {tab === 'books' && (
        books.length === 0 ? (
          <Empty icon={<BookOpen className="h-7 w-7" />} text={totalBooks === 0 ? (manage ? 'لا كتب بعد — أضف أول كتاب (رابط PDF)' : 'لا كتب في هذا الموضوع بعد') : 'لا نتائج'}
            action={manage && totalBooks === 0 && addBtn} />
        ) : (
          <div id="lib-books" className="space-y-2">
            {books.map((b) => (
              <BookCard key={b.id} domId={`lib-book-${b.id}`} {...b} fav={lib.isFav('book', b.id)} onFav={() => lib.toggleFav('book', b.id)}
                badge={manage && b.audience !== 'everyone' ? <AudienceBadge audience={b.audience} label={audienceLabel(b, lib.lookups)} /> : undefined}
                onEdit={manage ? () => setBookForm({ open: true, item: b }) : undefined}
                onDelete={manage && busy !== b.id ? () => removeBook(b) : undefined} />
            ))}
          </div>
        )
      )}
      {tab === 'lectures' && (
        lectures.length === 0 ? (
          <Empty icon={<GraduationCap className="h-7 w-7" />} text={totalLectures === 0 ? (manage ? 'لا محاضرات بعد — أضف أول محاضرة (فيديو أو صوت)' : 'لا محاضرات في هذا الموضوع بعد') : 'لا نتائج'}
            action={manage && totalLectures === 0 && addBtn} />
        ) : (
          <div id="lib-lectures" className="grid gap-3 sm:grid-cols-2">
            {lectures.map((l) => (
              <LectureCard key={l.id} domId={`lib-lecture-${l.id}`} {...l} fav={lib.isFav('lecture', l.id)} onFav={() => lib.toggleFav('lecture', l.id)} onPlay={() => setPlaying(l)}
                badge={manage && l.audience !== 'everyone' ? <AudienceBadge audience={l.audience} label={audienceLabel(l, lib.lookups)} /> : undefined}
                onEdit={manage ? () => setLectureForm({ open: true, item: l }) : undefined}
                onDelete={manage && busy !== l.id ? () => removeLecture(l) : undefined} />
            ))}
          </div>
        )
      )}

      {subjectForm && (
        <SubjectFormModal item={subject} lookups={lib.lookups} onClose={() => setSubjectForm(false)}
          onSaved={(s) => { lib.upsertSubject(s); setSubjectForm(false); lib.flash('تم حفظ التعديلات'); }} />
      )}
      {bookForm.open && (
        <BookFormModal item={bookForm.item} subjectId={subject.id} subjects={lib.subjects} lookups={lib.lookups} onClose={() => setBookForm({ open: false, item: null })}
          onSaved={() => { lib.reload(); setBookForm({ open: false, item: null }); lib.flash(bookForm.item ? 'تم حفظ التعديلات' : 'تمت إضافة الكتاب'); }} />
      )}
      {lectureForm.open && (
        <LectureFormModal item={lectureForm.item} subjectId={subject.id} subjects={lib.subjects} lookups={lib.lookups} onClose={() => setLectureForm({ open: false, item: null })}
          onSaved={() => { lib.reload(); setLectureForm({ open: false, item: null }); lib.flash(lectureForm.item ? 'تم حفظ التعديلات' : 'تمت إضافة المحاضرة'); }} />
      )}
      {playing && <MediaPlayerModal title={playing.title} speaker={playing.speaker} kind={playing.kind} url={playing.media_url} onClose={() => setPlaying(null)} />}
      <Toast msg={lib.toast} />
    </AppShell>
  );
}
