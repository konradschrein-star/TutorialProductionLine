'use server';

import { cookies } from 'next/headers';

const VALID_THEMES = ['lime', 'purple', 'teal', 'orange', 'blue', 'green'] as const;
type Theme = (typeof VALID_THEMES)[number];

export async function saveThemeAction(theme: string): Promise<void> {
  if (!VALID_THEMES.includes(theme as Theme)) return;
  const cookieStore = await cookies();
  cookieStore.set('hub_ui_theme', theme, {
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
}
