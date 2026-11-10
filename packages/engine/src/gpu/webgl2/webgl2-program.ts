import type { GpuShaderSource } from '../gpu-shader.js';

import { parseGlslBindings } from './glsl-bindings.js';

function compileStage(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('WebGL2 could not create a shader.');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`GLSL compilation failed: ${log}`);
  }
  return shader;
}

/**
 * Ties the generated GLSL's uniform blocks and samplers to their WGSL bindings: block binding
 * point = binding number, sampler texture unit = the texture's binding number. Both stages
 * declare their own block for a shared binding, so both land on the same binding point.
 *
 * @param gl - The context.
 * @param program - The linked program.
 * @param shader - The shader whose generated GLSL declares the resources.
 */
function bindResources(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  shader: GpuShaderSource,
): void {
  gl.useProgram(program);
  for (const glsl of [shader.glslVertex, shader.glslFragment]) {
    for (const { kind, name, binding } of parseGlslBindings(glsl)) {
      if (kind === 'uniform-block') {
        const blockIndex = gl.getUniformBlockIndex(program, name);
        if (blockIndex !== gl.INVALID_INDEX) {
          gl.uniformBlockBinding(program, blockIndex, binding);
        }
      } else {
        gl.uniform1i(gl.getUniformLocation(program, name), binding);
      }
    }
  }
  gl.useProgram(null);
}

/**
 * Compiles and links a shader's generated GLSL ES 3.0 stages, with attribute locations from
 * their `layout(location = n)` and every resource tied to its WGSL binding.
 *
 * @param gl - The context.
 * @param shader - The shader source with its generated GLSL.
 * @returns The linked program.
 * @throws {Error} When a stage does not compile or the program does not link; the message
 *   carries the driver's log.
 * @throws {RangeError} When the generated GLSL binds a resource outside WGSL group 0.
 */
export function createWebGl2Program(
  gl: WebGL2RenderingContext,
  shader: GpuShaderSource,
): WebGLProgram {
  const vertex = compileStage(gl, gl.VERTEX_SHADER, shader.glslVertex);
  const fragment = compileStage(gl, gl.FRAGMENT_SHADER, shader.glslFragment);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new Error(`Linking ${shader.label} failed: ${log}`);
  }
  try {
    bindResources(gl, program, shader);
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  }
  return program;
}
