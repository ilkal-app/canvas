import type { ReactElement } from 'react';

import type { ObjectId } from '@canvas/schema';

import { isSelectionLocked } from '../panels/inspector-header.js';
import { useBoardVote } from '../voting/vote-context.js';

import type { PopoverStyleControlsProps } from './popover-controls.js';
import { PopoverLinkButton } from './popover-link.js';
import { Divider, RowButton } from './popover-row-parts.js';
import { PopoverColourButton } from './popover-shared.js';
import {
  borderChanges,
  sharedBackgroundOf,
  sharedBorderColourOf,
  type PopoverFrame,
  type PopoverImage,
} from './several-values.js';

/**
 * Vote in this section: a dot vote scoped to the one selected section, where a vote can start
 * (the person may vote and none is open).
 *
 * @param props - The sections.
 * @param props.frames - The selected sections.
 * @returns The button.
 */
function SectionVoteButton(props: { readonly frames: readonly PopoverFrame[] }): ReactElement {
  const vote = useBoardVote();
  const [frame] = props.frames;
  const canStart =
    props.frames.length === 1 &&
    vote?.canVote === true &&
    vote.session?.status !== 'open' &&
    frame !== undefined;
  return (
    <RowButton
      label="Vote in this section"
      icon="vote"
      isDisabled={!canStart}
      title={canStart ? undefined : 'Select one section to vote in it, while no vote is open'}
      onPress={() => {
        if (frame !== undefined) vote?.start(frame.id);
      }}
    />
  );
}

/**
 * Whether a section has a direct child Fit to content counts: not a connector or a comment
 * (`fitFrameToContent` refuses a section with none).
 *
 * @param controls - The popover's controls' props, with the engine's board.
 * @param id - The section.
 * @returns Whether it has one.
 */
function hasFittableChild(controls: PopoverStyleControlsProps, id: ObjectId): boolean {
  const board = controls.engine?.board.board;
  if (board === undefined) return false;
  for (const childId of board.references.childrenOf(id)) {
    const type = board.get(childId)?.type;
    if (type !== undefined && type !== 'connector' && type !== 'comment') return true;
  }
  return false;
}

/**
 * The section row (the SECTION card): fill, fit to content, lock |
 * a timer and a dot vote for the one selected section. Each change is one action.
 *
 * @param props - The controls' props and the sections.
 * @param props.controls - The popover's controls' props.
 * @param props.frames - The selected sections.
 * @returns The controls.
 */
export function SectionControls(props: {
  readonly controls: PopoverStyleControlsProps;
  readonly frames: readonly PopoverFrame[];
}): ReactElement {
  const { controls, frames } = props;
  const [frame] = frames;
  const canFit =
    frames.length === 1 &&
    frame !== undefined &&
    !frame.locked &&
    frame.autoLayout === undefined &&
    hasFittableChild(controls, frame.id);
  const onTimer = controls.onSectionTimer;
  const canTime = frames.length === 1 && onTimer !== undefined && frame !== undefined;
  return (
    <>
      <PopoverColourButton
        kind="fill"
        value={sharedBackgroundOf(frames)}
        controls={controls}
        onChange={(background) => {
          // The fill palette offers no ink: a section's background is a colour, a token or none.
          if (background === 'ink') return;
          controls.dispatch({
            type: 'style',
            changes: frames.map((object) => ({ id: object.id, style: { background } })),
          });
        }}
      />
      <RowButton
        label="Fit to content"
        icon="zoom-fit"
        isDisabled={!canFit}
        title={canFit ? undefined : 'Select one unlocked section with content, without auto layout'}
        onPress={() => {
          if (frame !== undefined) controls.dispatch({ type: 'fitToContent', id: frame.id });
        }}
      />
      <RowButton
        label="Lock"
        icon="lock"
        isPressed={isSelectionLocked(frames)}
        onPress={() => {
          controls.dispatch({ type: 'selection', command: 'toggleLock' });
        }}
      />
      <Divider />
      <RowButton
        label="Timer for this section"
        icon="timer"
        isDisabled={!canTime}
        title={canTime ? undefined : 'Select one section to time it'}
        onPress={() => {
          if (frame !== undefined) onTimer?.(frame.id);
        }}
      />
      <SectionVoteButton frames={frames} />
      <Divider />
    </>
  );
}

/**
 * The image row (the IMAGE card): crop and replace (one unlocked image), and the border
 * colour of every unlocked image | link.
 *
 * @param props - The controls' props and the images.
 * @param props.controls - The popover's controls' props.
 * @param props.images - The selected images.
 * @returns The controls.
 */
export function ImageControls(props: {
  readonly controls: PopoverStyleControlsProps;
  readonly images: readonly PopoverImage[];
}): ReactElement {
  const { controls, images } = props;
  const canCrop = images.length === 1 && images[0]?.locked === false;
  const [image] = images;
  const onReplace = controls.onReplaceImage;
  const canReplace = canCrop && onReplace !== undefined;
  return (
    <>
      <RowButton
        label="Crop"
        icon="crop"
        isDisabled={!canCrop}
        title={canCrop ? undefined : 'Select one unlocked image to crop it'}
        onPress={() => {
          controls.dispatch({ type: 'selection', command: 'activate' });
        }}
      />
      <RowButton
        label="Replace"
        icon="upload"
        isDisabled={!canReplace}
        title={canReplace ? undefined : 'Select one unlocked image to replace its picture'}
        onPress={() => {
          if (image !== undefined) onReplace?.(image.id);
        }}
      />
      <PopoverColourButton
        kind="border"
        value={sharedBorderColourOf(images)}
        controls={controls}
        isDisabled={images.every((each) => each.locked)}
        onChange={(color) => {
          const changes = borderChanges(images, color);
          if (changes.length > 0) controls.dispatch({ type: 'style', changes });
        }}
      />
      <Divider />
      <PopoverLinkButton selection={images} dispatch={controls.dispatch} />
    </>
  );
}
