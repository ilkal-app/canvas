import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import type { AssetId } from '@canvas/schema';

import type { ImageAvailability } from '../assets/image-availability.js';

/** Where the image section asks whether the board can show an image's asset. */
export type ImageAvailabilityReader = (assetId: AssetId) => Promise<ImageAvailability>;

/** Outside a provider (no assets service), nothing is known. */
const imageAvailability = createContext<ImageAvailabilityReader>(() => Promise.resolve('unknown'));

/** Props of {@link ImageAvailabilityProvider}. */
export interface ImageAvailabilityProviderProps {
  /** Asks the board's assets service (`PageImages.availability`). */
  readonly value: ImageAvailabilityReader;
  /** The panel. */
  readonly children: ReactNode;
}

/**
 * Provides the image section's availability check to the panel below it: the page's
 * images live in the shell's workspace, not in the panel's selection props.
 *
 * @param props - The check and the panel.
 * @returns The provider.
 */
export function ImageAvailabilityProvider(props: ImageAvailabilityProviderProps): ReactElement {
  return (
    <imageAvailability.Provider value={props.value}>{props.children}</imageAvailability.Provider>
  );
}

/**
 * Whether the board can show an asset, asked once per asset while it is shown; `unknown` until
 * the answer arrives or without an asset.
 *
 * @param assetId - The asset, or undefined.
 * @returns Its availability.
 */
export function useImageAvailability(assetId: AssetId | undefined): ImageAvailability {
  const read = useContext(imageAvailability);
  const [answer, setAnswer] = useState<{ assetId: AssetId; value: ImageAvailability }>();
  useEffect(() => {
    if (assetId === undefined) return undefined;
    let isCurrent = true;
    void read(assetId).then((value) => {
      if (isCurrent) setAnswer({ assetId, value });
    });
    return () => {
      isCurrent = false;
    };
  }, [assetId, read]);
  if (assetId === undefined || answer?.assetId !== assetId) return 'unknown';
  return answer.value;
}
