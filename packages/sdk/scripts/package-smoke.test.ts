import { describe, expect, it } from 'vitest';

import { CONSUMER_TSCONFIG, consumerManifest, consumerSource } from './package-smoke.ts';

describe('the package smoke check’s consumer', () => {
  it('installs the two tarballs and React at the peer ranges', () => {
    expect(
      consumerManifest(
        [
          { name: '@ilkal/sdk', tarball: '/tmp/x/ilkal-sdk-0.1.3.tgz' },
          { name: '@ilkal/fonts', tarball: '/tmp/x/ilkal-fonts-0.1.3.tgz' },
        ],
        { react: '^19.3.0', 'react-dom': '^19.3.0' },
      ),
    ).toEqual({
      name: 'sdk-smoke-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@ilkal/sdk': 'file:/tmp/x/ilkal-sdk-0.1.3.tgz',
        '@ilkal/fonts': 'file:/tmp/x/ilkal-fonts-0.1.3.tgz',
        react: '^19.3.0',
        'react-dom': '^19.3.0',
      },
    });
  });

  it('checks strictly, the declarations too, as Node resolves packages', () => {
    expect(CONSUMER_TSCONFIG.compilerOptions).toMatchObject({
      strict: true,
      skipLibCheck: false,
      moduleResolution: 'nodenext',
    });
  });

  it('imports the README’s calls from the package, and expects a wrong input refused', () => {
    const source = consumerSource('@ilkal/sdk');
    expect(source).toContain('} from "@ilkal/sdk";');
    expect(source).toContain('await mount(element, options)');
    expect(source).toContain("board.run(\n      'moveObjects'");
    expect(source).toContain('// @ts-expect-error');
  });
});
