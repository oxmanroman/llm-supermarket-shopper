'use client';

import { useState } from 'react';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import SettingsIcon from '@mui/icons-material/Settings';
import { AppBar, Badge, IconButton, Toolbar, Typography } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { PreferencesDialog } from '~/containers/PreferencesDialog';
import { usePreferences } from '~/hooks/usePreferences';

export const Navbar = () => {
  const { mode, setMode } = useColorScheme();
  const { prefs, setPrefs } = usePreferences();
  const [prefsOpen, setPrefsOpen] = useState(false);

  const toggleTheme = () => setMode(mode === 'dark' ? 'light' : 'dark');

  return (
    <>
      <AppBar position='static' color='default' elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar>
          <Typography variant='h6' sx={{ flexGrow: 1 }}>
            Plan de compras
          </Typography>
          <IconButton
            onClick={() => setPrefsOpen(true)}
            data-testid='open-preferences-button'
            aria-label='Open preferences'
          >
            <Badge color='primary' variant='dot' invisible={prefs.length === 0}>
              <SettingsIcon />
            </Badge>
          </IconButton>
          <IconButton onClick={toggleTheme} aria-label='Toggle theme'>
            {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
          </IconButton>
        </Toolbar>
      </AppBar>
      <PreferencesDialog open={prefsOpen} initialValue={prefs} onSave={setPrefs} onClose={() => setPrefsOpen(false)} />
    </>
  );
};
