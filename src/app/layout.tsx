import type { Metadata } from 'next';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { Providers } from '~/providers';
import { LayoutContent } from './layout-content';

export const metadata: Metadata = {
  title: 'Supermarket',
  description: 'Recipe-to-cart helper for Argentine supermarkets.',
  robots: 'noindex',
  icons: { icon: '/favicon.ico' },
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
