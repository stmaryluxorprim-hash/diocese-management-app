// ---------- Card Designer types (JSONB schema of card_templates) ----------
// All positions & sizes are in MILLIMETERS (converted to px on screen).

// ----- element kinds -----
// Variables — filled per person at print time.
export type CardVariableField =
  | 'name'
  | 'age'
  | 'birthdate'
  | 'phone'
  | 'national_id'
  | 'address'
  // ----- birthday-card variables (module أعياد الميلاد) -----
  | 'first_name'      // الاسم الأول
  | 'turns_age'       // السن التي يتمها في عيد الميلاد (سنة الكارت)
  | 'birthday_day'    // يوم الميلاد (رقم)
  | 'birthday_month'  // شهر الميلاد (اسم عربي)
  | 'birthday_date'   // يوم + شهر (مثلاً «5 مارس»)
  | 'birthday_year'   // سنة العيد
  | 'gift_points';    // نقاط الهدية

// Constants — fixed values bound to the template scope.
export type CardConstantField = 'church_name' | 'service_name' | 'class_name';

export type CardElementType =
  | 'variable' // person text field
  | 'photo' // person photo
  | 'qr' // QR code of national_id
  | 'constant' // church / service / class name
  | 'text' // free constant text
  | 'logo' // church logo
  | 'service_logo' // service picture / logo (services.photo_url)
  | 'class_logo' // class picture / logo (classes.photo_url)
  | 'image'; // uploaded constant image

// element types that render an image bound to the person's scope
export const SCOPE_LOGO_TYPES: readonly CardElementType[] = ['logo', 'service_logo', 'class_logo'];
export const isImageElement = (t: CardElementType): boolean =>
  t === 'photo' || t === 'image' || SCOPE_LOGO_TYPES.includes(t);

export type ImageFit = 'cover' | 'contain' | 'stretch' | 'tile';
export type TextAlign = 'right' | 'center' | 'left';

export interface CardTextStyle {
  fontFamily: string;
  fontSize: number; // pt
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
}

// ----- QR code look (element type 'qr') -----
// The QR sits inside its element box: [frame] → [background pad] → [QR].
//   color        modules (dark) colour
//   bgColor      background behind the QR — also fills the "expanded" pad
//   bgTransparent no background at all (the card shows through the light modules)
//   padding      mm — expands the background around the QR (quiet zone)
//   (the rounded corners of the background = the element's borderRadius)
//   frame        ring around the background — solid colour or a metallic
//                gradient with gold / silver / bronze presets
export type QrFramePreset = 'gold' | 'silver' | 'bronze' | 'custom';

export interface CardQrFrame {
  enabled: boolean;
  preset: QrFramePreset;
  color: string; // solid colour (custom preset, or when metallic is off)
  width: number; // mm
  metallic: boolean; // gradient shine (gold / silver / bronze)
}

export interface CardQrSettings {
  color: string;
  bgColor: string;
  bgTransparent: boolean;
  padding: number; // mm
  frame: CardQrFrame;
}

// Metallic shine = a 135° linear gradient. `stops` is the single source of
// truth (used for the SVG gradient that is PRINTED); `gradient` is the same
// thing as a CSS string for the designer swatches.
export type GradientStop = { offset: number; color: string }; // offset 0..1
const cssGradient = (stops: GradientStop[]): string =>
  `linear-gradient(135deg, ${stops.map((st) => `${st.color} ${Math.round(st.offset * 100)}%`).join(', ')})`;
const preset = (label: string, color: string, stops: GradientStop[]) => ({ label, color, stops, gradient: cssGradient(stops) });

export const QR_FRAME_PRESETS: Record<Exclude<QrFramePreset, 'custom'>, { label: string; color: string; stops: GradientStop[]; gradient: string }> = {
  gold: preset('ذهبي', '#d4af37', [
    { offset: 0, color: '#bf953f' }, { offset: 0.22, color: '#fcf6ba' }, { offset: 0.48, color: '#b38728' },
    { offset: 0.72, color: '#fbf5b7' }, { offset: 1, color: '#aa771c' },
  ]),
  silver: preset('فضي', '#c0c0c0', [
    { offset: 0, color: '#8e9eab' }, { offset: 0.24, color: '#f5f7f8' }, { offset: 0.5, color: '#a7b3bd' },
    { offset: 0.74, color: '#ffffff' }, { offset: 1, color: '#7d8a96' },
  ]),
  bronze: preset('برونزي', '#cd7f32', [
    { offset: 0, color: '#7a4a12' }, { offset: 0.24, color: '#e3a857' }, { offset: 0.5, color: '#a0522d' },
    { offset: 0.74, color: '#f1c27d' }, { offset: 1, color: '#6e3b0e' },
  ]),
};

