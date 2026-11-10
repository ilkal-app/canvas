import type { ReactElement } from 'react';

import type { ToolId } from '@canvas/tools';

import type { PageImages } from '../assets/page-images.js';
import { UploadBadges } from '../assets/upload-badges.js';
import type { BoardConnection } from '../collab/board-connection.js';
import { FollowFrame } from '../collab/follow-frame.js';
import { CommentOverlay } from '../comments/comment-overlay.js';
import { PeerCursors } from '../cursors/peer-cursors.js';
import { InkDebugReadout } from '../diagnostics/ink-debug/ink-debug-readout.js';
import { isInkDebug } from '../diagnostics/ink-debug/ink-latency.js';
import { DeleteComponentDialog } from '../dialogs/delete-component-dialog.js';
import type { CameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { BusyIndicator } from '../feedback/busy-indicator.js';
import { useStoreBusy } from '../feedback/use-store-busy.js';
import type { NoticeBinding } from '../hooks/use-notice.js';
import { LinkClickLayer } from '../links/link-click-layer.js';
import { isLiveInkOff } from '../live-ink/live-ink-off.js';
import { LiveInkOverlay } from '../live-ink/live-ink-overlay.js';
import { usePublishViewport } from '../minimap/use-publish-viewport.js';
import { NoticeOutlines } from '../notices/notice-outlines.js';
import { ReactionLayer } from '../reactions/reaction-layer.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ThemeName } from '../theme/theme-tokens.js';
import { TraceSheets } from '../trace-sheets/trace-sheets.js';
import { VoteCursor } from '../voting/vote-cursor.js';
import { VoteDots } from '../voting/vote-dots.js';

/** Props of {@link BoardOverlays}. */
export interface BoardOverlaysProps {
  /** The engine, once it runs. */
  readonly engine: MountedEngine | undefined;
  /** The board's connection, if any. */
  readonly connection?: BoardConnection | undefined;
  /** Whether the person may edit the board. */
  readonly canEdit: boolean;
  /** The theme shown. */
  readonly themeName: ThemeName;
  /** The shell's one notice, whose outline is drawn over the board. */
  readonly notice: NoticeBinding;
  /** The camera, if the engine reports one. */
  readonly camera?: CameraSource | undefined;
  /** The shell's tool: a link's chip and hand cursor are the select tool's. */
  readonly activeTool?: ToolId | undefined;
  /** Runs a shell action: a link edited from its chip. */
  readonly dispatch?: ((action: ShellAction) => void) | undefined;
}

/**
 * The states of the board's images over the canvas (`UploadBadges`: the page's uploads, a
 * collaborator's processing images), with the page's images.
 *
 * @param images - The page's images, if the board has them.
 * @param engine - The engine, once it runs.
 * @returns The overlays, or nothing without images.
 */
function imageStatesOf(
  images: PageImages | undefined,
  engine: MountedEngine | undefined,
): ReactElement | null {
  if (images === undefined) return null;
  return <UploadBadges uploads={images.uploads} processing={images.processing} engine={engine} />;
}

/**
 * What the shell draws over the board, under the editing layers and the popovers: the agents'
 * trace sheets, the states of the board's images, the canvas's links (
 * ⌘/Ctrl-click opens one: a click shows its chip), the draw tool's stroke under way
 * (unless `?liveink=off`), the comment pins, the reactions, the dot vote's dots
 * and voting cursor, the delete-main confirmation, the notice's outline, the
 * collaborators' live cursors (item 10), and a stepped run's busy indicator. It
 * also tells collaborators what the person's screen shows (`usePublishViewport`).
 *
 * @param props - The engine, connection, role, theme, notice and camera.
 * @returns The overlays.
 */
export function BoardOverlays(props: BoardOverlaysProps): ReactElement {
  const { engine, connection, notice } = props;
  const busy = useStoreBusy(connection?.store);
  usePublishViewport(connection, props.camera);
  return (
    <>
      <TraceSheets
        connection={connection}
        engine={engine}
        canEdit={props.canEdit}
        themeName={props.themeName}
        onNotice={notice.show}
      />
      {imageStatesOf(connection?.images, engine)}
      <LinkClickLayer
        engine={engine}
        camera={props.camera}
        activeTool={props.activeTool}
        canEdit={props.canEdit}
        dispatch={props.dispatch}
        onNotice={notice.show}
      />
      {!isLiveInkOff(window.location.search) && (
        <LiveInkOverlay
          engine={engine}
          camera={props.camera}
          themeName={props.themeName}
          board={engine?.board}
        />
      )}
      <CommentOverlay engine={engine} themeName={props.themeName} />
      <ReactionLayer engine={engine} />
      {isInkDebug(window.location.search) && <InkDebugReadout engine={engine} />}
      <VoteDots engine={engine} />
      <VoteCursor engine={engine} store={connection?.store} />
      <DeleteComponentDialog confirmations={engine?.board.deletions} />
      <NoticeOutlines
        outline={notice.notice?.outline}
        board={engine?.board.board}
        camera={props.camera}
      />
      <PeerCursors connection={connection} engine={engine} camera={props.camera} />
      <FollowFrame />
      <BusyIndicator busy={busy} />
    </>
  );
}
