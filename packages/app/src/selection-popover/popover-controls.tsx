import type { ReactElement } from 'react';

import type { BoardObject, ColorMode, ObjectId } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';
import type { TextStyleChange, TextStyleContext } from '../engine/text-style-types.js';
import { MIXED } from '../panels/controls/mixed-value.js';
import type { ShellAction } from '../state/shell-action.js';

import { AlignDropdown } from './align-dropdown.js';
import { LineControls } from './line-controls.js';
import { LinkCardControls, singleLinkCardOf } from './link-card-controls.js';
import { PopoverLinkButton, runLinkEntriesOf } from './popover-link.js';
import {
  Divider,
  EmphasisToggles,
  NotYetButton,
  RowButton,
  VoteButton,
} from './popover-row-parts.js';
import { PopoverColourButton, TypeControls } from './popover-shared.js';
import { popoverTextValues, type PopoverTextValues } from './popover-values.js';
import { ImageControls, SectionControls } from './section-image-controls.js';
import { SameTypeArrangeControls, SeveralControls } from './several-controls.js';
import { isFrameSelection, isImageSelection, isSeveralSelection } from './several-values.js';
import { isLineSelection, isShapeSelection } from './shape-connector-values.js';
import { ShapeControls } from './shape-controls.js';

/** Props of {@link PopoverStyleControls}. */
export interface PopoverStyleControlsProps {
  /** The engine, for the board's colour tokens. */
  readonly engine: MountedEngine | undefined;
  /** The selected objects. */
  readonly selection: readonly BoardObject[];
  /** The engine's view of the selected text. */
  readonly textStyle: TextStyleContext | undefined;
  /** Applies a text style change: one undo step. */
  readonly onTextStyle: ((change: TextStyleChange) => void) | undefined;
  /** Runs a shell action: an object restyle, one undo step. */
  readonly dispatch: (action: ShellAction) => void;
  /** The mode the board is shown in, for token swatches. */
  readonly mode: ColorMode;
  /**
   * Starts editing a connector's label; the selection's `activate` (as Enter) when
   * absent.
   */
  readonly onEditLabel?: ((id: ObjectId) => void) | undefined;
  /** Starts the board timer for a section; the section's Timer is disabled without. */
  readonly onSectionTimer?: ((sectionId: ObjectId) => void) | undefined;
  /** Asks for a picture to replace an image's; the image's Replace is disabled without. */
  readonly onReplaceImage?: ((id: ObjectId) => void) | undefined;
  /** The board's "Show authors on stickies" setting and its toggle; absent, not built. */
  readonly stickyAuthors?: StickyAuthorsToggle | undefined;
  /**
   * Fetches a failed link card's page again; a failed card offers no Retry without.
   *
   * @param id - The card.
   * @param url - Its link.
   */
  readonly onRetryLink?: ((id: ObjectId, url: string) => void) | undefined;
}

/** The sticky row's Author toggle: whether the board shows authors, and the press. */
export interface StickyAuthorsToggle {
  /** Whether the board shows its stickies' authors. */
  readonly isShown: boolean;
  /** Turns the board's setting over. */
  readonly onToggle: () => void;
}

/**
 * The alignment dropdown: horizontal for text, and vertical too for stickies.
 *
 * @param props - The controls' props, the selection's values and whether it is stickies.
 * @param props.controls - The popover's controls' props.
 * @param props.values - What the selection shares.
 * @param props.isNotes - Whether the selection is stickies.
 * @returns The dropdown, or nothing where the text cannot be aligned.
 */
function Alignment(props: {
  readonly controls: PopoverStyleControlsProps;
  readonly values: PopoverTextValues;
  readonly isNotes: boolean;
}): ReactElement | null {
  const { controls, values } = props;
  if (values.align === undefined) return null;
  return (
    <AlignDropdown
      align={values.align}
      verticalAlign={values.verticalAlign}
      onAlign={(align) => {
        controls.onTextStyle?.({ kind: 'align', align });
      }}
      onVerticalAlign={
        props.isNotes
          ? (verticalAlign) => {
              controls.dispatch({
                type: 'style',
                changes: controls.selection.map((object) => ({
                  id: object.id,
                  style: { verticalAlign },
                })),
              });
            }
          : undefined
      }
    />
  );
}