export const QR_FRAME_PRESET_LABELS: Record<QrFramePreset, string> = {
  gold: 'ذهبي',
  silver: 'فضي',
  bronze: 'برونزي',
  custom: 'لون مخصص',
};

// Gradient stops of a metallic frame, or null when the frame is a flat colour
export const qrFrameStops = (f: CardQrFrame): GradientStop[] | null =>
  f.preset !== 'custom' && f.metallic ? QR_FRAME_PRESETS[f.preset].stops : null;

// Flat colour of a frame (presets → their metal colour)
export const qrFrameColor = (f: CardQrFrame): string =>
  f.preset !== 'custom' ? QR_FRAME_PRESETS[f.preset].color : (f.color || '#1e3a8a');

// CSS background of a QR frame (gradient for metallic presets, else solid) —
// designer swatches only; the card itself draws an SVG ring (CardCanvas)
export const qrFrameCss = (f: CardQrFrame): string => {
  if (f.preset !== 'custom' && f.metallic) return QR_FRAME_PRESETS[f.preset].gradient;
  if (f.preset !== 'custom') return QR_FRAME_PRESETS[f.preset].color;
  return f.color || '#1e3a8a';
};

// Minimum quiet zone (mm) the rounded corners of the background force on a
// QR element: a corner arc of radius r (measured inside the frame) eats
// r·(1 − 1/√2) ≈ 0.293·r into the square at every corner. Without that
// margin the finder patterns get clipped by the round corners and the code
// no longer scans. Renderer and designer both use this.
export const qrCornerSafePadding = (borderRadiusMm: number, frame: CardQrFrame): number => {
  const frameMm = frame.enabled && frame.width > 0 ? frame.width : 0;
  const r = Math.max(0, borderRadiusMm - frameMm);
  return r > 0 ? r * (1 - Math.SQRT1_2) + 0.15 : 0;
};

// The quiet zone actually rendered: the user's padding, never below the
// corner-safe minimum.
export const qrEffectivePadding = (borderRadiusMm: number, q: CardQrSettings): number =>
  Math.max(0, q.padding, qrCornerSafePadding(borderRadiusMm, q.frame));

export const DEFAULT_QR_SETTINGS: CardQrSettings = {
  color: '#000000',
  bgColor: '#ffffff',
  bgTransparent: false,
  padding: 0,
  frame: { enabled: false, preset: 'gold', color: '#d4af37', width: 0.8, metallic: true },
};

export interface CardElement {
  id: string;
  type: CardElementType;
  field?: CardVariableField | CardConstantField; // for variable / constant
  text?: string; // for free text
  label?: string; // optional prefix shown before variable (e.g. "الاسم:")
  imageUrl?: string; // for image type
  x: number; // mm from left
  y: number; // mm from top
  w: number; // mm
  h: number; // mm
  rotation: number; // degrees
  style: CardTextStyle; // text elements
  imageFit: ImageFit; // photo / logo / image
  borderRadius: number; // mm — round corners of the element box (all types)
  opacity: number; // 0..1 — whole element
  // per-element box background
  bgEnabled: boolean;
  bgColor: string;
  bgOpacity: number; // 0..1 — background only
  // per-element stroke (border) around the box, follows borderRadius
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number; // mm
  // keep width/height ratio while resizing
  lockAspect: boolean;
  // QR look (type 'qr' only) — optional so old rows load; normalizeElements fills
  qr?: CardQrSettings;
}

// ----- background -----
// Free transform: 'custom' fit uses zoom + offset (pan/crop) chosen visually.
export interface CardBackground {
  color: string;
  imageUrl: string | null;
  imageFit: ImageFit | 'custom';
  imageOpacity: number; // 0..1
  // custom transform (used when imageFit = 'custom'):
  zoom: number; // 1 = image covers the card exactly; 2 = 200% ...
  offsetX: number; // % of card width: 0 = centered, +right / -left
  offsetY: number; // % of card height: 0 = centered, +down / -up
}

