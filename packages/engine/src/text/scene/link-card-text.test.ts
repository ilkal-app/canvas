import { describe, expect, it } from 'vitest';

import { LINE_CLAMP_ELLIPSIS } from '@canvas/text';

import { linkCard } from '../../shapes/__fixtures__/link-cards.js';
import { FontLibrary } from '../font/font-library.js';
import { layoutTextNow } from '../layout/layout-job.js';
import { createLayoutJobRequest } from '../layout/layout-request.js';

import { addBundledFaces, CAMERA, createTextSetUp } from './__fixtures__/text-objects.js';
import { linkCardBodyPlacement, linkCardFooterPlacement } from './link-card-text-box.js';
import {
  LINK_CARD_BODY_PASS,
  LINK_CARD_BODY_PASS_KIND,
  LINK_CARD_BODY_PASS_NAME,
  LINK_CARD_FOOTER_PASS,
  LINK_CARD_FOOTER_PASS_NAME,
} from './link-card-text-pass.js';

describe('a link card’s text boxes', () => {
  it('lays the title over the description in the text column, two lines each', () => {
    const body = linkCardBodyPlacement(linkCard());
    expect(body).toMatchObject({
      text: 'Story\nWhat it says.',
      wrapWidth: 296,
      origin: { x: 12, y: 180 },
      lineCaps: [2, 2],
    });
    expect(body?.runs.map((run) => [run.length, run.style.weight, run.style.color])).toEqual([
      [6, 700, { token: 'text' }],
      [13, 400, { token: 'muted' }],
    ]);
  });

  it('shows the URL where the page gave no title, and a failed card’s bare URL and Retry', () => {
    expect(linkCardBodyPlacement(linkCard({ title: '' }))?.text).toBe(
      'https://www.example.com/story\nWhat it says.',
    );
    const failed = linkCard({ status: 'failed', height: 72 });
    expect(linkCardBodyPlacement(failed)).toMatchObject({
      text: 'www.example.com/story',
      lineCaps: [1],
    });
    // Frame L3: no icon, and Retry in the accent colour.
    const footer = linkCardFooterPlacement(failed);
    expect(footer?.text).toBe('No preview available   Retry');
    expect(footer?.origin.x).toBe(12);
    expect(footer?.runs.at(-1)?.style.color).toEqual({ token: 'accent' });
  });

  it('puts the domain on one line in the footer, beside the icon', () => {
    const footer = linkCardFooterPlacement(linkCard());
    expect(footer).toMatchObject({ text: 'example.com', wrapWidth: 280, lineCaps: [1] });
    expect(footer?.origin.x).toBe(28);
  });

  it('shows no text on a pending card or an object that is not a card', () => {
    expect(linkCardBodyPlacement(linkCard({ status: 'pending' }))).toBeUndefined();
    expect(linkCardFooterPlacement(linkCard({ status: 'pending' }))).toBeUndefined();
    expect(LINK_CARD_BODY_PASS_KIND.textOf(linkCard({ status: 'pending' }))).toBeUndefined();
  });

  it('keeps the same boxes for the same card', () => {
    const card = linkCard();
    expect(linkCardBodyPlacement(card)).toBe(linkCardBodyPlacement(card));
  });
});

describe('the link card text passes', () => {
  it('draw a card’s body and domain at the card’s place', async () => {
    const setup = createTextSetUp(CAMERA, true, false, {
      passes: [LINK_CARD_BODY_PASS, LINK_CARD_FOOTER_PASS],
    });
    setup.document.create(linkCard({ x: 20, y: 60 }));
    setup.renderer.enqueue(setup.document.takeChanges());
    expect(await setup.settle()).toBeLessThan(12);
    const { scene } = setup.renderer;
    expect(scene.instanceBufferOf(LINK_CARD_BODY_PASS_NAME).recordCount).toBeGreaterThan(0);
    expect(scene.instanceBufferOf(LINK_CARD_FOOTER_PASS_NAME).recordCount).toBeGreaterThan(0);
  });
});

describe('line caps in a layout job', () => {
  it('cuts a long title to its lines with an ellipsis, and lays a short one out whole', () => {
    const fonts = new FontLibrary();
    addBundledFaces(fonts);
    const title = 'A title long enough to run onto a third line in a narrow card column of text';
    const card = linkCard({ title, description: '', width: 160 });
    const box = linkCardBodyPlacement(card);
    if (box === undefined) throw new Error('no box');
    const job = (caps?: readonly number[]) =>
      createLayoutJobRequest(
        {
          objectId: 'card',
          text: box.text,
          runs: box.runs,
          maxWidth: box.wrapWidth,
          align: 'left',
          ...(caps === undefined ? {} : { lineCaps: caps }),
        },
        fonts,
      );
    const whole = layoutTextNow(job());
    const clamped = layoutTextNow(job([2]));
    expect(whole.lines.length).toBeGreaterThan(2);
    expect(clamped.lines).toHaveLength(2);
    expect(clamped.glyphs.at(-1)?.codepoint).toBe(LINE_CLAMP_ELLIPSIS.codePointAt(0));
    const [titleRun] = box.runs;
    if (titleRun === undefined) throw new Error('no run');
    const short = layoutTextNow({ ...job([2]), text: 'Story', runs: [{ ...titleRun, length: 5 }] });
    expect(short.glyphs.map((glyph) => glyph.codepoint)).toEqual(
      Array.from('Story', (character) => character.codePointAt(0)),
    );
  });
});
