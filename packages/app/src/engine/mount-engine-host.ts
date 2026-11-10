import {
  isSameCamera,
  type BenchmarkSample,
  type Camera,
  type EngineHost,
  type EngineHostKind,
} from '@canvas/engine';
import { resizeCameraViewport, type CameraInput, type ToolId } from '@canvas/tools';

import type { CanvasBackingSize } from '../canvas/backing-store-size.js';
import type { ClipboardFlavours } from '../clipboard/clipboard-formats.js';
import type { PreparedCut } from '../clipboard/clipboard-source.js';
import type { PasteTarget } from '../clipboard/paste-handlers.js';
import { captureLiveProjection } from '../collab/capture-cached-projection.js';
import { HostFrameFeed } from '../diagnostics/ink-debug/host-frame-feed.js';
import type { OverlayLabelFeed } from '../editing/overlay-label-feed.js';
import type { PixelBlock, PixelRect } from '../harness/canvas-harness.js';
import { mountLiveInk } from '../live-ink/live-ink-hand-off.js';
import { keepPageCameras } from '../pages/page-cameras.js';
import type { CanvasAction } from '../state/shell-action.js';
import type { ToolStyle } from '../state/tool-style.js';
import type { ViewPreferences } from '../state/view-preferences.js';
import { pageTextFonts, PAGE_TEXT_LAYOUT } from '../text-input/page-fonts.js';

import type { BoardView } from './board-view.js';
import { bindCameraInput } from './camera-input-binding.js';
import { planCameraInput } from './camera-input-plan.js';
import { cameraInputForCanvasAction } from './canvas-action-input.js';
import { CanvasCursor } from './canvas-cursor.js';
import { createEngineDocument } from './create-engine-document.js';
import type { TextStyleChange } from './document-text.js';
import { EngineClipboard } from './engine-clipboard.js';
import type { EngineDocument, EngineInspection } from './engine-document.js';
import { EngineGlide } from './engine-glide.js';
import { holdEngineHost } from './engine-host-lease.js';
import {
  announceEngine,
  measureViewport,
  prefersReducedMotionQuery,
  reportFault,
  startingCamera,
  type EngineHostMountOptions,
} from './engine-host-mount-options.js';
import { attachLiveScene, waitForSceneFrame } from './engine-preview-scene.js';
import { forwardPointerEvents } from './forward-pointer-events.js';
import { HostFrames } from './host-frames.js';
import { HostInput } from './host-input.js';
import { HostLayers } from './host-layers.js';
import { HostViewSettings } from './host-view-settings.js';
import { hostView, nextFrame, type HostView } from './host-view.js';
import { MountImages } from './mount-images.js';
import { MountPeerEditing, MountPeerSelection } from './mount-peers.js';
import { MountText } from './mount-text.js';
import { mountTouchCallbacks } from './mount-touch-callbacks.js';
import type {
  EngineDrawingBuffer,
  MountedEngine,
  MountEngine,
  MountEngineOptions,
} from './mounted-engine.js';
import { readHostPixels } from './read-host-pixels.js';
import { bindSelectInput } from './select-input-binding.js';
import { SEARCH_HIGHLIGHT_LAYER, TRACE_TINT_LAYER } from './shell-overlay.js';
import { startBrowserHost } from './start-browser-host.js';

