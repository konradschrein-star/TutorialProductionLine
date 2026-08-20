'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

export interface KeybindEntry {
  key: string;
  description: string;
  category: string;
}

interface KeybindContextValue {
  register: (entry: KeybindEntry, handler: () => void) => () => void;
  bindings: KeybindEntry[];
  isOverlayOpen: boolean;
  setOverlayOpen: (open: boolean) => void;
}

const KeybindContext = createContext<KeybindContextValue | null>(null);

const DISPLAY_ONLY_BINDINGS: KeybindEntry[] = [
  { key: '?', description: 'Show keyboard shortcuts', category: 'Global' },
  { key: 'Ctrl/⌘+K', description: 'Open command palette', category: 'Global' },
  { key: 'Esc', description: 'Close dialogs / deselect', category: 'Global' },
];

export function KeybindProvider({ children }: { children: ReactNode }) {
  const handlers = useRef<Map<string, { entry: KeybindEntry; handler: () => void }>>(new Map());
  const [bindings, setBindings] = useState<KeybindEntry[]>(DISPLAY_ONLY_BINDINGS);
  const [isOverlayOpen, setOverlayOpen] = useState(false);
  const chordBuffer = useRef<string[]>([]);
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const register = useCallback((entry: KeybindEntry, handler: () => void) => {
    handlers.current.set(entry.key, { entry, handler });
    setBindings([...DISPLAY_ONLY_BINDINGS, ...Array.from(handlers.current.values()).map((v) => v.entry)]);
    return () => {
      handlers.current.delete(entry.key);
      setBindings([...DISPLAY_ONLY_BINDINGS, ...Array.from(handlers.current.values()).map((v) => v.entry)]);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      if (e.key === '?' && !inInput) {
        e.preventDefault();
        setOverlayOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape') {
        setOverlayOpen(false);
        return;
      }
      if (inInput) return;

      // Chord handling: press g then d within 800ms = "g+d"
      const key = e.key.toLowerCase();
      chordBuffer.current.push(key);
      if (chordTimer.current) clearTimeout(chordTimer.current);
      chordTimer.current = setTimeout(() => {
        chordBuffer.current = [];
      }, 800);

      const chord = chordBuffer.current.join('+');
      if (handlers.current.has(chord)) {
        e.preventDefault();
        handlers.current.get(chord)!.handler();
        chordBuffer.current = [];
        return;
      }
      if (handlers.current.has(key)) {
        e.preventDefault();
        handlers.current.get(key)!.handler();
        chordBuffer.current = [];
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <KeybindContext.Provider value={{ register, bindings, isOverlayOpen, setOverlayOpen }}>
      {children}
    </KeybindContext.Provider>
  );
}

export function useKeybinds() {
  const ctx = useContext(KeybindContext);
  if (!ctx) throw new Error('useKeybinds must be used inside KeybindProvider');
  return ctx;
}

export function useRegisterKeybind(
  entry: KeybindEntry,
  handler: () => void,
  deps: unknown[] = []
) {
  const { register } = useKeybinds();
  useEffect(() => {
    return register(entry, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
