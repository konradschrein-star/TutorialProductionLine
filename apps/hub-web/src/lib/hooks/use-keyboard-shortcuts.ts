import { useEffect, useRef } from 'react';

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  cmd?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
  description: string;
}

/**
 * Register keyboard shortcuts
 * Automatically handles Ctrl (Windows/Linux) vs Cmd (Mac)
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[], enabled = true) {
  const handlersRef = useRef(shortcuts);

  // Update handlers ref when shortcuts change
  useEffect(() => {
    handlersRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

      for (const shortcut of handlersRef.current) {
        const keyMatches =
          e.key.toLowerCase() === shortcut.key.toLowerCase() ||
          e.code.toLowerCase() === shortcut.key.toLowerCase();

        if (!keyMatches) continue;

        // Check modifiers
        const ctrlOrCmdRequired = shortcut.ctrl || shortcut.cmd;
        const ctrlOrCmdPressed = isMac ? e.metaKey : e.ctrlKey;

        if (ctrlOrCmdRequired && !ctrlOrCmdPressed) continue;
        if (!ctrlOrCmdRequired && ctrlOrCmdPressed) continue;

        if (shortcut.shift && !e.shiftKey) continue;
        if (!shortcut.shift && e.shiftKey) continue;

        if (shortcut.alt && !e.altKey) continue;
        if (!shortcut.alt && e.altKey) continue;

        // Don't trigger shortcuts when typing in inputs
        const target = e.target as HTMLElement;
        const isInput =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable;

        // Allow Escape and specific shortcuts even in inputs
        if (isInput && e.key !== 'Escape' && shortcut.key !== '/') {
          continue;
        }

        e.preventDefault();
        shortcut.handler();
        break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}

/**
 * Format shortcut for display
 */
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const isMac = typeof navigator !== 'undefined' &&
    navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  const parts: string[] = [];

  if (shortcut.ctrl || shortcut.cmd) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (shortcut.shift) {
    parts.push(isMac ? '⇧' : 'Shift');
  }
  if (shortcut.alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }

  // Format key
  let key = shortcut.key;
  if (key === 'delete' || key === 'backspace') key = 'Del';
  else if (key === 'escape') key = 'Esc';
  else if (key === 'enter') key = '↵';
  else if (key.length === 1) key = key.toUpperCase();

  parts.push(key);

  return parts.join(isMac ? '' : '+');
}
