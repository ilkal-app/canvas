import type { BoardMode } from '@canvas/schema';

import type { DockButtonId } from '../state/dock-buttons.js';

/**
 * Every icon the app draws (UI-18): the dock's tools and modes, a layer's object type
 * (an instance's), the zoom control and the layers toggle, the drawers' close buttons, the page list's add, the selects' chevron
 * and check, a layer's disclosure, the top bars' back, more, agent and rename marks, the share
 * dialog's link, the inspector toggle, a layer's lock and its visibility, a comment's send,
 * the inspector's arrange, text alignment, route and crop icons, the compact undo pill's
 * undo and redo, the text bar's list icons, the past-due notice's alert,
 * home's grid or list toggle (`view-grid`, four squares; `view-list`, three equal
 * lines; frame H1), and the site's sort caret (`caret-down`, the frames' small ▾) and its
 * links' arrows (`arrow-right`, `arrow-left`; the frames' → and ←).
 */
export type IconName =
  | DockButtonId
  | `mode-${BoardMode}`
  | 'shapes'
  | 'group'
  | 'instance'
  | 'diamond'
  | 'chevron-down'
  | 'list-bullet'
  | 'list-numbered'
  | 'indent'
  | 'outdent'
  | 'chevron-left'
  | 'chevron-right'
  | 'check'
  | 'zoom-out'
  | 'zoom-in'
  | 'zoom-fit'
  | 'layers'
  | 'close'
  | 'plus'
  | 'more'
  | 'agent'
  | 'rename'
  | 'link'
  | 'copy'
  | 'layout-vertical'
  | 'layout-horizontal'
  | 'external'
  | 'inspector'
  | 'lock'
  | 'unlock'
  | 'eye'
  | 'eye-off'
  | 'send'
  | 'undo'
  | 'redo'
  | 'pause'
  | 'play'
  | 'sound'
  | 'sound-off'
  | 'view-grid'
  | 'view-list'
  | 'caret-down'
  | 'arrow-right'
  | 'arrow-left'
  | WhiteboardIconName
  | InspectorIconName;

/**
 * The whiteboard chrome's icons (the design board's Library page): the board bar's home
 * (roof and walls), the zoom control's minimap (the folded map, option A), the draw panel's lasso
 * and highlighter, the dock's reactions (a smiley) and section (the frame's grid), the
 * facilitate card's timer and vote (a tick), the board bar's search, the image panel's upload,
 * and the floating zoom control's fit (the Library's icon/fit: rounded corner
 * brackets, where `zoom-fit` has square ones), and the sticky popover's author (the Library's
 * icon/invite).
 */
export type WhiteboardIconName =
  | 'home'
  | 'minimap'
  | 'lasso'
  | 'highlighter'
  | 'reactions'
  | 'section'
  | 'timer'
  | 'vote'
  | 'search'
  | 'upload'
  | 'fit'
  | 'invite'
  | 'alert';

/**
 * The inspector's icons (Figma "Icons · inspector" and the inspector's reference card):
 * the arrange row's align, distribute, tidy, group, ungroup and order buttons, the text
 * alignment toggles, the line's curved route and the image's crop.
 */
export type InspectorIconName =
  | 'align-left'
  | 'align-centre'
  | 'align-right'
  | 'align-top'
  | 'align-middle'
  | 'align-bottom'
  | 'distribute-horizontally'
  | 'distribute-vertically'
  | 'tidy-up'
  | 'arrange-group'
  | 'ungroup'
  | 'bring-to-front'
  | 'bring-forward'
  | 'send-backward'
  | 'send-to-back'
  | 'text-left'
  | 'text-centre'
  | 'text-right'
  | 'route-curved'
  | 'crop';

/**
 * Each icon's drawing in a 16 × 16 box: plain paths stroked in the text colour (the design's
 * outline icons, redrawn so the shell ships no icon font), scaled to the shared icon size with
 * the stroke kept at the shared width (`Icon`). No fills: every mark is a stroke.
 */
