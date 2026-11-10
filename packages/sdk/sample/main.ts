// A host page that mounts a board through the SDK alone: what an embedding
// page does. `pnpm sample` serves it by Vite from the SDK's sources; `pnpm sample:built` builds it
// on the built SDK (vite.sample.config.ts), the public README's runnable example. The frame-time
// benchmark's `-sdk` scenarios open it, with the harness on, to set the SDK's frames beside the
// app's own page.
//   ?theme=light|dark|system   the theme to start in; the system's if absent
//   ?persistence=device        keep the board in IndexedDB; in memory if absent
//   ?boardId=<id>              the board's id, the key a device board is kept under
import { mount, type CanvasInstance, type CanvasTheme, type MountOptions } from '@ilkal/sdk';

/** The page's mounted board, for a test or a benchmark to read. */
declare global {
  interface Window {
    canvasSdk?: CanvasInstance;
  }
}

/** The themes the page takes from `?theme`. */
const THEMES: readonly CanvasTheme[] = ['light', 'dark', 'system'];

/**
 * The theme `?theme` names, or `undefined` for none or an unknown one.
 *
 * @param search - The page's query.
 * @returns The theme.
 */
function themeOf(search: string): CanvasTheme | undefined {
  const theme = new URLSearchParams(search).get('theme');
  return THEMES.find((name) => name === theme);
}

/**
 * The mount's options from the page's query: `theme`, `persistence` and `boardId`.
 *
 * @param search - The page's query.
 * @returns The options.
 */
function optionsOf(search: string): MountOptions {
  const parameters = new URLSearchParams(search);
  const theme = themeOf(search);
  const boardId = parameters.get('boardId');
  return {
    ...(theme === undefined ? {} : { theme }),
    ...(parameters.get('persistence') === 'device' ? { persistence: 'device' as const } : {}),
    ...(boardId === null ? {} : { boardId }),
  };
}

const element = document.querySelector<HTMLElement>('#board');
if (element === null) throw new Error('The sample page has no #board element.');
window.canvasSdk = await mount(element, optionsOf(location.search));
