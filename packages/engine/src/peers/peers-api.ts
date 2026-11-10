// The peers' overlay layers ('s editing marks,'s selections), exported whole by
// the package's index.
export {
  createPeerEditingLayer,
  PEER_EDITING_STAGE_NAME,
  PeerEditingLayer,
} from './peer-editing-layer.js';
export {
  EMPTY_PEER_EDITING,
  isPeerEditingModel,
  PEER_CARET_PX,
  PEER_HIGHLIGHT_ALPHA,
  PEER_OUTLINE_PX,
  peerEditingRectsOf,
} from './peer-editing-model.js';
export {
  createPeerSelectionLayer,
  PEER_SELECTION_STAGE_NAME,
  PeerSelectionLayer,
} from './peer-selection-layer.js';
export {
  EMPTY_PEER_SELECTION,
  isPeerSelectionModel,
  MAX_PEER_SELECTION_OUTLINES,
  peerSelectionRectsOf,
} from './peer-selection-model.js';
export type { PeerSelectionModel, PeerSelectionOutline } from './peer-selection-model.js';