// ----- one face of the card (front or back) -----
export type CardSide = 'front' | 'back';
export const CARD_SIDE_LABELS: Record<CardSide, string> = { front: 'الوجه', back: 'الظهر' };

export interface CardFace {
  background: CardBackground;
  border: { enabled: boolean; color: string; width: number }; // width mm
  elements: CardElement[];
  // mirror the whole face (useful for transfer / transparent media). Optional
  // so designs saved before this feature keep loading — normalizeDesign fills.
  flipH?: boolean; // mirror left ↔ right
  flipV?: boolean; // mirror top ↔ bottom
}

// Back face: same engine as the front + an enabled switch. The card size
// (width / height / corner radius) is shared with the front.
export interface CardBack extends CardFace {
  enabled: boolean;
}

// ----- whole design -----
// The top-level background / border / elements ARE the front face (kept flat
// for backward compatibility with every stored template); the back lives in
// `back` (optional in old rows — normalizeDesign always fills it).
export interface CardDesign extends CardFace {
  version: 1;
  width: number; // mm
  height: number; // mm
  cornerRadius: number; // mm
  back?: CardBack;
}

// does this design have a printable back?
export const hasBack = (d: CardDesign | null | undefined): boolean => !!d?.back?.enabled;

// The design of ONE face as a stand-alone CardDesign (same size), so every
// renderer keeps taking a plain CardDesign. Front → the design itself.
export const faceDesign = (d: CardDesign, side: CardSide): CardDesign => {
  if (side === 'front') return d;
  const b = d.back ?? DEFAULT_BACK;
  return {
    ...d,
    background: b.background,
    border: b.border,
    elements: b.elements,
    flipH: b.flipH ?? false,
    flipV: b.flipV ?? false,
    back: undefined,
  };
};

// ----- print settings -----
export type PaperSize = 'A4' | 'A3' | 'A5' | 'Letter' | 'custom';
export type PaperOrientation = 'portrait' | 'landscape';

// How the grid of cards sits inside the printable area (inside margins)
export type HAlign = 'right' | 'center' | 'left';
export type VAlign = 'top' | 'center' | 'bottom';

export const H_ALIGN_LABELS: Record<HAlign, string> = {
  right: 'يمين',
  center: 'وسط',
  left: 'يسار',
};
export const V_ALIGN_LABELS: Record<VAlign, string> = {
  top: 'أعلى',
  center: 'وسط',
  bottom: 'أسفل',
};

// ----- back-side printing -----
// none      → front only (even when the design has a back)
// separate  → a page of fronts followed by a page of backs (duplex printing)
// beside    → back printed next to the front (same page, one row)
// below     → back printed under the front (same page, one column)
export type BackPrintMode = 'none' | 'separate' | 'beside' | 'below';
export const BACK_MODE_LABELS: Record<BackPrintMode, string> = {
  none: 'بدون ظهر',
  separate: 'صفحة منفصلة (وجه ثم ظهر)',
  beside: 'بجانب الوجه',
  below: 'أسفل الوجه',
};

// How the back page is mirrored so it lands behind its front after the
// paper is turned over: horizontal = the printer flips on the long edge
// (usual for portrait), vertical = flip on the short edge.
export type DuplexMirror = 'none' | 'horizontal' | 'vertical';
export const DUPLEX_MIRROR_LABELS: Record<DuplexMirror, string> = {
  horizontal: 'أفقي (قلب على الحافة الطويلة)',
  vertical: 'رأسي (قلب على الحافة القصيرة)',
  none: 'بدون انعكاس',
};

export interface CardPrintSettings {
  version: 1;
  paper: PaperSize;
  // ----- back side (see BackPrintMode) — optional so old rows / profiles load -----
  backMode?: BackPrintMode;
  duplexMirror?: DuplexMirror; // separate mode only
  backGap?: number; // mm between front and back (beside / below)
  // mirror the WHOLE printed page (preview + print)
  flipPageH?: boolean;
  flipPageV?: boolean;
  // page center guide lines (previewed AND printed)
  centerLineV: boolean; // vertical center line of the page
  centerLineH: boolean; // horizontal center line of the page
  customWidth: number; // mm (paper = custom)
  customHeight: number; // mm
  orientation: PaperOrientation;
  marginTop: number; // mm
  marginBottom: number;
  marginRight: number;
  marginLeft: number;
  gapX: number; // horizontal space between cards (mm)
  gapY: number; // vertical space between cards (mm)
  cutMarks: boolean;
  alignH: HAlign; // grid horizontal alignment inside printable area
  alignV: VAlign; // grid vertical alignment inside printable area
}

