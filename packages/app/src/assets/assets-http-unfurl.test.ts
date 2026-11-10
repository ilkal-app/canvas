import { describe, expect, it } from 'vitest';

import { FAKE_ASSETS_URL } from './__fixtures__/fake-assets-service.js';
import { AssetsHttp } from './assets-http.js';

describe('AssetsHttp.unfurl', () => {
  it('posts the link and the board, and answers the preview', async () => {
    const preview = { title: 'Story', description: '', siteName: 'Example' };
    const requests: { url: string; method: string | undefined; body: unknown }[] = [];
    const fetcher = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : input.toString();
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      requests.push({ url, method: init?.method, body });
      return Promise.resolve(new Response(JSON.stringify(preview), { status: 200 }));
    };
    const http = new AssetsHttp(
      { assetsUrl: FAKE_ASSETS_URL, boardId: 'board-a', token: 't' },
      fetcher,
    );
    expect(await http.unfurl('https://example.com/story')).toEqual(preview);
    expect(requests).toEqual([
      {
        url: expect.stringContaining('/v1/links/unfurl') as unknown,
        method: 'POST',
        body: { url: 'https://example.com/story', boardId: 'board-a' },
      },
    ]);
  });
});
