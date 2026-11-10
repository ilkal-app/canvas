import { useEffect, useState, type ReactElement } from 'react';

import { pageFontStatus, subscribePageFonts } from './page-fonts.js';

/**
 * Shows missing-font status without changing stored family names.
 *
 * @param props - The selected family.
 * @param props.family - A name, or undefined for mixed/no selection.
 * @returns A missing-font marker where appropriate.
 */
export function MissingFontMarker(props: {
  readonly family: string | undefined;
}): ReactElement | null {
  const [, update] = useState(0);
  useEffect(
    () =>
      subscribePageFonts(() => {
        update((value) => value + 1);
      }),
    [],
  );
  if (props.family === undefined) return null;
  const status = pageFontStatus(props.family);
  if (status !== 'missing' && status !== 'failed') return null;
  return (
    <p role="status">
      Missing font: {props.family}. Choose an available font before editing its words.
    </p>
  );
}
