import { createWebWorkerTransport, type EngineWorkerTransport } from '@canvas/engine';

import { loadPageFonts, subscribePageFonts } from '../text-input/page-fonts.js';
import { postFontFiles } from '../text-input/worker-font-files.js';

/**
 * Starts the engine worker (`engine-worker.ts`) as a module worker. The app owns the bundler, so
 * it owns the worker's URL; Vite turns the `new URL(…, import.meta.url)` into the bundled script.
 * Once the page's fonts have loaded, their bytes are posted to the worker (`postFontFiles`), so
 * each font file is downloaded once per page, whatever the HTTP cache keeps.
 *
 * @returns The worker, as the engine host talks to it.
 */
export function spawnEngineWorker(): EngineWorkerTransport {
  // Written inline so Vite recognises the pattern and bundles the worker script.
  const worker = new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' });
  const page = loadPageFonts();
  const sent = new Map<string, string>();
  let isStopped = false;
  const publish = () => {
    if (!isStopped) postFontFiles(worker, page.fonts, sent);
  };
  const stop = subscribePageFonts(publish);
  void page.loaded.then(publish);
  const transport = createWebWorkerTransport(worker);
  return {
    connect: (listener) => {
      transport.connect(listener);
    },
    post: (message, transfer) => {
      transport.post(message, transfer);
    },
    terminate: () => {
      isStopped = true;
      stop();
      transport.terminate();
    },
  };
}
