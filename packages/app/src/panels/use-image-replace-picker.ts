import { useEffect, useMemo, useRef } from 'react';

import type { ObjectId } from '@canvas/schema';

import type { PageImages } from '../assets/page-images.js';
import type { ShellAction } from '../state/shell-action.js';

import { imageReplacerOf } from './image-replacement-context.js';

/**
 * Picks an image file the way a file field does, without one in the page: a detached file input
 * clicked once, its choice handed on.
 *
 * @param onFile - Receives the file chosen.
 */
function pickImageFile(onFile: (file: File) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const [file] = input.files ?? [];
    if (file !== undefined) onFile(file);
  });
  input.click();
}

/**
 * The image popover's Replace: picks an image file, which the page's images read, draw
 * at once and upload (`PageImages.replace`), and dispatches the image's `replaceImage` with the
 * new asset and natural size (one undo step; its box and, where it fits, its crop kept), the
 * upload's badge on the image. None where the page has no images (no assets service). Once the
 * workspace is gone, a file chosen or prepared later does nothing: no replacement, no upload.
 *
 * @param images - The page's images, when the board has an assets service.
 * @param notify - Shows an upload's notice.
 * @param dispatch - The shell's dispatch.
 * @returns The picker for an image, or undefined.
 */
export function useImageReplacePicker(
  images: PageImages | undefined,
  notify: (message: string) => void,
  dispatch: (action: ShellAction) => void,
): ((id: ObjectId) => void) | undefined {
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  return useMemo(() => {
    const replace = imageReplacerOf(images, notify);
    if (replace === undefined) return undefined;
    return (id: ObjectId) => {
      pickImageFile((file) => {
        if (!isMounted.current) return;
        replace(file, ({ assetId, naturalSize }) => {
          if (!isMounted.current) return undefined;
          dispatch({ type: 'replaceImage', id, assetId, naturalSize });
          return [id];
        });
      });
    };
  }, [images, notify, dispatch]);
}