// ----- print profile (ملف طباعة محفوظ) — migration 0049 -----
// A NAMED, reusable set of print settings (paper · margins · gaps · alignment
// · cut marks · center lines). Saved once, applied to any template / to the
// bound print page. Scoped church → service → class like the templates
// (church_id NULL = shared with everyone who can see the module).
export interface CardPrintProfile {
  id: string;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  name: string;
  settings: CardPrintSettings;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// ----- DB row -----
export interface CardTemplate {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  name: string;
  design: CardDesign;
  print_settings: CardPrintSettings;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// ---------- labels ----------
export const VARIABLE_FIELDS: { value: CardVariableField; label: string }[] = [
  { value: 'name', label: 'الاسم' },
  { value: 'age', label: 'السن' },
  { value: 'birthdate', label: 'تاريخ الميلاد' },
  { value: 'phone', label: 'الهاتف' },
  { value: 'national_id', label: 'الرقم القومي' },
  { value: 'address', label: 'العنوان' },
];

// Extra variables offered by the BIRTHDAY card designer (in addition to the
// list above). Kept separate so the ID-card designer stays unchanged.
export const BIRTHDAY_VARIABLE_FIELDS: { value: CardVariableField; label: string }[] = [
  { value: 'first_name', label: 'الاسم الأول' },
  { value: 'turns_age', label: 'السن الجديدة (يتمّ … سنة)' },
  { value: 'birthday_date', label: 'يوم وشهر العيد' },
  { value: 'birthday_day', label: 'يوم العيد (رقم)' },
  { value: 'birthday_month', label: 'شهر العيد' },
  { value: 'birthday_year', label: 'سنة العيد' },
  { value: 'gift_points', label: 'نقاط الهدية' },
];

export const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export const CONSTANT_FIELDS: { value: CardConstantField; label: string }[] = [
  { value: 'church_name', label: 'اسم الكنيسة' },
  { value: 'service_name', label: 'اسم الخدمة' },
  { value: 'class_name', label: 'اسم الفصل' },
];

export const ELEMENT_TYPE_LABELS: Record<CardElementType, string> = {
  variable: 'بيان متغير',
  photo: 'صورة المخدوم',
  qr: 'رمز QR',
  constant: 'بيان ثابت',
  text: 'نص ثابت',
  logo: 'شعار الكنيسة',
  service_logo: 'شعار الخدمة',
  class_logo: 'شعار الفصل',
  image: 'صورة / شعار مرفوع',
};

export const IMAGE_FIT_LABELS: Record<ImageFit, string> = {
  cover: 'قص (يملأ)',
  contain: 'احتواء (زووم للداخل)',
  stretch: 'تمديد',
  tile: 'تكرار',
};

export const FONT_FAMILIES: { value: string; label: string }[] = [
  { value: 'Cairo', label: 'Cairo — القاهرة' },
  { value: 'Amiri', label: 'Amiri — أميري' },
  { value: 'Tajawal', label: 'Tajawal — تجوّل' },
  { value: 'El Messiri', label: 'El Messiri — المسيري' },
  { value: 'Reem Kufi', label: 'Reem Kufi — ريم كوفي' },
  { value: 'Noto Naskh Arabic', label: 'Noto Naskh — نسخ' },
  { value: 'Lateef', label: 'Lateef — لطيف' },
  { value: 'Changa', label: 'Changa — تشانجا' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Times New Roman', label: 'Times New Roman' },
];

// Google-font families (need a <link> to load)
export const GOOGLE_FONTS = [
  'Cairo', 'Amiri', 'Tajawal', 'El Messiri', 'Reem Kufi', 'Noto Naskh Arabic', 'Lateef', 'Changa',
];

export const PAPER_SIZES: Record<Exclude<PaperSize, 'custom'>, { w: number; h: number; label: string }> = {
  A4: { w: 210, h: 297, label: 'A4 — ‏210×297 مم' },
  A3: { w: 297, h: 420, label: 'A3 — ‏297×420 مم' },
  A5: { w: 148, h: 210, label: 'A5 — ‏148×210 مم' },
  Letter: { w: 216, h: 279, label: 'Letter — ‏216×279 مم' },
};

// ---------- defaults ----------
export const DEFAULT_TEXT_STYLE: CardTextStyle = {
  fontFamily: 'Cairo',
  fontSize: 12,
  color: '#1e293b',
  bold: true,
  italic: false,
  align: 'center',
};

export const newElement = (type: CardElementType, partial?: Partial<CardElement>): CardElement => ({
  id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  type,
  x: 5,
  y: 5,
  w: type === 'qr' || isImageElement(type) ? 20 : 50,
  h: type === 'qr' || isImageElement(type) ? 20 : 10,
  rotation: 0,
  style: { ...DEFAULT_TEXT_STYLE },
  imageFit: 'cover',
  borderRadius: type === 'qr' ? 0 : 2,
  opacity: 1,
  bgEnabled: false,
  bgColor: '#ffffff',
  bgOpacity: 1,
  strokeEnabled: false,
  strokeColor: '#1e3a8a',
  strokeWidth: 0.3,
  lockAspect: type === 'qr',
  qr: type === 'qr' ? { ...DEFAULT_QR_SETTINGS, frame: { ...DEFAULT_QR_SETTINGS.frame } } : undefined,
  ...partial,
});

// Empty, disabled back — every design gets one through normalizeDesign
export const DEFAULT_BACK: CardBack = {
  enabled: false,
  background: {
    color: '#ffffff', imageUrl: null, imageFit: 'cover', imageOpacity: 1,
    zoom: 1, offsetX: 0, offsetY: 0,
  },
  border: { enabled: true, color: '#1e3a8a', width: 0.5 },
  elements: [],
  flipH: false,
  flipV: false,
};

// A ready-made back for a new template (church name + free text + QR)
export const sampleBack = (width: number, height: number): CardBack => ({
  ...DEFAULT_BACK,
  enabled: true,
  elements: [
    newElement('constant', {
      field: 'church_name', x: 4, y: 4, w: width - 8, h: 8,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 10, color: '#1e3a8a' },
    }),
    newElement('text', {
      text: 'هذا الكارت ملك للكنيسة — في حالة العثور عليه يُرجى تسليمه', x: 4, y: 14, w: width - 8, h: 10,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 7, bold: false, color: '#64748b' },
    }),
    newElement('qr', { x: width / 2 - 8, y: Math.max(26, height - 22), w: 16, h: 16, borderRadius: 0 }),
  ],
});

// Standard CR80 ID-card size (like a credit card)
export const DEFAULT_DESIGN: CardDesign = {
  version: 1,
  width: 85.6,
  height: 54,
  cornerRadius: 3,
  background: {
    color: '#ffffff', imageUrl: null, imageFit: 'cover', imageOpacity: 1,
    zoom: 1, offsetX: 0, offsetY: 0,
  },
  border: { enabled: true, color: '#1e3a8a', width: 0.5 },
  flipH: false,
  flipV: false,
  back: DEFAULT_BACK,
  elements: [
    newElement('logo', { x: 3, y: 3, w: 12, h: 12, borderRadius: 6 }),
    newElement('constant', {
      field: 'church_name', x: 17, y: 3, w: 52, h: 7,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 10, color: '#1e3a8a' },
    }),
    newElement('constant', {
      field: 'service_name', x: 17, y: 10, w: 52, h: 5,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 7, bold: false, color: '#64748b' },
    }),
    newElement('photo', { x: 62, y: 17, w: 20, h: 24, borderRadius: 2 }),
    newElement('variable', {
      field: 'name', x: 4, y: 19, w: 55, h: 8,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 13, align: 'right' },
    }),
    newElement('variable', {
      field: 'phone', label: 'الهاتف:', x: 4, y: 28, w: 55, h: 6,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 8, bold: false, align: 'right' },
    }),
    newElement('constant', {
      field: 'class_name', label: 'الفصل:', x: 4, y: 34, w: 55, h: 6,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 8, bold: false, align: 'right' },
    }),
    newElement('qr', { x: 3, y: 41, w: 11, h: 11, borderRadius: 0 }),
  ],
};

