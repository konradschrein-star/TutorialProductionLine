'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

interface UseEditableFieldProps {
  jobId: string;
  fieldName: 'youtube_title' | 'youtube_description' | 'youtube_tags';
  initialValue: string;
  onSave: (jobId: string, fieldName: string, value: string) => Promise<void>;
}

interface UseEditableFieldReturn {
  value: string;
  isDirty: boolean;
  isSaving: boolean;
  error: string | null;
  setValue: (newValue: string) => void;
  copyToClipboard: () => Promise<void>;
}

export function useEditableField({
  jobId,
  fieldName,
  initialValue,
  onSave,
}: UseEditableFieldProps): UseEditableFieldReturn {
  const [value, setValueState] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isDirty = value !== initialValue;

  const setValue = useCallback(
    (newValue: string) => {
      setValueState(newValue);

      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Start new debounce timer (1500ms)
      debounceTimerRef.current = setTimeout(async () => {
        try {
          setIsSaving(true);
          setError(null);
          await onSave(jobId, fieldName, newValue);
          setIsSaving(false);
        } catch (err: any) {
          setIsSaving(false);
          setError(err.message || 'Save failed');
          toast.error(`Failed to save: ${err.message || 'Unknown error'}`);
        }
      }, 1500);
    },
    [jobId, fieldName, onSave]
  );

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copied to clipboard');
    } catch (err) {
      toast.error('Copy failed - please copy manually');
    }
  }, [value]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    value,
    isDirty,
    isSaving,
    error,
    setValue,
    copyToClipboard,
  };
}
