import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBuffer } from '../gpu/gpu-buffer.js';

/** Bytes per path mesh vertex: `x, y` as 32-bit floats (`buildPathMesh`'s layout). */
const VERTEX_BYTES = 8;

/**
 * The size of a shared page, bytes: 1 MiB, about 130,000 vertices. A zoomed-out frame binds a
 * page per run of meshes in it rather than a buffer per path.
 */
export const PATH_MESH_PAGE_BYTES = 1024 * 1024;

/** Where a mesh's vertices are: a buffer, and the vertex they start at in it. */
export interface PathMeshPlacement {
  /** The buffer, shared with other meshes unless the mesh is larger than a page. */
  readonly buffer: GpuBuffer;
  /** The mesh's vertex 0, counted from the buffer's start. */
  readonly firstVertex: number;
  /** Its vertex count. */
  readonly vertexCount: number;
}

/** A shared buffer and its free runs of vertices, `[first, count]`, in order, never touching. */
interface Page {
  readonly buffer: GpuBuffer;
  readonly vertexCapacity: number;
  readonly free: [number, number][];
  used: number;
}

/**
 * The vertex buffers of a path pass's meshes: meshes are placed side by side in shared
 * pages of {@link PATH_MESH_PAGE_BYTES}, first fit, and a mesh larger than a page gets a buffer
 * of its own. Freed room is merged with its neighbours and reused; a page whose last mesh goes
 * is destroyed. A frame then binds a page once for a run of meshes in it and draws each from its
 * `firstVertex`, instead of binding a buffer per path. One thread; call with no render pass open.
 */
export class PathMeshArena {
  private readonly pages: Page[] = [];
  private readonly placed = new Map<PathMeshPlacement, Page>();
  private bytes = 0;

  /**
   * Creates an empty arena.
   *
   * @param backend - The backend buffers are made on.
   * @param label - The buffers' label.
   * @param pageBytes - A shared page's size, bytes, a multiple of 8.
   */
  constructor(
    private readonly backend: GpuBackend,
    private readonly label: string,
    private readonly pageBytes = PATH_MESH_PAGE_BYTES,
  ) {}

  /**
   * The bytes of every buffer the arena holds, free room in its pages included.
   *
   * @returns The total, bytes.
   */
  get byteLength(): number {
    return this.bytes;
  }

  /**
   * Copies a mesh's vertices into the arena.
   *
   * @param vertices - `x, y` per vertex; not empty.
   * @returns Where they are, until released.
   */
  place(vertices: Float32Array<ArrayBuffer>): PathMeshPlacement {
    const vertexCount = vertices.byteLength / VERTEX_BYTES;
    const page = this.pageWithRoom(vertexCount) ?? this.openPage(vertexCount);
    const firstVertex = take(page.free, vertexCount);
    page.used += vertexCount;
    this.backend.writeBuffer(page.buffer, firstVertex * VERTEX_BYTES, vertices);
    const placement = { buffer: page.buffer, firstVertex, vertexCount };
    this.placed.set(placement, page);
    return placement;
  }

  /**
   * Gives a mesh's room back; nothing for a placement released already.
   *
   * @param placement - What `place` returned.
   */
  release(placement: PathMeshPlacement): void {
    const page = this.placed.get(placement);
    if (page === undefined) return;
    this.placed.delete(placement);
    page.used -= placement.vertexCount;
    if (page.used === 0) {
      this.pages.splice(this.pages.indexOf(page), 1);
      this.bytes -= page.buffer.byteLength;
      page.buffer.destroy();
      return;
    }
    give(page.free, placement.firstVertex, placement.vertexCount);
  }

  /** Destroys every buffer. */
  destroy(): void {
    for (const page of this.pages) page.buffer.destroy();
    this.pages.length = 0;
    this.placed.clear();
    this.bytes = 0;
  }

  private pageWithRoom(vertexCount: number): Page | undefined {
    return this.pages.find(({ free }) => free.some(([, count]) => count >= vertexCount));
  }

  private openPage(vertexCount: number): Page {
    const byteLength = Math.max(this.pageBytes, vertexCount * VERTEX_BYTES);
    const buffer = this.backend.createBuffer({ usage: 'vertex', byteLength, label: this.label });
    const vertexCapacity = byteLength / VERTEX_BYTES;
    const page: Page = { buffer, vertexCapacity, free: [[0, vertexCapacity]], used: 0 };
    this.pages.push(page);
    this.bytes += byteLength;
    return page;
  }
}

/**
 * Takes room from the first free run that holds it.
 *
 * @param free - The free runs; one is shortened or removed.
 * @param vertexCount - The room, vertices.
 * @returns The first vertex taken.
 * @throws {RangeError} When no run holds it (the caller picked a page with room).
 */
function take(free: [number, number][], vertexCount: number): number {
  const index = free.findIndex(([, count]) => count >= vertexCount);
  const run = free[index];
  if (run === undefined) throw new RangeError('No free run holds the mesh.');
  const [first, count] = run;
  if (count === vertexCount) free.splice(index, 1);
  else free[index] = [first + vertexCount, count - vertexCount];
  return first;
}

/**
 * Gives room back, merged with the free runs it touches.
 *
 * @param free - The free runs, in order; changed in place.
 * @param first - The room's first vertex.
 * @param vertexCount - Its vertices.
 */
function give(free: [number, number][], first: number, vertexCount: number): void {
  let index = free.findIndex(([start]) => start > first);
  if (index === -1) index = free.length;
  let start = first;
  let end = first + vertexCount;
  const before = free[index - 1];
  const after = free[index];
  let removeFrom = index;
  let removeCount = 0;
  if (before !== undefined && before[0] + before[1] === start) {
    start = before[0];
    removeFrom = index - 1;
    removeCount += 1;
  }
  if (after?.[0] === end) {
    end = after[0] + after[1];
    removeCount += 1;
  }
  free.splice(removeFrom, removeCount, [start, end - start]);
}
