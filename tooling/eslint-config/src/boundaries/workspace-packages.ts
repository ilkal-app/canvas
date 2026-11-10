/** A workspace package as the dependency-direction rules see it. */
export interface WorkspacePackage {
  /** The package name, e.g. `@canvas/document`. */
  readonly name: string;
  /** The package directory relative to the repository root, e.g. `packages/document`. */
  readonly dir: string;
  /** The workspace packages this package may import, directly or through their re-exports. */
  readonly allowedImports: readonly string[];
  /** Whether the package may import `react` or `react-dom`. */
  readonly canImportReact: boolean;
  /**
   * Allowed imports this package may use for types only (`import type`), never for values,
   * so their code never loads at runtime. Each must also be in `allowedImports`.
   */
  readonly typeOnlyImports?: readonly string[];
}

/**
 * The dependency direction, as a table:
 * `schema ← document ← collab ← headless ← mcp`; `schema ← text ← engine ← tools ← app`, and
 * `text ← mcp` (the font metrics and text layout both the renderer and agents measure with;
 * `app` imports it too, in the test holding the two to agree);
 * `sdk` may import app, tools, engine, collab, document and schema; services import only
 * schema, document and plans. `plans` (private) imports schema and is imported by the
 * services, mcp, tooling/ci and the app's site and admin, never by the SDK's closure. Arrows are
 * transitive, so a package may import anything upstream of it.
 * `tools` also imports `document`, and `app` also imports `collab` and `document`. React belongs to
 * the shell only: `tools`, `app` and `sdk`.
 *
 * Adding a package means adding a row here.
 */
