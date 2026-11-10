import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssetsHttpError } from './assets-responses.js';
import { uploadFailureMessage } from './run-upload.js';
import { createXhrPut, PUT_STALL_TIMEOUT_MS, type PutRequest } from './xhr-put.js';

/** A request the test answers by hand. */
class FakeRequest implements PutRequest {
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: ((event: ProgressEvent) => void) | null = null;
  onerror: ((event: ProgressEvent) => void) | null = null;
  onabort: ((event: ProgressEvent) => void) | null = null;
  status = 0;
  responseType: XMLHttpRequestResponseType = '';
  responseTypeAtSend: XMLHttpRequestResponseType | undefined;
  isAborted = false;
  readonly opened: string[] = [];
  readonly headers: [string, string][] = [];
  body: Blob | undefined;

  open(method: string, url: string): void {
    this.opened.push(method, url);
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.push([name, value]);
  }

  send(body: Blob): void {
    this.responseTypeAtSend = this.responseType;
    this.body = body;
  }

  abort(): void {
    this.isAborted = true;
    this.onabort?.({} as ProgressEvent);
  }

  progress(loaded: number, total: number, isLengthComputable = true): void {
    const event = { loaded, total, lengthComputable: isLengthComputable };
    this.upload.onprogress?.(event as ProgressEvent);
  }
}

describe('createXhrPut', () => {
  it('requests a text response before sending so Firefox never parses an empty answer as XML', async () => {
    const request = new FakeRequest();
    const putting = createXhrPut(() => request)('u', {}, new Blob([]), () => undefined);
    expect(request.responseTypeAtSend).toBe('text');
    request.status = 200;
    request.onload?.({} as ProgressEvent);
    await putting;
  });

  it('puts the body with the declared headers and reports progress', async () => {
    const request = new FakeRequest();
    const progress: [number, number][] = [];
    const body = new Blob([new Uint8Array(10)]);
    const putting = createXhrPut(() => request)(
      'https://store.test/staging/1',
      { 'content-type': 'image/png' },
      body,
      (loaded, total) => progress.push([loaded, total]),
    );
    expect(request.opened).toEqual(['PUT', 'https://store.test/staging/1']);
    expect(request.headers).toEqual([['content-type', 'image/png']]);
    expect(request.body).toBe(body);
    request.progress(4, 10);
    request.progress(6, 0, false);
    request.status = 200;
    request.onload?.({} as ProgressEvent);
    await putting;
    expect(progress).toEqual([
      [4, 10],
      [6, 10],
    ]);
  });

  it('rejects a refused put with its status, and one that got no answer with 0', async () => {
    const refused = new FakeRequest();
    const put = createXhrPut(() => refused);
    const first = put('u', {}, new Blob([]), () => undefined);
    refused.status = 410;
    refused.onload?.({} as ProgressEvent);
    await expect(first).rejects.toMatchObject({ status: 410 });
    const lost = new FakeRequest();
    const second = createXhrPut(() => lost)('u', {}, new Blob([]), () => undefined);
    lost.onerror?.({} as ProgressEvent);
    await expect(second).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('calls a store’s 403 an expired put, which a fresh declaration fixes', async () => {
    const expired = new FakeRequest();
    const putting = createXhrPut(() => expired)('u', {}, new Blob([]), () => undefined);
    expired.status = 403;
    expired.onload?.({} as ProgressEvent);
    const error: unknown = await putting.catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: 403, code: 'put-expired' });
    expect(uploadFailureMessage(error)).toBe('The upload took too long.');
  });

  describe('on fake timers', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('abandons a put that makes no progress for a while, as a stalled upload', async () => {
      vi.useFakeTimers();
      const stalled = new FakeRequest();
      const putting = createXhrPut(() => stalled)('u', {}, new Blob([]), () => undefined);
      const settled = putting.catch((failure: unknown) => failure);
      await vi.advanceTimersByTimeAsync(PUT_STALL_TIMEOUT_MS - 1000);
      // Progress keeps it alive.
      stalled.progress(1, 2);
      await vi.advanceTimersByTimeAsync(PUT_STALL_TIMEOUT_MS - 1000);
      expect(stalled.isAborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      const error = await settled;
      expect(stalled.isAborted).toBe(true);
      expect(error).toMatchObject({ status: 0, code: 'stalled' });
      expect(uploadFailureMessage(error)).toBe('The upload stalled.');
      expect(uploadFailureMessage(new AssetsHttpError(0, 'network', 'x'))).toContain('reach');
    });
  });

  it('aborts a put when its signal is aborted, or at once when it already was', async () => {
    const running = new FakeRequest();
    const controller = new AbortController();
    const putting = createXhrPut(() => running)(
      'u',
      {},
      new Blob([]),
      () => undefined,
      controller.signal,
    );
    controller.abort();
    await expect(putting).rejects.toMatchObject({ status: 0, code: 'aborted' });
    expect(running.isAborted).toBe(true);
    const never = new FakeRequest();
    const late = createXhrPut(() => never)(
      'u',
      {},
      new Blob([]),
      () => undefined,
      controller.signal,
    );
    await expect(late).rejects.toMatchObject({ code: 'aborted' });
    expect(never.body).toBeUndefined();
    const other = new FakeRequest();
    const cancelled = createXhrPut(() => other)('u', {}, new Blob([]), () => undefined);
    other.onabort?.({} as ProgressEvent);
    await expect(cancelled).rejects.toMatchObject({ code: 'aborted' });
  });

  it('puts through the browser’s XMLHttpRequest by default', async () => {
    const made: FakeRequest[] = [];
    vi.stubGlobal(
      'XMLHttpRequest',
      class extends FakeRequest {
        constructor() {
          super();
          made.push(this);
        }
      },
    );
    try {
      const putting = createXhrPut()('u', {}, new Blob([]), () => undefined);
      const [request] = made;
      if (request === undefined) throw new Error('No request was made.');
      request.status = 200;
      request.onload?.({} as ProgressEvent);
      await putting;
      expect(request.opened).toEqual(['PUT', 'u']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
