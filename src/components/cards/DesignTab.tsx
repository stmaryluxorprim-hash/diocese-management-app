'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, Upload, X, ChevronUp, ChevronDown, Loader2,
  Type, User, QrCode, Landmark, ImagePlus, TextCursorInput, Image as ImageIcon,
  ZoomIn, ZoomOut, Maximize, Lock, LockOpen, Church, Users,
  FlipHorizontal2, FlipVertical2, Copy, RotateCcw, ArrowLeftRight,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import type {
  CardDesign, CardElement, CardElementType, CardVariableField, CardConstantField, ImageFit, TextAlign,
  CardSide, CardFace, CardBack, CardQrSettings, CardQrFrame, QrFramePreset,
} from '@/lib/card-types';
import {
  newElement, VARIABLE_FIELDS, BIRTHDAY_VARIABLE_FIELDS, CONSTANT_FIELDS, ELEMENT_TYPE_LABELS,
  IMAGE_FIT_LABELS, FONT_FAMILIES, isImageElement, faceDesign, normalizeBack, sampleBack,
  DEFAULT_BACK, CARD_SIDE_LABELS, normalizeQr, QR_FRAME_PRESETS, DEFAULT_QR_SETTINGS, qrFrameCss,
  qrCornerSafePadding, qrEffectivePadding,
} from '@/lib/card-types';
import CardCanvas, { SAMPLE_PERSON, type CardConstantsData, type CardPersonData } from './CardCanvas';

const ALL_VARIABLE_FIELDS = [...VARIABLE_FIELDS, ...BIRTHDAY_VARIABLE_FIELDS];

// ---------- small labelled number input (mm / pt / deg) ----------
function Num({
  label, value, onChange, min = 0, max = 500, step = 0.5, suffix,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">
        {label}{suffix && <span className="text-slate-300"> ({suffix})</span>}
      </span>
      <input
        type="number"
        className="input-field !py-2 !px-2.5 !text-sm"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        dir="ltr"
      />
    </label>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-0.5"
        />
        <input
          className="input-field !py-2 !px-2.5 !text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          dir="ltr"
        />
      </div>
    </label>
  );
}

// ---------- element icon per type ----------
const TYPE_ICONS: Record<CardElementType, React.ReactNode> = {
  variable: <TextCursorInput className="h-4 w-4" />,
  photo: <User className="h-4 w-4" />,
  qr: <QrCode className="h-4 w-4" />,
  constant: <Landmark className="h-4 w-4" />,
  text: <Type className="h-4 w-4" />,
  logo: <Landmark className="h-4 w-4" />,
  service_logo: <Church className="h-4 w-4" />,
  class_logo: <Users className="h-4 w-4" />,
  image: <ImageIcon className="h-4 w-4" />,
};

const elementTitle = (el: CardElement): string => {
  if (el.type === 'variable') return ALL_VARIABLE_FIELDS.find((f) => f.value === el.field)?.label ?? 'بيان';
  if (el.type === 'constant') return CONSTANT_FIELDS.find((f) => f.value === el.field)?.label ?? 'ثابت';
  if (el.type === 'text') return el.text?.slice(0, 18) || 'نص ثابت';
  return ELEMENT_TYPE_LABELS[el.type];
};

