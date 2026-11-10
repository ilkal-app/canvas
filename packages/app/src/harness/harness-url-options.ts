import type { EngineHostKind, GpuBackendName } from '@canvas/engine';
import { BOARD_MODES, type BoardMode } from '@canvas/schema';

import { WHITEBOARD_CHROMES, type WhiteboardChrome } from '../shell/whiteboard-chrome.js';
import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';
import type { ThemePreference } from '../theme/theme-preference.js';

/** Shell options a scenario test may set through the page's query string. */
export interface HarnessUrlOptions {
  /** `?platform=mac|other`: the keyboard convention, instead of the one detected. */
  readonly platform?: KeyboardPlatform;
  /** `?theme=system|light|dark`: the theme preference to start with. */
  readonly initialThemePreference?: ThemePreference;
  /** `?engine=worker|main`: mount the engine in the canvas, preferring this host. */
  readonly engine?: EngineHostKind;
  /**
   * `?content=demo|empty|selection-cap`: what the forced engine host (`?engine=`) starts with; `empty` leaves
   * the canvas to what a test sends through the engine harness (the benchmark boards).
   * The demo board if absent. (`?board=` names the board to open on the relay; see
   * `parseBoardAddress`.)
   */
  readonly board?: HarnessBoard;
  /** `?backend=webgpu|webgl2`: the GPU backend the engine tries first (the benchmark harness). */
  readonly backend?: GpuBackendName;
  /**
   * `?churnBudget=on`: the forced engine host (`?engine=`) takes the default per-frame churn
   * budget, objects nearest the viewport centre first; off if absent.
   */
  readonly isChurnBudgeted?: boolean;
  /**
   * `?reactions=local`: the forced engine host's shell gets a reactions channel of its own, with
   * no relay, which the engine harness feeds (`receiveReactions`,'s reactions burst).
   * Any other value is ignored.
   */
  readonly reactions?: 'local';
  /**
   * `?workerProbe=fail`: the default shell's probe of whether a worker can render answers no,
   * so the shell runs on its fallback, the engine on the main thread.
   */
  readonly workerProbe?: WorkerProbe;
  /**
   * `?view=tokens`: the token sheet, every surface, text style and the float shadow
   * of the theme, instead of the shell; `?view=fields`: the inspector's number field in each
   * state; both for the shell's screenshot baselines and axe.
   */
  readonly view?: HarnessView;
  /**
   * `?loading=1`: the shell as while the board's objects load (`AppShellProps.isLoading`), input
   * held and the layers drawer showing its skeleton rows; for the shell's screenshot
   * baselines.
   */
  readonly isLoading?: boolean;
  /**
   * `?chrome=classic|floating`: the chrome the token sheet (`?view=tokens`) shows its primitives
   * in. The shell ignores it since the cutover's delete: a whiteboard board is floating
   * and a design board (`?mode=`) classic.
   */
  readonly whiteboardChrome?: WhiteboardChrome;
  /**
   * `?mode=whiteboard|uiux|diagram|illustration|motion|slides`: the board's mode
   * (`AppShellProps.mode`), as a site board has the mode it was created with: the way a spec
   * opens a design mode since the mode switcher went. Whiteboard if absent.
   */
  readonly mode?: BoardMode;
  /**
   * `?fonts=neutral`: the chrome in the shell's own open fonts (`NEUTRAL_CHROME_FONTS`),
   * as the SDK shows it, in place of the site's Rand.
   */
  readonly fonts?: 'neutral';
}

/** The pages the harness can show instead of the shell. */
export type HarnessView = 'tokens' | 'fields';

/** What the harness page can make the default shell's worker probe answer. */
export type WorkerProbe = 'fail';

/** The boards the harness page can start the engine with. */
export type HarnessBoard = 'demo' | 'empty' | 'selection-cap';

const PLATFORMS: readonly KeyboardPlatform[] = ['mac', 'other'];
const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const ENGINE_HOST_KINDS: readonly EngineHostKind[] = ['worker', 'main'];
const BOARDS: readonly HarnessBoard[] = ['demo', 'empty', 'selection-cap'];
const BACKENDS: readonly GpuBackendName[] = ['webgpu', 'webgl2'];
const WORKER_PROBES: readonly WorkerProbe[] = ['fail'];
const VIEWS: readonly HarnessView[] = ['tokens', 'fields'];
const MODES: readonly BoardMode[] = BOARD_MODES;