/** The page's live document, input and camera over one leased rendering host. */
class HostedEngine implements MountedEngine {
  readonly ready: Promise<void>;
  private readonly canvas: HTMLCanvasElement;
  private readonly document: EngineDocument;
  private readonly clipboard: EngineClipboard;
  private readonly images: MountImages;
  private readonly cursor: CanvasCursor;
  private readonly text: MountText;
  private readonly input: HostInput;
  private readonly prefersReducedMotion: () => boolean;
  private readonly onFault: (error: Error) => void;
  private readonly onCameraChange: ((camera: Camera) => void) | undefined;
  private readonly onCameraInput: (() => void) | undefined;
  private readonly cleanups: (() => void)[] = [];
  private readonly release: () => void;
  readonly pages: NonNullable<MountedEngine['pages']>;
  private host: EngineHost | undefined;
  private view: HostView | undefined;
  /** The camera last asked for: during a glide, its target. */
  private currentCamera: Camera;
  /** A glide under way on the engine's frames, followed through its frame reports. */
  private readonly glide = new EngineGlide((target) => {
    this.currentCamera = target;
    this.host?.setCamera(target);
    this.syncCursor();
  });
  /** The drawing buffer size last sent to the host, device px: where the next frame draws. */
  private bufferSize: CanvasBackingSize;
  private readonly frames = new HostFrames();
  readonly hostFrames = new HostFrameFeed();
  readonly liveInk = mountLiveInk(() => ({ host: this.host, view: this.view }));
  private isDestroyed = false;
  private readonly layers = new HostLayers();
  readonly showTraceTint = this.layers.setter(TRACE_TINT_LAYER);
  readonly showSearchHighlights = this.layers.setter(SEARCH_HIGHLIGHT_LAYER);
  readonly peerEditing: MountPeerEditing;
  readonly peerSelection = new MountPeerSelection(() => this.document, this.layers);
  private readonly settings: HostViewSettings;
  readonly setTheme: MountedEngine['setTheme'];
  readonly setWhiteboardChrome: MountedEngine['setWhiteboardChrome'];
  readonly setInkPicked: MountedEngine['setInkPicked'];
  readonly setStickyAuthors: MountedEngine['setStickyAuthors'];

  constructor(
    canvas: HTMLCanvasElement,
    options: MountEngineOptions,
    hostOptions: EngineHostMountOptions,
  ) {
    const viewport = options.viewport ?? measureViewport(canvas);
    this.canvas = canvas;
    this.cursor = new CanvasCursor(canvas);
    this.prefersReducedMotion = options.prefersReducedMotion ?? prefersReducedMotionQuery;
    this.onFault = options.onFault ?? reportFault;
    this.onCameraChange = options.onCameraChange;
    this.onCameraInput = options.onCameraInput;
    this.bufferSize = viewport;
    this.settings = new HostViewSettings(options, hostOptions, () => {
      this.document.tools.refresh();
    });
    this.setTheme = this.settings.themeSetter(() => this.host);
    this.setWhiteboardChrome = this.settings.setWhiteboardChrome.bind(this.settings);
    this.setInkPicked = this.settings.setInkPicked.bind(this.settings);
    this.setStickyAuthors = this.settings.stickyAuthorsSetter(() => this.view);
    this.currentCamera = hostOptions.previewScene?.camera ?? startingCamera(viewport);
    const textLayout = options.textLayout ?? PAGE_TEXT_LAYOUT;
    this.text = new MountText(options.onTextStyleChange);
    const parts = createEngineDocument(
      { ...options, textLayout },
      () => {
        this.syncCursor();
        this.text.changed();
        this.peerSelection.refresh(); // Peers' boxes follow the board and a drag.
      },
      {
        ...mountTouchCallbacks(canvas, options.onContextMenu, (input) => {
          this.handleInput(input);
        }),
        pickImages: (at) => this.images.pick(at),
        viewCentre: () => this.pasteTarget().viewCentre,
        creationInk: this.settings.creationInk,
        liveInk: this.liveInk,
        hasDesignTools: () => this.settings.hasDesignTools, // Follows the chrome.
        afterPageSlice: () => this.view?.flush(), // At once, not at a held-back frame.
      },
    );
    this.text.follow(parts.document);
    this.document = parts.document;
    this.peerEditing = new MountPeerEditing(parts.document, textLayout, this.text, this.layers);
    this.pages = parts.pages;
    this.input = new HostInput({
      ...parts.input,
      onNotice: (message) => options.onNotice?.(message),
      zoom: () => this.camera().zoom,
      refuses: (action) => this.document.refuses(action),
      act: this.act,
    });
    const camera = () => this.camera();
    this.clipboard = new EngineClipboard(canvas, parts.clipboard, camera, options.images);
    this.images = new MountImages(canvas, this.pasteTarget, camera, () => this.document.canEdit);
    const startHost =
      hostOptions.startHost ??
      ((target: HTMLCanvasElement, prefer: EngineHostKind) =>
        startBrowserHost(target, prefer, hostOptions, options.images));
    const hold = holdEngineHost(canvas, () => startHost(canvas, hostOptions.prefer));
    this.release = hold.release;
    if (hostOptions.previewScene === undefined) this.attachInput();
    this.ready = hold.host.then((host) => this.start(host, hostOptions));
  }

