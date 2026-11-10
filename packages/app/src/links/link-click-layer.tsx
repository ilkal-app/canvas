import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';

import { worldToScreen, type Camera } from '@canvas/engine';
import type { ToolId } from '@canvas/tools';

import type { CameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import type { ShellAction } from '../state/shell-action.js';

import { linkHitAtPoint, type CanvasLinkHit } from './link-at.js';
import { LinkChip } from './link-chip.js';
import styles from './link-chip.module.css';
import { useLinkClicks, type LinkClickGate } from './use-link-clicks.js';

/** What the person is told once a link is on the clipboard. */
export const LINK_COPIED_MESSAGE = 'Link copied';

/** What the person is told when the clipboard refused the link. */
export const LINK_COPY_FAILED_MESSAGE = 'The link could not be copied.';

/** How far below the link's characters the chip sits, CSS px. */
export const LINK_CHIP_GAP_PX = 6;

/** The chip shown: the link clicked, and whether a finger clicked it. */
interface ShownChip extends CanvasLinkHit {
  /** Whether a finger or a pen tapped it: its buttons are 44 px. */
  readonly isTouch: boolean;
}

/** Props of {@link LinkClickLayer}. */
export interface LinkClickLayerProps {
  /** The engine, once it runs. */
  readonly engine: MountedEngine | undefined;
  /** The camera on screen, which the chip follows; no chip without it. */
  readonly camera?: CameraSource | undefined;
  /** The shell's tool: the chip and the hand cursor are the select tool's alone. */
  readonly activeTool?: ToolId | undefined;
  /** Whether the person may edit the board: the chip's Edit then shows. */
  readonly canEdit?: boolean | undefined;
  /** Runs a shell action: an edited or removed link, one undo step. */
  readonly dispatch?: ((action: ShellAction) => void) | undefined;
  /** Shows the shell's notice: Copy says it copied. */
  readonly onNotice?: ((message: string) => void) | undefined;
  /** What counts as the person's click (`useLinkClicks`); trusted primary input if absent. */
  readonly gate?: LinkClickGate | undefined;
}

/** What subscribing to no camera returns. */
function noUnsubscribe(): void {
  // Nothing was subscribed.
}

/**
 * Shows the hand cursor over a link while the select tool hovers it: the link under a
 * still mouse, looked up at most once a frame (`linkHitAtPoint` lays out only linked texts, once
 * per version), marks the canvas with a class whose cursor outranks the tool's. A finger has no
 * hover; leaving the canvas, or another tool, clears it.
 *
 * @param canvas - The canvas.
 * @param hitAt - The link under a page point, if any; none while the select tool is not active.
 */
function useLinkHover(
  canvas: HTMLElement | null,
  hitAt: ((clientX: number, clientY: number) => CanvasLinkHit | undefined) | undefined,
): void {
  useEffect(() => {
    if (canvas === null || hitAt === undefined) return undefined;
    let frame: number | undefined;
    let latest: PointerEvent | undefined;
    const mark = (isOver: boolean): void => {
      canvas.classList.toggle(styles.overLink ?? 'overLink', isOver);
    };
    const look = (): void => {
      frame = undefined;
      const event = latest;
      if (event === undefined) return;
      mark(event.buttons === 0 && hitAt(event.clientX, event.clientY) !== undefined);
    };
    const onMove = (event: PointerEvent): void => {
      if (event.pointerType !== 'mouse') return;
      latest = event;
      frame ??= requestAnimationFrame(look);
    };
    const onLeave = (): void => {
      latest = undefined;
      mark(false);
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      mark(false);
    };
  }, [canvas, hitAt]);
}

/**
 * Closes the chip when what it is about changes: the selection moves off its object, or the
 * object changes or goes (its link may be gone or elsewhere now).
 *
 * @param engine - The engine.
 * @param chip - The chip shown, if any.
 * @param close - Closes it.
 */
function useChipLifetime(
  engine: MountedEngine | undefined,
  chip: ShownChip | undefined,
  close: () => void,
): void {
  useEffect(() => {
    if (engine === undefined || chip === undefined) return undefined;
    const board = engine.board;
    return board.subscribe((change) => {
      const isGone =
        change.kind === 'selection'
          ? !board.state().selectedIds.includes(chip.objectId)
          : change.changes.updated.includes(chip.objectId) ||
            change.changes.deleted.includes(chip.objectId);
      if (isGone) close();
    });
  }, [engine, chip, close]);
}

/**
 * Copies a link and says so.
 *
 * @param link - The link.
 * @param notify - Shows the shell's notice, if any.
 */
async function copyLink(
  link: string,
  notify: ((message: string) => void) | undefined,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(link);
    notify?.(LINK_COPIED_MESSAGE);
  } catch {
    notify?.(LINK_COPY_FAILED_MESSAGE);
  }
}

/**
 * The canvas's link presses and hover: ⌘/Ctrl-click opens a link,
 * and with the select tool a plain click or tap on a link shows its chip, which closes on a press
 * elsewhere on the canvas, when what it is about changes, and when another tool takes over.
 *
 * @param engine - The engine.
 * @param target - The canvas.
 * @param target.current - The canvas element, once mounted.
 * @param isSelecting - Whether the select tool is active.
 * @param hasCamera - Whether a camera is known to place the chip with.
 * @param gate - What counts as the person's click.
 * @returns The chip shown, if any, and what closes it.
 */
