// Ruling 9: the cached preview of a page showing instances. A virtual candidate maps to
// its owner, the projection carries each shown instance's main closure (also off-page and
// retired), override assets need evidence, and no virtual id is ever stored.
import { describe, expect, it, vi } from 'vitest';

import { DOCUMENT_LAYOUT_VERSION } from '@canvas/document';
import { isVirtualObjectId, type EngineHost, type PreviewCertificate } from '@canvas/engine';
import { createBoard, exportBoard, type Board, type BoardObject } from '@canvas/schema';

import { enqueueHostScene } from '../engine/host-scene-stream.js';

import {
  FIXTURE_CAMERA,
  instanceBoard,
  liveScene,
  MAINS_PAGE,
  sceneCertificate,
} from './__fixtures__/instance-board.js';
import { readCachedProjection } from './cached-projection.js';
import { captureCachedProjection, captureLiveProjection } from './capture-cached-projection.js';

const identity = { boardId: 'board', camera: FIXTURE_CAMERA, fontSetKey: 'font-sha' };

/**
 * The default page alone, as the page-scoped store reads it.
 *
 * @param board - The whole board.
 * @returns Its default page's objects.
 */
function pageOf(board: Board): Board {
  return createBoard(liveSceneRealObjects(board));
}

function liveSceneRealObjects(board: Board): BoardObject[] {
  const ids = new Set(['plain', 'inst', 'nest', 'gone', 'old', 'late']);
  return [...board.objects.values()].filter((object) => ids.has(object.id));
}

async function capture(
  board: Board,
  certificate?: (scene: PreviewCertificate['scene']) => PreviewCertificate,
) {
  const host = {
    applyChangeSet: vi.fn(),
    readPreviewCertificate: vi.fn(() => Promise.resolve(certified)),
  } as unknown as EngineHost;
  const scene = enqueueHostScene(host, { created: [], updated: [], deleted: [], objects: {} });
  const certified = certificate?.(scene) ?? sceneCertificate(board, scene);
  const bytes = await captureCachedProjection(host, {
    ...identity,
    board: pageOf(board),
    definitions: board,
    isCurrent: () => true,
  });
  return { bytes, certified };
}

function decode(bytes: Uint8Array | undefined): Record<string, unknown> {
  if (bytes === undefined) throw new Error('nothing captured');
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === 'object' && value !== null)
    return Object.entries(value).flatMap(([key, entry]) => [key, ...strings(entry)]);
  return [];
}