/**
 * The selection popover's style controls (frame A and "Properties for every
 * object type"): for stickies the note colour | font, size, alignment (vertical too) | author
 * and vote; for texts font, size, bold, italic, the text colour, alignment | link (slice
 * 2b). Author is not built yet; Vote waits for a dot vote. Shapes, connectors and
 * lines take their own rows (`ShapeControls`, `LineControls`), as do sections, images
 * and several objects of mixed types (`SectionControls`, `ImageControls`, `SeveralControls`,
 *). Several objects of one type add the several-objects row's arrange buttons and Group
 * to their own row (`SameTypeArrangeControls`, item 13). Each choice is one action, so
 * one undo step however many objects are selected.
 *
 * @param props - The selection, its text style and the handlers.
 * @returns The controls, or nothing.
 */
export function PopoverStyleControls(props: PopoverStyleControlsProps): ReactElement | null {
  const { selection } = props;
  const row = typeRowOf(props);
  // Several objects of one type keep their type's row and gain arrange and Group.
  if (row === null || selection.length < 2 || isSeveralSelection(selection)) return row;
  // Sections' row ends in a rule, and unlabelled shapes' before the label controls they lack.
  const hasTrailingRule =
    isFrameSelection(selection) ||
    (isShapeSelection(selection) && selection.some((shape) => shape.label === null));
  return (
    <>
      {row}
      <SameTypeArrangeControls controls={props} hasLeadingRule={!hasTrailingRule} />
    </>
  );
}

/**
 * The row for the selection's type, or the several-objects row ({@link PopoverStyleControls}).
 *
 * @param props - The selection, its text style and the handlers.
 * @returns The row, or nothing.
 */
function typeRowOf(props: PopoverStyleControlsProps): ReactElement | null {
  const { selection } = props;
  if (isShapeSelection(selection)) return <ShapeControls controls={props} shapes={selection} />;
  if (isLineSelection(selection)) return <LineControls controls={props} lines={selection} />;
  if (isFrameSelection(selection)) return <SectionControls controls={props} frames={selection} />;
  if (isImageSelection(selection)) return <ImageControls controls={props} images={selection} />;
  const card = singleLinkCardOf(selection);
  if (card !== undefined) return <LinkCardControls controls={props} card={card} />;
  if (isSeveralSelection(selection)) return <SeveralControls controls={props} />;
  const isNotes = selection.length > 0 && selection.every((object) => object.type === 'sticky');
  const isTexts = selection.length > 0 && selection.every((object) => object.type === 'text');
  if (!isNotes && !isTexts) return null;
  const values = popoverTextValues(selection, props.textStyle);
  const textColour = (
    <PopoverColourButton
      kind="text"
      value={values.textColor ?? MIXED}
      controls={props}
      onChange={(color) => {
        if (color !== null) props.onTextStyle?.({ kind: 'style', patch: { color } });
      }}
    />
  );
  return (
    <>
      {isNotes ? (
        <>
          <PopoverColourButton
            kind="note"
            value={values.noteColor ?? MIXED}
            controls={props}
            onChange={(color) => {
              if (color === null || color === 'ink') return;
              props.dispatch({
                type: 'style',
                changes: selection.map((object) => ({ id: object.id, style: { color } })),
              });
            }}
          />
          <Divider />
        </>
      ) : null}
      <TypeControls controls={props} values={values} />
      {isTexts ? (
        <>
          <EmphasisToggles textStyle={props.textStyle} onTextStyle={props.onTextStyle} />
          {textColour}
        </>
      ) : null}
      <Alignment controls={props} values={values} isNotes={isNotes} />
      <Divider />
      {isNotes ? (
        <>
          {props.stickyAuthors === undefined ? (
            <NotYetButton label="Author" icon="invite" />
          ) : (
            <RowButton
              label="Show authors"
              icon="invite"
              isPressed={props.stickyAuthors.isShown}
              onPress={props.stickyAuthors.onToggle}
            />
          )}
          <VoteButton />
          {/* A note's links: listed only when its text carries some. */}
          {runLinkEntriesOf(selection).length > 0 ? (
            <PopoverLinkButton selection={selection} dispatch={props.dispatch} />
          ) : null}
        </>
      ) : (
        <PopoverLinkButton selection={selection} dispatch={props.dispatch} />
      )}
    </>
  );
}
