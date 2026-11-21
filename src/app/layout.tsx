import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { AppDateProvider } from '@/lib/app-date-context';
import { ModulesProvider } from '@/lib/modules-context';
import { PermissionsProvider } from '@/lib/permissions-context';
import { CustomizationProvider } from '@/lib/customization-context';
import PwaRegister from '@/components/PwaRegister';
import { BRANDING, appIcon, manifestUrl } from '@/lib/branding';

// Name / description / icons come from the branding environment variables
// (Vercel → Settings → Environment Variables), see src/lib/branding.ts.
export const metadata: Metadata = {
  title: BRANDING.dioceseName,
  applicationName: BRANDING.appName,
  description: BRANDING.description,
  icons: {
    icon: BRANDING.appIconUrl
      ? [
          { url: appIcon(96), sizes: '96x96', type: 'image/png' },
          { url: appIcon(192), sizes: '192x192', type: 'image/png' },
        ]
      : [
          { url: '/favicon.ico', sizes: 'any' },
          { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
          { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
        ],
    apple: appIcon(180),
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: BRANDING.shortName,
  },
  // Chrome deprecated `apple-mobile-web-app-capable` alone — the standard tag
  // must be present too (Next emits the apple one from `appleWebApp`).
  other: { 'mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
  themeColor: BRANDING.themeColor,
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Rendered by hand: `metadata.manifest` drops the ?v= cache-buster. */}
        <link rel="manifest" href={manifestUrl()} />
        {/* Runtime Supabase URL/anon key (SUPABASE_URL / SUPABASE_ANON_KEY) —
            a blocking classic script on purpose: it must run before hydration. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/api/runtime-config" />
        <link rel="apple-touch-icon" href={appIcon(180)} />
      </head>
      <body className="font-arabic bg-gradient-to-b from-slate-50 to-indigo-50/40 min-h-screen text-slate-800 antialiased">
        <AuthProvider>
          <ModulesProvider>
            <PermissionsProvider>
              <CustomizationProvider>
                <AppDateProvider>{children}</AppDateProvider>
              </CustomizationProvider>
            </PermissionsProvider>
          </ModulesProvider>
        </AuthProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
