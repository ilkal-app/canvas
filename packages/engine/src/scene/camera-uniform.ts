import { cameraClipTransform, type Camera } from '../camera/camera.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBuffer } from '../gpu/gpu-buffer.js';

/**
 * The camera uniform's size: `vec2f scale, vec2f offset`, then `f32 pixel`, `f32 cssPixel` and
 * two floats of padding, 32 bytes (std140-safe).
 */
export const CAMERA_UNIFORM_BYTE_LENGTH = 32;

/**
 * The floats of the camera uniform: the world-to-clip map (`cameraClipTransform`,
 * `clip = world × scale + offset`), then the size of one device pixel in world units
 * (`1 / (zoom × dpr)`), which a shader that pads its quads for antialiasing reads (the SDF
 * shape pass), then the size of one CSS pixel in world units (`1 / zoom`), which the
 * frame title pass scales names drawn at a constant size on screen by, then two
 * zeros of padding. Passes that need only the map declare the first 16 bytes. Pure.
 *
 * @param camera - The camera.
 * @returns Eight floats, in the uniform's order.
 */
export function cameraUniformValues(camera: Camera): readonly number[] {
  return [...cameraClipTransform(camera), 1 / (camera.zoom * camera.dpr), 1 / camera.zoom, 0, 0];
}

/**
 * The one uniform buffer every scene pass binds at `@group(0) @binding(0)`: the camera's
 * world-to-clip map and the world size of a device pixel (`cameraUniformValues`). It is written
 * only when they change, so a pan or zoom costs one 32-byte write and a still frame costs none.
 */
export class CameraUniform {
  /** The GPU buffer, `uniform` usage, {@link CAMERA_UNIFORM_BYTE_LENGTH} bytes. */
  readonly buffer: GpuBuffer;
  private readonly backend: GpuBackend;
  private readonly next = new Float32Array(CAMERA_UNIFORM_BYTE_LENGTH / 4);
  private readonly written = new Float32Array(CAMERA_UNIFORM_BYTE_LENGTH / 4);
  private hasWritten = false;

  /**
   * Allocates the uniform buffer.
   *
   * @param backend - The backend the scene draws through.
   */
  constructor(backend: GpuBackend) {
    this.backend = backend;
    this.buffer = backend.createBuffer({
      usage: 'uniform',
      byteLength: CAMERA_UNIFORM_BYTE_LENGTH,
      label: 'camera',
    });
  }

  /**
   * Writes the camera's values if they differ, at 32-bit precision, from the ones last written.
   * Call with no render pass open.
   *
   * @param camera - This frame's camera.
   * @returns Whether the buffer was written.
   */
  update(camera: Camera): boolean {
    this.next.set(cameraUniformValues(camera));
    if (this.hasWritten && this.next.every((value, index) => value === this.written[index])) {
      return false;
    }
    this.backend.writeBuffer(this.buffer, 0, this.next);
    this.written.set(this.next);
    this.hasWritten = true;
    return true;
  }

  /** Frees the uniform buffer. */
  destroy(): void {
    this.buffer.destroy();
  }
}
