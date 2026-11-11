import { describe, expect, it } from 'vitest';

import { minifyChunk } from './minify-chunks.ts';

const CHUNK = `/*! Example 1.0 | MIT licence, kept as the licence asks */
import { helper as importedHelper } from "./index-a.js";
/**
 * A long description nobody needs at run time.
 */
export function mountBoard(element, options) {
  const localName = importedHelper(element);
  // A line comment.
  /** @license Apache-2.0, a comment that must survive */
  const worker = new Worker(new URL("./assets/engine-worker-x.js", import.meta.url), { type: "module" });
  const shader = \`
    fn main() -> f32 {
      return 1.0;
    }
  \`;
  return { name: localName, worker, shader, options };
}
`;

describe("the SDK's minified chunks", () => {
  it('drop whitespace and comments, and keep the licence comments', async () => {
    const minified = await minifyChunk(CHUNK, 'index-x.js');
    expect(minified.length).toBeLessThan(CHUNK.length * 0.75);
    expect(minified).not.toContain('A long description');
    expect(minified).not.toContain('A line comment');
    expect(minified).not.toContain('localName');
    expect(minified).toContain('/*! Example 1.0 | MIT licence, kept as the licence asks */');
    expect(minified).toContain('@license Apache-2.0, a comment that must survive');
  });

  it("keep the module's imports, exports and the URLs a host's bundler follows", async () => {
    const minified = await minifyChunk(CHUNK, 'index-x.js');
    expect(minified).toMatch(/import\{helper as \w+\}from"\.\/index-a\.js"/u);
    expect(minified).toMatch(/export\{\w+ as mountBoard\}|export function mountBoard/u);
    expect(minified).toContain(
      'new Worker(new URL("./assets/engine-worker-x.js",import.meta.url),{type:"module"})',
    );
  });

  it("keep a template literal's lines: the shaders' source", async () => {
    const minified = await minifyChunk(CHUNK, 'index-x.js');
    expect(minified).toContain('\n    fn main() -> f32 {\n      return 1.0;\n    }\n  ');
  });
});
