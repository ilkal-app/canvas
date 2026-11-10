import { useState } from 'react';

import type { CommentMode } from './comment-context.js';

/**
 * Whether resolved threads are shown, and its toggle.
 *
 * @returns The flag and its toggle.
 */
export function useResolvedToggle(): Pick<CommentMode, 'isResolvedShown' | 'toggleResolvedShown'> {
  const [isResolvedShown, setResolvedShown] = useState(false);
  return {
    isResolvedShown,
    toggleResolvedShown: () => {
      setResolvedShown(!isResolvedShown);
    },
  };
}
