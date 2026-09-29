import { useSyncExternalStore } from 'react';
import { sfx } from './audio';

/** Current audio state: 'none' (not yet unlocked), 'running', 'suspended' or 'interrupted'. */
export function useAudioState(): string {
  return useSyncExternalStore(sfx.subscribe, () => sfx.state);
}
