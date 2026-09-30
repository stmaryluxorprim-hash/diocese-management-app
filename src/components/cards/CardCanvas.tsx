'use client';

import { useId, useMemo, type CSSProperties } from 'react';
import QRCode from 'qrcode';
import { User, Landmark } from 'lucide-react';
import type {
  CardDesign,
  CardElement,
  CardPrintSettings,
  CardSide,
  CardQrFrame,
  ImageFit,
} from '@/lib/card-types';
import {
  ageFromBirthdate, ARABIC_MONTHS, isImageElement, faceDesign, normalizeQr, qrFrameStops, qrFrameColor, qrEffectivePadding,
} from '@/lib/card-types';
import { unitDims, unitFaces } from '@/lib/card-layout';

// ---------- data fed into a card ----------
export interface CardPersonData {
  name: string;
  national_id: string;
  birthdate: string | null;
  phone: string | null;
  address: string | null;
  image_url: string | null;
  // ----- birthday-card extras (optional; derived from birthdate when absent) -----
  birthday_year?: number;      // the year the card is for (default: current year)
  gift_points?: number | null; // points gifted for this birthday
  // ----- bulk-print extras (optional) -----
  // Free-form row data: when present, every `{{key}}` inside a free-text
  // element or a label prefix is replaced by fields[key]. Absent (the normal
  // ID / birthday cards) → texts are rendered verbatim, exactly as before.
  fields?: Record<string, string>;
}

// {{ key }} → fields[key] (case-insensitive key match; unknown keys → '')
const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
export const fillPlaceholders = (text: string, fields: Record<string, string> | undefined): string => {
  if (!fields || !text || text.indexOf('{{') === -1) return text;
  const lower = new Map<string, string>();
  Object.keys(fields).forEach((k) => lower.set(k.toLowerCase(), fields[k]));
  return text.replace(PLACEHOLDER_RE, (_m, key: string) => {
    const k = key.trim();
    if (k in fields) return fields[k] ?? '';
    return lower.get(k.toLowerCase()) ?? '';
  });
};

// Arabic «N سنة» with correct plural forms
export const arabicYears = (n: number): string => {
  if (n === 1) return 'سنة واحدة';
  if (n === 2) return 'سنتين';
  if (n >= 3 && n <= 10) return `${n} سنوات`;
  return `${n} سنة`;
};

const birthParts = (birthdate: string | null): { day: number; month: number; year: number } | null => {
  if (!birthdate) return null;
  const m = birthdate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
};

export interface CardConstantsData {
  church_name: string;
  service_name: string;
  class_name: string;
  church_logo_url: string | null;
  // service / class pictures (services.photo_url / classes.photo_url) —
  // optional so older callers / RPC payloads keep working (→ placeholder)
  service_logo_url?: string | null;
  class_logo_url?: string | null;
}

// url of the image an element shows (null → placeholder)
export const elementImageUrl = (
  el: CardElement,
  person: CardPersonData,
  constants: CardConstantsData,
): string | null => {
  switch (el.type) {
    case 'photo': return person.image_url;
    case 'logo': return constants.church_logo_url;
    case 'service_logo': return constants.service_logo_url ?? null;
    case 'class_logo': return constants.class_logo_url ?? null;
    case 'image': return el.imageUrl ?? null;
    default: return null;
  }
};

export const SAMPLE_PERSON: CardPersonData = {
  name: 'مينا جرجس عبد المسيح',
  national_id: '30001011234567',
  birthdate: '2015-06-15',
  phone: '01234567890',
  address: 'الأقصر — حي الكرنك',
  image_url: null,
};

// ---------- helpers ----------
const fitToCss = (fit: ImageFit): CSSProperties =>
  fit === 'tile'
    ? { backgroundRepeat: 'repeat', backgroundSize: 'auto' }
    : {
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        backgroundSize: fit === 'cover' ? 'cover' : fit === 'contain' ? 'contain' : '100% 100%',
      };

