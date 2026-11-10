import { useCallback, useEffect, useRef, useState } from 'react';

import { localFontPermission, requestLocalFonts } from './local-fonts.js';

/**
 * The fonts on this computer as a font menu shows them: the browser has no Local Font
 * Access (`unsupported`, every browser but desktop Chrome and Edge), the person has not been
 * asked (`prompt`), refused (`denied`), the page is reading them (`reading`), or their families
 * (`granted`).
 */
export type LocalFontFamilies =
  | { readonly status: 'unsupported' | 'prompt' | 'denied' | 'reading' }
  | { readonly status: 'granted'; readonly families: readonly string[] };

/** The page's one listing of this computer's families, shared by every font menu. */
let listing: Promise<readonly string[]> | undefined;

/**
 * This computer's families, listed once per page; a failed listing is not kept.
 *
 * @returns The families.
 */
function listFamilies(): Promise<readonly string[]> {
  listing ??= requestLocalFonts().catch((error: unknown) => {
    listing = undefined;
    throw error;
  });
  return listing;
}

/**
 * The fonts on this computer for a font menu: the permission read without asking, and
 * the families listed once it is granted (never prompting); `request` asks, from the person's
 * press, through the browser's own prompt. Font files are not read here: a family's faces load
 * when its row is shown (`loadLocalFont`).
 *
 * @returns What the menu shows, and the request.
 */
export function useLocalFontFamilies(): {
  readonly local: LocalFontFamilies;
  readonly request: () => void;
} {
  const [local, setLocal] = useState<LocalFontFamilies>({ status: 'reading' });
  const read = useCallback(async (isAsked: boolean): Promise<LocalFontFamilies> => {
    const permission = await localFontPermission();
    if (permission === 'unsupported' || permission === 'denied') return { status: permission };
    if (permission === 'prompt' && !isAsked) return { status: 'prompt' };
    try {
      return { status: 'granted', families: await listFamilies() };
    } catch {
      // Refused at the prompt, or the listing failed: what the browser says now.
      const after = await localFontPermission();
      return { status: after === 'granted' ? 'prompt' : after };
    }
  }, []);
  // A permission read or a listing that settles after the menu is gone changes nothing.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    void read(false).then((next) => {
      if (isMounted.current) setLocal(next);
    });
    return () => {
      isMounted.current = false;
    };
  }, [read]);
  const request = useCallback(() => {
    setLocal({ status: 'reading' });
    void read(true).then((next) => {
      if (isMounted.current) setLocal(next);
    });
  }, [read]);
  return { local, request };
}
