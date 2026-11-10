import type { StylePatch } from '@canvas/document';
import type { WorldBounds } from '@canvas/engine';
import type { AutoLayout, LayoutChild, ObjectId, OverrideRecord, Point } from '@canvas/schema';
import type { ToolId } from '@canvas/tools';

import type { LayoutField } from '../panels/layout-box.js';

import type { BesideShellAction } from './beside-shell-action.js';
import type { LinkCardAction } from './link-card-action.js';
import type {
  ArrangeCommand,
  HistoryCommand,
  NavigationCommand,
  SelectionCommand,
} from './shell-commands.js';
import type { ToolStyle } from './tool-style.js';
import type { VariantComponentAction } from './variant-action.js';

export type {
  ArrangeCommand,
  HistoryCommand,
  NavigationCommand,
  SelectionCommand,
} from './shell-commands.js';

/**
 * A command on a component main or an instance from the inspector (rulings 4 and 5),
 * each one document command and so one undo step, but `goToMain`, which only navigates: it
 * shows the main's page, selects the main and zooms to it.
 */
export type ComponentAction =
  | {
      /** A component command. */
      readonly type: 'component';
      /** Override fields of one child of an instance (`setInstanceOverride`). */
      readonly command: 'setOverride';
      /** The instance. */
      readonly id: ObjectId;
      /** The child's path: nested instance ids, then the child's id, joined by `/`. */
      readonly path: string;
      /** The fields to set; the child's other overrides are kept. */
      readonly override: OverrideRecord;
    }
  | {
      /** A component command. */
      readonly type: 'component';
      /** Clear an instance's overrides (`resetInstanceOverrides`): one child's, or all. */
      readonly command: 'resetOverrides';
      /** The instance. */
      readonly id: ObjectId;
      /** The child's path; every child's overrides when absent. */
      readonly path?: string;
      /** The fields to clear; all of them when absent. */
      readonly fields?: readonly (keyof OverrideRecord)[];
    }
  | {
      /** A component command. */
      readonly type: 'component';
      /** Set an instance's content scale (`resizeObjects`' scale arm), 1 to reset. */
      readonly command: 'setScale';
      /** The instance. */
      readonly id: ObjectId;
      /** The new scale, 0.05 to 20. */
      readonly scale: number;
    }
  | {
      /** A component command. */
      readonly type: 'component';
      /**
       * `detach`: make an instance a frame of plain objects (`detachInstance`); `placeInstance`:
       * place an instance of a main to its right on its page (`createInstance`), and select it;
       * `goToMain`: show the main's page, select it and zoom to it (not an edit); board search
       * goes to any object this way.
       */
      readonly command: 'detach' | 'placeInstance' | 'goToMain';
      /**
       * The instance (`detach`), the main (`placeInstance`, `goToMain`) or, from board search,
       * any object (`goToMain`).
       */
      readonly id: ObjectId;
    }
  | {
      /** A component command. */
      readonly type: 'component';
      /**
       * Place an instance of a main centred on a point, at the root of the page shown, and
       * select it (`createInstance`; the components panel, ruling 3). The mount's clipboard side
       * runs it: it knows the view.
       */
      readonly command: 'placeInstanceAt';
      /** The main, on any page. */
      readonly id: ObjectId;
      /** The instance's centre, world units; the view's centre when absent. */
      readonly at?: Point;
    }
  | {
      /** A component command. */
      readonly type: 'component';
      /** Rename a main, or any object from its layers row (`renameObject`). */
      readonly command: 'rename';
      /** The object. */
      readonly id: ObjectId;
      /** Its new name, at most 200 characters; empty clears it. */
      readonly name: string;
    }
  | {
      /** A component command. */
      readonly type: 'component';
      /** Set or clear the mains a slot may be swapped to (`setSwapOptions`). */
      readonly command: 'setSwapOptions';
      /** The slot: an instance inside a main. */
      readonly id: ObjectId;
      /** The mains, 1 to 64 distinct live ones; `null` allows any live main. */
      readonly options: readonly ObjectId[] | null;
    }
  | VariantComponentAction;

/** One of the commands a {@link ComponentAction} names. */
export type ComponentCommand = ComponentAction['command'];

/** One object's restyle, as the style panel asks for it: only the fields it sets. */
export interface StyleChange {
  /** The object. */
  readonly id: ObjectId;
  /** The appearance fields to set; each must be one the object's type takes. */
  readonly style: StylePatch;
}

