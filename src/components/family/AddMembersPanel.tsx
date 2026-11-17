'use client';

// ---------- العائلات → إضافة أفراد ----------
// Three ways to bring a person into the family:
//   مسح كود   — scan card after card (or type the code) → added instantly
//   بحث       — search existing persons by name / phone / code (same search
//               as everywhere else) → tap «إضافة»
//   فرد جديد  — create the person here (code typed / scanned / generated,
//               data, photo, optional church → service → class) and add him
//               in one transaction
// A person belongs to ONE family — someone already in another family asks
// «نقل إلى هنا؟» in every mode. The relation chosen at the top is applied
// to the next additions.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  UsersRound, QrCode, Loader2, Check, X, UserPlus, AlertCircle, CheckCircle2, ArrowLeftRight, Keyboard,
  Search, ScanLine, Wand2, Camera, Trash2, School, Phone, IdCard,
} from 'lucide-react';
import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/client';
import { PersonAvatar } from '@/components/CallFeedback';
import QrScanner from '@/components/store/QrScanner';
import PhotoCropModal from '@/components/PhotoCropModal';
import { useCodeGenerator } from '@/lib/customization-context';
import { cachedLookup } from '@/lib/queries';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { uploadPhoto } from '@/lib/upload';
import { PHONE_LOCAL_LENGTH, PHONE_PREFIX, GENDER_LABELS, type Church, type Service, type ClassRoom, type Gender } from '@/lib/types';
import {
  RELATIONS, RELATION_LABELS, relationLabel,
  addFamilyMemberByCode, addFamilyMemberById, addNewFamilyMember, searchPersonsForFamily,
  FAMILY_ADD_ERROR_LABELS, NEW_MEMBER_ERROR_LABELS,
  type Family, type FamilyMemberWithPerson, type FamilyRelation, type FamilyAddResult, type PersonSearchHit, type NewMemberInput,
} from '@/lib/families';

type Mode = 'scan' | 'search' | 'new';
interface LogEntry { id: string; kind: 'ok' | 'moved' | 'err'; name: string; code: string; detail: string }
interface MoveAsk { other: { id: string; name: string }; retry: () => void }

const MODES: { key: Mode; label: string; icon: typeof QrCode }[] = [
  { key: 'scan', label: 'مسح كود', icon: QrCode },
  { key: 'search', label: 'بحث', icon: Search },
  { key: 'new', label: 'فرد جديد', icon: UserPlus },
];

