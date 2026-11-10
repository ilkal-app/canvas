import type { ChangeSet, OriginKind } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type { ObjectChanges } from '../document/canvas-document.js';

/**
 * A change to the board, by the person, an agent, an undo, or the board's own repair: its objects,
 * and its pages, colour tokens and named styles, each list empty when it touched none of them.
 */
export interface CanvasChangeEvent extends ObjectChanges {
  /** The pages it changed (added, renamed, reordered, removed). */
  readonly pages: NonNullable<ChangeSet['pages']>;
  /** The colour tokens it changed. */
  readonly tokens: NonNullable<ChangeSet['tokens']>;
  /** The named text styles it changed. */
  readonly textStyles: NonNullable<ChangeSet['textStyles']>;
  /** The named effect styles it changed. */
  readonly effectStyles: NonNullable<ChangeSet['effectStyles']>;
  /** What kind of actor made it. */
  readonly origin: OriginKind;
}

/**
 * The change event of a store's change set: every list present, empty when untouched.
 *
 * @param changes - The change set.
 * @returns The event.
 */
export function changeEventOf(changes: ChangeSet): CanvasChangeEvent {
  return {
    created: changes.created,
    updated: changes.updated,
    deleted: changes.deleted,
    pages: changes.pages ?? [],
    tokens: changes.tokens ?? [],
    textStyles: changes.textStyles ?? [],
    effectStyles: changes.effectStyles ?? [],
    origin: changes.origin.kind,
  };
}

/** The person's selection, after it changed. */
export interface CanvasSelectionEvent {
  /** The selected objects' ids; empty when nothing is selected. */
  readonly ids: readonly ObjectId[];
}

/** Something that went wrong without stopping the board. */
export interface CanvasErrorEvent {
  /**
   * Where: the device's storage (a `device` board's IndexedDB cannot open, read or write), or
   * the renderer (no WebGPU or WebGL2, a worker that stopped).
   */
  readonly source: 'storage' | 'engine';
  /** The error. */
  readonly error: unknown;
}

/** The events a mounted board sends, by type (`CanvasInstance.on`). */
export interface CanvasEvents {
  /** The board's objects changed. */
  readonly change: CanvasChangeEvent;
  /** The person's selection changed. */
  readonly selection: CanvasSelectionEvent;
  /** Something went wrong; with no `error` listener, it is reported to the page. */
  readonly error: CanvasErrorEvent;
}

/** Receives one type of event. */
export type CanvasListener<Type extends keyof CanvasEvents> = (event: CanvasEvents[Type]) => void;

/** Listeners by event type, and sending to them. */
export interface CanvasEventHub {
  /**
   * Adds a listener.
   *
   * @param type - The event type.
   * @param listener - Called with each event of that type.
   * @returns A function that removes it.
   */
  on<Type extends keyof CanvasEvents>(type: Type, listener: CanvasListener<Type>): () => void;
  /**
   * Sends an event to every listener of its type. A listener that throws is reported to the page
   * and the others still hear it; an error event with no listener is reported to the page.
   *
   * @param type - The event type.
   * @param event - The event.
   */
  emit<Type extends keyof CanvasEvents>(type: Type, event: CanvasEvents[Type]): void;
  /** Removes every listener. */
  clear(): void;
}

/**
 * Makes an event hub.
 *
 * @param report - Where errors no listener takes go; the page's `reportError` if absent.
 * @returns The hub.
 */
export function createCanvasEventHub(
  report: (error: unknown) => void = (error) => {
    reportError(error);
  },
): CanvasEventHub {
  const listeners = new Map<keyof CanvasEvents, Set<(event: never) => void>>();
  return {
    on(type, listener) {
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set);
      const added = listener as (event: never) => void;
      set.add(added);
      return () => {
        set.delete(added);
      };
    },
    emit(type, event) {
      const set = listeners.get(type);
      if (set === undefined || set.size === 0) {
        if (type === 'error') report((event as CanvasErrorEvent).error);
        return;
      }
      for (const listener of [...set]) {
        try {
          (listener as (event: CanvasEvents[typeof type]) => void)(event);
        } catch (error: unknown) {
          report(error);
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}
