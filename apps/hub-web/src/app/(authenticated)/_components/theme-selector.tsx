'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { saveThemeAction } from '@/app/actions/theme';

const THEMES = [
  { key: 'lime',   label: 'Lime',   hex: '#aaff00', dim: '#6fca00' },
  { key: 'purple', label: 'Purple', hex: '#904efb', dim: '#650ccf' },
  { key: 'teal',   label: 'Teal',   hex: '#23decb', dim: '#1ab3a3' },
  { key: 'orange', label: 'Orange', hex: '#f97316', dim: '#c4580e' },
  { key: 'blue',   label: 'Blue',   hex: '#60a5fa', dim: '#3b82f6' },
  { key: 'green',  label: 'Green',  hex: '#34d399', dim: '#059669' },
] as const;

interface Props {
  currentTheme: string;
}

export function ThemeSelector({ currentTheme }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSelect(theme: string) {
    startTransition(async () => {
      await saveThemeAction(theme);
      router.refresh();
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {THEMES.map((theme) => {
          const isActive = currentTheme === theme.key;
          return (
            <button
              key={theme.key}
              onClick={() => handleSelect(theme.key)}
              disabled={isPending}
              className="v2-glow"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                padding: '14px 18px',
                background: isActive ? 'rgba(255,255,255,0.04)' : 'transparent',
                border: `1px solid ${isActive ? theme.hex : 'rgba(75,68,85,0.3)'}`,
                borderRadius: 12,
                cursor: isPending ? 'wait' : 'pointer',
                opacity: isPending ? 0.6 : 1,
                boxShadow: isActive ? `0 0 16px ${theme.hex}55` : 'none',
                minWidth: 80,
              }}
            >
              <div style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${theme.hex}, ${theme.dim})`,
                boxShadow: isActive ? `0 0 20px ${theme.hex}88` : `0 0 8px ${theme.hex}33`,
                position: 'relative',
              }}>
                {isActive && (
                  <span
                    className="material-symbols-outlined"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      color: '#fff',
                      fontVariationSettings: "'FILL' 1",
                    }}
                  >
                    check
                  </span>
                )}
              </div>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: isActive ? theme.hex : 'rgba(205,195,215,0.6)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                {theme.label}
              </span>
            </button>
          );
        })}
      </div>
      {isPending && (
        <p style={{ fontSize: 11, color: 'rgba(205,195,215,0.4)', margin: 0 }}>
          Applying theme...
        </p>
      )}
    </div>
  );
}
