import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { Toaster } from 'sonner';
import { getSession } from './_lib/v2-auth';
import { AppSidebar } from './_components/sidebar';
import { AppHeader } from './_components/header';
import { KeybindProvider } from './_lib/keybinds';
import { KeybindOverlay } from './_components/keybind-overlay';
import { PresenceHeartbeat } from './_components/presence-heartbeat';
import './v2.css';

const VALID_THEMES = new Set(['lime', 'purple', 'teal', 'orange', 'blue', 'green']);

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const cookieStore = await cookies();
  const rawTheme = cookieStore.get('hub_ui_theme')?.value ?? 'blue';
  const theme = VALID_THEMES.has(rawTheme) ? rawTheme : 'blue';
  const themeClass = theme !== 'lime' ? `theme-${theme}` : '';
  const mode = cookieStore.get('hub_ui_mode')?.value === 'light' ? 'light' : 'dark';

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&family=Inter:wght@300;400;500;600;700;800;900&display=swap"
        rel="stylesheet"
      />
      <KeybindProvider>
        <PresenceHeartbeat />
        <div
          data-theme={mode}
          className={`studio-shell flex overflow-hidden${themeClass ? ` ${themeClass}` : ''}`}
          style={{ backgroundColor: 'var(--v2-bg)', color: 'var(--v2-text-1)', fontFamily: 'Inter, sans-serif' }}
        >
          <AppSidebar session={session} />

          <div className="studio-shell-content">
            <AppHeader session={session} />
            <main id="workspace-main" className="studio-main" tabIndex={-1}>
              <div className="w-full min-w-0">
                {children}
              </div>
            </main>
          </div>
        </div>

        <KeybindOverlay />
      </KeybindProvider>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#1a1a1a',
            border: '1px solid rgba(170,255,0,0.15)',
            color: '#e5e2e1',
            fontSize: 12,
            fontFamily: 'Inter, sans-serif',
          },
        }}
      />
    </>
  );
}