const resolveText = (
  el: CardElement,
  person: CardPersonData,
  constants: CardConstantsData
): string => {
  let value = '';
  if (el.type === 'text') value = fillPlaceholders(el.text ?? '', person.fields);
  else if (el.type === 'constant') {
    if (el.field === 'church_name') value = constants.church_name;
    else if (el.field === 'service_name') value = constants.service_name;
    else if (el.field === 'class_name') value = constants.class_name;
  } else if (el.type === 'variable') {
    switch (el.field) {
      case 'name': value = person.name; break;
      case 'age': value = ageFromBirthdate(person.birthdate); break;
      case 'birthdate': value = person.birthdate ?? '—'; break;
      case 'phone': value = person.phone ?? '—'; break;
      case 'national_id': value = person.national_id; break;
      case 'address': value = person.address ?? '—'; break;
      // ----- birthday variables -----
      case 'first_name': value = person.name.trim().split(/\s+/)[0] ?? ''; break;
      case 'turns_age': {
        const bp = birthParts(person.birthdate);
        const y = person.birthday_year ?? new Date().getFullYear();
        value = bp ? arabicYears(y - bp.year) : '—';
        break;
      }
      case 'birthday_day': value = String(birthParts(person.birthdate)?.day ?? '—'); break;
      case 'birthday_month': {
        const bp = birthParts(person.birthdate);
        value = bp ? ARABIC_MONTHS[bp.month - 1] : '—';
        break;
      }
      case 'birthday_date': {
        const bp = birthParts(person.birthdate);
        value = bp ? `${bp.day} ${ARABIC_MONTHS[bp.month - 1]}` : '—';
        break;
      }
      case 'birthday_year': value = String(person.birthday_year ?? new Date().getFullYear()); break;
      case 'gift_points': value = person.gift_points != null ? String(person.gift_points) : '—'; break;
    }
  }
  const label = el.label ? fillPlaceholders(el.label, person.fields) : '';
  return label ? `${label} ${value}` : value;
};

// QR as an inline VECTOR (SVG path built from the module matrix). A raster
// data-url (toDataURL) rounds the module size to whole pixels and leaves an
// uneven blank strip on the right / bottom, which shows as the code sitting
// slightly off-centre inside its background / frame. The SVG viewBox is
// exactly N×N modules, so the symbol is mathematically centred (xMidYMid)
// and stays crisp at any zoom / print resolution. The light modules are
// TRANSPARENT so the element's own background (colour, expanded pad, or
// nothing at all) shows through.
function QrImage({ value, color = '#000000', className }: { value: string; color?: string; className?: string }) {
  const { size, path } = useMemo(() => {
    try {
      const qr = QRCode.create(value || '—', { errorCorrectionLevel: 'M' });
      const n = qr.modules.size;
      const parts: string[] = [];
      for (let y = 0; y < n; y++) {
        // merge horizontal runs of dark modules into one rect per run
        let x = 0;
        while (x < n) {
          if (!qr.modules.get(y, x)) { x++; continue; }
          const start = x;
          while (x < n && qr.modules.get(y, x)) x++;
          parts.push(`M${start} ${y}h${x - start}v1h${start - x}z`);
        }
      }
      return { size: n, path: parts.join('') };
    } catch {
      return { size: 0, path: '' };
    }
  }, [value]);
  if (!size) return null;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ display: 'block', width: '100%', height: '100%' }}
      shapeRendering="crispEdges"
      aria-label="QR"
      role="img"
    >
      <path d={path} fill={color} />
    </svg>
  );
}

// Rounded-rect path (clockwise) — r is clamped to half the smaller side
const roundedRectPath = (x: number, y: number, w: number, h: number, r: number): string => {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr === 0) return `M${x} ${y}h${w}v${h}h${-w}z`;
  return (
    `M${x + rr} ${y}h${w - 2 * rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}v${h - 2 * rr}a${rr} ${rr} 0 0 1 ${-rr} ${rr}` +
    `h${-(w - 2 * rr)}a${rr} ${rr} 0 0 1 ${-rr} ${-rr}v${-(h - 2 * rr)}a${rr} ${rr} 0 0 1 ${rr} ${-rr}z`
  );
};

