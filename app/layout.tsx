import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SessionProvider } from '@/context/session';
import { CookieConsent } from '@/components/cookie-consent';
import { VisitorTracker } from '@/components/visitor-tracker';
import { ToastProvider } from '@/components/toast';

const themeInit = `(function(){try{var s=localStorage.getItem('mrcenter.theme');var m=s?JSON.parse(s).mode:null;if(m!=='light'&&m!=='dark'){m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',m);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export const metadata: Metadata = {
  title: 'Mr Center',
  description: 'منصة إدارة السناتر التعليمية — ويب وموبايل بحساب واحد وبيانات مشتركة.',
  applicationName: 'Mr Center',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#171c25' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>
        <script>{themeInit}</script>
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
        <CookieConsent />
        <VisitorTracker />
      </body>
    </html>
  );
}
