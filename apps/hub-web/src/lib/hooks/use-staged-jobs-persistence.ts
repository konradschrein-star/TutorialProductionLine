import { useState, useEffect, useCallback } from 'react';
import type { StagedJob } from '@/components/job-creation/advanced-staging-table';

const STORAGE_KEY = 'staged-jobs-backup';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface StagedJobsBackup {
  templateId: string;
  jobs: StagedJob[];
  timestamp: number;
}

/**
 * Persists staged jobs to localStorage so they survive page refresh
 * Automatically clears backups older than 24 hours
 */
export function useStagedJobsPersistence(templateId: string) {
  const [initialized, setInitialized] = useState(false);

  // Load staged jobs from localStorage on mount
  const loadStagedJobs = useCallback((): StagedJob[] => {
    if (typeof window === 'undefined' || !templateId) return [];

    try {
      const stored = localStorage.getItem(`${STORAGE_KEY}-${templateId}`);
      if (!stored) return [];

      const backup = JSON.parse(stored) as StagedJobsBackup;

      // Check age
      if (Date.now() - backup.timestamp > MAX_AGE_MS) {
        localStorage.removeItem(`${STORAGE_KEY}-${templateId}`);
        return [];
      }

      // Reconstruct jobs (convert plain objects back to Maps/Sets)
      const jobs = backup.jobs.map((job: any) => ({
        ...job,
        assets: new Map(Object.entries(job.assets || {})),
        overrides: new Set(job.overrides || []),
      })) as StagedJob[];

      return jobs;
    } catch (err) {
      console.warn('Failed to load staged jobs:', err);
      return [];
    }
  }, [templateId]);

  // Save staged jobs to localStorage
  const saveStagedJobs = useCallback(
    (jobs: StagedJob[]) => {
      if (typeof window === 'undefined' || !templateId) return;

      try {
        // Convert Maps/Sets to plain objects for JSON serialization
        const serializable = jobs.map((job) => ({
          ...job,
          assets: Object.fromEntries(job.assets),
          overrides: Array.from(job.overrides),
        }));

        const backup: StagedJobsBackup = {
          templateId,
          jobs: serializable as any,
          timestamp: Date.now(),
        };

        localStorage.setItem(`${STORAGE_KEY}-${templateId}`, JSON.stringify(backup));
      } catch (err) {
        console.warn('Failed to save staged jobs:', err);
      }
    },
    [templateId]
  );

  // Clear staged jobs backup
  const clearStagedJobs = useCallback(() => {
    if (typeof window === 'undefined' || !templateId) return;
    localStorage.removeItem(`${STORAGE_KEY}-${templateId}`);
  }, [templateId]);

  // Clean up old backups on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const allKeys = Object.keys(localStorage);
    const backupKeys = allKeys.filter((k) => k.startsWith(STORAGE_KEY));

    backupKeys.forEach((key) => {
      try {
        const stored = localStorage.getItem(key);
        if (!stored) return;

        const backup = JSON.parse(stored) as StagedJobsBackup;
        if (Date.now() - backup.timestamp > MAX_AGE_MS) {
          localStorage.removeItem(key);
        }
      } catch (err) {
        // Invalid backup, remove it
        localStorage.removeItem(key);
      }
    });

    setInitialized(true);
  }, []);

  return {
    initialized,
    loadStagedJobs,
    saveStagedJobs,
    clearStagedJobs,
  };
}
