import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { Toaster } from 'sonner';
import { getSession } from './_lib/v2-auth';
import { AppSidebar } from './_components/sidebar';
import { AppHeader } from './_components/header';
import { KeybindProvider } from './_lib/keybinds';
import { KeybindOverlay } from './_components/keybind-overlay';
import { CommandPaletteTrigger } from './_components/command-palette';
import './v2.css';

const VALID_THEMES = new Set(['lime', 'purple', 'teal', 'orange', 'blue', 'green']);

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const cookieStore = await cookies();
  const rawTheme = cookieStore.get('hub_ui_theme')?.value ?? 'lime';
  const theme = VALID_THEMES.has(rawTheme) ? rawTheme : 'lime';
  const themeClass = theme !== 'lime' ? `theme-${theme}` : '';

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&family=Inter:wght@300;400;500;600;700;800;900&display=swap"
        rel="stylesheet"
      />
      <KeybindProvider>
        <div
          className={`flex h-screen overflow-hidden${themeClass ? ` ${themeClass}` : ''}`}
          style={{ backgroundColor: '#000', color: '#eceae6', fontFamily: 'Inter, sans-serif' }}
        >
          {/* Ambient background glow blobs */}
          <div
            className="fixed top-0 right-0 pointer-events-none -z-10"
            style={{ width: 800, height: 800, background: 'rgba(var(--v2-accent-rgb), 0.05)', filter: 'blur(120px)', borderRadius: '50%', transform: 'translate(50%, -50%)' }}
          />
          <div
            className="fixed bottom-0 left-0 pointer-events-none -z-10"
            style={{ width: 600, height: 600, background: 'rgba(var(--v2-accent-rgb), 0.03)', filter: 'blur(100px)', borderRadius: '50%', transform: 'translate(-50%, 50%)' }}
          />

          <AppSidebar session={session} />

          <div className="flex flex-col flex-1 min-h-screen overflow-hidden" style={{ marginLeft: 256 }}>
            <AppHeader session={session} />
            <main className="flex-1 overflow-y-auto p-8">
              <div className="max-w-[1600px] mx-auto w-full">
                {children}
              </div>
            </main>
          </div>
        </div>

        <KeybindOverlay />
        <CommandPaletteTrigger />
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