  private attachInput(): void {
    this.text.attach(this.canvas, () => this.camera(), this.input.textInput());
    this.cleanups.push(
      bindCameraInput(this.canvas, (input) => {
        this.handleInput(input);
      }),
      bindSelectInput(this.canvas, (input) => {
        const gated = this.input.gate(input); // Not while a stepped run holds the store.
        if (gated !== undefined) this.document.handlePointer(gated, this.camera());
        this.showCursor();
      }),
    );
  }

  get board(): BoardView {
    return this.document.panels.board;
  }

  get overlayLabels(): OverlayLabelFeed {
    return this.document.tools.labels;
  }

  prepareSnapshotPreview(boardId: string): Promise<Uint8Array | undefined> {
    this.view?.flush();
    return captureLiveProjection(this.host, this.document.captureProjectionSource(), {
      boardId,
      fontSetKey: pageTextFonts().contentIdentity,
      camera: this.camera(),
      isCurrent: (camera) => !this.isDestroyed && isSameCamera(camera, this.camera()),
    });
  }

  setToolStyle(tool: ToolId, style: ToolStyle): void {
    this.document.panels.setToolStyle(tool, style);
  }

  camera(): Camera {
    return this.glide.shown ?? this.currentCamera;
  }

  resize(size: CanvasBackingSize): void {
    // A glide ends at its target.
    this.glide.end();
    this.bufferSize = size;
    this.currentCamera = resizeCameraViewport(this.currentCamera, size);
    this.host?.resize(size.widthPx, size.heightPx, size.dpr);
    this.host?.setCamera(this.currentCamera);
    this.syncCursor();
  }

  setActiveTool(tool: ToolId): void {
    this.input.setActiveTool(() => {
      this.document.setActiveTool(tool);
      this.settings.toolChosen(tool, this.document.tools.services().store);
      this.showCursor();
    });
  }

  setEditable(canEdit: boolean): void {
    if (!canEdit) this.input.drop();
    this.document.setEditable(canEdit);
    this.showCursor();
  }

  setViewPreferences(preferences: ViewPreferences): void {
    this.settings.setViewPreferences(preferences, this.host, this.document);
  }

  runCanvasAction(action: CanvasAction): void {
    this.input.runCanvasAction(action); // Through the input queue.
  }

  private readonly act = (action: CanvasAction, zoom: number): void => {
    if (this.clipboard.runCanvasAction(action) || this.document.runCanvasAction(action, zoom)) {
      this.syncCursor();
      return;
    }
    const input = cameraInputForCanvasAction(action);
    if (input !== undefined) this.handleInput(input);
  };

  readonly copySelection = (): ClipboardFlavours | undefined => this.clipboard.copySelection();
  readonly prepareCut = (): PreparedCut => this.clipboard.prepareCut();
  readonly pasteTarget = (): PasteTarget => this.clipboard.pasteTarget();

  inspect(): EngineInspection {
    this.view?.flush();
    return this.document.inspect();
  }

  async capturePixels(rect: PixelRect): Promise<PixelBlock> {
    await this.ready;
    if (this.isDestroyed || this.host === undefined) {
      throw new Error('The engine is unmounted; there is no frame to read.');
    }
    return readHostPixels(this.host, this.view, this.bufferSize, rect);
  }
  readonly drawingBuffer = (): EngineDrawingBuffer | undefined => this.frames.drawingBuffer();
  readonly startFrameStats = (): void => {
    this.frames.measure(true, this.host);
  };
  readFrameStats(): Promise<BenchmarkSample> {
    if (this.isDestroyed || this.host === undefined) {
      return Promise.reject(new Error('The engine is not running; there are no frames to read.'));
    }
    return this.host.readFrameStats();
  }

