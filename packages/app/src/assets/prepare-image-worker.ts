// The prepare worker: reads an image file's size from its header and hashes it with
// crypto.subtle.digest, off the page's thread; nothing is decoded (prepare-image.ts starts it,
// at most two files at a time; Vite bundles it from the `new URL` there).
import { prepareImageFile, type PrepareAnswer, type PrepareRequest } from './prepare-image.js';

self.onmessage = (event: MessageEvent<PrepareRequest>) => {
  const { id, file } = event.data;
  void prepareImageFile(file).then((outcome) => {
    self.postMessage({ id, outcome } satisfies PrepareAnswer);
  });
};
