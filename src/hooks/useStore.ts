import { useEffect, useRef, useState } from 'react';
import { StorageService } from '../services/storageService';
import { Channel, VAUser, StudioJob, FinishedVideo } from '../types';
import { StudioConfig } from '../types/config';

/**
 * Subscribe a component to the StorageService store. `getter` reads the value;
 * the component re-renders whenever a relevant key changes (this tab or another).
 *
 * `keys` optionally scopes which mutations trigger a re-read (recommended for
 * performance). '*' events (import/reset) always trigger a re-read.
 */
export function useStore<T>(getter: () => T, keys?: string[]): T {
  const [value, setValue] = useState<T>(getter);
  const getterRef = useRef(getter);
  getterRef.current = getter;

  useEffect(() => {
    // Re-read on mount in case the store changed between initial render and effect.
    setValue(getterRef.current());
    const unsub = StorageService.subscribe((changedKey) => {
      if (changedKey === '*' || !keys || keys.includes(changedKey)) {
        setValue(getterRef.current());
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys ? keys.join('|') : '']);

  return value;
}

// ---- Convenience hooks for the common domain slices ------------------------

export const useChannels = (): Channel[] =>
  useStore(() => StorageService.getChannels(), ['custom_channels']);

export const useUsers = (): VAUser[] =>
  useStore(() => StorageService.getUsers(), ['custom_users', 'deleted_user_ids']);

export const useActiveUser = (): VAUser =>
  useStore(() => StorageService.getActiveUser(), ['active_user', 'custom_users', 'deleted_user_ids']);

export const useActiveChannel = (): Channel =>
  useStore(() => StorageService.getActiveChannel(), ['active_channel', 'custom_channels']);

export const useConfig = (): StudioConfig =>
  useStore(() => StorageService.getConfig(), ['studio_config']);

export const useStudioJobs = (): StudioJob[] =>
  useStore(() => StorageService.getStudioJobs(), ['studio_jobs']);

export const useFinishedVideos = (): FinishedVideo[] =>
  useStore(() => StorageService.getFinishedVideos(), ['finished_videos']);