/** The direction an arrow key nudges the selection. */
export type NudgeDirection = 'up' | 'down' | 'left' | 'right';

/**
 * An action addressed to the canvas rather than the shell: the shell records it and the
 * engine and tools, as they arrive, act on it.
 */
export type CanvasAction =
  | {
      /** A camera or view command. */
      readonly type: 'navigate';
      /** Which one. */
      readonly command: NavigationCommand;
    }
  | {
      /** Frame a world rectangle (the threads of a comment cluster). */
      readonly type: 'frame';
      /** The rectangle, world units. */
      readonly bounds: WorldBounds;
    }
  | {
      /** A command on the selection or the clipboard. */
      readonly type: 'selection';
      /** Which one. */
      readonly command: SelectionCommand;
    }
  | {
      /** Move the selection with an arrow key. */
      readonly type: 'nudge';
      /** Which way. */
      readonly direction: NudgeDirection;
      /** Whether this is the large nudge (Shift held) rather than the one-pixel one. */
      readonly isLarge: boolean;
    }
  | {
      /** A grouping, z-order, alignment or distribution command. */
      readonly type: 'arrange';
      /** Which one. */
      readonly command: ArrangeCommand;
    }
  | {
      /** Undo or redo. */
      readonly type: 'history';
      /** Which one. */
      readonly command: HistoryCommand;
    }
  | {
      /**
       * Restyle objects from the style panel: one `setStyle` command,
       * so one undo step, however many objects it touches.
       */
      readonly type: 'style';
      /** One entry per object, with only the fields being set. */
      readonly changes: readonly StyleChange[];
    }
  | {
      /**
       * Lock or unlock given objects, whatever is selected (a layers panel row's lock): one
       * `setLocked` command, so one undo step; locked as a whole, they unlock, else they lock.
       * The selection is left as it is.
       */
      readonly type: 'toggleLockOf';
      /** The objects. */
      readonly ids: readonly ObjectId[];
    }
  | {
      /**
       * Place objects from the layers panel's drag and drop or its keys: one
       * `placeObjects` command, so one undo step, directly below a sibling or on top of a frame,
       * group or the root, taking them into it where they are on the board. The selection is
       * left as it is.
       */
      readonly type: 'placeLayers';
      /** The objects. */
      readonly ids: readonly ObjectId[];
      /** The frame, group or main they end up in, or null for the root. */
      readonly parentId: ObjectId | null;
      /** The child of that parent they go directly below; on top when absent. */
      readonly belowId?: ObjectId;
    }
  | {
      /**
       * Set one layout field of objects from the inspector's layout section: X, Y, W,
       * H or rotation, run as the existing `moveObjects`, `resizeObjects` or `rotateObjects`
       * command (`planLayoutChange`), so one undo step; locked objects refuse it.
       */
      readonly type: 'layout';
      /** The objects. */
      readonly ids: readonly ObjectId[];
      /** Which field. */
      readonly field: LayoutField;
      /**
       * The value: X and Y the left and top of each object's box on the board and W and H its
       * size, world units; rotation in degrees, clockwise.
       */
      readonly value: number;
    }
  | {
      /**
       * Fit a section to its content (the section popover): one `fitFrameToContent`
       * command, so one undo step; nothing moves on the board.
       */
      readonly type: 'fitToContent';
      /** The section. */
      readonly id: ObjectId;
    }
  | LinkCardAction
  | {
      /**
       * Replace an image's picture (the image popover): one `replaceImage` command, so
       * one undo step; the image keeps its box and, where it fits, its crop.
       */
      readonly type: 'replaceImage';
      /** The image. */
      readonly id: ObjectId;
      /** The new picture's asset. */
      readonly assetId: string;
      /** The new picture's size, px. */
      readonly naturalSize: {
        /** Its width, px. */
        readonly width: number;
        /** Its height, px. */
        readonly height: number;
      };
    }
  | {
      /**
       * Change frames' and mains' live auto-layout, or how boxes sit in one, from the inspector:
       * one `setAutoLayout` (`set`: add one, or remove it with null),
       * `patchAutoLayout` (`patch`: some fields, each container keeping the rest) or
       * `setLayoutChild` (`child`: whether boxes fill their container) command, so one undo
       * step, laid out in the same transaction; locked objects refuse it.
       */
      readonly type: 'autoLayout';
      /** The containers (`set`, `patch`) or the boxes (`child`). */
      readonly ids: readonly ObjectId[];
      /**
       * What changes: a whole auto-layout set (`null` removes it), some of its fields patched
       * (padding per side), or how the boxes sit in their container.
       */
      readonly change:
        | {
            /** Set a whole auto-layout. */
            readonly kind: 'set';
            /** The auto-layout, or null to remove it, the children staying where they are. */
            readonly autoLayout: AutoLayout | null;
          }
        | {
            /** Change some fields of each container's own auto-layout. */
            readonly kind: 'patch';
            /** The fields to set; the others keep each container's own. */
            readonly patch: Omit<Partial<AutoLayout>, 'padding'> & {
              /** The padding sides to set; the others keep each container's own. */
              readonly padding?: Partial<AutoLayout['padding']>;
            };
          }
        | {
            /** Set how the boxes sit in their container. */
            readonly kind: 'child';
            /** Whether each fills the space left, or null to remove it. */
            readonly layoutChild: LayoutChild | null;
          };
    }
  | ComponentAction
  | BesideShellAction
  | {
      /**
       * The toolbar's button of the tool shown as active was pressed again: a mode an activation
       * or a sub-tool switch started under that tool's name ends and the tool starts afresh
       * (the Select button leaves vector editing, which shows the select tool); the
       * tool's own mode carries on. Its key does not do this (V in vector editing stays).
       */
      readonly type: 'reselectTool';
      /** The tool. */
      readonly tool: ToolId;
    };