export const WORKSPACE_PACKAGES: readonly WorkspacePackage[] = [
  { name: '@canvas/schema', dir: 'packages/schema', allowedImports: [], canImportReact: false },
  // The hosted product's private terms: plans, the flag registry and the services'
  // logging. Never in the SDK's closure: the services, mcp, tooling/ci and the app's site and admin
  // import it (the shell's own boundary test and the SDK's boundary check keep the shell out).
  {
    name: '@canvas/plans',
    dir: 'packages/plans',
    allowedImports: ['@canvas/schema'],
    canImportReact: false,
  },
  {
    name: '@canvas/document',
    dir: 'packages/document',
    allowedImports: ['@canvas/schema'],
    canImportReact: false,
  },
  {
    name: '@canvas/text',
    dir: 'packages/text',
    allowedImports: ['@canvas/schema'],
    canImportReact: false,
  },
  {
    name: '@canvas/engine',
    dir: 'packages/engine',
    allowedImports: ['@canvas/text', '@canvas/schema'],
    canImportReact: false,
  },
  {
    name: '@canvas/collab',
    dir: 'packages/collab',
    allowedImports: ['@canvas/document', '@canvas/schema'],
    canImportReact: false,
  },
  {
    name: '@canvas/tools',
    dir: 'packages/tools',
    allowedImports: ['@canvas/engine', '@canvas/document', '@canvas/schema'],
    canImportReact: true,
  },
  {
    name: '@canvas/app',
    dir: 'packages/app',
    allowedImports: [
      '@canvas/tools',
      '@canvas/engine',
      '@canvas/text',
      '@canvas/collab',
      '@canvas/document',
      '@canvas/plans',
      '@canvas/schema',
    ],
    canImportReact: true,
  },
  {
    name: '@canvas/headless',
    dir: 'packages/headless',
    allowedImports: ['@canvas/collab', '@canvas/document', '@canvas/schema'],
    canImportReact: false,
  },
  {
    name: '@canvas/mcp',
    dir: 'packages/mcp',
    allowedImports: [
      '@canvas/headless',
      '@canvas/collab',
      '@canvas/document',
      '@canvas/text',
      '@canvas/plans',
      '@canvas/schema',
    ],
    canImportReact: false,
  },
  {
    name: '@ilkal/sdk',
    dir: 'packages/sdk',
    allowedImports: [
      '@canvas/app',
      '@canvas/tools',
      '@canvas/engine',
      '@canvas/collab',
      '@canvas/document',
      '@canvas/schema',
    ],
    canImportReact: true,
  },
  {
    name: '@canvas/relay',
    dir: 'services/relay',
    allowedImports: ['@canvas/plans', '@canvas/schema', '@canvas/document'],
    canImportReact: false,
  },
  {
    name: '@canvas/assets',
    dir: 'services/assets',
    allowedImports: ['@canvas/plans', '@canvas/schema', '@canvas/document'],
    canImportReact: false,
  },
  // The boards service (sign-in, boards, sharing): it reads the shared types and nothing else from
  // the workspace, and imports neither the relay nor the assets service.
  {
    name: '@canvas/boards',
    dir: 'services/boards',
    allowedImports: ['@canvas/plans', '@canvas/schema'],
    canImportReact: false,
  },
  {
    name: '@canvas/mcp-service',
    dir: 'services/mcp',
    allowedImports: [
      '@canvas/mcp',
      '@canvas/headless',
      '@canvas/collab',
      '@canvas/document',
      '@canvas/plans',
      '@canvas/schema',
    ],
    canImportReact: false,
  },
  // The render service: its page draws board objects with the engine itself in
  // headless Chrome, so snapshots (and later exports) match the app; the Node side reads only
  // the shared types. The only service that imports the engine.
  {
    name: '@canvas/render-service',
    dir: 'services/render',
    allowedImports: ['@canvas/engine', '@canvas/plans', '@canvas/schema'],
    canImportReact: false,
  },
  {
    name: '@canvas/eslint-config',
    dir: 'tooling/eslint-config',
    allowedImports: [],
    canImportReact: false,
  },
  // The CI checks import nothing but the feature registry, for the flag retirement check
  // (src/cli/check-flags.ts).
  {
    name: '@canvas/ci',
    dir: 'tooling/ci',
    allowedImports: ['@canvas/plans', '@canvas/schema'],
    canImportReact: false,
  },
  // The agent hooks run in Node on every tool call of every harness; they import nothing.
  { name: '@canvas/hooks', dir: 'tooling/hooks', allowedImports: [], canImportReact: false },
  // The scenario harness drives the app in a browser; in Node it may use only the app's types,
  // so Playwright never loads React or the app. Collaboration scenarios start the relay in
  // process through e2e-sync and mint the pages' board tokens with it. ci gives the config a free
  // port and a folder per run, so suites in several worktrees run side by side.
  {
    name: '@canvas/scenario',
    dir: 'tooling/scenario',
    allowedImports: ['@canvas/app', '@canvas/e2e-sync', '@canvas/ci'],
    canImportReact: false,
    typeOnlyImports: ['@canvas/app'],
  },
  // End-to-end sync tests: collab and headless clients against a real relay in process, and the
  // real assets service in process for the app's image scenarios. The only package that
  // may import both a client package and a service, so neither has to import the other.
  {
    name: '@canvas/e2e-sync',
    dir: 'tooling/e2e-sync',
    allowedImports: [
      '@canvas/headless',
      '@canvas/collab',
      '@canvas/relay',
      '@canvas/assets',
      '@canvas/document',
      '@canvas/schema',
    ],
    canImportReact: false,
  },
  // The sync convergence fuzz harness: many headless clients against the in-process relay of
  // @canvas/e2e-sync, under seeded commands, partitions, delays and reordering.
  {
    name: '@canvas/sync-fuzz',
    dir: 'tooling/sync-fuzz',
    allowedImports: [
      '@canvas/e2e-sync',
      '@canvas/headless',
      '@canvas/collab',
      '@canvas/document',
      '@canvas/schema',
    ],
    canImportReact: false,
  },
  // The benchmark harness: drives the app in Chrome through the scenario harness (the
  // app's engine-harness types only), builds its boards with the document package, reads the
  // engine's frame statistics, and runs the collaborators as headless clients against the relay
  // that e2e-sync starts in process; golden gives it Chrome's GPU flags per platform; ci a folder
  // per run and the port variable's parsing; text the script coverage faces a text
  // board's first paint waits for.
  {
    name: '@canvas/bench',
    dir: 'tooling/bench',
    allowedImports: [
      '@canvas/app',
      '@canvas/scenario',
      '@canvas/golden',
      '@canvas/e2e-sync',
      '@canvas/ci',
      '@canvas/headless',
      '@canvas/collab',
      '@canvas/engine',
      '@canvas/text',
      '@canvas/document',
      '@canvas/schema',
    ],
    canImportReact: false,
    typeOnlyImports: ['@canvas/app'],
  },
  // The MX benchmark harness: the frozen inputs and the Python tools, run in Node;
  // it reads no other package.
  { name: '@canvas/mx-bench', dir: 'tooling/mx-bench', allowedImports: [], canImportReact: false },
  // The SDK export: copies the open packages into the public repository's tree; it
  // reads their files, never imports them.
  {
    name: '@canvas/sdk-export',
    dir: 'tooling/sdk-export',
    allowedImports: [],
    canImportReact: false,
  },
  // The golden scenes render through the engine; the camera scenes frame the view with the
  // camera controller of @canvas/tools, so a golden image checks the real fit.
  {
    name: '@canvas/golden',
    dir: 'tooling/golden',
    allowedImports: ['@canvas/engine', '@canvas/tools', '@canvas/schema', '@canvas/ci'],
    canImportReact: false,
  },
];
