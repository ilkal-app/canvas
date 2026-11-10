import { describe, expect, it } from 'vitest';

// Pins the Yjs version. The dependency is `~13.6.33`, so a lockfile update may resolve
// a newer patch release, but some of this package's code replays or leans on Yjs internals of
// exactly one version. An upgrade must fail here first, so that code is re-read against the new
// Yjs source before the expected version below is changed.

/** The Yjs version whose internals the files below were checked against. */
const REPLAYED_YJS_VERSION = '13.6.33';

/** What to re-read in the new Yjs source before changing {@link REPLAYED_YJS_VERSION}. */
const RE_READ_BEFORE_UPGRADING = [
  'packages/document/src/meta/update-integration.ts: replays `integrateStructs` ' +
    '(src/utils/encoding.js) and `Item.getMissing` (src/structs/Item.js); the relay applies ' +
    'only updates this replay proves (UpdateStampCheck, services/relay/src/server/update-gate.ts)',
  'packages/document/src/meta/held-structs.ts: reads the struct store as that replay does',
  'packages/document/src/meta/pending-updates.ts, services/relay/src/server/' +
    'pending-hub-updates.ts and services/relay/src/persistence/board-state.ts: read and clear ' +
    "a document's `store.pendingStructs` and `pendingDs`",
  'packages/document/src/store/remote-update.ts: retries held structs once inside ' +
    'the incoming update transaction (src/utils/encoding.js pending retry hints)',
  'packages/document/src/store/sync-state.ts: encoding-only store view relies on ' +
    'encodeStateAsUpdateV2/writeStateAsUpdate reading only doc.store and not mutating it',
  'packages/document/src/meta/layout-history.ts: relies on `afterTransaction` running before ' +
    'Yjs collects deleted content (src/utils/Transaction.js)',
  'packages/document/src/assets/update-scan.ts and update-content.ts: decode the update ' +
    'format (UpdateDecoderV1, readItemContent)',
  'packages/document/src/history/single-step.ts: relies on how `Y.UndoManager` pops its ' +
    'stacks (src/utils/UndoManager.js, popStackItem)',
  'packages/document/src/history/key-replacements.ts: memo lifetime relies on restorations ' +
    'finishing before deleteFilter, stable left links during deletion, and later GC/merging ' +
    '(src/utils/UndoManager.js, src/structs/Item.js, src/utils/Transaction.js)',
  'packages/document/src/history/field-guard.ts: the undo guard, relies on ' +
    'the order in which UndoManager deletes and restores items',
].join('\n  - ');

/**
 * The version of the Yjs this package resolves, from its own `package.json` (exported by Yjs).
 * The specifier is a variable so the type checker, which has no JSON modules here, leaves it to
 * the test runner.
 *
 * @returns The version.
 */
async function resolvedYjsVersion(): Promise<string> {
  const specifier = 'yjs/package.json';
  const manifest = (await import(specifier, { with: { type: 'json' } })) as {
    readonly default: { readonly version: string };
  };
  return manifest.default.version;
}

describe('the Yjs version', () => {
  it('is the one whose internals this package replays', async () => {
    const version = await resolvedYjsVersion();
    expect(
      version,
      `Yjs resolved to ${version}, not ${REPLAYED_YJS_VERSION}. Before changing the expected ` +
        `version in this test, re-read these against the new Yjs source and update them:\n  - ` +
        RE_READ_BEFORE_UPGRADING,
    ).toBe(REPLAYED_YJS_VERSION);
  });
});