// Birthday greeting card — A6 landscape (148×105 mm), festive default.
export const DEFAULT_BIRTHDAY_DESIGN: CardDesign = {
  version: 1,
  width: 148,
  height: 105,
  cornerRadius: 4,
  background: {
    color: '#fff1f7', imageUrl: null, imageFit: 'cover', imageOpacity: 1,
    zoom: 1, offsetX: 0, offsetY: 0,
  },
  border: { enabled: true, color: '#db2777', width: 0.8 },
  flipH: false,
  flipV: false,
  back: DEFAULT_BACK,
  elements: [
    newElement('logo', { x: 4, y: 4, w: 16, h: 16, borderRadius: 8 }),
    newElement('constant', {
      field: 'church_name', x: 22, y: 5, w: 90, h: 7,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 10, color: '#9d174d', align: 'right' },
    }),
    newElement('constant', {
      field: 'class_name', label: 'أسرة', x: 22, y: 12, w: 90, h: 6,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 8, bold: false, color: '#be185d', align: 'right' },
    }),
    newElement('text', {
      text: '🎂 كل سنة وأنت طيب 🎉', x: 10, y: 24, w: 128, h: 14,
      style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'El Messiri', fontSize: 24, color: '#db2777' },
    }),
    newElement('photo', { x: 108, y: 42, w: 32, h: 40, borderRadius: 16, strokeEnabled: true, strokeColor: '#f472b6', strokeWidth: 0.8 }),
    newElement('variable', {
      field: 'name', x: 8, y: 44, w: 96, h: 12,
      style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Cairo', fontSize: 18, color: '#1e293b', align: 'center' },
    }),
    newElement('variable', {
      field: 'turns_age', label: 'أتممت', x: 8, y: 58, w: 96, h: 9,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 12, bold: false, color: '#475569', align: 'center' },
    }),
    newElement('variable', {
      field: 'birthday_date', x: 8, y: 67, w: 96, h: 8,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 11, color: '#9d174d', align: 'center' },
    }),
    newElement('text', {
      text: 'ربنا يفرّح قلبك ويكمّل سنينك بالخير والبركة ✨', x: 8, y: 84, w: 132, h: 9,
      style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Amiri', fontSize: 12, bold: false, color: '#475569' },
    }),
    newElement('constant', {
      field: 'service_name', x: 8, y: 95, w: 132, h: 6,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 8, bold: false, color: '#94a3b8' },
    }),
  ],
};

