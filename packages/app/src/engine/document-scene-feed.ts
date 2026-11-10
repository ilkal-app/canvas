import type { ChangeSet, DocumentStore, OriginKind } from '@canvas/document';
import {
  InstanceExpansion,
  type ColorTokenValues,
  type SceneChangeSet,
  type SceneSource,
  type SceneSpatialIndex,
  type WorldBounds,
} from '@canvas/engine';
import { createBoard, type BoardObject, type ObjectId } from '@canvas/schema';

import type { ProjectionCapture } from '../collab/capture-cached-projection.js';

import { ChangeLog } from './change-log.js';
import type { DocumentHitIndex } from './document-hit-index.js';
import { PendingSceneObjects } from './pending-scene-objects.js';

/** One document change set as the test harness reports it: plain, structured-cloneable data. */
export interface ChangeSetSummary {
  /** The kind of origin the transaction carried (`user`, `agent`, `undo`, `system`). */
  readonly originKind: OriginKind;
  /** Objects created. */
  readonly created: readonly ObjectId[];
  /** Objects changed. */
  readonly updated: readonly ObjectId[];
  /** Objects deleted. */
  readonly deleted: readonly ObjectId[];
}

/**
 * Where the scene's changes go: the main-thread `SceneRenderer`, which reads each change set's
 * objects when its next frame runs, or the engine host's forwarder, which serialises them at
 * once for the worker (`serializeChangeSet`).
 */
export interface SceneChangeSink {
  /**
   * Takes a change set for the next frame.
   *
   * @param changes - The ids and a `get` reading the objects through the scene's source.
   */
  enqueue(changes: SceneChangeSet): void;
  /**
   * Takes the board's colour token values: sent on attach and whenever a change set
   * names `tokens`. Absent on a sink that draws no tokens.
   *
   * @param tokens - The board's token table.
   */
  setColorTokens?(tokens: ColorTokenValues): void;
}

/**
 * The document as the scene draws it, with what instances resolve their mains from when that
 * differs: a preview of a main in a variant's preset shows on the main alone, so its
 * instances read the main as stored. The scene's own source when absent.
 */
export interface PreviewedSource extends SceneSource {
  /** What instances read their mains' content from; this source when absent. */
  readonly definitions?: SceneSource;
}

/** How many objects one slice of a sliced attach sends, before ancestors, by default. */
const DEFAULT_SLICE_SIZE = 2000;

/**
 * How `DocumentSceneFeed.attach` sends a large document: what the camera shows first,
 * then the rest in slices, yielding to the browser between them, so no slice is a long task.
 */
export interface SceneAttachSlicing {
  /** The world rectangle the camera shows, whose objects go first. */
  readonly viewport: WorldBounds;
  /** Lets the browser run other tasks between slices. */
  readonly yieldToBrowser: () => Promise<void>;
  /** Called after each slice is enqueued, to send it at once (`HostView.flush`). */
  readonly afterSlice?: () => void;
  /** How many objects a slice sends, before their ancestors; default 2000. */
  readonly sliceSize?: number;
}

/**
 * Derives what the engine shows from the document: every change
 * set the store delivers goes to the scene renderer (read through `source`, the document with
 * the select tool's drag preview laid over it); the hit-test index (`DocumentHitIndex`, gated as
 * the renderer's scene is) follows the store on its own, at once, since it must answer
 * between frames (the scene's own culling index is fed only when a frame runs). A preview change
 * goes to the renderer alone, since hit testing reads the document. Main thread.
 */
export class DocumentSceneFeed {
  private readonly hits: DocumentHitIndex;
  private readonly store: DocumentStore;
  private readonly source: PreviewedSource;
  private readonly stopListening: () => void;
  private readonly stopDefinitions: () => void;
  private expansion: InstanceExpansion;
  private renderer: SceneChangeSink | undefined;
  private isDestroyed = false;
  /** The change sets the harness reads (with their total). */
  readonly changeLog = new ChangeLog();
  /** What a sliced attach still owes the renderer, while it does. */
  private pending: PendingSceneObjects | undefined;
  /**
   * Previewed objects the document does not hold (an input method composing in a text box the
   * text tool has not created yet), which the renderer has as created.
   */
  private readonly previewOnly = new Set<ObjectId>();
  /**
   * Stored objects a preview hides (a main's child its preset hides): out of the scene
   * until the source shows them again; the document still holds them.
   */
  private readonly previewHidden = new Set<ObjectId>();