/**
 * Everything the shell can be asked to do, from a shortcut, a toolbar button or a menu. A
 * discriminated union on `type`, reduced by `shellReducer`.
 */
export type ShellAction =
  | {
      /** Make a tool the active one. */
      readonly type: 'selectTool';
      /** The tool. */
      readonly tool: ToolId;
      /**
       * Fields to set in the tool's style as it becomes active: a tool variant
       * (`tool-variants.ts`, the line tool's arrow); the style is kept as it is when absent.
       */
      readonly style?: ToolStyle;
      /**
       * When present, a field of `style` is set only while the tool's style holds the value given
       * here for it (`ToolVariant.replaces`): `l` turns the arrow's end cap back to none and
       * keeps a cap chosen in the panel.
       */
      readonly replaces?: ToolStyle;
    }
  | {
      /** Open the shortcut cheat sheet, or close it if open. */
      readonly type: 'toggleCheatSheet';
    }
  | {
      /** Close the shortcut cheat sheet. */
      readonly type: 'closeCheatSheet';
    }
  | {
      /** Show the developer overlay (frame timings and GPU memory), or hide it if shown. */
      readonly type: 'toggleDeveloperOverlay';
    }
  | {
      /** Open the layers drawer over the canvas's left side, or close it if open. */
      readonly type: 'toggleLayersDrawer';
    }
  | {
      /**
       * Open the board search sheet under the floating board bar and move focus into its field
       * (mod+f under the floating chrome); the bar keeps whether it is open.
       */
      readonly type: 'openBoardSearch';
    }
  | {
      /**
       * Open the inspector drawer and move focus into it, or close it (alt+8). The
       * shell's drawer (`useInspectorDrawer`) takes it before the reducer, which keeps no state
       * of it.
       */
      readonly type: 'toggleInspector';
    }
  | {
      /**
       * Turn the person's "delete connectors with their objects" preference on or off:
       * whether a delete deletes attached connectors rather than detaching them.
       */
      readonly type: 'toggleDeleteConnectors';
    }
  | {
      /**
       * Set fields of the style a creation tool gives new objects, from the style panel while
       * that tool is active and nothing is selected.
       */
      readonly type: 'setToolStyle';
      /** The creation tool. */
      readonly tool: ToolId;
      /** The fields to set; the others keep their values. */
      readonly style: ToolStyle;
      /**
       * Whether the colour the tool creates with (a stroke's, the text tool's text's) was just
       * picked as Ink (true) or as a fixed colour or none (false); unchanged when absent
       * (`ShellState.pickedInk`).
       */
      readonly isInkPick?: boolean;
    }
  | {
      /**
       * Whether the person may edit the board, as the board's connection says (the
       * relay's answer for their token; a viewer or a commenter may not). The shell dispatches it
       * when that changes; while they may not, every editing action does nothing
       * (`isEditingAction`) and the select tool is the active one.
       */
      readonly type: 'setEditable';
      /** Whether they may edit. */
      readonly canEdit: boolean;
    }
  | CanvasAction;
