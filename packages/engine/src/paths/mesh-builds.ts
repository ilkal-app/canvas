import type { MeshJobRequest, MeshJobResponse } from './mesh-job-payload.js';
import { runMeshJob } from './mesh-job.js';
import type { PathMeshBuilder } from './path-mesh-builder.js';

/**
 * Frames a pool build may stay unanswered before the path is meshed inline instead: about five
 * seconds at 60 Hz. The drawer reads no clock, so it counts its own frames, which keep coming
 * while builds are pending (`hasPendingWork`).
 */
export const MESH_BUILD_TIMEOUT_FRAMES = 300;

/** How {@link MeshBuilds} reports its results. */
export interface MeshBuildsOptions {
  /** Builds meshes, at once or later. */
  readonly builder: PathMeshBuilder;
  /** Receives every mesh that did not come back from `request` at once. */
  readonly onLanded: (response: MeshJobResponse) => void;
  /**
   * Receives what went wrong: at most one error per frame summing up that frame's timed-out
   * and failed builds, so a hung worker on a board of thousands of paths is one fault, not
   * thousands.
   */
  readonly onFault: (error: Error) => void;
  /** Frames before an unanswered build times out. Default {@link MESH_BUILD_TIMEOUT_FRAMES}. */
  readonly timeoutFrames?: number;
}

/** A build in flight. */
interface PendingBuild {
  readonly request: MeshJobRequest;
  /** The frame it was sent in. */
  readonly sentFrame: number;
}

/**
 * The key of a build: its version, bucket and object, which no id can make ambiguous since the
 * two numbers come first.
 *
 * @param request - The build's request.
 * @returns The key.
 */
function keyOf(request: MeshJobRequest): string {
  return `${String(request.version)}:${String(request.bucket)}:${request.objectId}`;
}

/**
 * The path pass's mesh builds in flight: at most one per path, version and bucket. A
 * build the builder rejects, or leaves unanswered for {@link MESH_BUILD_TIMEOUT_FRAMES} frames,
 * is made once inline at the start of the next frame, so a lost worker job never keeps the
 * frame loop waiting; a timed-out build also has its worker retired (`abandon`), since a
 * worker that holds a job that long is hung. Each frame's timeouts and failures are reported
 * as one fault. A path whose inline build throws too is not tried again until its network
 * changes. Its maps shrink as paths are forgotten, so they stay bounded by the paths drawn.
 * Rendering thread only.
 */
export class MeshBuilds {
  private readonly options: MeshBuildsOptions;
  private readonly timeoutFrames: number;
  private readonly pending = new Map<string, PendingBuild>();
  /** Builds whose job was rejected, to make inline at the next frame's start. */
  private failed = new Map<string, MeshJobRequest>();
  /** The version of each path whose inline build threw, not tried again. */
  private readonly unbuildable = new Map<string, number>();
  private frame = 0;
  private isStopped = false;

  /**
   * Creates the tracker.
   *
   * @param options - The builder, where results and faults go, and the timeout.
   */
  constructor(options: MeshBuildsOptions) {
    this.options = options;
    this.timeoutFrames = options.timeoutFrames ?? MESH_BUILD_TIMEOUT_FRAMES;
  }

  /**
   * Builds in flight, and failed ones waiting to be made inline.
   *
   * @returns The count.
   */
  get size(): number {
    return this.pending.size + this.failed.size;
  }

  /**
   * Starts a frame: builds unanswered for too long have their workers retired, and they and the
   * builds that failed since the last frame are made inline, their meshes delivered through
   * `onLanded` now (before the frame's render pass), with one fault for the lot.
   */
  beginFrame(): void {
    this.frame += 1;
    const timedOut: MeshJobRequest[] = [];
    for (const [key, build] of this.pending) {
      if (this.frame - build.sentFrame < this.timeoutFrames) continue;
      this.pending.delete(key);
      timedOut.push(build.request);
    }
    const failed = [...this.failed.values()];
    this.failed.clear();
    if (timedOut.length === 0 && failed.length === 0) return;
    const reason = new Error(
      `A mesh job went unanswered for ${String(this.timeoutFrames)} frames.`,
    );
    // Retiring a worker fails its other jobs too; they are made inline next frame.
    for (const request of timedOut) this.options.builder.abandon?.(request, reason);
    const unbuilt = [...timedOut, ...failed].filter((request) => !this.buildInline(request));
    this.options.onFault(new Error(describeFrame(timedOut.length, failed.length, unbuilt)));
  }