  /**
   * Starts following the document.
   *
   * @param store - The document.
   * @param source - What the renderer reads objects through: the store, or a preview over it.
   * @param hits - The hit-test index, which follows the store itself.
   * @param onChange - Called after every document change, to schedule a frame.
   * @param definitions - Whole-board definitions, including off-page mains.
   */
  constructor(
    store: DocumentStore,
    source: PreviewedSource,
    hits: DocumentHitIndex,
    onChange: () => void,
    private readonly definitions: DocumentStore = store,
  ) {
    this.store = store;
    this.source = source;
    this.hits = hits;
    this.expansion = this.createExpansion();
    this.stopListening = store.subscribe((changes) => {
      this.follow(changes);
      onChange();
    });
    this.stopDefinitions = definitions.subscribe((changes) => {
      const didChange = this.followDefinitions([
        ...changes.created,
        ...changes.updated,
        ...changes.deleted,
      ]);
      // The token table is the whole board's: a page's own change sets may not name it.
      const didTokensChange = (changes.tokens?.length ?? 0) > 0 && this.sendTokens();
      if ((didChange && definitions !== store) || didTokensChange) onChange();
    });
  }

  /**
   * The document's recent change sets, oldest first (the last hundred), for the test harness:
   * one per transaction, so one per command.
   *
   * @returns The summaries.
   */
  get changes(): readonly ChangeSetSummary[] {
    return this.changeLog.recent;
  }

  /**
   * The R-tree hit testing, marquee selection, snapping and zoom to fit query, in step with the
   * store and holding drawable objects only.
   *
   * @returns The index.
   */
  get hitIndex(): SceneSpatialIndex {
    return this.hits.index;
  }

  /**
   * Starts feeding a renderer as `attach` does, a document larger than one slice in slices:
   * at once, the objects the viewport shows (up to one slice) with their ancestors;
   * after each yield, another slice, the viewport's objects first, each slice ancestor-closed. A
   * change meanwhile to an object not yet sent sends it at once.
   *
   * @param renderer - The scene renderer (or the host's forwarder), once the engine runs.
   * @param previousIds - Objects already drawn by an inert cached projection.
   * @param slicing - How to send a large document in slices.
   * @returns Resolves once every object is queued, or once the feed stops or attaches again.
   */
  attach(
    renderer: SceneChangeSink,
    previousIds: readonly ObjectId[] | undefined,
    slicing: SceneAttachSlicing,
  ): Promise<void>;
  /**
   * Starts feeding a renderer: queues the whole document for its first frame, then every change.
   *
   * @param renderer - The scene renderer (or the host's forwarder), once the engine runs.
   * @param previousIds - Objects already drawn by an inert cached projection.
   */
  attach(renderer: SceneChangeSink, previousIds?: readonly ObjectId[]): void;
  attach(
    renderer: SceneChangeSink,
    previousIds: readonly ObjectId[] = [],
    slicing?: SceneAttachSlicing,
  ): Promise<void> {
    this.renderer = renderer;
    this.pending = undefined;
    const ids = [...this.store.read().objects.keys()];
    const previous = new Set(previousIds);
    const current = new Set(ids);
    this.expansion = this.createExpansion();
    this.sendTokens();
    const deleted = previousIds.filter((id) => !current.has(id));
    const get = (id: ObjectId): BoardObject | undefined => this.source.get(id);
    const sliceSize = slicing?.sliceSize ?? DEFAULT_SLICE_SIZE;
    if (slicing === undefined || ids.length <= sliceSize) {
      this.enqueue({
        created: ids.filter((id) => !previous.has(id)),
        updated: ids.filter((id) => previous.has(id)),
        deleted,
        get,
      });
      return Promise.resolve();
    }
    const pending = new PendingSceneObjects(ids, previous);
    this.pending = pending;
    const shown = pending.prioritize(this.hits.index.searchRect(slicing.viewport));
    const first = pending.takeNext(Math.min(shown, sliceSize), this.parentOf);
    this.enqueue({ ...first, deleted, get });
    slicing.afterSlice?.();
    return this.sendSlices(pending, slicing, sliceSize);
  }

  /**
   * Queues objects whose preview changed, so the next frame redraws them from `source`; a
   * preview of an object the document does not hold is created in the scene, and deleted
   * with it; a stored object the source no longer shows leaves the scene until it shows again.
   *
   * @param ids - The objects.
   */
  previewChanged(ids: readonly ObjectId[]): void {
    if (ids.length === 0) return;
    const created: ObjectId[] = [];
    const updated: ObjectId[] = [];
    const deleted: ObjectId[] = [];
    for (const id of ids) {
      if (this.store.get(id) !== undefined) {
        const isShown = this.source.get(id) !== undefined;
        if (!isShown) {
          if (!this.previewHidden.has(id)) deleted.push(id);
          this.previewHidden.add(id);
        } else if (this.previewHidden.delete(id)) created.push(id);
        else updated.push(id);
      } else if (this.source.get(id) === undefined) {
        if (this.previewOnly.delete(id)) deleted.push(id);
      } else if (this.previewOnly.has(id)) updated.push(id);
      else {
        this.previewOnly.add(id);
        created.push(id);
      }
    }
    this.hits.setPreviewHidden(this.previewHidden);
    this.enqueueRouted({ created, updated, deleted, get: (id) => this.source.get(id) });
    this.followDefinitions(ids);
  }

