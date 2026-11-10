import type { Point } from '@canvas/schema';
import {
  CropMode,
  fullImageFrame,
  ImageMode,
  orientedBoxOf,
  type CropModeContext,
} from '@canvas/tools';

import { NO_IMAGES_MESSAGE } from '../../assets/page-images.js';

import type { ToolModeEntry, ToolModeServices } from './tool-mode-entry.js';

/**
 * What crop mode works on, from the tool modes' services: the document, the preview the whole
 * image shows as, the typing undo policy (so the crop is its own undo step), the router's exit
 * and where refusals go.
 *
 * @param services - The tool modes' services.
 * @returns Crop mode's context.
 */
export function cropContextOf(services: ToolModeServices): CropModeContext {
  return {
    store: services.store,
    origin: services.origin,
    environment: services.environment,
    capture: services.capture,
    setPreview: services.setPreview,
    onChange: services.onChange,
    requestExit: services.requestExit,
    ...(services.onCommandRefused === undefined
      ? {}
      : { onCommandRefused: services.onCommandRefused }),
  };
}

/**
 * The image tool's picker: the page's (`pickImages`), or, on a page with no assets service, one
 * that says so and closes at once.
 *
 * @param services - The tool modes' services.
 * @returns The picker.
 */
function pickerOf(services: ToolModeServices): (at: Point | undefined) => Promise<void> {
  return (
    services.pickImages ??
    (() => {
      services.onNotice?.(NO_IMAGES_MESSAGE);
      return Promise.resolve();
    })
  );
}

/**
 * The image tool (`i`): opens the file picker, the images chosen placed at the view's
 * centre (a click while it waits opens it for the clicked point), and hands back to select.
 * Activating an image (a double-click, Enter with it alone selected, the image section's Crop
 * button) enters crop mode on it, unless it is locked.
 */
export const toolModeEntry: ToolModeEntry = {
  tool: 'image',
  activates: ['image'],
  create: (services) =>
    new ImageMode({ pickImages: pickerOf(services), requestExit: services.requestExit }),
  activate: (services, activation, object) => {
    if (object.locked || object.type !== 'image') return undefined;
    const frame = orientedBoxOf(object.id, services.selectTool.source);
    if (frame === undefined) return undefined;
    return new CropMode(cropContextOf(services), object, fullImageFrame(frame, object));
  },
};