describe('capturing a page that shows instances', () => {
  it('keeps each shown instance with its main closure, off-page and retired, and no virtual id', async () => {
    const board = instanceBoard();
    const { bytes, certified } = await capture(board);
    expect(certified.candidates.some(isVirtualObjectId)).toBe(true);
    const payload = decode(bytes);
    const projection = payload.projection as { objects: { id: string }[]; pages: unknown[] };
    expect(projection.objects.map((object) => object.id).sort()).toEqual(
      // Shown: the page's objects except the retired main and its child, which do not draw.
      // Closure: `main` and `outer` (another page) inside their frame, `inner`, `title`,
      // `photo`, and the retired `gone` with `old` for the late instance.
      [
        'gone',
        'inner',
        'inst',
        'late',
        'main',
        'nest',
        'old',
        'outer',
        'photo',
        'plain',
        'shelf',
        'title',
      ],
    );
    expect(projection.pages).toEqual([
      { id: 'page-1', name: 'Page 1', order: 'a0' },
      { ...MAINS_PAGE },
    ]);
    const stored = payload.certificate as PreviewCertificate;
    expect(stored.candidates).toEqual(['plain', 'inst', 'nest', 'late']);
    const virtual = [...liveScene(board).keys()].filter(isVirtualObjectId);
    expect(virtual).toContain('nest/inner/title');
    expect(virtual).toContain('late/old');
    const persisted = new Set(strings(payload));
    expect(virtual.filter((id) => persisted.has(id))).toEqual([]);
    expect([...persisted].filter((value) => isVirtualObjectId(value))).toEqual([]);
  });

  it('restores the closure and reports which objects draw', async () => {
    const board = instanceBoard();
    const { bytes } = await capture(board);
    if (bytes === undefined) throw new Error('nothing captured');
    const restored = readCachedProjection(bytes, identity);
    expect(restored?.board.objects.get('main' as never)).toEqual(
      board.objects.get('main' as never),
    );
    expect([...(restored?.shownIds ?? [])].sort()).toEqual(['inst', 'late', 'nest', 'plain']);
    expect(restored?.certificate.candidates.some(isVirtualObjectId)).toBe(false);
  });

  it('refuses when the drawn override or closure image has no content evidence', async () => {
    const board = instanceBoard();
    const { bytes } = await capture(board, (scene) => {
      const certificate = sceneCertificate(board, scene);
      return {
        ...certificate,
        assets: certificate.assets.filter((asset) => asset.assetId !== 'asset-override'),
      };
    });
    expect(bytes).toBeUndefined();
  });

  it('refuses the image-free live capture when a closure holds an image', async () => {
    const board = instanceBoard();
    let certified: PreviewCertificate | undefined;
    const host = {
      applyChangeSet: vi.fn(),
      readPreviewCertificate: vi.fn(() => Promise.resolve(certified)),
    } as unknown as EngineHost;
    const scene = enqueueHostScene(host, { created: [], updated: [], deleted: [], objects: {} });
    certified = sceneCertificate(board, scene);
    const live = (images: Board) =>
      captureLiveProjection(
        host,
        { board: pageOf(images), definitions: images, isCurrent: () => true },
        { ...identity, isCurrent: () => true },
      );
    await expect(live(board)).resolves.toBeUndefined();
    const free = instanceBoard({ hasImages: false });
    certified = sceneCertificate(free, scene);
    await expect(live(free)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('refuses a capture whose instance is not on the page view', async () => {
    const board = instanceBoard();
    const host = {
      applyChangeSet: vi.fn(),
      readPreviewCertificate: vi.fn(() => Promise.resolve(certified)),
    } as unknown as EngineHost;
    const scene = enqueueHostScene(host, { created: [], updated: [], deleted: [], objects: {} });
    const certified = sceneCertificate(board, scene);
    const page = createBoard(liveSceneRealObjects(board).filter((object) => object.id !== 'inst'));
    await expect(
      captureCachedProjection(host, {
        ...identity,
        board: page,
        definitions: board,
        isCurrent: () => true,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('restoring a projection with instances', () => {
  function envelope(board: Board, certificate: PreviewCertificate): Uint8Array {
    return new TextEncoder().encode(
      JSON.stringify({
        format: 'canvas.cached-projection',
        version: 1,
        boardId: 'board',
        layoutVersion: DOCUMENT_LAYOUT_VERSION,
        certificate,
        projection: exportBoard(board),
      }),
    );
  }

  async function stored() {
    const board = instanceBoard();
    const { bytes } = await capture(board);
    const payload = decode(bytes);
    const restored = readCachedProjection(bytes ?? new Uint8Array(), identity);
    if (restored === undefined) throw new Error('not restored');
    return { board: restored.board, certificate: payload.certificate as PreviewCertificate };
  }

  it('refuses an object that is neither drawn nor in a shown main closure', async () => {
    const { board, certificate } = await stored();
    const stray = instanceBoard().objects.get('stray' as never);
    if (stray === undefined) throw new Error('fixture');
    const extra = createBoard([...board.objects.values(), stray], board.pages?.values());
    expect(readCachedProjection(envelope(extra, certificate), identity)).toBeUndefined();
    expect(readCachedProjection(envelope(board, certificate), identity)).toBeDefined();
  });

  it('refuses a stored virtual candidate', async () => {
    const { board, certificate } = await stored();
    const virtual = { ...certificate, candidates: [...certificate.candidates, 'inst/title'] };
    expect(readCachedProjection(envelope(board, virtual as never), identity)).toBeUndefined();
  });

  it('refuses an override asset without content evidence', async () => {
    const { board, certificate } = await stored();
    const missing = {
      ...certificate,
      assets: certificate.assets.filter((asset) => asset.assetId !== 'asset-override'),
    };
    expect(readCachedProjection(envelope(board, missing), identity)).toBeUndefined();
  });
});
