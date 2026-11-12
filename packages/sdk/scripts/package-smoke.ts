// The consumer project the package smoke check installs the packed SDK into: what a
// host does with `npm install @ilkal/sdk react react-dom`, then a strict TypeScript check of the
// README's own calls. Pure: smoke-package.ts packs, installs and runs it.

/** The consumer's tsconfig: as strict as a host is likely to be, the library checked too. */
export const CONSUMER_TSCONFIG = {
  compilerOptions: {
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    skipLibCheck: false,
    target: 'es2022',
    lib: ['es2022', 'dom', 'dom.iterable'],
    module: 'nodenext',
    moduleResolution: 'nodenext',
    types: [],
  },
  files: ['smoke.ts'],
} as const;

/**
 * The consumer's package.json: the two packed tarballs and React at the SDK's peer ranges.
 *
 * @param packages - Each package's name and its tarball's path.
 * @param peers - The SDK's peer dependencies.
 * @returns The manifest.
 */
export function consumerManifest(
  packages: readonly { readonly name: string; readonly tarball: string }[],
  peers: Readonly<Record<string, string>>,
): Record<string, unknown> {
  return {
    name: 'sdk-smoke-consumer',
    private: true,
    type: 'module',
    dependencies: {
      ...Object.fromEntries(packages.map(({ name, tarball }) => [name, `file:${tarball}`])),
      ...peers,
    },
  };
}

/**
 * The consumer's TypeScript: the README's calls, every public type it names, and one wrong
 * command input the types must refuse (so a type that degraded to `any` fails the check).
 *
 * @param name - The SDK's package name.
 * @returns The source.
 */
export function consumerSource(name: string): string {
  return `import {
  mount,
  SDK_API_VERSION,
  type CanvasChangeEvent,
  type CanvasInstance,
  type CanvasTheme,
  type ImportOutcome,
  type MountOptions,
} from ${JSON.stringify(name)};

const theme: CanvasTheme = 'light';
const options: MountOptions = { boardId: 'smoke', persistence: 'memory', theme, fontsUrl: '/fonts/' };

export async function start(element: HTMLElement): Promise<CanvasInstance> {
  const canvas = await mount(element, options);
  canvas.on('change', ({ created, updated, deleted }: CanvasChangeEvent) => {
    console.log(created, updated, deleted);
  });
  const board = canvas.document;
  const [first] = board.objects();
  if (first !== undefined) {
    board.get(first.id);
    const outcome = board.run(
      'moveObjects',
      { moves: [{ id: first.id, by: { x: 40, y: 0 } }] },
      { origin: 'agent' },
    );
    if (outcome.status === 'rejected') console.warn(outcome.errors);
    // @ts-expect-error: the command's input is typed, so a wrong one is refused.
    board.run('moveObjects', { moves: 'nowhere' });
  }
  const imported: ImportOutcome = board.import(board.export());
  console.log(imported.status, SDK_API_VERSION satisfies number);
  return canvas;
}
`;
}
