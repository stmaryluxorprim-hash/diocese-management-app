/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      // PWAs installed before the branding change keep re-checking the manifest
      // at the URL they were installed with — send them to the branded one so
      // Chrome/Android eventually refresh the home-screen icon and name.
      { source: '/manifest.json', destination: '/branding/manifest', permanent: false },
      { source: '/manifest.webmanifest', destination: '/branding/manifest', permanent: false },
      { source: '/offline.html', destination: '/offline', permanent: false },
      // 20261002120000 — the store module is organised per shop now
      // (/store/[shop]/pos …); the old flat pages go to the shops list.
      { source: '/store/shops', destination: '/store', permanent: false },
      { source: '/store/pos', destination: '/store', permanent: false },
      { source: '/store/inventory', destination: '/store', permanent: false },
      { source: '/store/requests', destination: '/store', permanent: false },
      { source: '/store/archive', destination: '/store', permanent: false },
    ];
  },
  images: {
    // Serve photos straight from Supabase Storage instead of routing them
    // through Vercel's /_next/image optimizer:
    //  • every child photo is a distinct "source image" — the Hobby plan
    //    quota (1000/month) is exhausted quickly and the optimizer then
    //    answers with errors, so pictures vanished (first noticed on phones,
    //    where nothing was cached);
    //  • the app already uploads compressed 512px WebP (PhotoCropModal /
    //    compressImage), so there is nothing left to optimize.
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: '**.supabase.in' },
    ],
  },
};

export default nextConfig;