  applyTextStyle(change: TextStyleChange): void {
    if (!this.document.canEdit) return;
    this.input.applyTextStyle(this.document.tools.text.session() !== undefined, () => {
      this.text.apply(change);
    });
  }

  readonly stopFrameStats = (): void => {
    this.frames.measure(false, this.host);
  };
  readonly frameTimesMs = (): readonly number[] => this.frames.times();
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.input.drop();
    this.glide.end();
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    this.text.destroy();
    this.images.destroy();
    this.clipboard.destroy();
    this.view?.destroy();
    this.liveInk.destroy();
    this.document.destroy();
    this.host = undefined;
    this.release();
  }

  /**
   * Shows a camera at once, the queued scene sent first: a page's own camera.
   *
   * @param camera - The camera.
   */
  jumpCamera(camera: Camera): void {
    this.view?.flush();
    this.glide.end();
    this.currentCamera = camera;
    this.host?.setCamera(camera);
    this.syncCursor();
  }

  private async start(host: EngineHost, hostOptions: EngineHostMountOptions): Promise<void> {
    if (this.isDestroyed) return;
    this.host = host;
    this.cleanups.push(
      host.onFault((error) => {
        this.view?.releaseFrame();
        this.onFault(error);
      }),
      // Keeps the frame's report (the drawing buffer) and, mid-glide, the camera it shows.
      host.onFrame((report) => {
        this.frames.follow(report);
        this.hostFrames.follow(report, host);
        if (this.glide.follow(report.camera)) this.syncCursor();
      }),
    );
    const { widthPx, heightPx, dpr } = this.bufferSize;
    host.resize(widthPx, heightPx, dpr);
    this.view = hostView(host);
    attachLiveScene(this.document, this.view, this.currentCamera, hostOptions.previewScene);
    this.layers.attach(this.view);
    this.view.flush();
    this.settings.show(host);
    host.setCamera(this.currentCamera);
    if (this.frames.isMeasuring) host.startFrameStats();
    const { store } = this.document.tools.services();
    const load = this.document.load.bind(this.document);
    const cleanup = announceEngine(hostOptions, host, this.canvas, this.view, load, store);
    if (cleanup) this.cleanups.push(cleanup);
    if (hostOptions.previewScene !== undefined) {
      await waitForSceneFrame(host, () => this.currentCamera);
      if (this.host !== host) return; // Destroyed while the scene drew.
      this.attachInput();
    }
    this.cleanups.push(forwardPointerEvents(this.canvas, this.view));
    if (hostOptions.previewScene === undefined) await nextFrame(host);
  }

  private handleInput(input: CameraInput): void {
    this.onCameraInput?.(); // The person's own camera move (following stops on it).
    // New input continues from the camera on screen, mid-glide included, and ends the glide.
    const from = this.camera();
    const plan = planCameraInput(input, from, this.document, this.prefersReducedMotion);
    if (plan === undefined) return;
    const { next, durationMs } = plan;
    this.currentCamera = next;
    this.glide.end();
    if (durationMs > 0 && this.host !== undefined) {
      this.glide.start(from, next, durationMs);
      this.host.animateCamera(next, durationMs);
    } else {
      this.host?.setCamera(next);
    }
    this.syncCursor();
  }

  /** Refreshes a still pointer's cursor for the camera on screen, shows it, reports the camera. */
  private syncCursor(): void {
    this.document.refreshCursor(this.camera());
    this.showCursor();
    this.onCameraChange?.(this.camera());
  }

  private showCursor(): void {
    this.cursor.show(this.document.cursor());
  }
}

/**
 * Mounts the live document and input over a leased main-thread or worker renderer.
 * Strict Mode remounts reuse the canvas host; camera() follows its rendered glide.
 *
 * @param hostOptions - Where to run the engine, and what to do once it runs.
 * @returns The mount, for `AppShell`'s `mountEngine`.
 */
export function createEngineHostMount(hostOptions: EngineHostMountOptions): MountEngine {
  return (canvas, options = {}) => keepPageCameras(new HostedEngine(canvas, options, hostOptions));
}
