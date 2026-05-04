import type { Metadata } from 'next';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { Providers } from '~/providers';
import { LayoutContent } from './layout-content';

export const metadata: Metadata = {
  title: 'Next.js Boilerplate',
  description: 'Next.js Boilerplate.',
  robots: 'noindex',
  icons: {
    icon: '/favicon.ico',
  },
  openGraph: {
    title: 'Next.js Boilerplate',
    description: 'Next.js Boilerplate.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Next.js Boilerplate',
    description: 'Next.js Boilerplate.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <body>
        <AppRouterCacheProvider>
          <Providers>
            <LayoutContent>{children}</LayoutContent>
          </Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