export const ICON_PATHS: Readonly<Record<IconName, string>> = {
  select: 'M3.5 2.5 12.5 7 8.3 8.3 7 12.5Z',
  hand: 'M5 8V4.5a1 1 0 0 1 2 0V8M7 7.5V3.5a1 1 0 0 1 2 0v4M9 7.5V4.5a1 1 0 0 1 2 0V9c0 2.8-1.7 4.5-4 4.5S3.5 12 2.8 10L2.3 8.6a1 1 0 0 1 1.8-.8L5 9.5',
  note: 'M3 3h10v6.5L9.5 13H3ZM9.5 13V9.5H13',
  text: 'M3.5 4V3h9v1M8 3v10M6 13h4',
  rectangle: 'M2.5 3.5h11v9h-11Z',
  ellipse: 'M8 3a5.5 5 0 1 0 0 10A5.5 5 0 1 0 8 3Z',
  triangle: 'M8 2.5 13.5 12.5h-11Z',
  polygon: 'M8 2.5 13.5 6.4 11.4 12.8H4.6L2.5 6.4Z',
  star: 'M8 2.2 9.7 6l4.1.4-3.1 2.7.9 4-3.6-2.1-3.6 2.1.9-4-3.1-2.7L6.3 6Z',
  line: 'M3 13 13 3',
  arrow: 'M3 13 13 3M7 3h6v6',
  'elbow-connector': 'M3 3.5h5v9h5M11 10.5l2 2-2 2',
  connector: 'M3 13c0-6 10-4 10-10M11 4.5 13 3l1 2.2',
  image: 'M2.5 3.5h11v9h-11ZM2.5 10.5 6 7.5l3 3 2-1.5 2.5 2M10.3 6.2h.01',
  pen: 'M3 13 4 9.5 10.5 3l2.5 2.5L6.5 12ZM8.8 4.7l2.5 2.5M3 13l3-1',
  frame: 'M5 2v12M11 2v12M2 5h12M2 11h12',
  comment: 'M3 3.5h10v7H7L4 13v-2.5H3Z',
  component:
    'M8 2 10.5 4.5 8 7 5.5 4.5ZM8 9l2.5 2.5L8 14l-2.5-2.5ZM4.5 5.5 7 8 4.5 10.5 2 8ZM11.5 5.5 14 8l-2.5 2.5L9 8Z',
  prototype: 'M4 4l5 9 1-4 4-1ZM2 2l1.2 1.2M6 1.5v1.7M1.5 6h1.7',
  diagram: 'M6.5 2.5h3v3h-3ZM2.5 10.5h3v3h-3ZM10.5 10.5h3v3h-3ZM8 5.5v2.5M4 10.5V8h8v2.5',
  slide: 'M2 3h12v8H2ZM8 11v2.5M5.5 13.5h5',
  present: 'M2 3h12v8H2ZM6.5 5v4l3.5-2ZM8 11v2.5',
  pencil: 'M3 13l1-3.5L11 2.5 13.5 5 6.5 12ZM9.5 4l2.5 2.5',
  brush: 'M13.5 2.5 7.5 8.5M7.5 8.5c-2-1-4 .5-4 2.5 0 1.2-.5 2-1.5 2.5 3 .5 6-.5 5.5-5Z',
  'shape-builder': 'M2.5 2.5h5v5h-5ZM8.5 8.5h5v5h-5ZM10 2.5h3.5V6M2.5 10V13.5H6',
  eraser: 'M6 13.5h7.5M2.8 9.3l6-6.3 4.4 4.3-6.2 6.2H5Z M5.5 6.5l4.3 4.3',
  keyframe: 'M8 2.5 13.5 8 8 13.5 2.5 8Z',
  'motion-path': 'M2.5 12c2-6 4 0 6-5s3-3.5 5-4.5M2.5 12h.01M13.5 2.5h.01',
  easing: 'M2.5 13.5c6 0 5-11 11-11',
  timeline: 'M2.5 4h7M5 8h8.5M2.5 12h5',
  'mode-whiteboard': 'M3.5 2.5h6l3 3v8h-9ZM9.5 2.5v3h3',
  'mode-uiux': 'M2.5 2.5h11v4h-11ZM2.5 8.5h4.5v5H2.5ZM9 8.5h4.5v5H9Z',
  'mode-diagram': 'M6.5 2.5h3v3h-3ZM2.5 10.5h3v3h-3ZM10.5 10.5h3v3h-3ZM8 5.5v2.5M4 10.5V8h8v2.5',
  'mode-illustration': 'M3 13 4 9.5 10.5 3l2.5 2.5L6.5 12ZM8.8 4.7l2.5 2.5',
  'mode-motion': 'M4.5 2.5v11l9-5.5Z',
  'mode-slides': 'M2 3h12v8H2ZM8 11v2.5M5.5 13.5h5',
  group: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10M5 5h6v6H5Z',
  // A placed copy of a main: one diamond of the component's four, outlined twice.
  instance: 'M8 2 14 8 8 14 2 8ZM8 5.5 10.5 8 8 10.5 5.5 8Z',
  diamond: 'M8 2.5 13.5 8 8 13.5 2.5 8Z',
  shapes: 'M5 2.5 7.5 6.5h-5ZM2.5 9h4.5v4.5H2.5ZM11.3 9a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 1 0 0-4.6Z',
  'chevron-down': 'M4 6l4 4 4-4',
  // The frames' ▾: a small closed triangle, which the round join fills.
  'caret-down': 'M6 6.8h4L8 9.6Z',
  'arrow-right': 'M3 8h10M9 4l4 4-4 4',
  'arrow-left': 'M13 8H3M7 4 3 8l4 4',
  'list-bullet': 'M6.5 4h7M6.5 8h7M6.5 12h7M3 4h.01M3 8h.01M3 12h.01',
  'list-numbered': 'M7 4h6.5M7 8h6.5M7 12h6.5M2.5 3.2 3.5 2.5v3M2.5 7.5h1.5L2.5 9.5H4',
  indent: 'M2.5 3.5h11M7.5 6.5h6M7.5 9.5h6M2.5 12.5h11M2.5 6l2 2-2 2',
  outdent: 'M2.5 3.5h11M7.5 6.5h6M7.5 9.5h6M2.5 12.5h11M4.5 6l-2 2 2 2',
  'chevron-left': 'M10 12 6 8l4-4',
  'chevron-right': 'M6 4l4 4-4 4',
  check: 'M3 8.5 6.5 12 13 4.5',
  'zoom-out': 'M3.5 8h9',
  'zoom-in': 'M3.5 8h9M8 3.5v9',
  'zoom-fit': 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  layers: 'M8 2.5 13.5 5.5 8 8.5 2.5 5.5ZM2.5 8.25 8 11.25l5.5-3M2.5 10.75 8 13.75l5.5-3',
  close: 'M4 4l8 8M12 4l-8 8',
  plus: 'M8 3.5v9M3.5 8h9',
  more: 'M3.33 7.33a.67.67 0 1 0 0 1.34.67.67 0 1 0 0-1.34ZM8 7.33a.67.67 0 1 0 0 1.34.67.67 0 1 0 0-1.34ZM12.67 7.33a.67.67 0 1 0 0 1.34.67.67 0 1 0 0-1.34Z',
  send: 'M8 13V3M4 7l4-4 4 4',
  agent: 'M8 1.33 9.4 6.6l5.27 1.4L9.4 9.4 8 14.67 6.6 9.4 1.33 8 6.6 6.6Z',
  rename: 'M10.5 3.17a1.41 1.41 0 0 1 2 2L5.67 12 3 12.67 3.67 10Z',
  // A link card's popover: copy its link, its two layouts, open its page.
  copy: 'M5.5 5.5h7v7h-7ZM3.5 10.5v-7h7',
  'layout-vertical': 'M3.5 2.5h9v11h-9ZM3.5 8h9',
  'layout-horizontal': 'M2.5 3.5h11v9h-11ZM7 3.5v9',
  external: 'M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4',
  link: 'M6.67 8.67a3.33 3.33 0 0 0 5 .36l2-2a3.33 3.33 0 0 0-4.7-4.72L7.8 3.45M9.33 7.33a3.33 3.33 0 0 0-5-.36l-2 2a3.33 3.33 0 0 0 4.7 4.72l1.14-1.14',
  inspector:
    'M4 3h8a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4 3ZM9.5 3v10',
  lock: 'M4 7.5h8v6H4ZM5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2',
  unlock: 'M4 7.5h8v6H4ZM5.5 7.5V5.5a2.5 2.5 0 0 1 5 0',
  // A layer's visibility: an open eye, and the eye struck through for a hidden one.
  eye: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z',
  'eye-off':
    'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM2.5 2.5l11 11',
  // The compact undo pill's: a hooked arrow back, and its mirror.
  undo: 'M5.5 3.5 2.5 6.5l3 3M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7',
  redo: 'M10.5 3.5l3 3-3 3M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H9',
  // The inspector's, from Figma's 20-unit drawings scaled to the 16-unit box.
  'align-left':
    'M8.67 9.33H5.33C4.6 9.33 4 9.93 4 10.67V12C4 12.74 4.6 13.33 5.33 13.33H8.67C9.4 13.33 10 12.74 10 12V10.67C10 9.93 9.4 9.33 8.67 9.33ZM13.33 2.67H5.33C4.6 2.67 4 3.26 4 4V5.33C4 6.07 4.6 6.67 5.33 6.67H13.33C14.07 6.67 14.67 6.07 14.67 5.33V4C14.67 3.26 14.07 2.67 13.33 2.67ZM1.33 1.33V14.67',
  'align-centre':
    'M13.33 2.67H2.67C1.93 2.67 1.33 3.26 1.33 4V5.33C1.33 6.07 1.93 6.67 2.67 6.67H13.33C14.07 6.67 14.67 6.07 14.67 5.33V4C14.67 3.26 14.07 2.67 13.33 2.67ZM10.67 9.33H5.33C4.6 9.33 4 9.93 4 10.67V12C4 12.74 4.6 13.33 5.33 13.33H10.67C11.4 13.33 12 12.74 12 12V10.67C12 9.93 11.4 9.33 10.67 9.33ZM8 1.33V2.67M8 6.67V9.33M8 13.33V14.67',
  'align-right': 'M13.6 2.4V13.6M11.2 4H6V6.4H11.2V4ZM11.2 9.6H2.8V12H11.2V9.6Z',
  'align-top':
    'M5.33 4H4C3.26 4 2.67 4.6 2.67 5.33V13.33C2.67 14.07 3.26 14.67 4 14.67H5.33C6.07 14.67 6.67 14.07 6.67 13.33V5.33C6.67 4.6 6.07 4 5.33 4ZM12 4H10.67C9.93 4 9.33 4.6 9.33 5.33V8.67C9.33 9.4 9.93 10 10.67 10H12C12.74 10 13.33 9.4 13.33 8.67V5.33C13.33 4.6 12.74 4 12 4ZM14.67 1.33H1.33',
  'align-middle': 'M2.4 8H13.6M6.4 3.2H4V12.8H6.4V3.2ZM12 4.8H9.6V11.2H12V4.8Z',
  'align-bottom': 'M2.4 13.6H13.6M6.4 3.2H4V11.2H6.4V3.2ZM12 6.4H9.6V11.2H12V6.4Z',
  'distribute-horizontally': 'M2.4 2.4V13.6M13.6 2.4V13.6M9.2 4.8H6.8V11.2H9.2V4.8Z',
  'distribute-vertically': 'M2.4 2.4H13.6M2.4 13.6H13.6M11.2 6.8H4.8V9.2H11.2V6.8Z',
  'tidy-up':
    'M6.8 3.2H3.2V6.8H6.8V3.2ZM12.8 3.2H9.2V6.8H12.8V3.2ZM6.8 9.2H3.2V12.8H6.8V9.2ZM12.8 9.2H9.2V12.8H12.8V9.2Z',
  'arrange-group': 'M14 2H2V14H14V2ZM7.6 4.4H4.4V7.6H7.6V4.4ZM11.6 8.4H8.4V11.6H11.6V8.4Z',
  ungroup: 'M7.2 2.4H2.4V7.2H7.2V2.4ZM13.6 8.8H8.8V13.6H13.6V8.8Z',
  'bring-to-front': 'M3.2 2.8H12.8M8 13.6V6M5.2 8.8L8 6L10.8 8.8',
  'bring-forward': 'M8 12.8V4M4.8 7.2L8 4L11.2 7.2',
  'send-backward': 'M8 3.2V12M4.8 8.8L8 12L11.2 8.8',
  'send-to-back': 'M3.2 13.2H12.8M8 2.4V10M5.2 7.2L8 10L10.8 7.2',
  'text-left': 'M2.4 4H13.6M2.4 6.96H9.6M2.4 9.84H13.6M2.4 12.8H8.8',
  'text-centre': 'M2.4 4H13.6M4.8 6.96H11.2M2.4 9.84H13.6M5.6 12.8H10.4',
  'text-right': 'M2.4 4H13.6M6.4 6.96H13.6M2.4 9.84H13.6M7.2 12.8H13.6',
  'route-curved': 'M2.4 12.8C7.2 12.8 8.8 3.2 13.6 3.2',
  crop: 'M4.8 1.6V11.2H14.4M1.6 4.8H11.2V14.4',
  // The whiteboard chrome's, from the Library page's 20-unit drawings scaled to the
  // 16-unit box.
  home: 'M2.4 7.2 8 2.4l5.6 4.8M4 6.4v7.2h8V6.4',
  minimap: 'M1.6 4 5.6 2.4 10.4 4l4-1.6V12l-4 1.6L5.6 12l-4 1.6ZM5.6 2.4V12M10.4 4v9.6',
  lasso:
    'M8 2.4c3.52 0 5.6 1.76 5.6 4S11.2 10 8 10 2.4 8.64 2.4 6.4 4.48 2.4 8 2.4ZM4.8 9.6c-.8 1.6 0 3.6 1.6 3.6 1.2 0 1.28-1.2.48-1.84',
  highlighter: 'M9.6 2.4l4 4L8 12H4V8ZM3.2 14H8',
  fit: 'M5.33 2h-2A1.33 1.33 0 0 0 2 3.33v2M10.67 2h2A1.33 1.33 0 0 1 14 3.33v2M2 10.67v2A1.33 1.33 0 0 0 3.33 14h2M10.67 14h2a1.33 1.33 0 0 0 1.33-1.33v-2',
  reactions:
    'M8 2.4c3.2 0 5.6 2.4 5.6 5.6s-2.4 5.6-5.6 5.6S2.4 11.2 2.4 8 4.8 2.4 8 2.4ZM5.6 9.6c1.2 1.6 3.6 1.6 4.8 0M6 6.4v.4M10 6.4v.4',
  // The dock's section is drawn as the frame (the design swaps in icon/frame).
  section: 'M5 2v12M11 2v12M2 5h12M2 11h12',
  timer:
    'M8 3.2c3.52 0 5.6 2.4 5.6 5.6S11.2 14.4 8 14.4 2.4 12 2.4 8.8 4.48 3.2 8 3.2ZM8 4.8v4l2.4 1.6M6.4 1.6h3.2',
  vote: 'M3.2 8l3.2 3.2L12.8 4',
  // The Facilitate card's timer: pause, play, and the chime's sound and mute.
  pause: 'M5.6 3.6v8.8M10.4 3.6v8.8',
  play: 'M5.2 3.2v9.6L12.8 8Z',
  sound: 'M2.8 6h2.4l3.2-2.8v9.6L5.2 10H2.8ZM10.8 5.6a3.2 3.2 0 0 1 0 4.8',
  'sound-off': 'M2.8 6h2.4l3.2-2.8v9.6L5.2 10H2.8ZM10.4 6l3.2 4M13.6 6l-3.2 4',
  search: 'M7.33 2a5.33 5.33 0 1 0 0 10.67A5.33 5.33 0 1 0 7.33 2ZM14 14l-2.86-2.86',
  // The image panel's upload, the Library's icon/upload.
  upload: 'M8 2.4v8M4.8 5.6 8 2.4l3.2 3.2M2.4 10.4v3.2h11.2v-3.2',
  // The sticky popover's author, the Library's icon/invite.
  invite:
    'M10.67 14L10.67 12.66C10.67 11.96 10.39 11.28 9.89 10.78C9.39 10.28 8.71 10 8 10L4 10C3.3 10 2.62 10.28 2.12 10.78C1.62 11.28 1.34 11.96 1.34 12.66L1.34 14M8.67 4.66C8.67 6.14 7.47 7.34 6 7.34C4.53 7.34 3.34 6.14 3.34 4.66C3.34 3.19 4.53 2 6 2C7.47 2 8.67 3.19 8.67 4.66M12.66 5.34L12.66 9.34M14.66 7.34L10.66 7.34',
  // Home's grid or list toggle (frame H1): four squares, and three equal lines.
  'view-grid': 'M2.5 2.5h4.5v4.5h-4.5ZM9 2.5h4.5v4.5H9ZM2.5 9h4.5v4.5h-4.5ZM9 9h4.5v4.5H9Z',
  'view-list': 'M2.5 4h11M2.5 8h11M2.5 12h11',
  // The past-due notice's alert: a circle with an exclamation mark.
  alert: 'M8 1.6a6.4 6.4 0 1 0 0 12.8A6.4 6.4 0 1 0 8 1.6ZM8 4.8v3.6M8 10.8v.4',
};
