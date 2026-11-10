import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import type { ObjectId } from '@canvas/schema';

import type { PageImages, ReplacementAsset } from '../assets/page-images.js';

/**
 * Replaces an image with a file (`PageImages.replace`): reads and uploads it, giving its asset
 * to `apply`, which writes it and names the objects that show it; why a file was not taken goes
 * to the shell's notice.
 */
export type ImageReplacer = (
  file: File,
  apply: (asset: ReplacementAsset) => readonly ObjectId[] | undefined,
) => void;

/** Outside a provider (no assets service), no image can be replaced. */
const imageReplacement = createContext<ImageReplacer | undefined>(undefined);

/**
 * The page's images as an {@link ImageReplacer}, with the shell's notice for why a file was not
 * taken.
 *
 * @param images - The page's images, or undefined without an assets service.
 * @param notify - Shows the person a sentence.
 * @returns The replacer, or undefined without images.
 */
export function imageReplacerOf(
  images: PageImages | undefined,
  notify: (message: string) => void,
): ImageReplacer | undefined {
  if (images === undefined) return undefined;
  return (file, apply) => {
    void images.replace(file, apply, notify);
  };
}

/** Props of {@link ImageReplacementProvider}. */
export interface ImageReplacementProviderProps {
  /** Replaces an image with a file; none without an assets service. */
  readonly value: ImageReplacer | undefined;
  /** The panel. */
  readonly children: ReactNode;
}

/**
 * Provides the instance section's image replacement to the panel below it (rule 3): the
 * page's images live in the shell's workspace, not in the panel's selection props.
 *
 * @param props - The replacer and the panel.
 * @returns The provider.
 */
export function ImageReplacementProvider(props: ImageReplacementProviderProps): ReactElement {
  return (
    <imageReplacement.Provider value={props.value}>{props.children}</imageReplacement.Provider>
  );
}

/**
 * The panel's image replacement.
 *
 * @returns It, or undefined where no image can be replaced.
 */
export function useImageReplacer(): ImageReplacer | undefined {
  return useContext(imageReplacement);
}
