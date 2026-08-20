import { useEffect, useState } from 'react';

/**
 * Hook to remember user's last selected format and template
 * Uses localStorage for persistence across sessions
 */

const STORAGE_KEY = 'job-creation-last-selection';

interface FormatMemory {
  format: string | null;
  templateId: string | null;
  timestamp: number;
}

export function useFormatMemory() {
  const [memory, setMemory] = useState<FormatMemory>(() => {
    if (typeof window === 'undefined') {
      return { format: null, templateId: null, timestamp: 0 };
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored) as FormatMemory;
      }
    } catch (err) {
      console.warn('Failed to load format memory:', err);
    }

    return { format: null, templateId: null, timestamp: 0 };
  });

  // Save to localStorage whenever memory changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
    } catch (err) {
      console.warn('Failed to save format memory:', err);
    }
  }, [memory]);

  function remember(format: string, templateId: string) {
    setMemory({
      format,
      templateId,
      timestamp: Date.now(),
    });
  }

  function clear() {
    setMemory({ format: null, templateId: null, timestamp: 0 });
  }

  return {
    lastFormat: memory.format,
    lastTemplate: memory.templateId,
    remember,
    clear,
  };
}
