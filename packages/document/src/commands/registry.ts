import type { z } from 'zod';

import type { AnyCommand, Command } from './command.js';
import { connectCommand } from './connect.js';
import { createComponentCommand } from './create-component.js';
import { createFrameCommand } from './create-frame.js';
import { createInstanceCommand } from './create-instance.js';
import { createObjectCommand } from './create-object.js';
import { createObjectsCommand } from './create-objects.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { detachInstanceCommand } from './detach-instance.js';
import { editNetworkCommand } from './edit-network.js';
import { setBoardTimerCommand } from './facilitation/set-board-timer.js';
import { setStickyAuthorsCommand } from './facilitation/set-sticky-authors.js';
import { fitFrameToContentCommand } from './fit-frame-to-content.js';
import { groupCommand } from './group.js';
import { linkCardToTextCommand, retryLinkUnfurlCommand } from './link-card-edits.js';
import { applyLinkUnfurlCommand, setLinkLayoutCommand } from './link-card.js';
import { moveObjectsCommand } from './move-objects.js';
import { addPageCommand } from './pages/add-page.js';
import { deletePageCommand } from './pages/delete-page.js';
import { duplicatePageCommand } from './pages/duplicate-page.js';
import { moveObjectsToPageCommand } from './pages/move-to-page.js';
import { renamePageCommand } from './pages/rename-page.js';
import { reorderPageCommand } from './pages/reorder-page.js';
import { patchAutoLayoutCommand } from './patch-auto-layout.js';
import { placeObjectsCommand } from './place-objects.js';
import { renameFrameCommand } from './rename-frame.js';
import { renameObjectCommand } from './rename-object.js';
import {
  bringForwardCommand,
  bringToFrontCommand,
  sendBackwardCommand,
  sendToBackCommand,
} from './reorder.js';
import { replaceFontFamilyCommand } from './replace-font-family.js';
import { replaceImageCommand } from './replace-image.js';
import { resetInstanceOverridesCommand } from './reset-instance-overrides.js';
import { resizeObjectsCommand } from './resize-objects.js';
import { rotateObjectsCommand } from './rotate-objects.js';
import { setAutoLayoutCommand, setLayoutChildCommand } from './set-auto-layout.js';
import { setConnectorEndCommand } from './set-connector-end.js';
import { setConstraintsCommand } from './set-constraints.js';
import { setInstanceOverrideCommand } from './set-instance-override.js';
import { setInstanceVariantCommand } from './set-instance-variant.js';
import { setLinePointsCommand } from './set-line-points.js';
import { setLockedCommand } from './set-locked.js';
import { setStyleCommand } from './set-style.js';
import { setSwapOptionsCommand } from './set-swap-options.js';
import { setTextRunsCommand } from './set-text-runs.js';
import { setVariantAxesCommand } from './set-variant-axes.js';
import { resetVariantPresetCommand, setVariantPresetCommand } from './set-variant-preset.js';
import { deleteEffectStyleCommand, deleteTextStyleCommand } from './styles/delete-named-style.js';
import { setEffectStyleCommand, setTextStyleCommand } from './styles/set-named-style.js';
import { deleteColorTokenCommand } from './tokens/delete-color-token.js';
import { renameColorTokenCommand } from './tokens/rename-color-token.js';
import { resetColorTokenCommand } from './tokens/reset-color-token.js';
import { setColorTokenCommand } from './tokens/set-color-token.js';
import { ungroupCommand } from './ungroup.js';

/**
 * Every command of the command layer, by name: what the MCP server and the headless
 * client expose, and what `findCommand` looks names up in. Each key is its command's
 * `name`. To add a command, import it and add one entry.
 */
