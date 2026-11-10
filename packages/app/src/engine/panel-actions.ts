import {
  batchCommand,
  fitFrameToContentCommand,
  linkCardToTextCommand,
  setLinkLayoutCommand,
  replaceImageCommand,
  runCommand,
  setTextRunsCommand,
  type CommandEnvironment,
  type CommandError,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import {
  normalizeLink,
  type BoardObject,
  type ObjectId,
  type StyleRun,
  type TextContent,
} from '@canvas/schema';
import { applyStyle, linkSpansOf } from '@canvas/tools';

import { PASTED_TEXT_STYLE } from '../clipboard/pasted-text.js';
import type { CharacterRange } from '../state/beside-shell-action.js';
import type { CanvasAction } from '../state/shell-action.js';

/** The canvas actions a panel or the selection popover dispatches, which `DocumentPanels` runs. */
export type PanelAction = Extract<
  CanvasAction,
  {
    readonly type:
      | 'style'
      | 'layout'
      | 'toggleLockOf'
      | 'placeLayers'
      | 'colorToken'
      | 'autoLayout'
      | 'fitToContent'
      | 'linkCard'
      | 'replaceImage'
      | 'relinkText';
  }
>;

/** The kinds of {@link PanelAction}. */
const PANEL_ACTION_TYPES: ReadonlySet<CanvasAction['type']> = new Set([
  'style',
  'layout',
  'toggleLockOf',
  'placeLayers',
  'colorToken',
  'autoLayout',
  'fitToContent',
  'linkCard',
  'replaceImage',
  'relinkText',
]);

/** Several texts' runs replaced as one command, one undo step (a relink). */
const SET_TEXT_RUNS_BATCH = batchCommand(setTextRunsCommand, 'edits');

/**
 * Whether a canvas action is one `DocumentPanels.runAction` runs.
 *
 * @param action - The action.
 * @returns True for a panel action.
 */
export function isPanelAction(action: CanvasAction): action is PanelAction {
  return PANEL_ACTION_TYPES.has(action.type);
}

/** What fitting a section writes with and where a refusal goes. */
export interface FitEdits {
  /** The board's store. */
  readonly store: DocumentStore;
  /** The person's origin. */
  readonly origin: TransactionOrigin;
  /** The command environment. */
  readonly environment: CommandEnvironment;
}

/**
 * Fits a section to its content (the section popover's Fit to content): one
 * `fitFrameToContent` command, so one undo step; a refusal (a locked or auto-layout section, one
 * with nothing to fit, a collaborator's change meanwhile) writes nothing and is reported.
 *
 * @param edits - The store, origin and environment.
 * @param id - The section.
 * @param onRefused - Reports a refusal.
 */
export function runFitToContent(
  edits: FitEdits,
  id: ObjectId,
  onRefused: (errors: readonly CommandError[]) => void,
): void {
  const { store, origin, environment } = edits;
  const outcome = runCommand(store, origin, fitFrameToContentCommand, { id }, environment);
  if (outcome.status === 'rejected') onRefused(outcome.errors);
}

/**
 * Replaces an image's picture (the image popover's Replace): one `replaceImage` command,
 * so one undo step; a refusal (a locked or deleted image) writes nothing and is reported.
 *
 * @param edits - The store, origin and environment.
 * @param action - The image, the new asset and its natural size.
 * @param onRefused - Reports a refusal.
 */
export function runReplaceImage(
  edits: FitEdits,
  action: Extract<CanvasAction, { readonly type: 'replaceImage' }>,
  onRefused: (errors: readonly CommandError[]) => void,
): void {
  const { store, origin, environment } = edits;
  const input = {
    id: action.id,
    assetId: action.assetId,
    naturalSize: { width: action.naturalSize.width, height: action.naturalSize.height },
  };
  const outcome = runCommand(store, origin, replaceImageCommand, input, environment);
  if (outcome.status === 'rejected') onRefused(outcome.errors);
}

/** The panel actions that edit named objects with one command each. */
type ObjectEdit = Extract<
  PanelAction,
  { readonly type: 'fitToContent' | 'replaceImage' | 'linkCard' | 'relinkText' }
>;

/**
 * Whether a panel action edits named objects with one command (`runObjectEdit`).
 *
 * @param action - The action.
 * @returns True for a section fit, an image replace, a link card edit or a relink.
 */
export function isObjectEdit(action: PanelAction): action is ObjectEdit {
  return (
    action.type === 'fitToContent' ||
    action.type === 'replaceImage' ||
    action.type === 'linkCard' ||
    action.type === 'relinkText'
  );
}

/**
 * Runs a panel action that edits named objects with one command, so one undo step.
 *
 * @param edits - The store, origin and environment.
 * @param action - The action.
 * @param onRefused - Reports a refusal.
 */
export function runObjectEdit(
  edits: FitEdits,
  action: ObjectEdit,
  onRefused: (errors: readonly CommandError[]) => void,
): void {
  if (action.type === 'fitToContent') runFitToContent(edits, action.id, onRefused);
  else if (action.type === 'replaceImage') runReplaceImage(edits, action, onRefused);
  else if (action.type === 'linkCard') runLinkCard(edits, action, onRefused);
  else runRelinkText(edits, action, onRefused);
}

/**
 * Runs a link card's popover edit: its layout (`setLinkLayout`) or turning it into a
 * text link in the pasted text's style (`linkCardToText`); one command, so one undo step. A
 * refusal (a deleted card, a collaborator's change meanwhile) writes nothing and is reported.
 *
 * @param edits - The store, origin and environment.
 * @param action - The card and the edit.
 * @param onRefused - Reports a refusal.
 */
export function runLinkCard(
  edits: FitEdits,
  action: Extract<CanvasAction, { readonly type: 'linkCard' }>,
  onRefused: (errors: readonly CommandError[]) => void,
): void {
  const { store, origin, environment } = edits;
  const { change } = action;
  const outcome =
    change.kind === 'layout'
      ? runCommand(
          store,
          origin,
          setLinkLayoutCommand,
          { ids: [action.id], layout: change.layout },
          environment,
        )
      : runCommand(
          store,
          origin,
          linkCardToTextCommand,
          { id: action.id, style: { ...PASTED_TEXT_STYLE } },
          environment,
        );
  if (outcome.status === 'rejected') onRefused(outcome.errors);
}

/**
 * The runs of the text an object draws, which may carry run links: a text's or sticky's, or a
 * shape's or connector's label.
 *
 * @param object - The object, if it is on the board.
 * @returns The characters and runs, or undefined when it draws no text.
 */
function drawnContentOf(object: BoardObject | undefined): TextContent | undefined {
  if (object?.type === 'text' || object?.type === 'sticky') return object;
  if ((object?.type === 'shape' || object?.type === 'connector') && object.label !== null) {
    return object.label;
  }
  return undefined;
}

/**
 * Whether every range of a text is still exactly a stretch of characters carrying `link`, as
 * `linkSpansOf` reads its runs now.
 *
 * @param runs - The text's runs now.
 * @param ranges - The ranges.
 * @param link - The link they should carry.
 * @returns True when each range is one of its spans of that link.
 */
function isStillLinked(
  runs: readonly StyleRun[],
  ranges: readonly CharacterRange[],
  link: string,
): boolean {
  const spans = linkSpansOf(runs);
  return ranges.every(({ start, end }) =>
    spans.some((span) => span.link === link && span.start === start && span.end === end),
  );
}

/**
 * Changes or removes a link on ranges of texts' characters (the link chip's and the
 * Links list's Edit and Remove): each text's ranges relinked (`applyStyle` with the link, or
 * `null` to remove it), written as one batch of `setTextRuns` edits, so one transaction and one
 * undo step however many texts, each writing only its restyled ranges; the characters stay.
 * Nothing is written when any range is no longer exactly a stretch carrying `from` (a
 * collaborator's edit moved or changed the link since the chip or list showed it), when a text
 * is gone, or for a link `normalizeLink` would change; a refusal (a locked object) writes
 * nothing and is reported.
 *
 * @param edits - The store, origin and environment.
 * @param action - The texts and ranges, the link they carry and the new one.
 * @param onRefused - Reports a refusal.
 */
export function runRelinkText(
  edits: FitEdits,
  action: Extract<CanvasAction, { readonly type: 'relinkText' }>,
  onRefused: (errors: readonly CommandError[]) => void,
): void {
  const { store, origin, environment } = edits;
  const { targets, from, link } = action;
  if (targets.length === 0 || (link !== null && normalizeLink(link) !== link)) return;
  const written = [];
  for (const { id, ranges } of targets) {
    const content = drawnContentOf(store.get(id));
    if (content === undefined || ranges.length === 0) return;
    if (!isStillLinked(content.runs, ranges, from)) return;
    const runs = ranges.reduce<readonly StyleRun[]>(
      (relinked, { start, end }) => applyStyle(relinked, start, end, { link }),
      content.runs,
    );
    // The command's input is JSON-shaped (agents send it too), so it takes plain arrays.
    // The whole value: the paragraph styles go with the text, or setTextRuns clears them.
    const paragraphs =
      content.paragraphs === undefined ? {} : { paragraphs: [...content.paragraphs] };
    written.push({ id, text: content.text, runs: [...runs], ...paragraphs });
  }
  const outcome = runCommand(store, origin, SET_TEXT_RUNS_BATCH, { edits: written }, environment);
  if (outcome.status === 'rejected') onRefused(outcome.errors);
}
