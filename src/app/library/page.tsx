'use client';

// ---------- LIBRARY HOME (المكتبة) ----------
// Search bar (subjects · books · lectures · authors · speakers) → two tabs:
// المواضيع (subject cards: cover · name · books · lectures) · المفضلة (⭐
// books + lectures). Typing a query replaces the tabs with grouped results.
// Managers add / edit / delete subjects here.

import { collapseGroups } from '@/lib/class-groups';
import { useMemo, useState, type ReactNode } from 'react';
import { Plus, Search, Loader2, Library, Star, BookOpen, Video, X, LayoutGrid } from 'lucide-react';
import AppShell from '@/components/AppShell';
import {
  LibraryHeader, SubjectCard, BookCard, LectureCard, MediaPlayerModal, Toast, Empty, AudienceBadge,
} from '@/components/library/LibraryBits';
import { SubjectFormModal } from '@/components/library/LibraryForms';
import { useLibrary } from '@/lib/library-context';
import { createClient } from '@/lib/supabase/client';
import {
  deleteSubject, searchLibrary, libraryErrorMessage, MIGRATION_HINT, audienceLabel,
  type LibrarySubject, type LibraryLecture,
} from '@/lib/library';

type Tab = 'subjects' | 'favorites';

function SectionTitle({ icon, label, count }: { icon: ReactNode; label: string; count?: number }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-500">
      {icon} {label}
      {count !== undefined && <span className="badge bg-slate-100 text-slate-500 tabular-nums">{count}</span>}
    </h3>
  );
}