// The QR frame: a ring between the element box and the background pad,
// metallic gradient or flat colour. Pure SVG → prints exactly like the screen
// and leaves the inside fully transparent.
function QrFrameRing({
  w, h, outerR, thickness, frame,
}: { w: number; h: number; outerR: number; thickness: number; frame: CardQrFrame }) {
  const gradId = useId().replace(/:/g, '');
  const stops = qrFrameStops(frame);
  const innerR = Math.max(0, outerR - thickness);
  const d = roundedRectPath(0, 0, w, h, outerR) + roundedRectPath(thickness, thickness, w - 2 * thickness, h - 2 * thickness, innerR);
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ position: 'absolute', inset: 0, display: 'block', pointerEvents: 'none' }}
      aria-hidden
    >
      {stops && (
        <defs>
          {/* 135° like the CSS swatch: top-left → bottom-right */}
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            {stops.map((st, i) => <stop key={i} offset={st.offset} stopColor={st.color} />)}
          </linearGradient>
        </defs>
      )}
      <path d={d} fillRule="evenodd" fill={stops ? `url(#${gradId})` : qrFrameColor(frame)} />
    </svg>
  );
}

// ---------- single element ----------
function ElementView({
  el,
  scale,
  person,
  constants,
}: {
  el: CardElement;
  scale: number;
  person: CardPersonData;
  constants: CardConstantsData;
}) {
  const base: CSSProperties = {
    position: 'absolute',
    left: el.x * scale,
    top: el.y * scale,
    width: el.w * scale,
    height: el.h * scale,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    opacity: el.opacity,
    borderRadius: el.borderRadius * scale,
    overflow: 'hidden',
    boxSizing: 'border-box',
    // per-element stroke around the box (follows the rounded corners)
    border: el.strokeEnabled
      ? `${Math.max((el.strokeWidth ?? 0.3) * scale, 0.5)}px solid ${el.strokeColor ?? '#1e3a8a'}`
      : undefined,
  };

  // per-element background layer (own opacity, independent of content)
  const bgLayer = el.bgEnabled ? (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: el.bgColor ?? '#ffffff',
        opacity: el.bgOpacity ?? 1,
        pointerEvents: 'none',
      }}
    />
  ) : null;

  if (isImageElement(el.type)) {
    const url = elementImageUrl(el, person, constants);
    const PlaceholderIcon = el.type === 'photo' ? User : Landmark;
    return (
      <div style={base}>
        {bgLayer}
        {url ? (
          <div style={{ position: 'relative', width: '100%', height: '100%', backgroundImage: `url(${url})`, ...fitToCss(el.imageFit) }} />
        ) : (
          <div className={`relative flex h-full w-full items-center justify-center text-slate-300 ${el.bgEnabled ? '' : 'bg-slate-100'}`}>
            <PlaceholderIcon style={{ width: '60%', height: '60%' }} />
          </div>
        )}
      </div>
    );
  }

  if (el.type === 'qr') {
    // layers: element box = [frame] → [background pad (rounded)] → [QR]
    const q = normalizeQr(el);
    const frameOn = q.frame.enabled && q.frame.width > 0;
    const framePx = frameOn ? Math.max(q.frame.width * scale, 0.5) : 0;
    const outerR = el.borderRadius * scale;
    const innerR = Math.max(0, outerR - framePx);
    // quiet zone: the user's padding, never below what the rounded corners
    // need so the finder patterns are not clipped (qrCornerSafePadding)
    const padPx = qrEffectivePadding(el.borderRadius, q) * scale;
    // The frame is a RING drawn as an SVG even-odd path (outer rounded rect
    // minus inner rounded rect) filled with a flat colour or an SVG linear
    // gradient. It is NOT a CSS mask: print / PDF engines ignore
    // mask-composite and would paint the whole box in the frame colour, which
    // showed up as "the transparent background became the frame colour" on
    // paper. SVG paints identically on screen and in print.
    const W = el.w * scale;
    const H = el.h * scale;
    return (
      <div
        style={{
          ...base,
          // the generic stroke is replaced by the QR frame
          border: undefined,
        }}
      >
        {frameOn && (
          <QrFrameRing w={W} h={H} outerR={outerR} thickness={framePx} frame={q.frame} />
        )}
        <div
          style={{
            position: 'absolute',
            inset: framePx,
            borderRadius: innerR,
            backgroundColor: q.bgTransparent ? 'transparent' : q.bgColor,
            overflow: 'hidden',
            boxSizing: 'border-box',
            padding: padPx,
            // centre the symbol exactly inside the pad (also for non-square boxes)
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
            <QrImage value={person.national_id} color={q.color} />
          </div>
        </div>
      </div>
    );
  }

  // text-like elements
  const s = el.style;
  return (
    <div
      style={{
        ...base,
        display: 'flex',
        alignItems: 'center',
        justifyContent: s.align === 'center' ? 'center' : s.align === 'left' ? 'flex-end' : 'flex-start',
        fontFamily: `'${s.fontFamily}', sans-serif`,
        // fontSize in pt → px: 1pt = 1/72in, screen mm scale: scale px per mm, 1in = 25.4mm
        fontSize: s.fontSize * (scale * 25.4 / 72),
        color: s.color,
        fontWeight: s.bold ? 800 : 400,
        fontStyle: s.italic ? 'italic' : 'normal',
        textAlign: s.align,
        lineHeight: 1.2,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        direction: 'rtl',
      }}
    >
      {bgLayer}
      <span style={{ position: 'relative' }}>{resolveText(el, person, constants)}</span>
    </div>
  );
}

// custom background transform → CSS (zoom relative to cover, pan in % of card)
const customBgCss = (bg: CardDesign['background']): CSSProperties => ({
  backgroundRepeat: 'no-repeat',
  backgroundSize: `${(bg.zoom ?? 1) * 100}% auto`,
  backgroundPosition: `calc(50% + ${bg.offsetX ?? 0}%) calc(50% + ${bg.offsetY ?? 0}%)`,
});

// ---------- the card ----------
interface CardCanvasProps {
  design: CardDesign;
  scale: number; // px per mm
  person?: CardPersonData;
  constants: CardConstantsData;
  className?: string;
  // designer-mode extras
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, patch: { x: number; y: number; w: number; h: number }) => void;
  showCenterLines?: boolean; // imaginary vertical + horizontal center lines
}