export const DEFAULT_PRINT_SETTINGS: CardPrintSettings = {
  version: 1,
  paper: 'A4',
  centerLineV: false,
  centerLineH: false,
  customWidth: 210,
  customHeight: 297,
  orientation: 'portrait',
  marginTop: 10,
  marginBottom: 10,
  marginRight: 10,
  marginLeft: 10,
  gapX: 4,
  gapY: 4,
  cutMarks: false,
  alignH: 'center',
  alignV: 'top',
  backMode: 'separate',
  duplexMirror: 'horizontal',
  backGap: 4,
  flipPageH: false,
  flipPageV: false,
};

// QR settings of a stored element. Elements saved before the QR look existed
// carry no `qr` — derive it from the generic box background / stroke they
// used so far, so every stored template prints exactly as before.
export const normalizeQr = (el: Partial<CardElement>): CardQrSettings => {
  const q = el.qr;
  if (q) {
    return {
      ...DEFAULT_QR_SETTINGS,
      ...q,
      frame: { ...DEFAULT_QR_SETTINGS.frame, ...(q.frame ?? {}) },
    };
  }
  return {
    ...DEFAULT_QR_SETTINGS,
    bgColor: el.bgEnabled ? (el.bgColor ?? '#ffffff') : '#ffffff',
    frame: {
      ...DEFAULT_QR_SETTINGS.frame,
      enabled: !!el.strokeEnabled,
      preset: 'custom',
      color: el.strokeColor ?? '#1e3a8a',
      width: el.strokeWidth ?? 0.3,
      metallic: false,
    },
  };
};

