# @ilkal/sdk

## Purpose

The embeddable bundle and its public API, for host apps that put a canvas in their own pages.

## Public API

- `SDK_API_VERSION`: The version of the SDK's public API: the package's major version, 0 until the API freeze (see Versioning below).
- `mount`, `MountOptions`, `CanvasInstance`, `BoardPersistence`, `CanvasTheme`: Puts a canvas board into a host element: the whole editing shell on a board of its own, local only in v0 (no network, no font catalogue), empty, in memory unless `persistence: 'device'` keeps it in IndexedDB under its `boardId`; `theme` (light, dark or the system's) and `chromeFonts` to start with, `setTheme` and `setChromeFonts` to change them live (the theme is the board's own, never shared with another or stored); `helpLinks` as `AppShell` takes them; `document` and `on` (below); `destroy()` unmounts it, closes its storage and drops its listeners. Two instances share nothing. React and React DOM are peer dependencies.
- `CanvasDocument`, `CommandOrigin`, `RunOptions`, `RunOutcome`, `ObjectChanges`: A mounted board's document (`CanvasInstance.document`): `get(id)` and `objects()` read the board, `run(command, input, { origin })` runs one of the command layer's commands (`createObject`, `moveObjects`, `setStyle`, ...; typed by name), attributed to the board's user or to the SDK's agent (`agent:sdk`, operated by the user, whose undo takes its work back), in one undo step, or refuses it whole; `export()` returns the board as portable board JSON (the schema's `exportBoard`) and `import(json, { pageId, parentId, origin })` creates a portable document's objects with fresh ids in one `createObjects` command (its pages, tokens and styles are not created); there is no other way to write.
- `ImportOptions`, `ImportOutcome`: What `CanvasDocument.import` takes besides the document, and returns: `applied` with the new `ids` and the `idMap` from each document id, `invalid` with the document's `issues`, or `rejected` with the board's `errors`.
- `CanvasEvents`, `CanvasListener`, `CanvasChangeEvent`, `CanvasSelectionEvent`, `CanvasErrorEvent`: What `CanvasInstance.on(type, listener)` sends: `change` (every change to the board: the objects created, updated and deleted, the pages, colour tokens and named styles it touched, and the origin's kind), `selection` (the selected ids, after each change) and `error` (from `storage` or the `engine`; with no `error` listener, and no `onError` option, reported to the page).

## Depends on

`@canvas/app` (the shell and the local board connection); it may also import `@canvas/tools`, `@canvas/engine`, `@canvas/collab`, `@canvas/document` and `@canvas/schema`.

## How to test

From the repo root: `pnpm test` runs every package; `pnpm vitest --project @ilkal/sdk` watches this one.

`pnpm --filter @ilkal/sdk sample` serves the sample host (`sample/`): a page that mounts a board through the SDK alone, as an embedding page would (`?theme=light|dark|system`). The frame-time benchmark's SDK scenarios open the same page. `pnpm --filter @ilkal/sdk sample:built` builds the SDK, builds the same page against the bundle with `vite.sample.config.ts` (as a host's bundler would, into `sample/dist`), and serves it; the public README's runnable example, and the page `specs/sdk/sdk-built-sample.spec.ts` checks.

## Design notes

Open source: Apache-2.0, to be published as `@ilkal/sdk` from a public `ilkal-app/canvas` repository once the owner approves the release, with local mode only in v0. Until then the package is private.

**Licence files**: every open package (`open-packages.json`) carries the same
Apache-2.0 `LICENSE` and a `license` field. The SDK also ships `NOTICE` and
`THIRD_PARTY_LICENSES.md`, which `pnpm --filter @ilkal/sdk licenses` regenerates from the
installed packages after a dependency change; `scripts/licences.test.ts` fails when it is stale.

**The public repository's files** are drafted in `public-repo/`: CONTRIBUTING
(with the DCO sign-off), the code of conduct, SECURITY, the DCO text, TRADEMARKS, and the issue and
pull request templates. `public-repo/github/` becomes the public repository's `.github/`. The
export script copies them to the public repository's root.

Built by Vite in library mode (`vite.config.ts`) into one ES module; `tsc -b` emits only the declarations.

**Bundle budget** (measure, then lock): `scripts/check-bundle-budget.ts` builds the bundle in memory and measures, gzipped at level 9, the main script (the entry and the chunks it imports statically: what a host downloads at once) and, apart, the engine and job workers, the other lazy chunks, the wasm, the fonts and the stylesheet. Each may grow at most 1% past its figure in `scripts/bundle-budget.json` (content hashes in a script's file references are measured as a fixed placeholder, the one thing two builds of one tree differ in, so the measure is exact); the main script may not hold a font, the wasm or a script inlined (a data URL, or a base64 run of 64 kB or more), the workers, wasm and fonts must stay files of their own, and every emitted file must be counted by a part. Measure after `pnpm build`: some font files exist only once their packages are built. `specs/sdk/sdk-built-sample.spec.ts` checks that a mounted board fetches only a few of the fonts. The first build's main script was locked at 1,383,466 bytes gzipped; moved the style panel, its sections, the selection popover and the on-page engine fallback into the lazy chunks, bringing it to 953,121, and the lazy chunks rose by what left it. The first release ships at that size under a 2 MB ceiling; bringing the main script under 500 KB is, after the release. Growth past 1%, and raising a figure, need the owner's yes on the PR, and `--update` writes the measured figures.

**Versioning**: `SDK_API_VERSION` is the package's major version, and `src/api/sdk-api-version.test.ts` holds the two together. A release that breaks the public API (an export removed or renamed, a signature or option changed incompatibly, an event's shape or a command outcome changed) raises the major version, and `SDK_API_VERSION` with it; additions and fixes raise the minor or patch only. Until the API freeze the package is 0.x and `SDK_API_VERSION` is 0: a 0.x minor release may break, so a host pins the minor, and the Changesets changelog names every breaking change. From 1.0.0 a host compares `SDK_API_VERSION` with the major it was written against.

**Sample host** (`sample/`): a page that mounts a board with `mount` alone, served by Vite from source, or built on the built SDK by `vite.sample.config.ts` (`?theme=light|dark|system`, `?persistence=device`, `?boardId=`; the instance is `window.canvasSdk`). The frame-time benchmark's `-sdk` scenarios open it (`tooling/bench`).
