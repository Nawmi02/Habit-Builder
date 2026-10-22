import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import type { ThemeSetting } from '../api/types';
import { dark, light, type Palette } from './tokens';

interface ThemeValue {
  mode: 'light' | 'dark';
  colors: Palette;
}

const Ctx = createContext<ThemeValue>({ mode: 'light', colors: light });

/** `setting` is the user's saved theme (users/me/ -> theme): LIGHT | DARK | SYSTEM. */
export function ThemeProvider({ setting, children }: { setting: ThemeSetting; children: React.ReactNode }) {
  const system = useColorScheme();
  const mode: 'light' | 'dark' = setting === 'SYSTEM' ? (system === 'dark' ? 'dark' : 'light') : setting === 'DARK' ? 'dark' : 'light';
  const value = useMemo(() => ({ mode, colors: mode === 'dark' ? dark : light }), [mode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