export default function LibraryHomePage() {
  const lib = useLibrary();
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<Tab>('subjects');
  const [q, setQ] = useState('');
  const [form, setForm] = useState<{ open: boolean; item: LibrarySubject | null }>({ open: false, item: null });
  const [playing, setPlaying] = useState<LibraryLecture | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const counts = useMemo(() => {
    const books = new Map<string, number>(); const lectures = new Map<string, number>();
    collapseGroups(lib.books).forEach((b) => books.set(b.subject_id, (books.get(b.subject_id) ?? 0) + 1));
    collapseGroups(lib.lectures).forEach((l) => lectures.set(l.subject_id, (lectures.get(l.subject_id) ?? 0) + 1));
    return { books, lectures };
  }, [lib.books, lib.lectures]);

  const subjectName = (id: string) => lib.subjects.find((s) => s.id === id)?.name ?? '';
  const searching = q.trim().length > 0;
  const results = useMemo(() => (searching ? searchLibrary(lib, q) : null), [lib, q, searching]);

  const favBooks = useMemo(() => lib.books.filter((b) => lib.isFav('book', b.id)), [lib]);
  const favLectures = useMemo(() => lib.lectures.filter((l) => lib.isFav('lecture', l.id)), [lib]);
  const favCount = favBooks.length + favLectures.length;

  const remove = async (s: LibrarySubject) => {
    const nb = counts.books.get(s.id) ?? 0; const nl = counts.lectures.get(s.id) ?? 0;
    if (!confirm(`حذف الموضوع «${s.name}» نهائياً؟${nb + nl ? `\nسيُحذف معه ${nb} كتاب و${nl} محاضرة.` : ''}`)) return;
    setBusy(s.id);
    try { await deleteSubject(supabase, s.id); lib.removeSubject(s.id); lib.flash('تم حذف الموضوع'); }
    catch (e) { lib.flash(libraryErrorMessage(e, 'تعذر الحذف')); }
    finally { setBusy(null); }
  };

  const TABS: { value: Tab; label: string; icon: ReactNode; count: number }[] = [
    { value: 'subjects', label: 'المواضيع', icon: <LayoutGrid className="h-4 w-4" />, count: lib.subjects.length },
    { value: 'favorites', label: 'المفضلة', icon: <Star className="h-4 w-4" />, count: favCount },
  ];

  const addBtn = (cls = '!py-2 !px-3') => (
    <button id="lib-add-subject" type="button" onClick={() => setForm({ open: true, item: null })}
      className={`btn-primary inline-flex items-center gap-1.5 text-sm !from-lime-700 !to-lime-600 ${cls}`}>
      <Plus className="h-4 w-4" /> موضوع
    </button>
  );

  const subjectGrid = (list: LibrarySubject[], prefix: string, manage: boolean) => (
    <div id={prefix} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {list.map((s) => (
        <SubjectCard key={s.id} id={`${prefix}-${s.id}`} href={`/library/${s.id}`} name={s.name} description={s.description} image_url={s.image_url}
          books={counts.books.get(s.id) ?? 0} lectures={counts.lectures.get(s.id) ?? 0}
          badge={manage && s.audience !== 'everyone' ? <AudienceBadge audience={s.audience} label={audienceLabel(s, lib.lookups)} /> : undefined}
          onEdit={manage ? () => setForm({ open: true, item: s }) : undefined}
          onDelete={manage && busy !== s.id ? () => remove(s) : undefined} />
      ))}
    </div>
  );

  return (
    <AppShell>
      <LibraryHeader badge={<span className="badge bg-lime-100 text-lime-800 tabular-nums">{lib.subjects.length}</span>} right={lib.perms.manage && addBtn()} />

      {lib.migrationMissing && <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MIGRATION_HINT}</p>}

      {/* KPIs */}
      <section className="mb-3 grid grid-cols-3 gap-2">
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-lime-700">{lib.subjects.length}</p><p className="text-[10px] font-bold text-slate-400">موضوع</p></div>
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-emerald-600">{collapseGroups(lib.books).length}</p><p className="text-[10px] font-bold text-slate-400">كتاب</p></div>
        <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-rose-600">{collapseGroups(lib.lectures).length}</p><p className="text-[10px] font-bold text-slate-400">محاضرة</p></div>
      </section>

      {/* search */}
      <div className="relative mb-3">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input id="lib-search" className="input-field pr-9 pl-9" placeholder="ابحث في المواضيع والكتب والمحاضرات والمؤلفين والمتحدثين…" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button type="button" aria-label="مسح" onClick={() => setQ('')} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>}
      </div>

      {lib.loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-lime-600" /></div>
      ) : searching && results ? (
        /* ---------- search results ---------- */
        <div id="lib-search-results" className="space-y-4">
          {results.subjects.length + results.books.length + results.lectures.length === 0 && (
            <Empty icon={<Search className="h-7 w-7" />} text={`لا نتائج لـ «${q}»`} />
          )}
          {results.subjects.length > 0 && (
            <section>
              <SectionTitle icon={<Library className="h-4 w-4" />} label="المواضيع" count={results.subjects.length} />
              {subjectGrid(results.subjects, 'lib-sr-subject', false)}
            </section>
          )}
          {results.books.length > 0 && (
            <section>
              <SectionTitle icon={<BookOpen className="h-4 w-4" />} label="الكتب" count={results.books.length} />
              <div className="space-y-2">
                {results.books.map((b) => (
                  <BookCard key={b.id} domId={`lib-sr-book-${b.id}`} {...b} sub={subjectName(b.subject_id)} fav={lib.isFav('book', b.id)} onFav={() => lib.toggleFav('book', b.id)} />
                ))}
              </div>
            </section>
          )}
          {results.lectures.length > 0 && (
            <section>
              <SectionTitle icon={<Video className="h-4 w-4" />} label="المحاضرات" count={results.lectures.length} />
              <div className="grid gap-3 sm:grid-cols-2">
                {results.lectures.map((l) => (
                  <LectureCard key={l.id} domId={`lib-sr-lecture-${l.id}`} {...l} sub={subjectName(l.subject_id)} fav={lib.isFav('lecture', l.id)} onFav={() => lib.toggleFav('lecture', l.id)} onPlay={() => setPlaying(l)} />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <>
          <nav id="lib-tabs" className="mb-3 grid grid-cols-2 gap-2">
            {TABS.map((t) => (
              <button key={t.value} id={`lib-tab-${t.value}`} type="button" onClick={() => setTab(t.value)} aria-pressed={tab === t.value}
                className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${
                  tab === t.value ? 'bg-lime-700 text-white shadow ring-2 ring-lime-300' : 'bg-white text-slate-600 border border-slate-200'}`}>
                {t.icon} {t.label}
                <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${tab === t.value ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{t.count}</span>
              </button>
            ))}
          </nav>

          {tab === 'subjects' && (
            lib.subjects.length === 0
              ? <Empty icon={<Library className="h-7 w-7" />} text={lib.perms.manage ? 'لا توجد مواضيع بعد — أضف أول موضوع' : 'لا توجد مواضيع متاحة لك بعد'} action={lib.perms.manage && addBtn('!py-2 !px-4')} />
              : subjectGrid(lib.subjects, 'lib-subject', lib.perms.manage)
          )}

          {tab === 'favorites' && (
            favCount === 0 ? (
              <Empty icon={<Star className="h-7 w-7" />} text="لا مفضلة بعد — اضغط ⭐ على أي كتاب أو محاضرة" />
            ) : (
              <div id="lib-favorites" className="space-y-4">
                {favBooks.length > 0 && (
                  <section>
                    <SectionTitle icon={<BookOpen className="h-4 w-4" />} label="كتبي المفضلة" count={favBooks.length} />
                    <div className="space-y-2">
                      {favBooks.map((b) => <BookCard key={b.id} domId={`lib-fav-book-${b.id}`} {...b} sub={subjectName(b.subject_id)} fav onFav={() => lib.toggleFav('book', b.id)} />)}
                    </div>
                  </section>
                )}
                {favLectures.length > 0 && (
                  <section>
                    <SectionTitle icon={<Video className="h-4 w-4" />} label="محاضراتي المفضلة" count={favLectures.length} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      {favLectures.map((l) => <LectureCard key={l.id} domId={`lib-fav-lecture-${l.id}`} {...l} sub={subjectName(l.subject_id)} fav onFav={() => lib.toggleFav('lecture', l.id)} onPlay={() => setPlaying(l)} />)}
                    </div>
                  </section>
                )}
              </div>
            )
          )}
        </>
      )}

      {form.open && (
        <SubjectFormModal item={form.item} lookups={lib.lookups} onClose={() => setForm({ open: false, item: null })}
          onSaved={(s) => { lib.upsertSubject(s); setForm({ open: false, item: null }); lib.flash(form.item ? 'تم حفظ التعديلات' : 'تمت إضافة الموضوع'); }} />
      )}
      {playing && <MediaPlayerModal title={playing.title} speaker={playing.speaker} kind={playing.kind} url={playing.media_url} onClose={() => setPlaying(null)} />}
      <Toast msg={lib.toast} />
    </AppShell>
  );
}