// 8 free-transform handles: 4 corners + 4 edge midpoints
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: { id: HandleId; cursor: string }[] = [
  { id: 'nw', cursor: 'nwse-resize' },
  { id: 'n', cursor: 'ns-resize' },
  { id: 'ne', cursor: 'nesw-resize' },
  { id: 'e', cursor: 'ew-resize' },
  { id: 'se', cursor: 'nwse-resize' },
  { id: 's', cursor: 'ns-resize' },
  { id: 'sw', cursor: 'nesw-resize' },
  { id: 'w', cursor: 'ew-resize' },
];

export default function CardCanvas({
  design,
  scale,
  person = SAMPLE_PERSON,
  constants,
  className,
  selectedId,
  onSelect,
  onMove,
  onResize,
  showCenterLines = false,
}: CardCanvasProps) {
  const interactive = !!onSelect;
  const bg = design.background;
  // whole-face mirror (design.flipH / flipV) — applied to the content layer
  // only; the selection box / handles are drawn in mirrored screen positions
  // so the designer keeps working on a flipped face.
  const flipX = !!design.flipH;
  const flipY = !!design.flipV;
  const sx = flipX ? -1 : 1; // pointer delta sign → design delta
  const sy = flipY ? -1 : 1;
  const flipTransform = flipX || flipY
    ? `${flipX ? 'scaleX(-1)' : ''} ${flipY ? 'scaleY(-1)' : ''}`.trim()
    : undefined;
  // screen (visual) left / top of an element box, honoring the mirror
  const visLeft = (el: CardElement) => (flipX ? design.width - el.x - el.w : el.x) * scale;
  const visTop = (el: CardElement) => (flipY ? design.height - el.y - el.h : el.y) * scale;

  // finer snap when zoomed in for precise placement
  const snap = (v: number) => {
    const grid = scale >= 8 ? 10 : 2; // 0.1mm zoomed / 0.5mm normal
    return Math.round(v * grid) / grid;
  };

  // drag state (designer mode)
  const startDrag = (e: React.PointerEvent, el: CardElement) => {
    if (!interactive) return;
    e.stopPropagation();
    onSelect?.(el.id);
    if (!onMove) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = el.x;
    const origY = el.y;
    const move = (ev: PointerEvent) => {
      const dx = (sx * (ev.clientX - startX)) / scale;
      const dy = (sy * (ev.clientY - startY)) / scale;
      onMove(el.id, snap(origX + dx), snap(origY + dy));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // free-transform resize from any of the 8 handles
  const startResize = (e: React.PointerEvent, el: CardElement, handle: HandleId) => {
    if (!interactive || !onResize) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect?.(el.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { x: el.x, y: el.y, w: el.w, h: el.h };
    const ratio = orig.h > 0 ? orig.w / orig.h : 1;
    const locked = !!el.lockAspect;
    const move = (ev: PointerEvent) => {
      const dx = (sx * (ev.clientX - startX)) / scale;
      const dy = (sy * (ev.clientY - startY)) / scale;
      let { x, y, w, h } = orig;
      if (handle.includes('e')) w = orig.w + dx;
      if (handle.includes('s')) h = orig.h + dy;
      if (handle.includes('w')) { x = orig.x + dx; w = orig.w - dx; }
      if (handle.includes('n')) { y = orig.y + dy; h = orig.h - dy; }
      // lock aspect ratio: derive the other dimension from the dominant drag
      if (locked) {
        const isCorner = handle.length === 2;
        const horizOnly = handle === 'e' || handle === 'w';
        const vertOnly = handle === 'n' || handle === 's';
        if (horizOnly) {
          h = w / ratio;
        } else if (vertOnly) {
          w = h * ratio;
        } else if (isCorner) {
          // follow the larger relative change
          if (Math.abs(w / orig.w - 1) >= Math.abs(h / orig.h - 1)) h = w / ratio;
          else w = h * ratio;
        }
        // re-anchor the opposite side for n/w handles after the ratio adjust
        if (handle.includes('w')) x = orig.x + orig.w - w;
        if (handle.includes('n')) y = orig.y + orig.h - h;
      }
      // enforce minimum 1mm, anchoring the opposite side
      if (w < 1) {
        if (locked) { h = Math.max(1 / ratio, 1); }
        if (handle.includes('w')) x = orig.x + orig.w - 1;
        w = 1;
      }
      if (h < 1) {
        if (locked) { w = Math.max(ratio, 1); }
        if (handle.includes('n')) y = orig.y + orig.h - 1;
        h = 1;
      }
      onResize(el.id, { x: snap(x), y: snap(y), w: snap(w), h: snap(h) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // handle position (as CSS) around the selected element's box — the
  // semantic handle ('w' = design left edge) is drawn where that edge is SEEN
  const handlePos = (el: CardElement, h: HandleId): CSSProperties => {
    const L = visLeft(el);
    const T = visTop(el);
    const W = el.w * scale;
    const H = el.h * scale;
    const west = flipX ? h.includes('e') : h.includes('w');
    const east = flipX ? h.includes('w') : h.includes('e');
    const north = flipY ? h.includes('s') : h.includes('n');
    const south = flipY ? h.includes('n') : h.includes('s');
    const cx = west ? L : east ? L + W : L + W / 2;
    const cy = north ? T : south ? T + H : T + H / 2;
    return { left: cx - 5, top: cy - 5 };
  };
  // mirror the cursor too so it matches the visual direction
  const handleCursor = (h: HandleId, cursor: string): string => {
    if (flipX === flipY) return cursor; // both or none → diagonals unchanged
    if (cursor === 'nwse-resize') return 'nesw-resize';
    if (cursor === 'nesw-resize') return 'nwse-resize';
    return cursor;
  };

  const selEl = interactive ? design.elements.find((e) => e.id === selectedId) ?? null : null;

  return (
    <div
      className={className}
      onPointerDown={() => interactive && onSelect?.(null)}
      style={{
        position: 'relative',
        width: design.width * scale,
        height: design.height * scale,
        borderRadius: design.cornerRadius * scale,
        backgroundColor: bg.color,
        border: design.border.enabled
          ? `${Math.max(design.border.width * scale, 0.5)}px solid ${design.border.color}`
          : undefined,
        overflow: 'hidden',
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* content layer — mirrored as a whole when flipH / flipV are on */}
      <div style={{ position: 'absolute', inset: 0, transform: flipTransform }}>
        {bg.imageUrl && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${bg.imageUrl})`,
              opacity: bg.imageOpacity,
              ...(bg.imageFit === 'custom' ? customBgCss(bg) : fitToCss(bg.imageFit)),
            }}
          />
        )}
        {design.elements.map((el) => (
          <div
            key={el.id}
            onPointerDown={(e) => startDrag(e, el)}
            style={interactive ? { cursor: 'move', touchAction: 'none' } : undefined}
          >
            <ElementView el={el} scale={scale} person={person} constants={constants} />
          </div>
        ))}
      </div>

      {/* selection box (screen only, drawn in visual coordinates) */}
      {selEl && (
        <div
          style={{
            position: 'absolute',
            left: visLeft(selEl) - 2,
            top: visTop(selEl) - 2,
            width: selEl.w * scale + 4,
            height: selEl.h * scale + 4,
            border: '2px dashed #6366f1',
            borderRadius: 4,
            pointerEvents: 'none',
            zIndex: 55,
          }}
        />
      )}

      {/* free-transform resize handles on the selected element (screen only) */}
      {selEl && onResize && (
        <>
          {HANDLES.map((h) => (
            <div
              key={h.id}
              onPointerDown={(e) => startResize(e, selEl, h.id)}
              style={{
                position: 'absolute',
                width: 10,
                height: 10,
                borderRadius: 3,
                background: '#fff',
                border: '2px solid #6366f1',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                cursor: handleCursor(h.id, h.cursor),
                touchAction: 'none',
                zIndex: 60,
                ...handlePos(selEl, h.id),
              }}
            />
          ))}
        </>
      )}

      {/* imaginary center lines (screen only — never printed) */}
      {showCenterLines && (
        <>
          <div
            style={{
              position: 'absolute',
              left: (design.width / 2) * scale,
              top: 0,
              bottom: 0,
              width: 0,
              borderLeft: '1px dashed rgba(236, 72, 153, 0.65)',
              pointerEvents: 'none',
              zIndex: 50,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: (design.height / 2) * scale,
              left: 0,
              right: 0,
              height: 0,
              borderTop: '1px dashed rgba(236, 72, 153, 0.65)',
              pointerEvents: 'none',
              zIndex: 50,
            }}
          />
        </>
      )}
    </div>
  );
}

// ============================================================
// CardUnit — everything printed for ONE person in ONE grid cell:
// the front alone, or front + back side by side / one under the other
// (settings.backMode 'beside' / 'below'). Faces are positioned by the
// shared layout helpers so previews and the mm-exact print sheet agree.
// `side` forces a single face (used for the separate back page).
// ============================================================
export function CardUnit({
  design, settings, scale, person, constants, side, cutMarks,
}: {
  design: CardDesign;
  settings: CardPrintSettings;
  scale: number; // px per mm
  person?: CardPersonData;
  constants: CardConstantsData;
  side?: CardSide; // force one face
  cutMarks?: boolean; // thin outline around each face
}) {
  const dims = unitDims(design, settings);
  const faces = side ? [{ side, dx: 0, dy: 0 }] : unitFaces(design, settings);
  const w = side ? design.width : dims.w;
  const h = side ? design.height : dims.h;
  return (
    <div style={{ position: 'relative', width: w * scale, height: h * scale, flexShrink: 0 }}>
      {faces.map((f) => (
        <div
          key={f.side}
          style={{
            position: 'absolute',
            left: f.dx * scale,
            top: f.dy * scale,
            outline: cutMarks ? `${Math.max(0.2 * scale, 0.5)}px solid #cbd5e1` : undefined,
          }}
        >
          <CardCanvas design={faceDesign(design, f.side)} scale={scale} person={person} constants={constants} />
        </div>
      ))}
    </div>
  );
}

// dashed placeholder for an empty cell (same footprint as CardUnit)
export function CardUnitPlaceholder({
  design, settings, scale, side,
}: {
  design: CardDesign; settings: CardPrintSettings; scale: number; side?: CardSide;
}) {
  const dims = unitDims(design, settings);
  const faces = side ? [{ side, dx: 0, dy: 0 }] : unitFaces(design, settings);
  const w = side ? design.width : dims.w;
  const h = side ? design.height : dims.h;
  return (
    <div style={{ position: 'relative', width: w * scale, height: h * scale }}>
      {faces.map((f) => (
        <div
          key={f.side}
          className="absolute border border-dashed border-slate-200 bg-slate-50/60"
          style={{
            left: f.dx * scale,
            top: f.dy * scale,
            width: design.width * scale,
            height: design.height * scale,
            borderRadius: design.cornerRadius * scale,
          }}
        />
      ))}
    </div>
  );
}
