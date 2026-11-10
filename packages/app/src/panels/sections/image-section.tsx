import { useId, type ReactElement } from 'react';

import type { ImageObject } from '@canvas/schema';

import controls from '../controls/controls.module.css';
import { useImageAvailability } from '../image-availability-context.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

/**
 * The style panel's image section (crop, opacity): its opacity is the Layer section's,
 * with every other layer's; a Crop button, for one unlocked image, which enters crop mode on it
 * (the `activate` canvas action, as Enter does), and otherwise says why it does nothing (read with
 * it by a screen reader); and, for one image the board cannot show, a note saying so with Remove
 * (that its upload never finished only when this page began it; otherwise that it is not available
 * on this board). A press on the button keeps the focus where it was.
 *
 * @param props - The panel's props.
 * @returns The controls.
 */
function ImageSection(props: StylePanelSectionProps): ReactElement {
  const { selection, dispatch } = props;
  const images = selection.flatMap((object) => (object.type === 'image' ? [object] : []));
  const [only] = images;
  const one = images.length === 1 ? only : undefined;
  const canCrop = one !== undefined && !one.locked;
  const cropHintId = useId();
  const availability = useImageAvailability(one?.assetId);
  return (
    <>
      <div className={controls.control}>
        {/* aria-disabled, not disabled: it stays focusable, so its reason is read with it. */}
        <button
          type="button"
          className={controls.button}
          aria-disabled={!canCrop}
          aria-describedby={canCrop ? undefined : cropHintId}
          title={canCrop ? 'Crop the image (Enter)' : undefined}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            if (canCrop) dispatch({ type: 'selection', command: 'activate' });
          }}
        >
          Crop
        </button>
        {!canCrop && (
          <span id={cropHintId} className={controls.hint}>
            Select one unlocked image to crop it.
          </span>
        )}
      </div>
      {one !== undefined && (availability === 'missing' || availability === 'unfinished') && (
        <MissingImage image={one} isOwnUpload={availability === 'unfinished'} dispatch={dispatch} />
      )}
    </>
  );
}

/** How long after an image was placed a missing asset counts as an upload that never finished. */
export const ABANDONED_UPLOAD_MS = 10 * 60_000;

/** What the section says of an image the board cannot show that this page never uploaded. */
export const UNAVAILABLE_IMAGE_MESSAGE = 'This image is not available on this board.';

/**
 * What the section says of an image the board cannot show (fix rounds 1 and 2): an image
 * whose upload this page began and that never finished (recent: not yet) is a placeholder for
 * good, and a retry needs the file; any other (after a reload, another board's asset, an unknown
 * id, a collaborator's upload) is only called not available on this board, since the page cannot
 * tell which. Either way it offers Remove.
 *
 * @param props - The image, whether this page began its upload, and the shell's dispatch.
 * @param props.image - The image.
 * @param props.isOwnUpload - Whether this page began uploading its asset.
 * @param props.dispatch - The shell's dispatch.
 * @returns The message and Remove.
 */
function MissingImage(props: {
  readonly image: ImageObject;
  readonly isOwnUpload: boolean;
  readonly dispatch: StylePanelSectionProps['dispatch'];
}): ReactElement {
  const isAbandoned = Date.now() - props.image.createdAt > ABANDONED_UPLOAD_MS;
  return (
    <div className={controls.control} role="status">
      <span className={controls.hint}>
        {!props.isOwnUpload
          ? UNAVAILABLE_IMAGE_MESSAGE
          : isAbandoned
            ? 'This image never finished uploading, so it cannot be shown.'
            : 'This image has not finished uploading yet.'}
      </span>
      <button
        type="button"
        className={controls.button}
        onClick={() => {
          props.dispatch({ type: 'selection', command: 'delete' });
        }}
      >
        Remove
      </button>
    </div>
  );
}

/**
 * The style panel's image section: shown for images only, never for a creation tool's
 * style (the image tool has none).
 */
export const stylePanelSection: StylePanelSection = {
  id: 'image',
  title: 'Image',
  context: 'image',
  order: 10,
  isSelectionOnly: true,
  render: ImageSection,
};
