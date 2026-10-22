/** Colours taken from the Figma Make prototype (src/index.css + App.tsx in demo.zip). */
export interface Palette {
  bg: string; // screen background
  card: string; // cards, tiles, sheets
  surface: string; // inputs, chips, subtle fills
  ink: string; // primary text
  muted: string; // secondary text
  faint: string; // placeholders, disabled
  border: string;
  primary: string;
  primaryDark: string;
  primaryTint: string; // soft purple fill
  success: string;
  danger: string;
  warning: string;
  onPrimary: string;
}

export const light: Palette = {
  bg: '#FAF9FC',
  card: '#FFFFFF',
  surface: '#F0EEF3',
  ink: '#18111F',
  muted: '#6B7280',
  faint: '#9CA3AF',
  border: '#E5E7EB',
  primary: '#7C3AED',
  primaryDark: '#6D28D9',
  primaryTint: '#EDE9FE',
  success: '#10B981',
  danger: '#DC2626',
  warning: '#F59E0B',
  onPrimary: '#FFFFFF',
};

// Dark values from the prototype's `.theme-dark` overrides.
export const dark: Palette = {
  bg: '#111827',
  card: '#1F2937',
  surface: '#374151',
  ink: '#F9FAFB',
  muted: '#9CA3AF',
  faint: '#6B7280',
  border: '#374151',
  primary: '#8B5CF6',
  primaryDark: '#7C3AED',
  primaryTint: 'rgba(124,58,237,0.2)',
  success: '#10B981',
  danger: '#F87171',
  warning: '#F59E0B',
  onPrimary: '#FFFFFF',
};

export const radius = { input: 12, card: 16, tile: 12, button: 24, pill: 999 } as const;
export const SCREEN_PADDING = 20;
