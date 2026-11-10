// Gamma-correct text coverage, one WGSL source for every shader that antialiases text:
// a shader that calls `gammaCorrectedCoverage(` gets these functions included before its vertex
// input, as scripts/clip-shader.ts includes the clip functions. No shader keeps its own copy.

/** The included functions. */
export const GAMMA_FUNCTIONS = `
// Included by scripts/coverage-gamma-shader.ts.
fn toLinear(value: f32) -> f32 {
  return select(pow((value + 0.055) / 1.055, 2.4), value / 12.92, value <= 0.04045);
}

fn toEncoded(value: f32) -> f32 {
  return select(1.055 * pow(value, 1.0 / 2.4) - 0.055, value * 12.92, value <= 0.0031308);
}

// The canvas blends sRGB-encoded values, so a coverage right in light comes out too light for
// dark text and too dark for light text. The coverage is corrected so that dark text on white,
// and light text on black, blend as they would in linear light; the text's luminance picks the
// nearer case. A pure function of its arguments, no uniforms: call it on the final coverage
// (after any supersampling). \`color\` is the text's straight (not premultiplied) sRGB colour;
// Y is its linear luminance (Rec. 709 weights over the linearised channels). Dark text
// (encoded Y < 0.5) uses the on-white case, whose divisor 1 − enc(Y) is at least 0.5 there;
// light text uses the on-black case, whose divisor enc(Y) is at least 0.5 there. So Y = 0
// (black) and Y = 1 (white) are exact and never divide by zero; the unused case's divisor is
// kept off 0 as well, so it never yields NaN.
fn gammaCorrectedCoverage(coverage: f32, color: vec3f) -> f32 {
  let luminance = dot(vec3f(toLinear(color.r), toLinear(color.g), toLinear(color.b)), vec3f(0.2126, 0.7152, 0.0722));
  let encoded = toEncoded(luminance);
  let onWhite = (1.0 - toEncoded(1.0 - coverage * (1.0 - luminance))) / max(1.0 - encoded, 1e-4);
  let onBlack = toEncoded(coverage * luminance) / max(encoded, 1e-4);
  return clamp(select(onBlack, onWhite, encoded < 0.5), 0.0, 1.0);
}

`;

/**
 * A canonical shader with the gamma functions included, when it calls them.
 *
 * @param name - Its canonical name, for the error.
 * @param source - Its WGSL.
 * @returns The WGSL, with the functions before its vertex input when it calls them.
 * @throws {Error} When the shader defines the functions itself.
 */
export function gammaShaderSource(name: string, source: string): string {
  if (!source.includes('gammaCorrectedCoverage(')) return source;
  if (source.includes('fn gammaCorrectedCoverage(')) {
    throw new Error(`The ${name} shader defines gammaCorrectedCoverage; it is included.`);
  }
  return source.replace('struct VertexInput {', `${GAMMA_FUNCTIONS}struct VertexInput {`);
}
