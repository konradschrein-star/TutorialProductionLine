'use client';

import { useKeybinds } from '../_lib/keybinds';

export function KeybindOverlay() {
  const { isOverlayOpen, setOverlayOpen, bindings } = useKeybinds();

  if (!isOverlayOpen) return null;

  const byCategory = bindings.reduce<Record<string, typeof bindings>>((acc, b) => {
    (acc[b.category] ??= []).push(b);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onClick={() => setOverlayOpen(false)}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto"
        style={{
          background: 'rgba(53,53,52,0.98)',
          border: '1px solid rgba(var(--v2-accent-rgb), 0.2)',
          boxShadow: '0 0 40px rgba(var(--v2-accent-rgb), 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 style={{ color: '#e5e2e1', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Keyboard Shortcuts
          </h2>
          <span style={{ color: '#cdc3d7', fontSize: 10, opacity: 0.6 }}>Press ? to close</span>
        </div>
        {Object.entries(byCategory).map(([category, items]) => (
          <div key={category} className="mb-5">
            <div style={{ color: 'var(--v2-accent)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              {category}
            </div>
            <div className="space-y-2">
              {items.map((b) => (
                <div key={b.key} className="flex items-center justify-between">
                  <span style={{ color: '#cdc3d7', fontSize: 11 }}>{b.description}</span>
                  <kbd style={{ background: '#0e0e0e', border: '1px solid #4b4455', borderRadius: 4, padding: '2px 8px', color: '#e5e2e1', fontSize: 10, fontFamily: 'monospace', minWidth: 32, textAlign: 'center' }}>
                    {b.key.replace('+', ' \u2192 ')}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