export const COMMANDS = {
  /** Materializes an instance as a same-id frame. */
  detachInstance: detachInstanceCommand,
  /** Restores inheritance from a main. */
  resetInstanceOverrides: resetInstanceOverridesCommand,
  /** Sets child pin/stretch behavior. */
  setConstraints: setConstraintsCommand,
  /** Sets or removes a frame's or main's auto-layout. */
  setAutoLayout: setAutoLayoutCommand,
  /** Sets or removes how a box sizes inside an auto-layout container. */
  setLayoutChild: setLayoutChildCommand,
  /** Changes some fields of the auto-layout of frames and mains that have one. */
  patchAutoLayout: patchAutoLayoutCommand,
  /** Changes one instance child override. */
  setInstanceOverride: setInstanceOverrideCommand,
  /** Switches an instance's variant, dropping own overrides the variant controls. */
  setInstanceVariant: setInstanceVariantCommand,
  /** Sets a main's variant axes, carrying presets and choices across renames. */
  setVariantAxes: setVariantAxesCommand,
  /** Sets fields of one variant value's preset. */
  setVariantPreset: setVariantPresetCommand,
  /** Resets a variant value's preset, one path of it or some fields. */
  resetVariantPreset: resetVariantPresetCommand,
  /** Sets or clears the mains a slot may be swapped to. */
  setSwapOptions: setSwapOptionsCommand,
  /** Creates a board-local reusable definition. */
  createComponent: createComponentCommand,
  /** Places a reference to a live main. */
  createInstance: createInstanceCommand,
  /** Creates one object of any type. */
  createObject: createObjectCommand,
  /** Creates several objects in one step, with fresh ids and references between them kept. */
  createObjects: createObjectsCommand,
  /** Creates a frame and takes objects into it in one step. */
  createFrame: createFrameCommand,
  /** Sets a frame's name. */
  renameFrame: renameFrameCommand,
  /** Sets any object's layer name. */
  renameObject: renameObjectCommand,
  /** Deletes objects with their descendants. */
  deleteObjects: deleteObjectsCommand,
  /** Moves objects in board coordinates. */
  moveObjects: moveObjectsCommand,
  /** Resizes boxed objects and groups. */
  resizeObjects: resizeObjectsCommand,
  /** Turns objects about a point. */
  rotateObjects: rotateObjectsCommand,
  /** Sets objects' appearance fields. */
  setStyle: setStyleCommand,
  /** Replaces a text's or label's characters and runs. */
  setTextRuns: setTextRunsCommand,
  /** Groups objects that share a parent. */
  group: groupCommand,
  /** Dissolves groups, keeping their children in place. */
  ungroup: ungroupCommand,
  /** Creates a connector. */
  connect: connectCommand,
  /** Moves objects above all their siblings. */
  bringToFront: bringToFrontCommand,
  /** Moves objects below all their siblings. */
  sendToBack: sendToBackCommand,
  /** Moves objects one step up among their siblings. */
  bringForward: bringForwardCommand,
  /** Moves objects one step down among their siblings. */
  sendBackward: sendBackwardCommand,
  /** Places objects directly below a sibling or on top, in a frame, group or the root. */
  placeObjects: placeObjectsCommand,
  /** Locks or unlocks objects. */
  setLocked: setLockedCommand,
  /** Writes a fetched page's preview into a pending link card, once. */
  applyLinkUnfurl: applyLinkUnfurlCommand,
  /** Sets link cards' layout. */
  setLinkLayout: setLinkLayoutCommand,
  /** Fetches a failed link card's page again: back to pending under a new key. */
  retryLinkUnfurl: retryLinkUnfurlCommand,
  /** Turns a link card into a text linked to its page. */
  linkCardToText: linkCardToTextCommand,
  /** Moves a line's two end points. */
  setLinePoints: setLinePointsCommand,
  /** Attaches one end of a connector to an object, or frees it at a board point. */
  setConnectorEnd: setConnectorEndCommand,
  /** Sets and deletes a path's vertices and segments by id. */
  editNetwork: editNetworkCommand,
  /** Adds a page. */
  addPage: addPageCommand,
  /** Sets a page's name. */
  renamePage: renamePageCommand,
  /** Moves a page in the page order. */
  reorderPage: reorderPageCommand,
  /** Copies a page and its objects. */
  duplicatePage: duplicatePageCommand,
  /** Deletes a page and its objects. */
  deletePage: deletePageCommand,
  /** Moves objects to another page. */
  moveObjectsToPage: moveObjectsToPageCommand,
  /** Creates a colour token, or sets a token's name and values. */
  setColorToken: setColorTokenCommand,
  /** Sets a custom colour token's name. */
  renameColorToken: renameColorTokenCommand,
  /** Deletes a custom colour token. */
  deleteColorToken: deleteColorTokenCommand,
  /** Restores a built-in colour token's defaults. */
  resetColorToken: resetColorTokenCommand,
  /** Creates a text style, or sets one's name and value, rewriting its runs. */
  setTextStyle: setTextStyleCommand,
  /** Deletes a text style, detaching its runs. */
  deleteTextStyle: deleteTextStyleCommand,
  /** Replaces a font family everywhere the board names it, in one undo step. */
  replaceFontFamily: replaceFontFamilyCommand,
  /** Creates an effect style, or sets one's name and layers, rewriting its objects. */
  setEffectStyle: setEffectStyleCommand,
  /** Deletes an effect style, detaching its objects. */
  deleteEffectStyle: deleteEffectStyleCommand,
  /** Starts, pauses, resumes, resets or ends the board timer. */
  setBoardTimer: setBoardTimerCommand,
  /** Shows or hides the authors on the board's stickies. */
  setStickyAuthors: setStickyAuthorsCommand,
  /** Fits a section to its content, keeping everything's place on the board. */
  fitFrameToContent: fitFrameToContentCommand,
  /** Replaces an image's picture, keeping its box and, where it fits, its crop. */
  replaceImage: replaceImageCommand,
} as const satisfies Readonly<Record<string, AnyCommand>>;

/** The name of a registered command. */
export type CommandName = keyof typeof COMMANDS;

/** What a registered command takes, before its schema parses it (the SDK's `run`). */
export type CommandInput<Name extends CommandName> = z.input<(typeof COMMANDS)[Name]['input']>;

/** What a registered command returns when it applies. */
export type CommandResult<Name extends CommandName> =
  (typeof COMMANDS)[Name] extends Command<z.ZodType, unknown, infer Result> ? Result : never;

/**
 * Finds a command by name, for callers that receive names as data (an agent's tool call).
 *
 * @param name - The command name.
 * @returns The command, or `undefined` when there is none by that name.
 */
export function findCommand(name: string): AnyCommand | undefined {
  return Object.hasOwn(COMMANDS, name) ? COMMANDS[name as CommandName] : undefined;
}
