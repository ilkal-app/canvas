// Acceptance, written before the code.
import { describe, expect, it } from 'vitest';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { findCommand } from '../commands/registry.js';
import { setStyleCommand } from '../commands/set-style.js';
import {
  DOCUMENT_LAYOUT_VERSION,
  READABLE_LAYOUT_VERSIONS,
  STROKE_ALIGN_LAYOUT_VERSION,
} from '../meta/document-meta.js';

import { ADA, BOB, RELAY, createSyncedPair, exchange } from './__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from './yjs-document-store.js';

interface StyleReader {
  readTextStyles(): ReadonlyMap<string, unknown>;
  readEffectStyles(): ReadonlyMap<string, unknown>;
  read(): {
    textStyles?: ReadonlyMap<string, unknown>;
    effectStyles?: ReadonlyMap<string, unknown>;
  };
}

const TEXT = { fontFamily: 'Inter', fontSize: 24, weight: 400, italic: false };
const SHADOW = { x: 0, y: 4, blur: 4, spread: 0, color: [0, 0, 0, 0.25] };

function command(name: string) {
  const found = findCommand(name);
  if (found === undefined) throw new Error(`missing command: ${name}`);
  return found;
}

describe('named style store and sync', () => {
  it('reads the preceding layout and stamps this build’s one-step layout rise', () => {
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThan(STROKE_ALIGN_LAYOUT_VERSION);
    expect(READABLE_LAYOUT_VERSIONS).toContain(DOCUMENT_LAYOUT_VERSION - 1);
    expect(READABLE_LAYOUT_VERSIONS).toContain(DOCUMENT_LAYOUT_VERSION);
  });

  it('reports changed style ids in sorted order for a combined remote update', () => {
    const writer = new YjsDocumentStore();
    const reader = new YjsDocumentStore();
    for (const name of ['Zed', 'Alpha']) {
      applyCommand(writer, command('setTextStyle'), { name, value: TEXT });
      applyCommand(writer, command('setEffectStyle'), { name, value: { shadows: [SHADOW] } });
    }
    const seen: { textStyles?: readonly string[]; effectStyles?: readonly string[] }[] = [];
    const stop = reader.subscribe((changes) => {
      seen.push(changes);
    });
    reader.applyUpdate(writer.encodeState(), RELAY);
    stop();
    const changes = seen.at(-1);
    expect(changes?.textStyles).toEqual([...(changes?.textStyles ?? [])].sort());
    expect(changes?.effectStyles).toEqual([...(changes?.effectStyles ?? [])].sort());
    expect(changes?.textStyles).toHaveLength(2);
    expect(changes?.effectStyles).toHaveLength(2);
  });

  it('converges style tables and bound object rewrites after concurrent edits', () => {
    const [ada, bob] = createSyncedPair();
    const textId = (
      applyCommand(ada, command('setTextStyle'), { name: 'Body', value: TEXT }).result as {
        id: string;
      }
    ).id;
    const effectId = (
      applyCommand(ada, command('setEffectStyle'), { name: 'Depth', value: { shadows: [SHADOW] } })
        .result as { id: string }
    ).id;
    exchange(ada, bob);
    applyCommand(ada, setStyleCommand, {
      changes: [
        { id: 'text-title', style: { textStyle: { textStyleId: textId } } },
        { id: 'shape-box', style: { effectStyleId: effectId } },
      ],
    });
    exchange(ada, bob);
    applyCommand(
      ada,
      command('setTextStyle'),
      { id: textId, name: 'Body', value: { ...TEXT, fontSize: 30 } },
      ADA,
    );
    applyCommand(
      bob,
      command('setEffectStyle'),
      { id: effectId, name: 'Depth', value: { shadows: [{ ...SHADOW, blur: 12 }, SHADOW] } },
      BOB,
    );
    exchange(ada, bob);
    const adaStyles = ada as unknown as StyleReader;
    const bobStyles = bob as unknown as StyleReader;
    expect(adaStyles.readTextStyles()).toEqual(bobStyles.readTextStyles());
    expect(adaStyles.readEffectStyles()).toEqual(bobStyles.readEffectStyles());
    expect(ada.get('text-title' as never)).toEqual(bob.get('text-title' as never));
    expect(ada.get('shape-box' as never)).toEqual(bob.get('shape-box' as never));
    // Every run (text-title has two, coloured apart, so they never merge).
    const title = ada.get('text-title' as never) as unknown as {
      readonly runs: readonly unknown[];
    };
    expect(title).toMatchObject({
      runs: title.runs.map(() => ({ style: { fontSize: 30, textStyleId: textId } })),
    });
    expect(ada.get('shape-box' as never)).toMatchObject({
      effectStyleId: effectId,
      shadow: [{ ...SHADOW, blur: 12 }, SHADOW],
    });
    expect(adaStyles.read().textStyles).toEqual(adaStyles.readTextStyles());
    expect(adaStyles.read().effectStyles).toEqual(adaStyles.readEffectStyles());
  });
});
