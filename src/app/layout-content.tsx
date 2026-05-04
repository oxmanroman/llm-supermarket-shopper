'use client';

import { CssBaseline, styled } from '@mui/material';

export function LayoutContent({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CssBaseline />
      <MainContent>{children}</MainContent>
    </>
  );
}

const MainContent = styled('div')`
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 100vh;
`;