export default function AddMembersPanel({
  family, members, onAdded,
}: {
  family: Family;
  members: FamilyMemberWithPerson[];
  onAdded: (r: FamilyAddResult) => void;
}) {
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>('scan');
  const [relation, setRelation] = useState<FamilyRelation | ''>('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [moveAsk, setMoveAsk] = useState<MoveAsk | null>(null);

  const memberPersonIds = useMemo(() => new Set(members.map((m) => m.person_id)), [members]);
  const memberCodes = useMemo(() => new Set(members.map((m) => m.person.national_id)), [members]);

  const push = (e: Omit<LogEntry, 'id'>) =>
    setLog((prev) => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...e }, ...prev].slice(0, 50));

  /** Shared success path for every mode. */
  const succeed = (r: FamilyAddResult, extra?: string) => {
    const rel = relationLabel(r.relation);
    if (r.moved_from) {
      setFlash({ kind: 'ok', text: `تم نقل ${r.person.name} من «${r.moved_from.name}» إلى هذه العائلة ✔` });
      push({ kind: 'moved', name: r.person.name, code: r.person.national_id, detail: `نُقل من ${r.moved_from.name}${rel ? ` · ${rel}` : ''}` });
    } else {
      setFlash({ kind: 'ok', text: `تمت إضافة ${r.person.name} ✔${rel ? ` (${rel})` : ''}${extra ? ` — ${extra}` : ''}` });
      push({ kind: 'ok', name: r.person.name, code: r.person.national_id, detail: `${rel || 'بدون صلة محددة'}${extra ? ` · ${extra}` : ''}` });
    }
    onAdded(r);
  };
  const fail = (code: string, text: string) => {
    setFlash({ kind: 'err', text: `${code ? `${code} — ` : ''}${text}` });
    push({ kind: 'err', name: '—', code, detail: text });
  };

  // ---------- mode 1: scan / type a code ----------
  const [typed, setTyped] = useState('');
  const addByCode = async (rawCode: string, move = false) => {
    const code = rawCode.trim();
    if (!code || busy) return;
    if (!move && memberCodes.has(code)) { setFlash({ kind: 'err', text: `الكود ${code} موجود بالفعل في هذه العائلة` }); return; }
    setBusy(true); setFlash(null);
    const out = await addFamilyMemberByCode(supabase, family.id, code, relation || null, move);
    setBusy(false);
    if (!out.ok) {
      if (out.error === 'in_other_family' && out.otherFamily) { setMoveAsk({ other: out.otherFamily, retry: () => addByCode(code, true) }); return; }
      fail(code, FAMILY_ADD_ERROR_LABELS[out.error]);
      return;
    }
    succeed(out.result);
    setTyped('');
  };

  // ---------- mode 2: search existing persons ----------
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PersonSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [lookups, setLookups] = useState<{ churches: Church[]; services: Service[]; classes: ClassRoom[] }>({ churches: [], services: [], classes: [] });
  useEffect(() => {
    (async () => {
      const [churches, services, classes] = await Promise.all([
        cachedLookup<Church>(supabase, 'churches', { column: 'name' }),
        cachedLookup<Service>(supabase, 'services', { column: 'name' }),
        cachedLookup<ClassRoom>(supabase, 'classes', { column: 'name' }),
      ]);
      setLookups({ churches, services, classes });
    })();
  }, [supabase]);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setHits([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try { const r = await searchPersonsForFamily(supabase, s); if (!cancelled) setHits(r); }
      catch { if (!cancelled) setHits([]); }
      finally { if (!cancelled) setSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, supabase]);
  const placeLabel = (p: PersonSearchHit['places'][number]) => {
    const sv = lookups.services.find((x) => x.id === p.service_id)?.name ?? 'خدمة';
    const cl = lookups.classes.find((x) => x.id === p.class_id)?.name ?? 'فصل';
    return `${sv} › ${cl}`;
  };
  const addById = async (hit: PersonSearchHit, move = false) => {
    if (busy) return;
    setBusy(true); setFlash(null);
    const out = await addFamilyMemberById(supabase, family.id, hit.person.id, relation || null, move);
    setBusy(false);
    if (!out.ok) {
      if (out.error === 'in_other_family' && out.otherFamily) { setMoveAsk({ other: out.otherFamily, retry: () => addById(hit, true) }); return; }
      fail(hit.person.national_id, FAMILY_ADD_ERROR_LABELS[out.error]);
      return;
    }
    succeed(out.result);
  };

  return (
    <div id="family-add-members">
      {/* relation for the next additions */}
      <label className="mb-1 block text-xs font-bold text-slate-500">صلة القرابة للأفراد التاليين</label>
      <div id="family-add-relations" className="mb-3 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setRelation('')} aria-pressed={relation === ''}
          className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${relation === '' ? 'bg-slate-700 text-white shadow' : 'bg-slate-100 text-slate-500'}`}>
          بدون
        </button>
        {RELATIONS.map((r) => (
          <button key={r} type="button" onClick={() => setRelation(r)} aria-pressed={relation === r}
            className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${relation === r ? 'bg-teal-600 text-white shadow' : 'bg-teal-50 text-teal-700'}`}>
            {RELATION_LABELS[r]}
          </button>
        ))}
      </div>

      {/* mode switch */}
      <div id="family-add-modes" className="mb-3 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
        {MODES.map((m) => {
          const Icon = m.icon; const active = mode === m.key;
          return (
            <button key={m.key} id={`family-add-mode-${m.key}`} type="button" onClick={() => { setMode(m.key); setFlash(null); }} aria-pressed={active}
              className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-extrabold transition ${active ? 'bg-white text-teal-700 shadow' : 'text-slate-500'}`}>
              <Icon className="h-4 w-4" /> {m.label}
            </button>
          );
        })}
      </div>

      {/* ---------- SCAN ---------- */}
      {mode === 'scan' && (
        <>
          <p className="mb-3 flex items-center gap-1.5 rounded-2xl bg-teal-50 px-3 py-2 text-xs font-bold text-teal-700">
            <QrCode className="h-4 w-4 shrink-0" /> امسح كود كل فرد (QR الكارت) واحداً بعد الآخر — يُضاف إلى «{family.name}» فوراً.
          </p>
          <QrScanner idPrefix="family-add" autoStart paused={busy || !!moveAsk} hint="شغّل الكاميرا ووجّهها إلى كود الفرد" onCode={(c) => addByCode(c)} />
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addByCode(typed); }}>
            <div className="relative flex-1">
              <Keyboard className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input id="family-add-code" className="input-field pr-9 font-mono" placeholder="أو اكتب الكود يدوياً…" value={typed} onChange={(e) => setTyped(e.target.value)} dir="ltr" />
            </div>
            <button id="family-add-submit" type="submit" disabled={busy || !typed.trim()} className="btn-primary flex items-center gap-1.5 !px-4">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} إضافة
            </button>
          </form>
        </>
      )}

      {/* ---------- SEARCH ---------- */}
      {mode === 'search' && (
        <>
          <div className="relative mb-2">
            {searching ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-teal-500" /> : <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />}
            <input id="family-search-persons" className="input-field pr-9" placeholder="ابحث بالاسم أو الهاتف أو الكود…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          {q.trim().length >= 2 && !searching && hits.length === 0 && (
            <p className="card py-6 text-center text-sm font-bold text-slate-400">لا نتائج في نطاقك — جرّب «فرد جديد»</p>
          )}
          <ul id="family-search-results" className="space-y-2">
            {hits.map((h) => {
              const already = memberPersonIds.has(h.person.id);
              const elsewhere = !!h.family && h.family.id !== family.id;
              return (
                <li key={h.person.id} className="card flex items-center gap-3 !py-2.5">
                  <PersonAvatar name={h.person.name} imageUrl={h.person.image_url} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold">{h.person.name}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-[11px] font-bold text-slate-400">
                      <span className="font-mono" dir="ltr">{h.person.national_id}</span>
                      {h.person.phone && <span className="inline-flex items-center gap-0.5"><Phone className="h-3 w-3" />{h.person.phone.replace(/^\+2/, '')}</span>}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-1">
                      {h.places.slice(0, 2).map((p, i) => <span key={i} className="badge bg-indigo-50 text-indigo-600"><School className="h-3 w-3" />{placeLabel(p)}</span>)}
                      {h.places.length > 2 && <span className="badge bg-indigo-50 text-indigo-600">+{h.places.length - 2}</span>}
                      {already ? <span className="badge bg-emerald-100 text-emerald-700"><Check className="h-3 w-3" /> في هذه العائلة</span>
                        : elsewhere ? <span className="badge bg-amber-100 text-amber-700"><UsersRound className="h-3 w-3" /> {h.family!.name}</span> : null}
                    </p>
                  </div>
                  <button id={`family-search-add-${h.person.id}`} type="button" disabled={busy || already} onClick={() => addById(h)} aria-label="إضافة"
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow transition active:scale-95 disabled:opacity-40 ${elsewhere ? 'bg-amber-500 hover:bg-amber-600' : 'bg-teal-500 hover:bg-teal-600'}`}>
                    {elsewhere ? <ArrowLeftRight className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ---------- NEW ---------- */}
      {mode === 'new' && (
        <NewMemberForm
          family={family}
          relation={relation || null}
          lookups={lookups}
          busy={busy}
          setBusy={setBusy}
          onDone={(r, extra) => succeed(r, extra)}
          onError={(code, text) => fail(code, text)}
          onMoveAsk={(other, retry) => setMoveAsk({ other, retry })}
        />
      )}

      {flash && (
        <p id="family-add-flash" className={`mt-3 flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-bold ${flash.kind === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
          {flash.kind === 'ok' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
          <span>{flash.text}</span>
        </p>
      )}

      {/* move confirmation (all modes) */}
      {moveAsk && (
        <div id="family-move-ask" className="mt-3 rounded-2xl border-2 border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-extrabold text-amber-700">
            <ArrowLeftRight className="h-4 w-4" /> هذا الشخص موجود في عائلة «{moveAsk.other.name}»
          </p>
          <p className="mt-1 text-xs font-bold text-amber-600">الشخص ينتمي لعائلة واحدة فقط — هل تريد نقله إلى «{family.name}»؟</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button id="family-move-confirm" type="button" onClick={() => { const r = moveAsk.retry; setMoveAsk(null); r(); }}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 py-2 text-sm font-extrabold text-white shadow active:scale-95">
              <ArrowLeftRight className="h-4 w-4" /> نقل إلى هنا
            </button>
            <button type="button" onClick={() => setMoveAsk(null)} className="btn-secondary !py-2 text-sm">إلغاء</button>
          </div>
        </div>
      )}

      {/* current members */}
      <div className="mt-4">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-slate-500">
          <UsersRound className="h-4 w-4" /> أفراد العائلة الآن <span className="badge bg-teal-100 text-teal-700">{members.length}</span>
        </h4>
        {members.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 py-4 text-center text-xs font-bold text-slate-400">لا يوجد أفراد بعد</p>
        ) : (
          <ul className="space-y-1.5">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <PersonAvatar name={m.person.name} imageUrl={m.person.image_url} size={32} />
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{m.person.name}</span>
                {m.relation && <span className="badge bg-teal-100 text-teal-700">{relationLabel(m.relation)}</span>}
                <span className="font-mono text-[10px] font-bold text-slate-400" dir="ltr">{m.person.national_id}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* session log */}
      {log.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-xs font-extrabold text-slate-500">سجل الإضافة في هذه الجلسة</h4>
          <ul className="card !p-0 divide-y divide-slate-100 overflow-hidden">
            {log.map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${l.kind === 'ok' ? 'bg-emerald-100 text-emerald-600' : l.kind === 'moved' ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-500'}`}>
                  {l.kind === 'err' ? <X className="h-4 w-4" /> : l.kind === 'moved' ? <ArrowLeftRight className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-extrabold">{l.name}</span>
                  <span className="block truncate text-[10px] font-bold text-slate-400">{l.detail}</span>
                </span>
                <span className="font-mono text-[10px] text-slate-400" dir="ltr">{l.code}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// NewMemberForm — create the person here and add him to the family.
// Same rules as إضافة مخدوم (code · name · gender · phone +2 · birthdate ·
// address · notes · photo). The place (church → service → class) is
// OPTIONAL: parents who serve nowhere are plain persons with a code.
// =====================================================================
const composeBirthdate = (d: string, m: string, y: string): string | null =>
  d && m && y ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function NewMemberForm({
  family, relation, lookups, busy, setBusy, onDone, onError, onMoveAsk,
}: {
  family: Family;
  relation: FamilyRelation | null;
  lookups: { churches: Church[]; services: Service[]; classes: ClassRoom[] };
  busy: boolean;
  setBusy: (v: boolean) => void;
  onDone: (r: FamilyAddResult, extra?: string) => void;
  onError: (code: string, text: string) => void;
  onMoveAsk: (other: { id: string; name: string }, retry: () => void) => void;
}) {
  const supabase = createClient();
  const genCode = useCodeGenerator('person');

  // place (optional)
  const [churchId, setChurchId] = useState(lookups.churches.length === 1 ? lookups.churches[0].id : '');
  const [serviceId, setServiceId] = useState('');
  // several classes may be ticked: the first goes with the family RPC, the others enroll the same person
  const [classIds, setClassIds] = useState<string[]>([]);
  useEffect(() => { if (!churchId && lookups.churches.length === 1) setChurchId(lookups.churches[0].id); }, [lookups.churches, churchId]);
  const visibleServices = lookups.services.filter((s) => s.church_id === churchId);
  const visibleClasses = lookups.classes.filter((c) => c.service_id === serviceId);
  const pickedClasses = visibleClasses.filter((c) => classIds.includes(c.id));
  const classId = pickedClasses[0]?.id ?? '';

  // code
  const [code, setCode] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [qr, setQr] = useState('');
  useEffect(() => {
    const c = code.trim();
    if (!c) { setQr(''); return; }
    QRCode.toDataURL(c, { width: 240, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [code]);

  // data
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [bDay, setBDay] = useState(''); const [bMonth, setBMonth] = useState(''); const [bYear, setBYear] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  // photo
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawImage, setRawImage] = useState('');
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');

  const years = useMemo(() => { const y = new Date().getFullYear(); return Array.from({ length: 100 }, (_, i) => y - i); }, []);

  const reset = () => {
    setCode(''); setName(''); setGender(''); setPhoneLocal(''); setBDay(''); setBMonth(''); setBYear('');
    setAddress(''); setNotes(''); setPhotoBlob(null); if (photoPreview) URL.revokeObjectURL(photoPreview); setPhotoPreview('');
    setClassIds([]);
  };

  const submit = async (move = false) => {
    setError('');
    if (!name.trim()) { setError('اكتب الاسم'); return; }
    if (phoneLocal && phoneLocal.length !== PHONE_LOCAL_LENGTH) { setError(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقماً بعد ${PHONE_PREFIX}`); return; }
    if ((serviceId || pickedClasses.length) && !(churchId && serviceId && pickedClasses.length)) { setError('أكمل الكنيسة والخدمة والفصل — أو اترك المكان فارغاً'); return; }
    if (!classId && !code.trim()) { setError('الكود مطلوب عندما لا يُسجَّل الفرد في فصل — اكتبه أو امسحه أو ولّده'); return; }
    setBusy(true);
    try {
      let imageUrl: string | null = null;
      if (photoBlob) imageUrl = await uploadPhoto(supabase, 'persons', photoBlob, 'person.webp');
      const input: NewMemberInput = {
        name: name.trim(),
        code: code.trim() || null,
        gender: gender || null,
        birthdate: composeBirthdate(bDay, bMonth, bYear),
        phone: phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        image_url: imageUrl,
        church_id: classId ? churchId : null,
        service_id: classId ? serviceId : null,
        class_id: classId || null,
        relation,
      };
      const out = await addNewFamilyMember(supabase, family.id, input, move);
      if (!out.ok) {
        if (out.error === 'in_other_family' && out.otherFamily) { onMoveAsk(out.otherFamily, () => submit(true)); return; }
        setError(NEW_MEMBER_ERROR_LABELS[out.error]);
        onError(code.trim(), NEW_MEMBER_ERROR_LABELS[out.error]);
        return;
      }
      const r = out.result;
      // the other ticked classes: same person (by his code), one enrollment each
      const failed: string[] = [];
      let extraOk = 0;
      for (const c of pickedClasses.slice(1)) {
        const { error: xe, data: xd } = await supabase.rpc('add_person_and_enroll', {
          p_church: c.church_id, p_service: c.service_id, p_class: c.id,
          p_name: input.name, p_national_id: r.person?.national_id ?? input.code,
          p_gender: input.gender, p_birthdate: input.birthdate, p_phone: input.phone,
          p_address: input.address, p_notes: input.notes, p_image_url: input.image_url,
          p_points: 0, p_password: null,
        });
        if (xe) failed.push(c.name);
        else if (!(xd as { already_enrolled?: boolean } | null)?.already_enrolled) extraOk++;
      }
      const cls = pickedClasses.length > 1
        ? `${pickedClasses[0].name}${extraOk ? ` + ${extraOk} ${extraOk === 1 ? 'فصل' : 'فصول'}` : ''}`
        : pickedClasses[0]?.name;
      onDone(r, r.person_created ? (cls ? `شخص جديد · سُجّل في ${cls}` : 'شخص جديد') : (cls && !r.already_enrolled ? `شخص موجود · سُجّل في ${cls}` : 'شخص موجود'));
      if (failed.length) setError(`تعذر التسجيل في: ${failed.join('، ')}`);
      reset();
    } catch {
      setError('حدث خطأ أثناء رفع الصورة أو الحفظ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="family-new-member" className="space-y-3">
      <p className="flex items-center gap-1.5 rounded-2xl bg-teal-50 px-3 py-2 text-xs font-bold text-teal-700">
        <UserPlus className="h-4 w-4 shrink-0" /> إنشاء شخص جديد وإضافته إلى «{family.name}» — تسجيله في فصل اختياري (أب أو أم بلا خدمة = شخص بكود فقط)
      </p>

      {/* code + photo squares */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR" className="h-full w-full rounded-xl object-contain" />
          ) : (
            <><QrCode className="h-10 w-10 text-primary-400" /><span className="text-center text-xs font-extrabold text-slate-500">كود الفرد (QR)</span></>
          )}
        </div>
        <button type="button" onClick={() => fileRef.current?.click()} className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 overflow-hidden transition active:scale-95">
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoPreview} alt="صورة" className="h-full w-full rounded-xl object-cover" />
          ) : (
            <><Camera className="h-10 w-10 text-primary-500" /><span className="text-xs font-extrabold text-slate-500">الصورة</span></>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setRawImage(URL.createObjectURL(f)); }} />
      </div>
      {photoPreview && (
        <button type="button" onClick={() => { setPhotoBlob(null); URL.revokeObjectURL(photoPreview); setPhotoPreview(''); }} className="flex items-center gap-1 text-xs font-bold text-red-500">
          <Trash2 className="h-3.5 w-3.5" /> إزالة الصورة
        </button>
      )}

      {/* code: type · generate · scan */}
      <div>
        <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500"><IdCard className="h-3.5 w-3.5 text-primary-500" /> الكود (QR) {!classId && '*'}</label>
        <div className="flex gap-2">
          <input id="family-new-code" className="input-field flex-1 font-mono" dir="ltr" placeholder="اكتب الكود أو امسحه أو ولّده" value={code} onChange={(e) => setCode(e.target.value)} />
          <button type="button" onClick={() => setCode(genCode({ churchId: churchId || undefined, serviceId: serviceId || undefined, classId: classId || undefined }))} aria-label="توليد كود"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow transition hover:bg-primary-700 active:scale-95"><Wand2 className="h-5 w-5" /></button>
          <button type="button" onClick={() => setScanOpen(true)} aria-label="مسح الكود"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow transition hover:bg-orange-600 active:scale-95"><ScanLine className="h-5 w-5" /></button>
        </div>
        {classId && <p className="mt-1 text-[11px] font-bold text-slate-400">اتركه فارغاً ليُولَّد تلقائياً عند التسجيل في الفصل</p>}
      </div>

      {/* data */}
      <div className="card space-y-3">
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">الاسم *</label>
          <input id="family-new-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم بالكامل" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">النوع</label>
          <div className="grid grid-cols-2 gap-2">
            {(['male', 'female'] as Gender[]).map((g) => (
              <button key={g} type="button" onClick={() => setGender(gender === g ? '' : g)} aria-pressed={gender === g}
                className={`rounded-xl py-2 text-sm font-extrabold transition ${gender === g ? (g === 'male' ? 'bg-sky-500 text-white shadow' : 'bg-pink-500 text-white shadow') : 'bg-slate-100 text-slate-500'}`}>
                {GENDER_LABELS[g]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">الهاتف</label>
          <div className="flex items-center gap-2" dir="ltr">
            <span className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-extrabold text-slate-500">{PHONE_PREFIX}</span>
            <input id="family-new-phone" className="input-field flex-1" inputMode="numeric" placeholder="01xxxxxxxxx" value={phoneLocal}
              onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
          <div className="grid grid-cols-3 gap-2">
            <select className="input-field appearance-none text-sm" value={bDay} onChange={(e) => setBDay(e.target.value)}>
              <option value="">اليوم</option>{Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="input-field appearance-none text-sm" value={bMonth} onChange={(e) => setBMonth(e.target.value)}>
              <option value="">الشهر</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select className="input-field appearance-none text-sm" value={bYear} onChange={(e) => setBYear(e.target.value)}>
              <option value="">السنة</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">العنوان</label>
          <input className="input-field" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">ملاحظات</label>
          <textarea className="input-field min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {/* optional place */}
      <div className="card space-y-2">
        <p className="flex items-center gap-1 text-xs font-extrabold text-slate-600"><School className="h-4 w-4 text-primary-500" /> تسجيله في فصل أو أكثر (اختياري)</p>
        <select id="family-new-church" className="input-field appearance-none text-sm" value={churchId} onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassIds([]); }}>
          <option value="">الكنيسة</option>{lookups.churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select id="family-new-service" className="input-field appearance-none text-sm" value={serviceId} disabled={!churchId} onChange={(e) => { setServiceId(e.target.value); setClassIds([]); }}>
          <option value="">الخدمة</option>{visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <MultiClassSelect id="family-new-class" value={classIds} onChange={setClassIds} options={visibleClasses}
          showAll={false} allLabel="الفصول — بدون تسجيل" disabled={!serviceId} />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
      <button id="family-new-submit" type="button" onClick={() => submit()} disabled={busy} className="btn-primary flex w-full items-center justify-center gap-2">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
        إنشاء وإضافة إلى العائلة{relation ? ` (${RELATION_LABELS[relation]})` : ''}
      </button>

      {scanOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={() => setScanOpen(false)}>
          <div className="w-full max-w-xs rounded-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-base font-extrabold"><ScanLine className="h-5 w-5 text-orange-500" /> مسح كود الفرد</h3>
              <button type="button" onClick={() => setScanOpen(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <QrScanner idPrefix="family-new-scan" autoStart hint="وجّه الكاميرا إلى الكود المطبوع" onCode={(v) => { setCode(v.trim()); setScanOpen(false); }} />
          </div>
        </div>
      )}
      {rawImage && (
        <PhotoCropModal src={rawImage}
          onDone={(blob) => { if (photoPreview) URL.revokeObjectURL(photoPreview); setPhotoBlob(blob); setPhotoPreview(URL.createObjectURL(blob)); URL.revokeObjectURL(rawImage); setRawImage(''); }}
          onClose={() => { URL.revokeObjectURL(rawImage); setRawImage(''); }} />
      )}
    </div>
  );
}