// ============================================================
// DESIGN TAB
// ============================================================
export default function DesignTab({
  design, onChange, constants, variant = 'id', samplePerson,
}: {
  design: CardDesign;
  onChange: (d: CardDesign) => void;
  constants: CardConstantsData;
  /** 'birthday' adds the birthday variables (age turning, day / month …) to the add menu */
  variant?: 'id' | 'birthday';
  /** preview person (defaults to the built-in sample) */
  samplePerson?: CardPersonData;
}) {
  const supabase = createClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showCenterLines, setShowCenterLines] = useState(true);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const imgFileRef = useRef<HTMLInputElement>(null);

  // ---------- which face is being edited (الوجه / الظهر) ----------
  const [side, setSide] = useState<CardSide>('front');
  const back: CardBack = normalizeBack(design.back);
  const backEnabled = back.enabled;
  // the face under edit as a stand-alone design (same size) — all the
  // background / border / element controls below work on `face`
  const face: CardDesign = side === 'front' ? design : faceDesign(design, 'back');
  const selected = face.elements.find((e) => e.id === selectedId) ?? null;

  // preview zoom for precise placement (1x .. 6x)
  const [previewZoom, setPreviewZoom] = useState(1);
  const zoomIn = () => setPreviewZoom((z) => Math.min(6, Math.round((z + 0.5) * 2) / 2));
  const zoomOut = () => setPreviewZoom((z) => Math.max(1, Math.round((z - 0.5) * 2) / 2));

  // preview scale: both faces fit side by side into ~340px, capped height so
  // the sticky bar stays compact (one face when the back is off)
  const facesShown = backEnabled ? 2 : 1;
  const baseScale = useMemo(
    () => Math.min((340 - (facesShown - 1) * 12) / (design.width * facesShown), 190 / design.height),
    [design.width, design.height, facesShown]
  );
  const scale = baseScale * previewZoom;

  // distance from element center to card center (mm, + = right / down)
  const centerDx = (el: CardElement) => Math.round((el.x + el.w / 2 - design.width / 2) * 10) / 10;
  const centerDy = (el: CardElement) => Math.round((el.y + el.h / 2 - design.height / 2) * 10) / 10;

  // ---------- mutators ----------
  const set = (patch: Partial<CardDesign>) => onChange({ ...design, ...patch });
  // patch the FACE under edit (front = the design itself, back = design.back)
  const setFace = (patch: Partial<CardFace>) => {
    if (side === 'front') set(patch);
    else set({ back: { ...back, ...patch } });
  };
  const setBg = (patch: Partial<CardDesign['background']>) =>
    setFace({ background: { ...face.background, ...patch } });
  const setBorder = (patch: Partial<CardDesign['border']>) =>
    setFace({ border: { ...face.border, ...patch } });
  const setBack = (patch: Partial<CardBack>) => set({ back: { ...back, ...patch } });

  // switch side (selection belongs to one face)
  const switchSide = (s: CardSide) => { setSide(s); setSelectedId(null); setShowAddMenu(false); };

  // enable the back: seed it with a sample (or the front's background when it is a colour)
  const enableBack = () => {
    const seeded = back.elements.length ? { ...back, enabled: true } : {
      ...sampleBack(design.width, design.height),
      border: { ...design.border },
      background: { ...design.background, imageUrl: null },
    };
    set({ back: seeded });
    switchSide('back');
  };
  const disableBack = () => {
    setBack({ enabled: false });
    if (side === 'back') switchSide('front');
  };
  const clearBack = () => {
    if (!confirm('مسح كل عناصر الظهر؟')) return;
    setBack({ ...DEFAULT_BACK, enabled: true, border: { ...design.border } });
    setSelectedId(null);
  };
  // copy the other face's background + border + elements (new ids) into this face
  const copyFromOtherSide = () => {
    const src = side === 'front' ? faceDesign(design, 'back') : design;
    if (!confirm(`نسخ ${CARD_SIDE_LABELS[side === 'front' ? 'back' : 'front']} إلى ${CARD_SIDE_LABELS[side]}؟ سيحل محل التصميم الحالي.`)) return;
    setFace({
      background: { ...src.background },
      border: { ...src.border },
      elements: src.elements.map((e) => ({ ...e, id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` })),
    });
    setSelectedId(null);
  };

  const updateEl = (id: string, patch: Partial<CardElement>) =>
    setFace({ elements: face.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const updateElStyle = (id: string, patch: Partial<CardElement['style']>) =>
    setFace({
      elements: face.elements.map((e) =>
        e.id === id ? { ...e, style: { ...e.style, ...patch } } : e
      ),
    });
  // QR look (type 'qr'): patch the element's qr settings / its frame
  const updateQr = (el: CardElement, patch: Partial<CardQrSettings>) =>
    updateEl(el.id, { qr: { ...normalizeQr(el), ...patch } });
  const updateQrFrame = (el: CardElement, patch: Partial<CardQrFrame>) => {
    const q = normalizeQr(el);
    updateEl(el.id, { qr: { ...q, frame: { ...q.frame, ...patch } } });
  };
  const applyQrPreset = (el: CardElement, preset: QrFramePreset) => {
    const q = normalizeQr(el);
    const color = preset === 'custom' ? q.frame.color : QR_FRAME_PRESETS[preset].color;
    updateEl(el.id, {
      qr: { ...q, frame: { ...q.frame, enabled: true, preset, color, metallic: preset === 'custom' ? false : q.frame.metallic } },
    });
  };
  const removeEl = (id: string) => {
    setFace({ elements: face.elements.filter((e) => e.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };
  const moveLayer = (id: string, dir: -1 | 1) => {
    const idx = face.elements.findIndex((e) => e.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= face.elements.length) return;
    const arr = [...face.elements];
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    setFace({ elements: arr });
  };

  const addElement = (type: CardElementType, field?: CardVariableField | CardConstantField) => {
    const el = newElement(type, {
      field,
      text: type === 'text' ? 'نص جديد' : undefined,
      x: Math.max(2, design.width / 2 - 15),
      y: Math.max(2, design.height / 2 - 5),
    });
    setFace({ elements: [...face.elements, el] });
    setSelectedId(el.id);
    setShowAddMenu(false);
  };

  // ---------- uploads ----------
  const uploadBg = async (file: File) => {
    setUploadingBg(true);
    try {
      const url = await uploadPhoto(supabase, 'cards', file);
      setBg({ imageUrl: url });
    } finally { setUploadingBg(false); }
  };
  const uploadElImage = async (file: File) => {
    if (!selected) return;
    setUploadingImg(true);
    try {
      const url = await uploadPhoto(supabase, 'cards', file);
      updateEl(selected.id, { imageUrl: url });
    } finally { setUploadingImg(false); }
  };

  return (
    <div className="space-y-4">
      {/* ---------- live preview (frozen at top while scrolling) ---------- */}
      <section className="card !p-3 sticky top-[76px] z-30 !shadow-lg">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-[11px] font-extrabold text-slate-400 truncate">
            معاينة حية — سحب للتحريك · مقابض لتغيير الحجم
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {/* preview zoom controls */}
            <button
              onClick={zoomOut}
              disabled={previewZoom <= 1}
              aria-label="تصغير المعاينة"
              className="rounded-lg bg-slate-100 p-1.5 text-slate-500 hover:bg-slate-200 disabled:opacity-40 transition"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="w-10 text-center text-[10px] font-extrabold text-slate-500 tabular-nums" dir="ltr">
              {Math.round(previewZoom * 100)}%
            </span>
            <button
              onClick={zoomIn}
              disabled={previewZoom >= 6}
              aria-label="تكبير المعاينة"
              className="rounded-lg bg-slate-100 p-1.5 text-slate-500 hover:bg-slate-200 disabled:opacity-40 transition"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            {previewZoom !== 1 && (
              <button
                onClick={() => setPreviewZoom(1)}
                aria-label="إعادة ضبط الزووم"
                className="rounded-lg bg-slate-100 p-1.5 text-slate-500 hover:bg-slate-200 transition"
              >
                <Maximize className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => setShowCenterLines((v) => !v)}
              className={`badge shrink-0 transition ${showCenterLines ? 'bg-pink-100 text-pink-600' : 'bg-slate-100 text-slate-400'}`}
            >
              ✧ المنتصف
            </button>
          </div>
        </div>
        {/* front + back next to each other; the face under edit is interactive */}
        <div
          className={`overflow-auto py-1 ${previewZoom === 1 ? 'flex justify-center' : ''}`}
          style={{ maxHeight: previewZoom === 1 ? undefined : 260 }}
          dir="rtl"
        >
          <div
            className="flex items-start gap-3"
            style={{ width: 'fit-content', margin: previewZoom === 1 ? undefined : '0 auto' }}
          >
            {(backEnabled ? (['front', 'back'] as CardSide[]) : (['front'] as CardSide[])).map((s) => {
              const active = s === side;
              const fd = faceDesign(design, s);
              return (
                <div key={s} className="flex flex-col items-center gap-1">
                  <button
                    onClick={() => switchSide(s)}
                    className={`badge !py-0.5 transition ${active ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                  >
                    {CARD_SIDE_LABELS[s]}
                    {(fd.flipH || fd.flipV) && <span className="mr-1 opacity-80">⇄</span>}
                  </button>
                  <div
                    onClick={() => !active && switchSide(s)}
                    className={`shadow-lg transition ${active ? 'ring-2 ring-primary-400 ring-offset-2' : 'cursor-pointer opacity-70 hover:opacity-100'}`}
                    style={{ borderRadius: design.cornerRadius * scale, width: 'fit-content' }}
                    dir="ltr"
                  >
                    {active ? (
                      <CardCanvas
                        design={fd}
                        scale={scale}
                        constants={constants}
                        person={samplePerson ?? SAMPLE_PERSON}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        onMove={(id, x, y) => updateEl(id, { x, y })}
                        onResize={(id, patch) => updateEl(id, patch)}
                        showCenterLines={showCenterLines}
                      />
                    ) : (
                      <CardCanvas design={fd} scale={scale} constants={constants} person={samplePerson ?? SAMPLE_PERSON} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* live distance from card center for the selected element */}
        {selected && (
          <p className="mt-1.5 text-center text-[11px] font-extrabold text-pink-600" dir="rtl">
            بُعد مركز «{elementTitle(selected)}» عن مركز الكارت:
            أفقي <span dir="ltr">{centerDx(selected) > 0 ? '+' : ''}{centerDx(selected)}</span> مم
            · رأسي <span dir="ltr">{centerDy(selected) > 0 ? '+' : ''}{centerDy(selected)}</span> مم
          </p>
        )}
      </section>

      {/* ---------- side selector: الوجه / الظهر + flip ---------- */}
      <section className="card">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-slate-600">وجهي الكارت</h3>
          {backEnabled ? (
            <button onClick={disableBack} className="badge bg-red-50 text-red-500 hover:bg-red-100 transition !py-1">
              <X className="ml-1 inline h-3 w-3" /> إلغاء الظهر
            </button>
          ) : (
            <button onClick={enableBack} className="btn-primary !py-1.5 !px-3 flex items-center gap-1 text-xs">
              <Plus className="h-3.5 w-3.5" /> إضافة ظهر للكارت
            </button>
          )}
        </div>
        <div className="flex rounded-2xl bg-slate-50 p-1">
          {(['front', 'back'] as CardSide[]).map((s) => (
            <button
              key={s}
              onClick={() => (s === 'back' && !backEnabled ? enableBack() : switchSide(s))}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold transition ${
                side === s ? 'bg-primary-600 text-white shadow' : 'text-slate-500 hover:bg-white'
              } ${s === 'back' && !backEnabled ? 'opacity-60' : ''}`}
            >
              {s === 'front' ? '🪪' : '🔄'} {CARD_SIDE_LABELS[s]}
              {s === 'back' && !backEnabled && <span className="text-[10px] font-bold opacity-80">(غير مفعّل)</span>}
              {s === 'back' && backEnabled && <span className="badge !py-0 bg-white/20 text-current">{back.elements.length}</span>}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] font-bold text-slate-400">
          {side === 'front'
            ? 'تعمل كل الإعدادات أدناه (الخلفية · الإطار · العناصر) على الوجه.'
            : 'تعمل كل الإعدادات أدناه على الظهر — نفس المقاس ونفس أنواع العناصر (بيانات · QR · شعارات · نص). طريقة طباعة الظهر تُختار في تبويب الطباعة.'}
        </p>

        {/* mirror the face */}
        <div className="mt-3 border-t border-indigo-50 pt-3">
          <p className="mb-1.5 text-[11px] font-extrabold text-slate-500">
            قلب (انعكاس) {CARD_SIDE_LABELS[side]} — للطباعة على ورق شفاف / ورق نقل حراري
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => setFace({ flipH: !face.flipH })}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-extrabold transition ${
                face.flipH ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-400 hover:bg-slate-50'
              }`}
            >
              <FlipHorizontal2 className="h-4 w-4" /> قلب أفقي
            </button>
            <button
              onClick={() => setFace({ flipV: !face.flipV })}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-extrabold transition ${
                face.flipV ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-400 hover:bg-slate-50'
              }`}
            >
              <FlipVertical2 className="h-4 w-4" /> قلب رأسي
            </button>
            {(face.flipH || face.flipV) && (
              <button
                onClick={() => setFace({ flipH: false, flipV: false })}
                aria-label="إلغاء القلب"
                className="rounded-xl border border-slate-200 px-3 text-slate-400 hover:bg-slate-50"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
          </div>
          {(face.flipH || face.flipV) && (
            <p className="mt-1.5 text-[11px] font-bold text-amber-600">
              ⚠️ هذا الوجه يُطبع معكوساً — السحب وتغيير الحجم في المعاينة يتبعان الاتجاه الظاهر.
            </p>
          )}
        </div>

        {/* back tools */}
        {backEnabled && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-indigo-50 pt-3">
            <button onClick={copyFromOtherSide} className="badge bg-slate-100 text-slate-600 hover:bg-slate-200 transition !py-1.5">
              <Copy className="ml-1 inline h-3 w-3" />
              نسخ {CARD_SIDE_LABELS[side === 'front' ? 'back' : 'front']} إلى {CARD_SIDE_LABELS[side]}
            </button>
            <button
              onClick={() => switchSide(side === 'front' ? 'back' : 'front')}
              className="badge bg-slate-100 text-slate-600 hover:bg-slate-200 transition !py-1.5"
            >
              <ArrowLeftRight className="ml-1 inline h-3 w-3" /> الانتقال إلى {CARD_SIDE_LABELS[side === 'front' ? 'back' : 'front']}
            </button>
            {side === 'back' && (
              <button onClick={clearBack} className="badge bg-red-50 text-red-500 hover:bg-red-100 transition !py-1.5">
                <Trash2 className="ml-1 inline h-3 w-3" /> مسح عناصر الظهر
              </button>
            )}
          </div>
        )}
      </section>

      {/* ---------- card size ---------- */}
      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">مقاس الكارت</h3>
        <div className="grid grid-cols-3 gap-2">
          <Num label="العرض" suffix="مم" value={design.width} min={30} max={300} onChange={(v) => set({ width: v })} />
          <Num label="الطول" suffix="مم" value={design.height} min={30} max={300} onChange={(v) => set({ height: v })} />
          <Num label="استدارة الأركان" suffix="مم" value={design.cornerRadius} min={0} max={30} onChange={(v) => set({ cornerRadius: v })} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            { label: 'كارت ID ‏85.6×54', w: 85.6, h: 54 },
            { label: 'A6 ‏105×148', w: 105, h: 148 },
            { label: 'A7 ‏74×105', w: 74, h: 105 },
            { label: 'مربع ‏90×90', w: 90, h: 90 },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => set({ width: p.w, height: p.h })}
              className="badge bg-primary-50 text-primary-600 hover:bg-primary-100 transition !py-1"
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {/* ---------- background ---------- */}
      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">الخلفية <span className="text-slate-300">— {CARD_SIDE_LABELS[side]}</span></h3>
        <div className="grid grid-cols-2 gap-2">
          <ColorInput label="لون الخلفية" value={face.background.color} onChange={(v) => setBg({ color: v })} />
          <div>
            <span className="mb-0.5 block text-[11px] font-bold text-slate-500">صورة الخلفية</span>
            <input
              ref={bgFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadBg(e.target.files[0])}
            />
            {face.background.imageUrl ? (
              <div className="flex items-center gap-2">
                <button onClick={() => bgFileRef.current?.click()} className="btn-secondary !py-2 !px-3 flex-1 text-xs flex items-center justify-center gap-1">
                  {uploadingBg ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  تغيير
                </button>
                <button onClick={() => setBg({ imageUrl: null })} aria-label="إزالة الخلفية" className="rounded-xl bg-red-50 p-2 text-red-500">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button onClick={() => bgFileRef.current?.click()} className="btn-secondary !py-2 !px-3 w-full text-xs flex items-center justify-center gap-1">
                {uploadingBg ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                رفع صورة
              </button>
            )}
          </div>
        </div>
        {face.background.imageUrl && (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-0.5 block text-[11px] font-bold text-slate-500">طريقة العرض</span>
                <select
                  className="input-field !py-2 !px-2.5 !text-sm"
                  value={face.background.imageFit}
                  onChange={(e) => setBg({ imageFit: e.target.value as ImageFit | 'custom' })}
                >
                  {Object.entries(IMAGE_FIT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  <option value="custom">تحكم حر (زووم + تحريك)</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[11px] font-bold text-slate-500">
                  شفافية الصورة ({Math.round(face.background.imageOpacity * 100)}%)
                </span>
                <input
                  type="range" min={0.05} max={1} step={0.05}
                  value={face.background.imageOpacity}
                  onChange={(e) => setBg({ imageOpacity: Number(e.target.value) })}
                  className="mt-3 w-full accent-primary-600"
                />
              </label>
            </div>

            {/* free transform: zoom in/out + move/crop until the final look */}
            {face.background.imageFit === 'custom' && (
              <div className="mt-2 rounded-xl bg-indigo-50/60 p-3">
                <p className="mb-2 text-[11px] font-extrabold text-slate-500">
                  تحكم حر في الخلفية — كبّر وصغّر وحرّك حتى تصل للشكل النهائي (ما يخرج عن حدود الكارت يُقص)
                </p>
                <label className="block">
                  <span className="mb-0.5 flex items-center justify-between text-[11px] font-bold text-slate-500">
                    <span>الزووم</span>
                    <span dir="ltr">{Math.round((face.background.zoom ?? 1) * 100)}%</span>
                  </span>
                  <input
                    type="range" min={0.2} max={5} step={0.01}
                    value={face.background.zoom ?? 1}
                    onChange={(e) => setBg({ zoom: Number(e.target.value) })}
                    className="w-full accent-primary-600"
                  />
                </label>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-0.5 flex items-center justify-between text-[11px] font-bold text-slate-500">
                      <span>تحريك أفقي</span>
                      <span dir="ltr">{face.background.offsetX ?? 0}%</span>
                    </span>
                    <input
                      type="range" min={-200} max={200} step={1}
                      value={face.background.offsetX ?? 0}
                      onChange={(e) => setBg({ offsetX: Number(e.target.value) })}
                      className="w-full accent-primary-600"
                      dir="ltr"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 flex items-center justify-between text-[11px] font-bold text-slate-500">
                      <span>تحريك رأسي</span>
                      <span dir="ltr">{face.background.offsetY ?? 0}%</span>
                    </span>
                    <input
                      type="range" min={-200} max={200} step={1}
                      value={face.background.offsetY ?? 0}
                      onChange={(e) => setBg({ offsetY: Number(e.target.value) })}
                      className="w-full accent-primary-600"
                      dir="ltr"
                    />
                  </label>
                </div>
                <button
                  onClick={() => setBg({ zoom: 1, offsetX: 0, offsetY: 0 })}
                  className="mt-2 w-full rounded-lg bg-white py-1.5 text-[11px] font-extrabold text-slate-500 hover:bg-slate-50 border border-slate-200"
                >
                  إعادة ضبط (100% · منتصف)
                </button>
              </div>
            )}
          </>
        )}
        {/* border */}
        <div className="mt-3 border-t border-indigo-50 pt-3">
          <label className="mb-2 flex items-center gap-2 text-xs font-extrabold text-slate-600">
            <input
              type="checkbox"
              checked={face.border.enabled}
              onChange={(e) => setBorder({ enabled: e.target.checked })}
              className="h-4 w-4 accent-primary-600"
            />
            إطار حول الكارت
          </label>
          {face.border.enabled && (
            <div className="grid grid-cols-2 gap-2">
              <ColorInput label="لون الإطار" value={face.border.color} onChange={(v) => setBorder({ color: v })} />
              <Num label="سُمك الإطار" suffix="مم" value={face.border.width} min={0.1} max={5} step={0.1} onChange={(v) => setBorder({ width: v })} />
            </div>
          )}
        </div>
      </section>

      {/* ---------- elements list ---------- */}
      <section className="card">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-600">عناصر {CARD_SIDE_LABELS[side]} ({face.elements.length})</h3>
          <div className="relative">
            <button onClick={() => setShowAddMenu((v) => !v)} className="btn-primary !py-1.5 !px-3 flex items-center gap-1 text-xs">
              <Plus className="h-3.5 w-3.5" /> إضافة عنصر
            </button>
            {showAddMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowAddMenu(false)} />
                <div className="absolute left-0 z-20 mt-1 w-56 rounded-2xl border border-indigo-50 bg-white p-2 shadow-xl max-h-80 overflow-y-auto">
                  <p className="px-2 py-1 text-[10px] font-extrabold text-slate-400">بيانات متغيرة (لكل مخدوم)</p>
                  {VARIABLE_FIELDS.map((f) => (
                    <button key={f.value} onClick={() => addElement('variable', f.value)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-primary-50">
                      <TextCursorInput className="h-4 w-4 text-primary-500" /> {f.label}
                    </button>
                  ))}
                  {variant === 'birthday' && (
                    <>
                      <p className="px-2 py-1 text-[10px] font-extrabold text-pink-400">بيانات عيد الميلاد</p>
                      {BIRTHDAY_VARIABLE_FIELDS.map((f) => (
                        <button key={f.value} onClick={() => addElement('variable', f.value)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-pink-50">
                          <TextCursorInput className="h-4 w-4 text-pink-500" /> {f.label}
                        </button>
                      ))}
                    </>
                  )}
                  <button onClick={() => addElement('photo')} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-primary-50">
                    <User className="h-4 w-4 text-primary-500" /> صورة المخدوم
                  </button>
                  <button onClick={() => addElement('qr')} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-primary-50">
                    <QrCode className="h-4 w-4 text-primary-500" /> رمز QR (الرقم القومي)
                  </button>
                  <p className="mt-1 border-t border-indigo-50 px-2 py-1 text-[10px] font-extrabold text-slate-400">ثوابت</p>
                  {CONSTANT_FIELDS.map((f) => (
                    <button key={f.value} onClick={() => addElement('constant', f.value)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-gold-50">
                      <Landmark className="h-4 w-4 text-gold-500" /> {f.label}
                    </button>
                  ))}
                  <button onClick={() => addElement('logo')} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-gold-50">
                    <Landmark className="h-4 w-4 text-gold-500" /> شعار الكنيسة
                  </button>
                  <button
                    onClick={() => addElement('service_logo')}
                    className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-gold-50"
                    title="صورة الخدمة المرفوعة في إدارة الخدمات — تتغير مع خدمة كل مخدوم"
                  >
                    <Church className="h-4 w-4 text-gold-500" /> شعار الخدمة
                  </button>
                  <button
                    onClick={() => addElement('class_logo')}
                    className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-gold-50"
                    title="صورة الفصل المرفوعة في إدارة الفصول — تتغير مع فصل كل مخدوم"
                  >
                    <Users className="h-4 w-4 text-gold-500" /> شعار الفصل
                  </button>
                  <button onClick={() => addElement('text')} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-gold-50">
                    <Type className="h-4 w-4 text-gold-500" /> نص ثابت
                  </button>
                  <button onClick={() => addElement('image')} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold hover:bg-gold-50">
                    <ImagePlus className="h-4 w-4 text-gold-500" /> صورة / شعار مرفوع
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <ul className="space-y-1.5">
          {[...face.elements].reverse().map((el) => (
            <li key={el.id}>
              <button
                onClick={() => setSelectedId(el.id === selectedId ? null : el.id)}
                className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                  selectedId === el.id
                    ? 'border-primary-300 bg-primary-50 text-primary-700'
                    : 'border-slate-100 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-primary-500">{TYPE_ICONS[el.type]}</span>
                <span className="min-w-0 flex-1 truncate text-right">{elementTitle(el)}</span>
                <span className="text-[10px] font-normal text-pink-400" dir="ltr" title="بُعد المركز عن مركز الكارت (أفقي، رأسي)">
                  ⊕ {centerDx(el) > 0 ? '+' : ''}{centerDx(el)}, {centerDy(el) > 0 ? '+' : ''}{centerDy(el)} مم
                </span>
              </button>
            </li>
          ))}
          {face.elements.length === 0 && (
            <li className="py-6 text-center text-xs font-bold text-slate-300">لا توجد عناصر في {CARD_SIDE_LABELS[side]} — أضف عنصراً</li>
          )}
        </ul>
      </section>

      {/* ---------- selected element inspector ---------- */}
      {selected && (
        <section className="card border-primary-200 !border-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-primary-700">
              {TYPE_ICONS[selected.type]} {elementTitle(selected)}
            </h3>
            <div className="flex items-center gap-1">
              <button onClick={() => moveLayer(selected.id, 1)} aria-label="طبقة لأعلى" className="rounded-lg bg-slate-50 p-1.5 text-slate-500 hover:bg-slate-100">
                <ChevronUp className="h-4 w-4" />
              </button>
              <button onClick={() => moveLayer(selected.id, -1)} aria-label="طبقة لأسفل" className="rounded-lg bg-slate-50 p-1.5 text-slate-500 hover:bg-slate-100">
                <ChevronDown className="h-4 w-4" />
              </button>
              <button onClick={() => removeEl(selected.id)} aria-label="حذف العنصر" className="rounded-lg bg-red-50 p-1.5 text-red-500 hover:bg-red-100">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* position & size */}
          <div className="grid grid-cols-4 gap-2">
            <Num label="س (من اليسار)" value={selected.x} min={-50} max={300} onChange={(v) => updateEl(selected.id, { x: v })} />
            <Num label="ص (من الأعلى)" value={selected.y} min={-50} max={300} onChange={(v) => updateEl(selected.id, { y: v })} />
            <Num
              label="العرض" value={selected.w} min={1} max={300}
              onChange={(v) => {
                if (selected.lockAspect && selected.w > 0) {
                  const r = selected.h / selected.w;
                  updateEl(selected.id, { w: v, h: Math.round(v * r * 10) / 10 });
                } else updateEl(selected.id, { w: v });
              }}
            />
            <Num
              label="الارتفاع" value={selected.h} min={1} max={300}
              onChange={(v) => {
                if (selected.lockAspect && selected.h > 0) {
                  const r = selected.w / selected.h;
                  updateEl(selected.id, { h: v, w: Math.round(v * r * 10) / 10 });
                } else updateEl(selected.id, { h: v });
              }}
            />
          </div>

          {/* lock aspect ratio */}
          <button
            onClick={() => updateEl(selected.id, { lockAspect: !selected.lockAspect })}
            className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-extrabold transition ${
              selected.lockAspect
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-slate-200 text-slate-400 hover:bg-slate-50'
            }`}
          >
            {selected.lockAspect ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
            {selected.lockAspect ? 'نسبة الأبعاد مقفولة — العرض/الارتفاع يتغيران معاً' : 'قفل نسبة الأبعاد (العرض/الارتفاع)'}
          </button>

          {/* distance from card center — editable (moves the element) */}
          <div className="mt-2 rounded-xl bg-pink-50/60 p-2.5">
            <p className="mb-1.5 text-[11px] font-extrabold text-pink-600">
              ⊕ بُعد مركز العنصر عن مركز الكارت (+ يمين / أسفل · − يسار / أعلى)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Num
                label="أفقي من المركز" suffix="مم"
                value={centerDx(selected)} min={-300} max={300} step={0.5}
                onChange={(v) => updateEl(selected.id, { x: Math.round((design.width / 2 + v - selected.w / 2) * 10) / 10 })}
              />
              <Num
                label="رأسي من المركز" suffix="مم"
                value={centerDy(selected)} min={-300} max={300} step={0.5}
                onChange={(v) => updateEl(selected.id, { y: Math.round((design.height / 2 + v - selected.h / 2) * 10) / 10 })}
              />
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <button
                onClick={() => updateEl(selected.id, { x: Math.round((design.width / 2 - selected.w / 2) * 10) / 10 })}
                className="flex-1 rounded-lg bg-white py-1.5 text-[11px] font-extrabold text-pink-600 border border-pink-200 hover:bg-pink-50"
              >
                توسيط أفقي
              </button>
              <button
                onClick={() => updateEl(selected.id, { y: Math.round((design.height / 2 - selected.h / 2) * 10) / 10 })}
                className="flex-1 rounded-lg bg-white py-1.5 text-[11px] font-extrabold text-pink-600 border border-pink-200 hover:bg-pink-50"
              >
                توسيط رأسي
              </button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Num label="الدوران" suffix="°" value={selected.rotation} min={-180} max={180} step={1} onChange={(v) => updateEl(selected.id, { rotation: v })} />
            <Num label="استدارة الأركان" suffix="مم" value={selected.borderRadius} min={0} max={50} onChange={(v) => updateEl(selected.id, { borderRadius: v })} />
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-bold text-slate-500">
                الشفافية ({Math.round(selected.opacity * 100)}%)
              </span>
              <input
                type="range" min={0.05} max={1} step={0.05}
                value={selected.opacity}
                onChange={(e) => updateEl(selected.id, { opacity: Number(e.target.value) })}
                className="mt-3 w-full accent-primary-600"
              />
            </label>
          </div>

          {/* ---------- QR look: colours · expanded rounded background · frame ---------- */}
          {selected.type === 'qr' && (() => {
            const q = normalizeQr(selected);
            const f = q.frame;
            // rounded corners force a minimum quiet zone so the finder patterns
            // are never clipped — tell the user when it kicks in
            const safePad = Math.round(qrCornerSafePadding(selected.borderRadius, f) * 10) / 10;
            const effPad = Math.round(qrEffectivePadding(selected.borderRadius, q) * 10) / 10;
            const padForced = effPad > q.padding;
            return (
              <div className="mt-3 border-t border-indigo-50 pt-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold text-slate-400">
                  <QrCode className="h-3.5 w-3.5" /> مظهر رمز QR
                </p>

                {/* colours */}
                <div className="grid grid-cols-2 gap-2">
                  <ColorInput label="لون الرمز (المربعات)" value={q.color} onChange={(v) => updateQr(selected, { color: v })} />
                  <div>
                    <ColorInput
                      label="لون الخلفية"
                      value={q.bgColor}
                      onChange={(v) => updateQr(selected, { bgColor: v, bgTransparent: false })}
                    />
                    <label className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                      <input
                        type="checkbox"
                        checked={q.bgTransparent}
                        onChange={(e) => updateQr(selected, { bgTransparent: e.target.checked })}
                        className="h-3.5 w-3.5 accent-primary-600"
                      />
                      خلفية شفافة (يظهر الكارت خلف الرمز)
                    </label>
                  </div>
                </div>
                {q.bgTransparent && (
                  <p className="mt-1.5 text-[11px] font-bold text-amber-600">
                    ⚠️ تأكد أن خلفية الكارت خلف الرمز فاتحة ومتباينة مع لون الرمز ليقرأه الماسح بسهولة.
                  </p>
                )}

                {/* expanded background + rounded corners */}
                <div className="mt-2 rounded-xl bg-indigo-50/60 p-2.5">
                  <p className="mb-1.5 text-[11px] font-extrabold text-slate-500">
                    توسيع الخلفية حول الرمز (هامش أمان) واستدارة أركانها
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-0.5 flex items-center justify-between text-[11px] font-bold text-slate-500">
                        <span>توسيع الخلفية</span>
                        <span dir="ltr">
                          {q.padding} مم
                          {padForced && <span className="text-amber-600"> → {effPad}</span>}
                        </span>
                      </span>
                      <input
                        type="range" min={0} max={Math.max(1, Math.min(selected.w, selected.h) / 2 - 1)} step={0.1}
                        value={q.padding}
                        onChange={(e) => updateQr(selected, { padding: Number(e.target.value) })}
                        className="mt-2 w-full accent-primary-600"
                        dir="ltr"
                      />
                    </label>
                    <Num
                      label="استدارة أركان الخلفية" suffix="مم"
                      value={selected.borderRadius} min={0} max={50} step={0.5}
                      onChange={(v) => updateEl(selected.id, { borderRadius: v })}
                    />
                  </div>
                  <div className="mt-1.5 flex gap-1.5">
                    {[
                      { label: 'بدون توسيع', p: 0 },
                      { label: 'ضيق 1 مم', p: 1 },
                      { label: 'متوسط 2 مم', p: 2 },
                      { label: 'واسع 3 مم', p: 3 },
                    ].map((o) => (
                      <button
                        key={o.label}
                        onClick={() => updateQr(selected, { padding: o.p })}
                        className={`flex-1 rounded-lg border py-1.5 text-[10px] font-extrabold transition ${
                          q.padding === o.p ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => updateEl(selected.id, { borderRadius: Math.round(Math.min(selected.w, selected.h) / 2 * 10) / 10 })}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white py-1.5 text-[11px] font-extrabold text-slate-500 hover:bg-slate-50"
                  >
                    ⭕ خلفية دائرية (استدارة = نصف العرض)
                  </button>
                  {padForced && (
                    <p className="mt-1.5 text-[11px] font-bold text-amber-600">
                      ⚠️ الأركان المستديرة تقطع زوايا الرمز — يُطبّق توسيع {effPad} مم تلقائياً (الحد الأدنى لاستدارة {selected.borderRadius} مم هو {safePad} مم) ليبقى الرمز كاملاً وقابلاً للقراءة.
                      <button
                        onClick={() => updateQr(selected, { padding: effPad })}
                        className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 hover:bg-amber-200"
                      >
                        اعتماد {effPad} مم
                      </button>
                    </p>
                  )}
                </div>

                {/* frame */}
                <label className="mb-2 mt-3 flex items-center gap-2 text-xs font-extrabold text-slate-600">
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    onChange={(e) => updateQrFrame(selected, { enabled: e.target.checked })}
                    className="h-4 w-4 accent-primary-600"
                  />
                  إطار حول الرمز (يتبع استدارة الأركان)
                </label>
                {f.enabled && (
                  <div className="rounded-xl bg-gold-50/60 p-2.5">
                    <p className="mb-1.5 text-[11px] font-extrabold text-slate-500">لون الإطار — اختصارات معدنية</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(Object.keys(QR_FRAME_PRESETS) as Exclude<QrFramePreset, 'custom'>[]).map((p) => {
                        const preset = QR_FRAME_PRESETS[p];
                        const active = f.preset === p;
                        return (
                          <button
                            key={p}
                            onClick={() => applyQrPreset(selected, p)}
                            className={`flex flex-col items-center gap-1 rounded-xl border py-2 text-[11px] font-extrabold transition ${
                              active ? 'border-primary-400 bg-white text-primary-700 ring-2 ring-primary-200' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                            }`}
                          >
                            <span
                              className="h-6 w-6 rounded-full border border-black/10 shadow-inner"
                              style={{ background: f.metallic ? preset.gradient : preset.color }}
                            />
                            {preset.label}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => applyQrPreset(selected, 'custom')}
                        className={`flex flex-col items-center gap-1 rounded-xl border py-2 text-[11px] font-extrabold transition ${
                          f.preset === 'custom' ? 'border-primary-400 bg-white text-primary-700 ring-2 ring-primary-200' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        <span className="h-6 w-6 rounded-full border border-black/10 shadow-inner" style={{ background: f.color }} />
                        مخصص
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {f.preset === 'custom' ? (
                        <ColorInput label="لون الإطار" value={f.color} onChange={(v) => updateQrFrame(selected, { color: v })} />
                      ) : (
                        <div>
                          <span className="mb-0.5 block text-[11px] font-bold text-slate-500">اللمعة المعدنية</span>
                          <button
                            onClick={() => updateQrFrame(selected, { metallic: !f.metallic })}
                            className={`flex w-full items-center justify-center gap-2 rounded-xl border py-2 text-xs font-extrabold transition ${
                              f.metallic ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'
                            }`}
                          >
                            <span className="h-4 w-4 rounded-full border border-black/10" style={{ background: qrFrameCss(f) }} />
                            {f.metallic ? 'تدرّج معدني لامع' : 'لون ثابت (مطفي)'}
                          </button>
                        </div>
                      )}
                      <Num
                        label="سُمك الإطار" suffix="مم"
                        value={f.width} min={0.1} max={10} step={0.1}
                        onChange={(v) => updateQrFrame(selected, { width: v })}
                      />
                    </div>
                    <p className="mt-1.5 text-[10px] font-bold text-slate-400">
                      الإطار يُرسم داخل صندوق العنصر حول الخلفية — كبّر العنصر أو وسّع الخلفية ليبقى الرمز واضحاً.
                    </p>
                  </div>
                )}

                <button
                  onClick={() => updateEl(selected.id, { qr: { ...DEFAULT_QR_SETTINGS, frame: { ...DEFAULT_QR_SETTINGS.frame } } })}
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white py-1.5 text-[11px] font-extrabold text-slate-500 hover:bg-slate-50"
                >
                  إعادة ضبط مظهر الرمز (أسود على أبيض · بدون إطار)
                </button>
              </div>
            );
          })()}

          {/* ---------- box background & stroke (every element except QR — it has its own panel) ---------- */}
          {selected.type !== 'qr' && (
          <div className="mt-3 border-t border-indigo-50 pt-3">
            <label className="mb-2 flex items-center gap-2 text-xs font-extrabold text-slate-600">
              <input
                type="checkbox"
                checked={selected.bgEnabled}
                onChange={(e) => updateEl(selected.id, { bgEnabled: e.target.checked })}
                className="h-4 w-4 accent-primary-600"
              />
              خلفية للعنصر (لون صندوق العنصر)
            </label>
            {selected.bgEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <ColorInput label="لون الخلفية" value={selected.bgColor} onChange={(v) => updateEl(selected.id, { bgColor: v })} />
                <label className="block">
                  <span className="mb-0.5 block text-[11px] font-bold text-slate-500">
                    شفافية الخلفية ({Math.round(selected.bgOpacity * 100)}%)
                  </span>
                  <input
                    type="range" min={0.05} max={1} step={0.05}
                    value={selected.bgOpacity}
                    onChange={(e) => updateEl(selected.id, { bgOpacity: Number(e.target.value) })}
                    className="mt-3 w-full accent-primary-600"
                  />
                </label>
              </div>
            )}

            <label className="mb-2 mt-3 flex items-center gap-2 text-xs font-extrabold text-slate-600">
              <input
                type="checkbox"
                checked={selected.strokeEnabled}
                onChange={(e) => updateEl(selected.id, { strokeEnabled: e.target.checked })}
                className="h-4 w-4 accent-primary-600"
              />
              إطار حول العنصر (يتبع استدارة الأركان)
            </label>
            {selected.strokeEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <ColorInput label="لون الإطار" value={selected.strokeColor} onChange={(v) => updateEl(selected.id, { strokeColor: v })} />
                <Num label="سُمك الإطار" suffix="مم" value={selected.strokeWidth} min={0.1} max={5} step={0.1} onChange={(v) => updateEl(selected.id, { strokeWidth: v })} />
              </div>
            )}
          </div>
          )}

          {/* free text content */}
          {selected.type === 'text' && (
            <label className="mt-2 block">
              <span className="mb-0.5 block text-[11px] font-bold text-slate-500">النص</span>
              <textarea
                className="input-field !py-2 !text-sm"
                rows={2}
                value={selected.text ?? ''}
                onChange={(e) => updateEl(selected.id, { text: e.target.value })}
              />
            </label>
          )}

          {/* label prefix for variables / constants */}
          {(selected.type === 'variable' || selected.type === 'constant') && (
            <label className="mt-2 block">
              <span className="mb-0.5 block text-[11px] font-bold text-slate-500">نص قبل القيمة (اختياري)</span>
              <input
                className="input-field !py-2 !text-sm"
                value={selected.label ?? ''}
                onChange={(e) => updateEl(selected.id, { label: e.target.value })}
                placeholder="مثال: الاسم:"
              />
            </label>
          )}

          {/* text style */}
          {(selected.type === 'variable' || selected.type === 'constant' || selected.type === 'text') && (
            <div className="mt-3 border-t border-indigo-50 pt-3">
              <p className="mb-2 text-[11px] font-extrabold text-slate-400">الخط</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-0.5 block text-[11px] font-bold text-slate-500">نوع الخط</span>
                  <select
                    className="input-field !py-2 !px-2.5 !text-sm"
                    value={selected.style.fontFamily}
                    onChange={(e) => updateElStyle(selected.id, { fontFamily: e.target.value })}
                  >
                    {FONT_FAMILIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </label>
                <Num label="حجم الخط" suffix="pt" value={selected.style.fontSize} min={4} max={72} step={0.5} onChange={(v) => updateElStyle(selected.id, { fontSize: v })} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <ColorInput label="لون الخط" value={selected.style.color} onChange={(v) => updateElStyle(selected.id, { color: v })} />
                <div>
                  <span className="mb-0.5 block text-[11px] font-bold text-slate-500">التنسيق والمحاذاة</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => updateElStyle(selected.id, { bold: !selected.style.bold })}
                      className={`flex-1 rounded-lg border py-2 text-sm font-black transition ${selected.style.bold ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-400'}`}
                    >B</button>
                    <button
                      onClick={() => updateElStyle(selected.id, { italic: !selected.style.italic })}
                      className={`flex-1 rounded-lg border py-2 text-sm italic transition ${selected.style.italic ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-400'}`}
                    >I</button>
                    {(['right', 'center', 'left'] as TextAlign[]).map((a) => (
                      <button
                        key={a}
                        onClick={() => updateElStyle(selected.id, { align: a })}
                        className={`flex-1 rounded-lg border py-2 text-[10px] font-bold transition ${selected.style.align === a ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-400'}`}
                      >
                        {a === 'right' ? 'يمين' : a === 'center' ? 'وسط' : 'يسار'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* image settings */}
          {isImageElement(selected.type) && (
            <div className="mt-3 border-t border-indigo-50 pt-3">
              {(selected.type === 'logo' || selected.type === 'service_logo' || selected.type === 'class_logo') && (
                <p className="mb-2 rounded-xl bg-gold-50 p-2 text-[11px] font-bold text-gold-700">
                  {selected.type === 'logo' && 'يعرض شعار الكنيسة المرفوع في إدارة الكنائس — يتبع كنيسة كل مخدوم عند الطباعة.'}
                  {selected.type === 'service_logo' && 'يعرض صورة / شعار الخدمة المرفوعة في إدارة الخدمات — يتبع خدمة كل مخدوم عند الطباعة.'}
                  {selected.type === 'class_logo' && 'يعرض صورة / شعار الفصل المرفوعة في إدارة الفصول — يتبع فصل كل مخدوم عند الطباعة.'}
                  {' '}إن لم تكن الصورة مرفوعة يظهر مكانها فارغاً.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-0.5 block text-[11px] font-bold text-slate-500">طريقة عرض الصورة</span>
                  <select
                    className="input-field !py-2 !px-2.5 !text-sm"
                    value={selected.imageFit}
                    onChange={(e) => updateEl(selected.id, { imageFit: e.target.value as ImageFit })}
                  >
                    {Object.entries(IMAGE_FIT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                {selected.type === 'image' && (
                  <div>
                    <span className="mb-0.5 block text-[11px] font-bold text-slate-500">ملف الصورة</span>
                    <input
                      ref={imgFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && uploadElImage(e.target.files[0])}
                    />
                    <button onClick={() => imgFileRef.current?.click()} className="btn-secondary !py-2 !px-3 w-full text-xs flex items-center justify-center gap-1">
                      {uploadingImg ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      {selected.imageUrl ? 'تغيير الصورة' : 'رفع صورة'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
