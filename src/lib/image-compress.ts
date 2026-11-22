// Client-side image compression used by every upload (see uploadPhoto()).
//
// WHY: the Supabase «Cached Egress» meter counts the bytes the CDN serves. The
// `photos` bucket held raw phone photos (up to 4 MB) that the UI shows in
// 48-160 px circles: 29 files > 300 KB were 91 % of the bucket. Compressing at
// the single upload choke-point shrinks every future photo (~4 MB → ~60 KB).
//
// Pure helpers (planResize / shouldCompress / maxDimFor) are exported
// separately so they can be unit-tested without a browser.

/** Longest side (px) allowed per `photos` sub-folder. */
const MAX_DIM_BY_FOLDER: Record<string, number> = {
  // avatars — rendered at ≤ 160 px (2× retina = 320). 640 keeps the QR/ID-card print sharp.
  servants: 640,
  persons: 640,
  'child-requests': 640,
  priests: 640,
  // catalogue style images
  store: 800,
  classes: 800,
  services: 800,
  // content images viewed full-width on a phone
  messages: 1280,
  'child-messages': 1280,
  notifications: 1280,
  occasions: 1280,
  achievements: 1280,
  exams: 1280,
  // printed card / report backgrounds need more pixels
  cards: 1600,
};

export const DEFAULT_MAX_DIM = 1280;

export function maxDimFor(folder: string): number {
  return MAX_DIM_BY_FOLDER[folder] ?? DEFAULT_MAX_DIM;
}

/** Files at or below this size are uploaded untouched (already small). */
export const SKIP_BELOW_BYTES = 80 * 1024;

/** Mime types the canvas can decode and that are worth re-encoding. */
const COMPRESSIBLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export function shouldCompress(type: string, size: number): boolean {
  if (!COMPRESSIBLE.has((type || '').toLowerCase())) return false; // gif / svg / heic / unknown → untouched
  return size > SKIP_BELOW_BYTES;
}

/** Target dimensions: never upscales, keeps the aspect ratio. */
export function planResize(
  width: number,
  height: number,
  maxDim: number
): { width: number; height: number; scaled: boolean } {
  const longest = Math.max(width, height);
  if (!(longest > 0)) return { width: 1, height: 1, scaled: false };
  const scale = Math.min(1, maxDim / longest);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: scale < 1,
  };
}

/** Byte budget after which we stop lowering quality. */
export function targetBytesFor(maxDim: number): number {
  if (maxDim <= 640) return 90 * 1024;
  if (maxDim <= 800) return 130 * 1024;
  if (maxDim <= 1280) return 220 * 1024;
  return 380 * 1024;
}

const QUALITIES = [0.82, 0.72, 0.62, 0.5, 0.4];

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' applies the EXIF rotation (phone photos)
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new window.Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export interface CompressOptions {
  maxDim: number;
  /** Stop lowering quality once the result is ≤ this many bytes. */
  targetBytes?: number;
}

/**
 * Downscale + re-encode as WebP (JPEG on browsers whose canvas can't encode
 * WebP). Returns the ORIGINAL file when it is already small, not a compressible
 * type, cannot be decoded, or the re-encoded copy would not be smaller — so it
 * can never make an upload worse or fail it.
 */
export async function compressImageFile<T extends Blob>(file: T, opts: CompressOptions): Promise<T | Blob> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return file;
  if (!shouldCompress(file.type, file.size)) return file;
  const target = opts.targetBytes ?? targetBytesFor(opts.maxDim);

  let decoded: Awaited<ReturnType<typeof decode>> | null = null;
  try {
    decoded = await decode(file);
    const plan = planResize(decoded.width, decoded.height, opts.maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(decoded.source, 0, 0, plan.width, plan.height); // keeps PNG transparency in WebP

    let best: Blob | null = null;
    for (const q of QUALITIES) {
      let blob = await toBlob(canvas, 'image/webp', q);
      if (blob && blob.type !== 'image/webp') {
        // Browser silently fell back to PNG (old Safari) → JPEG on a white background.
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        blob = await toBlob(canvas, 'image/jpeg', q);
      }
      if (!blob) continue;
      best = blob;
      if (blob.size <= target) break;
    }
    if (!best || best.size >= file.size) return file;
    return best;
  } catch {
    return file;
  } finally {
    decoded?.close();
  }
}

/** File extension (no dot) matching a blob's mime type. */
export function extensionFor(type: string): string {
  switch ((type || '').toLowerCase()) {
    case 'image/webp': return 'webp';
    case 'image/jpeg':
    case 'image/jpg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/gif': return 'gif';
    case 'image/svg+xml': return 'svg';
    default: return '';
  }
}