function isOneOf<TValue extends string>(values: readonly TValue[], value: string): value is TValue {
  return (values as readonly string[]).includes(value);
}

/**
 * Reads the shell options a scenario test put in the standalone page's query string, so one
 * host can run a spec as a mac and as another platform. Only the harness-enabled page reads
 * them; a production page has no such parameters.
 *
 * @param search - `location.search`, with or without the leading `?`.
 * @returns The options the query string sets; absent ones are left out.
 * @throws {Error} When `platform`, `theme`, `engine`, `content`, `backend`, `workerProbe`, `view`,
 *   `loading`, `churnBudget`, `chrome` or `mode` has a
 *   value the shell does not know, so a typo fails the test instead of silently running the
 *   default.
 */
export function parseHarnessUrlOptions(search: string): HarnessUrlOptions {
  const parameters = new URLSearchParams(search);
  const platform = parameters.get('platform');
  const theme = parameters.get('theme');
  const engine = parameters.get('engine');
  const board = parameters.get('content');
  const backend = parameters.get('backend');
  const workerProbe = parameters.get('workerProbe');
  const view = parameters.get('view');
  const loading = parameters.get('loading');
  const churnBudget = parameters.get('churnBudget');
  const chrome = parameters.get('chrome');
  const mode = parameters.get('mode');
  const reactions = parameters.get('reactions');
  const fonts = parameters.get('fonts');
  if (platform !== null && !isOneOf(PLATFORMS, platform)) {
    throw new Error(`Unknown keyboard platform "${platform}"; use mac or other.`);
  }
  if (theme !== null && !isOneOf(THEME_PREFERENCES, theme)) {
    throw new Error(`Unknown theme "${theme}"; use system, light or dark.`);
  }
  if (engine !== null && !isOneOf(ENGINE_HOST_KINDS, engine)) {
    throw new Error(`Unknown engine host "${engine}"; use worker or main.`);
  }
  if (board !== null && !isOneOf(BOARDS, board)) {
    throw new Error(`Unknown content "${board}"; use demo, empty or selection-cap.`);
  }
  if (backend !== null && !isOneOf(BACKENDS, backend)) {
    throw new Error(`Unknown GPU backend "${backend}"; use webgpu or webgl2.`);
  }
  if (workerProbe !== null && !isOneOf(WORKER_PROBES, workerProbe)) {
    throw new Error(`Unknown worker probe "${workerProbe}"; use fail.`);
  }
  if (view !== null && !isOneOf(VIEWS, view)) {
    throw new Error(`Unknown view "${view}"; use tokens or fields.`);
  }
  if (loading !== null && loading !== '1') {
    throw new Error(`Unknown loading "${loading}"; use 1.`);
  }
  if (churnBudget !== null && churnBudget !== 'on') {
    throw new Error(`Unknown churnBudget "${churnBudget}"; use on.`);
  }
  if (chrome !== null && !isOneOf(WHITEBOARD_CHROMES, chrome)) {
    throw new Error(`Unknown chrome "${chrome}"; use classic or floating.`);
  }
  if (mode !== null && !isOneOf(MODES, mode)) {
    throw new Error(`Unknown mode "${mode}"; use one of ${MODES.join(', ')}.`);
  }
  if (fonts !== null && fonts !== 'neutral') {
    throw new Error(`Unknown fonts "${fonts}"; use neutral.`);
  }
  return {
    ...(platform === null ? {} : { platform }),
    ...(theme === null ? {} : { initialThemePreference: theme }),
    ...(engine === null ? {} : { engine }),
    ...(board === null ? {} : { board }),
    ...(backend === null ? {} : { backend }),
    ...(workerProbe === null ? {} : { workerProbe }),
    ...(view === null ? {} : { view }),
    ...(loading === null ? {} : { isLoading: true }),
    ...(churnBudget === null ? {} : { isChurnBudgeted: true }),
    ...(chrome === null ? {} : { whiteboardChrome: chrome }),
    ...(mode === null ? {} : { mode }),
    ...(reactions === 'local' ? { reactions } : {}),
    ...(fonts === null ? {} : { fonts }),
  };
}