  /**
   * Captures only the immutable authoritative scene, excluding every preview overlay object.
   * A page showing instances also captures the whole board's snapshot, which its mains are
   * resolved from (ruling 9), and any edit to it ends the capture.
   *
   * @returns Owned objects with a live source/lifetime fence, or undefined for a tool preview.
   */
  captureProjectionSource():
    Pick<ProjectionCapture, 'board' | 'definitions' | 'isCurrent'> | undefined {
    const board = createBoard(this.store.read().objects.values());
    const definitions = [...board.objects.values()].some((object) => object.type === 'instance')
      ? this.definitions.read()
      : undefined;
    const isCurrent = (): boolean => {
      if (
        this.isDestroyed ||
        this.previewOnly.size > 0 ||
        this.store.read().objects.size !== board.objects.size ||
        (definitions !== undefined && this.definitions.read() !== definitions)
      )
        return false;
      for (const [id, object] of board.objects) {
        if (this.store.get(id) !== object || this.source.get(id) !== object) return false;
      }
      return true;
    };
    if (!isCurrent()) return undefined;
    return definitions === undefined ? { board, isCurrent } : { board, definitions, isCurrent };
  }

  /** Stops following the document. */
  destroy(): void {
    this.isDestroyed = true;
    this.stopListening();
    this.stopDefinitions();
    this.renderer = undefined;
  }

  /**
   * Sends what a sliced attach still owes, one slice after each yield, until nothing is owed or
   * the feed stops or attaches again.
   *
   * @param pending - What is owed.
   * @param slicing - How to slice.
   * @param sliceSize - How many objects a slice sends, before ancestors.
   * @returns Resolves once done.
   */
  private async sendSlices(
    pending: PendingSceneObjects,
    slicing: SceneAttachSlicing,
    sliceSize: number,
  ): Promise<void> {
    while (pending.size > 0) {
      await slicing.yieldToBrowser();
      if (this.isDestroyed || this.pending !== pending) return;
      this.enqueue({
        ...pending.takeNext(sliceSize, this.parentOf),
        deleted: [],
        get: (id) => this.source.get(id),
      });
      slicing.afterSlice?.();
    }
    this.pending = undefined;
  }

  // The source too: a preview-only object (not stored yet) may sit under an object still owed.
  private readonly parentOf = (id: ObjectId): ObjectId | null =>
    (this.store.get(id) ?? this.source.get(id))?.parentId ?? null;

  private createExpansion(): InstanceExpansion {
    return new InstanceExpansion({
      get: (id) => (this.source.definitions ?? this.source).get(id) ?? this.definitions.get(id),
      childrenOf: (id) => this.definitions.references.childrenOf(id),
      instancesOf: (id) => this.definitions.references.instancesOf(id),
    });
  }

  /**
   * Sends the board's colour token values to the renderer, if it takes them.
   *
   * @returns Whether a renderer took them.
   */
  private sendTokens(): boolean {
    if (this.renderer?.setColorTokens === undefined) return false;
    this.renderer.setColorTokens(this.definitions.readTokens());
    return true;
  }

  private enqueue(changes: SceneChangeSet): void {
    if (this.renderer !== undefined) this.renderer.enqueue(this.expansion.expand(changes));
  }

  /**
   * Enqueues a change, first routing it through what a sliced attach still owes, if anything.
   *
   * @param changes - The change.
   */
  private enqueueRouted(changes: SceneChangeSet): void {
    if (this.pending === undefined) this.enqueue(changes);
    else {
      const routed = this.pending.route(changes, this.parentOf);
      this.enqueue({ ...routed, get: (id) => changes.get(id) });
    }
  }

  private followDefinitions(ids: readonly ObjectId[]): boolean {
    if (this.renderer === undefined) return false;
    const changes = this.expansion.dependentsOf(ids, this.source);
    if (changes === undefined) return false;
    this.renderer.enqueue(changes);
    return true;
  }

  private follow(changes: ChangeSet): void {
    const { created, updated, deleted } = changes;
    // An object created while its preview shows is already in the renderer: an update there.
    const shown = created.filter((id) => this.previewOnly.delete(id));
    const scene =
      shown.length === 0
        ? { created, updated }
        : { created: created.filter((id) => !shown.includes(id)), updated: [...updated, ...shown] };
    // An object a preview hides is out of the scene: an edit waits for the preview to end, and
    // a delete has nothing left to remove there.
    const isHidden = (id: ObjectId): boolean => this.previewHidden.has(id);
    const gone = deleted.filter((id) => !this.previewHidden.delete(id));
    if (gone.length < deleted.length) this.hits.setPreviewHidden(this.previewHidden);
    // A deleted object a preview still shows (a stroke the eraser fades) stays drawn as
    // the preview alone, so the preview's end removes it.
    for (const id of gone) if (this.source.get(id) !== undefined) this.previewOnly.add(id);
    this.enqueueRouted({
      created: scene.created,
      updated: scene.updated.filter((id) => !isHidden(id)),
      deleted: gone,
      get: (id) => this.source.get(id),
    });
    this.changeLog.add({
      originKind: changes.origin.kind,
      created,
      updated,
      deleted,
    });
  }
}
