import { useContext, type ReactElement } from 'react';

import type { BoardConnection } from '../collab/board-connection.js';
import type { TextStyleChange, TextStyleContext } from '../engine/document-text.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { useIsMobileSite } from '../shell/mobile-site.js';
import { shellBoardModeContext } from '../shell/shell-board-mode.js';
import { useWhiteboardChrome } from '../shell/whiteboard-chrome.js';
import type { ShellAction } from '../state/shell-action.js';

import type { CameraSource } from './camera-source.js';
import { OverlayLabels } from './overlay-labels.js';
import { PeerEditing } from './peer-editing.js';
import { PeerSelections } from './peer-selections.js';
import { TextBar } from './text-bar.js';

/** Props of {@link EditingLayers}. */
export interface EditingLayersProps {
  /** The engine, once it runs. */
  readonly engine: MountedEngine | undefined;
  /** The camera on screen. */
  readonly camera: CameraSource;
  /** The text style the engine reports. */
  readonly textStyle: TextStyleContext | undefined;
  /** Whether the person may edit. */
  readonly canEdit: boolean;
  /** Applies a text style change (`MountedEngine.applyTextStyle`). */
  readonly onTextStyle: (change: TextStyleChange) => void;
  /** The shell's dispatch. */
  readonly dispatch: (action: ShellAction) => void;
  /**
   * The board's connection: its presence shows peers editing text and shares the person's;
   * none if absent.
   */
  readonly connection?: BoardConnection | undefined;
}

/**
 * The editing states over the canvas that the GPU overlay cannot draw (Figma "States"):
 * peers' selection name tags (item 14), peers' "<name> is editing" tags (E1),
 * the labels (size readout, gap lengths, the locked notice) and the floating text bar, which
 * under the whiteboard's floating chrome at 768 px and more gives way to the selection popover's
 * editing form. Page.
 *
 * @param props - The engine, camera, text style and callbacks.
 * @returns The layers.
 */
export function EditingLayers(props: EditingLayersProps): ReactElement {
  const { engine, camera } = props;
  // Under the whiteboard's floating chrome at 768 px and more the selection popover's editing
  // form has the text's options; the docked bar stays below 768 px.
  const chrome = useWhiteboardChrome();
  const mode = useContext(shellBoardModeContext)?.mode;
  const isCompact = useIsMobileSite();
  const hasEditingPopover = chrome === 'floating' && mode === 'whiteboard' && !isCompact;
  return (
    <>
      <PeerSelections connection={props.connection} engine={engine} camera={camera} />
      <PeerEditing
        connection={props.connection}
        engine={engine}
        camera={camera}
        canEdit={props.canEdit}
      />
      <OverlayLabels feed={engine?.overlayLabels} camera={camera} />
      {hasEditingPopover ? null : (
        <TextBar
          engine={engine}
          camera={camera}
          context={props.textStyle}
          canEdit={props.canEdit}
          onChange={props.onTextStyle}
          dispatch={props.dispatch}
        />
      )}
    </>
  );
}
