// /branding/{icon|logo}/{96|180|192|512} — the app icon / diocese logo,
// resized on the server from the URL given in the environment
// (NEXT_PUBLIC_APP_ICON_URL / NEXT_PUBLIC_DIOCESE_LOGO_URL). The whole PWA
// (manifest, favicon, apple-touch-icon, login pages, push notifications)
// points here, so changing the Vercel variable re-brands every surface.
//
// When nothing is configured — or the remote image cannot be fetched — the
// request is redirected to the bundled icon in /public/icons so the app never
// shows a broken image.
//
// Cloudflare Workers: `sharp` is a native Node addon and cannot run in the
// Workers runtime (OpenNext strips it from the bundle). It is therefore
// loaded lazily; when it is unavailable the request is redirected to the
// configured source image as-is (browsers scale PWA icons themselves), so
// the branding still works on both Vercel (resized PNG) and Cloudflare.
import { NextResponse, type NextRequest } from 'next/server';
import { BRANDING, ICON_SIZES, bundledIcon, type IconSize } from '@/lib/branding';

type SharpModule = typeof import('sharp');
let sharpPromise: Promise<SharpModule | null> | undefined;
const loadSharp = (): Promise<SharpModule | null> => {
  if (!sharpPromise) {
    // Indirect specifier keeps webpack/esbuild from failing the build when the
    // package is absent; on Vercel/Node it resolves to the real module.
    const name = 'sharp';
    sharpPromise = import(/* webpackIgnore: true */ name)
      .then((m: { default?: SharpModule } & SharpModule) => (m.default ?? m) as SharpModule)
      .catch(() => null);
  }
  return sharpPromise;
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// URLs carry `?v=<branding hash>` (see src/lib/branding.ts), so a rendered
// icon can be cached for long: a branding change produces a new URL anyway.
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
};

type Params = { params: { kind: string; size: string } };

const sourceFor = (kind: string): string | null => {
  if (kind === 'icon') return BRANDING.appIconUrl || null;
  if (kind === 'logo') return BRANDING.dioceseLogoUrl || BRANDING.appIconUrl || null;
  return null;
};

const fallback = (req: NextRequest, size: IconSize) =>
  // Never cache the fallback redirect: once NEXT_PUBLIC_APP_ICON_URL is set
  // and the site redeployed, the very next request must reach the new icon.
  NextResponse.redirect(new URL(bundledIcon(size), req.nextUrl.origin), {
    status: 307,
    headers: { 'Cache-Control': 'no-store' },
  });

export async function GET(req: NextRequest, { params }: Params) {
  if (params.kind !== 'icon' && params.kind !== 'logo') {
    return NextResponse.json({ error: 'unknown kind' }, { status: 404 });
  }
  const size = Number(params.size) as IconSize;
  if (!ICON_SIZES.includes(size)) {
    return NextResponse.json({ error: 'unsupported size', sizes: ICON_SIZES }, { status: 404 });
  }

  const src = sourceFor(params.kind);
  if (!src) return fallback(req, size);

  const sharp = await loadSharp();
  if (!sharp) {
    // No native image library in this runtime (Cloudflare Workers): hand the
    // original image to the browser. Cached like the rendered variant — the
    // URL carries the branding hash so a change still busts every cache.
    // EGRESS: a redirect makes every browser download the original from
    // Supabase Storage (counted as «Cached Egress» on every cache hit). Proxy
    // it through this Worker instead and keep it in Cloudflare's own cache, so
    // Supabase is hit about once per edge location per branding change.
    // Any failure falls back to the old redirect.
    try {
      const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
      const cacheKey = new Request(req.nextUrl.toString(), { method: 'GET' });
      const hit = await cache?.match(cacheKey);
      if (hit) return hit;
      const up = await fetch(src, { signal: AbortSignal.timeout(8000) });
      const type = up.headers.get('content-type') || '';
      if (up.ok && type.startsWith('image/')) {
        const body = await up.arrayBuffer();
        // Skip proxying very large originals (Worker memory) — redirect instead.
        if (body.byteLength <= 2_000_000) {
          const res = new Response(body, {
            status: 200,
            headers: { 'Content-Type': type, 'Content-Length': String(body.byteLength), ...CACHE_HEADERS },
          });
          if (cache) await cache.put(cacheKey, res.clone());
          return res;
        }
      }
    } catch {
      /* fall through to the redirect */
    }
    return NextResponse.redirect(src, { status: 307, headers: CACHE_HEADERS });
  }

  try {
    const res = await fetch(src, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const input = Buffer.from(await res.arrayBuffer());

    // Square, cover-cropped, flattened on the splash background so maskable
    // icons have no transparent corners; PNG keeps it universally supported.
    const png = await sharp(input, { density: 300 })
      .rotate()
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .flatten({ background: BRANDING.backgroundColor })
      .png({ compressionLevel: 9 })
      .toBuffer();

    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.length), ...CACHE_HEADERS },
    });
  } catch {
    return fallback(req, size);
  }
}
