import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SessionProvider } from '@/context/session';

export const metadata: Metadata = {
  title: 'Mr Center Web',
  description: 'لوحة ويب عربية لإدارة السناتر التعليمية مرتبطة بنفس قاعدة Supabase الخاصة بتطبيق Mr Center.',
  applicationName: 'Mr Center Web',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#060A12',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