const normalizeElements = (els: CardElement[] | undefined, fallback: CardElement[]): CardElement[] =>
  (els ?? fallback).map((el) => ({
    ...newElement(el.type ?? 'text'),
    ...el,
    style: { ...DEFAULT_TEXT_STYLE, ...(el.style ?? {}) },
    qr: (el.type ?? 'text') === 'qr' ? normalizeQr(el) : undefined,
  }));

export const normalizeBack = (b: Partial<CardBack> | null | undefined): CardBack => ({
  ...DEFAULT_BACK,
  ...b,
  enabled: !!b?.enabled,
  background: { ...DEFAULT_BACK.background, ...(b?.background ?? {}) },
  border: { ...DEFAULT_BACK.border, ...(b?.border ?? {}) },
  elements: normalizeElements(b?.elements, []),
  flipH: !!b?.flipH,
  flipV: !!b?.flipV,
});

// merge stored JSON (may be partial / old) over defaults
export const normalizeDesign = (d: Partial<CardDesign> | null | undefined): CardDesign => ({
  ...DEFAULT_DESIGN,
  ...d,
  background: { ...DEFAULT_DESIGN.background, ...(d?.background ?? {}) },
  border: { ...DEFAULT_DESIGN.border, ...(d?.border ?? {}) },
  elements: normalizeElements(d?.elements, DEFAULT_DESIGN.elements),
  flipH: !!d?.flipH,
  flipV: !!d?.flipV,
  back: normalizeBack(d?.back),
});

export const normalizePrint = (p: Partial<CardPrintSettings> | null | undefined): CardPrintSettings => ({
  ...DEFAULT_PRINT_SETTINGS,
  ...p,
});

// Do two print settings describe the same page layout? (used to show which
// saved profile is currently «active» and whether it has unsaved changes)
export const printSettingsEqual = (a: CardPrintSettings, b: CardPrintSettings): boolean => {
  const na = normalizePrint(a);
  const nb = normalizePrint(b);
  return (Object.keys(DEFAULT_PRINT_SETTINGS) as (keyof CardPrintSettings)[])
    .every((k) => na[k] === nb[k]);
};

// short human summary of a print profile: «A4 طولي · 2×5 · هوامش 10»
export const describePrintSettings = (s: CardPrintSettings, card?: { width: number; height: number }): string => {
  const paper = s.paper === 'custom' ? `${s.customWidth}×${s.customHeight} مم` : s.paper;
  const orient = s.orientation === 'landscape' ? 'عرضي' : 'طولي';
  const parts = [`${paper} ${orient}`];
  if (card) {
    const dims = paperDims(s);
    const usableW = dims.w - s.marginRight - s.marginLeft;
    const usableH = dims.h - s.marginTop - s.marginBottom;
    const cols = Math.max(0, Math.floor((usableW + s.gapX) / (card.width + s.gapX)));
    const rows = Math.max(0, Math.floor((usableH + s.gapY) / (card.height + s.gapY)));
    parts.push(`${cols}×${rows}`);
  }
  const m = [s.marginTop, s.marginBottom, s.marginRight, s.marginLeft];
  parts.push(m.every((v) => v === m[0]) ? `هوامش ${m[0]}` : `هوامش ${m.join('/')}`);
  if (s.gapX || s.gapY) parts.push(`فراغ ${s.gapX}×${s.gapY}`);
  if (s.cutMarks) parts.push('قص');
  if (s.centerLineV || s.centerLineH) parts.push('منتصف');
  const bm = s.backMode ?? 'separate';
  if (bm === 'separate') parts.push('ظهر منفصل');
  else if (bm === 'beside') parts.push('ظهر بجانب');
  else if (bm === 'below') parts.push('ظهر أسفل');
  if (s.flipPageH || s.flipPageV) parts.push('قلب صفحة');
  return parts.join(' · ');
};

// paper size in mm honoring orientation
export const paperDims = (s: CardPrintSettings): { w: number; h: number } => {
  const base = s.paper === 'custom'
    ? { w: s.customWidth, h: s.customHeight }
    : { w: PAPER_SIZES[s.paper].w, h: PAPER_SIZES[s.paper].h };
  return s.orientation === 'landscape' ? { w: base.h, h: base.w } : base;
};

// age in years from birthdate string
export const ageFromBirthdate = (birthdate: string | null): string => {
  if (!birthdate) return '—';
  const b = new Date(birthdate);
  if (isNaN(b.getTime())) return '—';
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return String(age);
};
