import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import { NO_IMAGES_MESSAGE, type PageImages } from '../../assets/page-images.js';
import { insertFromLink } from '../../assets/panel-images.js';
import type { PasteTarget } from '../../clipboard/paste-handlers.js';

/** What the Image panel does, through the page's images and the engine's paste location. */
export interface ImagePanelActions {
  /**
   * Places image files at the view's centre: read, drawn at once and uploaded.
   *
   * @param files - The files the person picked.
   */
  upload(files: readonly File[]): void;
  /**
   * Adds the image at a link at the view's centre; why it was not is shown to the person.
   *
   * @param url - The link.
   * @returns Whether it was placed.
   */
  fromLink(url: string): Promise<boolean>;
}

/** Outside a provider (no engine or no assets service), the panel says images cannot be added. */
const imagePanelActions = createContext<ImagePanelActions | undefined>(undefined);

/**
 * The Image panel's actions over the page's images and the engine's paste location now.
 *
 * @param images - The page's images, or undefined without an assets service.
 * @param pasteTarget - The engine's paste location now, or undefined before it is mounted.
 * @param notify - Shows the person a sentence.
 * @returns The actions, or undefined without images.
 */
export function imagePanelActionsOf(
  images: Pick<PageImages, 'insert' | 'request'> | undefined,
  pasteTarget: () => PasteTarget | undefined,
  notify: (message: string) => void,
): ImagePanelActions | undefined {
  if (images === undefined) return undefined;
  const withTarget = (place: (target: PasteTarget) => void): void => {
    const target = pasteTarget();
    if (target === undefined) notify(NO_IMAGES_MESSAGE);
    else place(target);
  };
  return {
    upload: (files) => {
      withTarget((target) => {
        void images.insert(files, target.viewCentre, target);
      });
    },
    fromLink: async (url) => {
      const target = pasteTarget();
      if (target === undefined) {
        notify(NO_IMAGES_MESSAGE);
        return false;
      }
      return insertFromLink(images, url, target.viewCentre, target).catch((error: unknown) => {
        notify(error instanceof Error ? error.message : String(error));
        return false;
      });
    },
  };
}

/** Props of {@link ImagePanelActionsProvider}. */
export interface ImagePanelActionsProviderProps {
  /** The actions; none without an assets service. */
  readonly value: ImagePanelActions | undefined;
  /** The controls over the canvas, the dock and its panels among them. */
  readonly children: ReactNode;
}

/**
 * Provides the Image panel's actions to the dock below it: the page's images live in the shell's
 * workspace, not in the panel's props.
 *
 * @param props - The actions and the controls.
 * @returns The provider.
 */
export function ImagePanelActionsProvider(props: ImagePanelActionsProviderProps): ReactElement {
  return (
    <imagePanelActions.Provider value={props.value}>{props.children}</imagePanelActions.Provider>
  );
}

/**
 * The Image panel's actions.
 *
 * @returns Them, or undefined where images cannot be added.
 */
export function useImagePanelActions(): ImagePanelActions | undefined {
  return useContext(imagePanelActions);
}