  /**
   * Whether a request should be sent: not already in flight or waiting to be made inline, and
   * not a network that failed inline.
   *
   * @param request - The request.
   * @returns True when `request` would start a build.
   */
  canRequest(request: MeshJobRequest): boolean {
    return (
      !this.pending.has(keyOf(request)) &&
      !this.failed.has(keyOf(request)) &&
      this.unbuildable.get(request.objectId) !== request.version
    );
  }

  /**
   * Sends a request to the builder.
   *
   * @param request - The request; check `canRequest` first.
   * @returns The mesh when the builder answered at once, else `undefined` (it lands through
   *   `onLanded`).
   */
  request(request: MeshJobRequest): MeshJobResponse | undefined {
    let result: MeshJobResponse | Promise<MeshJobResponse>;
    try {
      result = this.options.builder.build(request);
    } catch (error) {
      this.unbuildable.set(request.objectId, request.version);
      this.options.onFault(
        new Error(`The mesh of path "${request.objectId}" cannot be built (${describe(error)}).`),
      );
      return undefined;
    }
    if (!(result instanceof Promise)) return result;
    const key = keyOf(request);
    this.pending.set(key, { request, sentFrame: this.frame });
    result.then(
      (response) => {
        // A build that timed out or was forgotten was replaced or is no longer wanted.
        if (this.isStopped || !this.pending.delete(key)) return;
        this.options.onLanded(response);
      },
      () => {
        if (this.isStopped || !this.pending.delete(key)) return;
        this.failed.set(key, request);
      },
    );
    return undefined;
  }

  /**
   * Drops everything held for a path: its builds in flight (ignored when they land) and a
   * failed network. Called when the path is deleted.
   *
   * @param objectId - The path.
   */
  forget(objectId: string): void {
    for (const [key, { request }] of this.pending) {
      if (request.objectId === objectId) this.pending.delete(key);
    }
    for (const [key, request] of this.failed) {
      if (request.objectId === objectId) this.failed.delete(key);
    }
    this.unbuildable.delete(objectId);
  }

  /** Ignores every build still in flight from now on. */
  stop(): void {
    this.isStopped = true;
    this.pending.clear();
    this.failed.clear();
  }

  /**
   * Builds a mesh on this thread and delivers it; a network that throws is marked unbuildable.
   *
   * @param request - The build.
   * @returns Whether it was built.
   */
  private buildInline(request: MeshJobRequest): boolean {
    try {
      this.options.onLanded(runMeshJob(request));
      return true;
    } catch {
      this.unbuildable.set(request.objectId, request.version);
      return false;
    }
  }
}

/**
 * The one fault message of a frame's failed builds.
 *
 * @param timedOut - Builds that timed out.
 * @param failed - Builds whose job was rejected.
 * @param unbuilt - Those whose inline build threw too.
 * @returns The message.
 */
function describeFrame(
  timedOut: number,
  failed: number,
  unbuilt: readonly MeshJobRequest[],
): string {
  const parts = [
    ...(timedOut > 0 ? [`${String(timedOut)} timed out (their workers were retired)`] : []),
    ...(failed > 0 ? [`${String(failed)} failed`] : []),
  ];
  const ids = unbuilt.map(({ objectId }) => `"${objectId}"`).join(', ');
  const cannot = unbuilt.length > 0 ? `; ${String(unbuilt.length)} cannot be built: ${ids}` : '';
  return `Path mesh jobs: ${parts.join(', ')}; meshed inline instead${cannot}.`;
}

/**
 * A thrown value's message.
 *
 * @param error - Anything thrown.
 * @returns Its message, or its text.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