function useCanvasLinks(
  engine: MountedEngine | undefined,
  target: { readonly current: HTMLCanvasElement | null },
  isSelecting: boolean,
  hasCamera: boolean,
  gate: LinkClickGate | undefined,
): { readonly chip: ShownChip | undefined; readonly close: () => void } {
  const [chip, setChip] = useState<ShownChip | undefined>(undefined);
  const hitAt = useMemo(() => {
    const canvas = target.current;
    if (engine === undefined || canvas === null) return undefined;
    return (clientX: number, clientY: number): CanvasLinkHit | undefined =>
      linkHitAtPoint(engine, canvas, clientX, clientY);
  }, [engine, target]);
  const linkAt = useMemo(
    () =>
      hitAt === undefined
        ? undefined
        : (clientX: number, clientY: number): string | undefined => hitAt(clientX, clientY)?.link,
    [hitAt],
  );
  const close = useCallback(() => {
    setChip(undefined);
  }, []);
  const onPlainClick = useMemo(
    () =>
      !isSelecting || hitAt === undefined || !hasCamera
        ? undefined
        : (release: PointerEvent): void => {
            const hit = hitAt(release.clientX, release.clientY);
            const isTouch = release.pointerType === 'touch' || release.pointerType === 'pen';
            setChip(hit === undefined ? undefined : { ...hit, isTouch });
          },
    [isSelecting, hitAt, hasCamera],
  );
  useLinkClicks(target, linkAt, undefined, gate, onPlainClick);
  useLinkHover(target.current, isSelecting ? hitAt : undefined);
  useChipLifetime(engine, chip, close);
  useEffect(() => {
    // Another tool, editing the text included, closes the chip.
    if (!isSelecting) close();
  }, [isSelecting, close]);
  useEffect(() => {
    // A press anywhere on the canvas closes it; a click on a link shows its chip again.
    const canvas = target.current;
    if (canvas === null || chip === undefined) return undefined;
    canvas.addEventListener('pointerdown', close);
    return () => {
      canvas.removeEventListener('pointerdown', close);
    };
  }, [target, chip, close]);
  return { chip, close };
}

/**
 * The chip shown under a link, placed where the camera shows the link, its Edit and Remove
 * dispatching the relink (a run's link) or the restyle (the object's own), one undo step.
 *
 * @param props - The chip, camera, canvas and what its buttons do.
 * @param props.chip - The chip.
 * @param props.view - The camera on screen.
 * @param props.canvas - The canvas, which the chip's layer shares an offset parent with.
 * @param props.layer - The layer props: role, dispatch and notice.
 * @param props.onClose - Closes it.
 * @returns The chip's layer.
 */
function ShownLinkChip(props: {
  readonly chip: ShownChip;
  readonly view: Camera;
  readonly canvas: HTMLCanvasElement;
  readonly layer: LinkClickLayerProps;
  readonly onClose: () => void;
}): ReactElement {
  const { chip, view, canvas } = props;
  const { dispatch, onNotice } = props.layer;
  const at = worldToScreen(view, chip.anchor);
  const { span } = chip;
  const apply = (link: string | null): void => {
    if (dispatch === undefined) return;
    if (span === undefined) {
      const style = { link: link ?? undefined };
      dispatch({ type: 'style', changes: [{ id: chip.objectId, style }] });
    } else {
      const targets = [{ id: chip.objectId, ranges: [{ start: span.start, end: span.end }] }];
      dispatch({ type: 'relinkText', targets, from: chip.link, link });
    }
  };
  const canEdit = props.layer.canEdit === true && dispatch !== undefined;
  return (
    <div className={styles.layer} data-link-chip-layer="">
      <LinkChip
        key={`${chip.objectId}|${String(span?.start)}|${chip.link}`}
        link={chip.link}
        left={at.x + canvas.offsetLeft}
        top={at.y + canvas.offsetTop + LINK_CHIP_GAP_PX}
        isTouch={chip.isTouch}
        onCopy={() => {
          void copyLink(chip.link, onNotice);
        }}
        onApply={canEdit ? apply : undefined}
        onRemove={
          canEdit
            ? () => {
                apply(null);
              }
            : undefined
        }
        onClose={props.onClose}
      />
    </div>
  );
}

/**
 * The canvas's links, placed in the canvas mount: ⌘/Ctrl-click on a
 * link opens it (`useLinkClicks`: the person's own short press on the canvas element itself);
 * with the select tool, a plain click or a tap on a link selects its object, as any press does,
 * and shows the link chip under the link's characters (`LinkChip`: the address as text, Open,
 * Copy, and for a person who can edit Edit, with Remove), which follows the camera; and a mouse
 * over a link shows the hand cursor. The chip closes on Escape, on Open, on a press elsewhere on
 * the canvas, when the selection leaves its object or the object changes, and when another tool
 * (editing the text included) takes over. Opening is never the first press. Main thread.
 *
 * @param props - The engine, camera, tool, role, dispatch and notice.
 * @returns A hidden marker in the mount, and the chip while one shows.
 */
export function LinkClickLayer(props: LinkClickLayerProps): ReactElement {
  const { engine, camera: source } = props;
  const isSelecting = (props.activeTool ?? 'select') === 'select';
  const markerRef = useRef<HTMLSpanElement>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setMount(markerRef.current?.closest('main') ?? null);
  }, []);
  // The canvas itself: a press on a control or overlay in the mount is not a click on it.
  const target = useMemo(() => ({ current: mount?.querySelector('canvas') ?? null }), [mount]);
  const hasCamera = source !== undefined;
  const { chip, close } = useCanvasLinks(engine, target, isSelecting, hasCamera, props.gate);
  const view = useSyncExternalStore(source?.subscribe ?? (() => noUnsubscribe), () =>
    source?.read(),
  );
  const canvas = target.current;
  return (
    <>
      <span ref={markerRef} hidden />
      {chip === undefined || view === undefined || canvas === null ? null : (
        <ShownLinkChip chip={chip} view={view} canvas={canvas} layer={props} onClose={close} />
      )}
    </>
  );
}
