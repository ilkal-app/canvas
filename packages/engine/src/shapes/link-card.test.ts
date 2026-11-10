import { describe, expect, it } from 'vitest';

import { LIGHT_PALETTE } from '../paint/color-palette.js';
import { isLayerForm } from '../scene/layers/layer-form.js';

import { linkCard } from './__fixtures__/link-cards.js';
import {
  hasLinkFavicon,
  LINK_CARD_LOOK,
  linkCardParts,
  linkDomainOf,
  linkPreviewBox,
} from './link-card-geometry.js';
import {
  linkCardRecordCount,
  linkCardRecordPlacement,
  linkCardRecords,
  writeLinkCardRecord,
} from './link-card-records.js';
import { SHAPE_INSTANCE_FLOATS } from './shape-instance-layout.js';

const card = linkCard;

const IDENTITY = { x: 0, y: 0, cos: 1, sin: 0 };

describe('a link card’s parts', () => {
  it('puts the preview on top of a vertical card and the text column below it', () => {
    const parts = linkCardParts(card());
    expect(parts.image).toEqual({ x: 0, y: 0, width: 320, height: LINK_CARD_LOOK.imageHeight });
    expect(parts.column).toEqual({ x: 12, y: 180, width: 296, height: 88 });
    expect(parts.title).toEqual({ x: 12, y: 180, width: 296, height: 36 });
    expect(parts.domain.y + parts.domain.height).toBe(268);
    expect(parts.icon.x).toBe(12);
    expect(parts.domain.x).toBe(12 + LINK_CARD_LOOK.iconSize + LINK_CARD_LOOK.iconGap);
    expect(parts.description?.y).toBe(222);
  });

  it('puts the preview on the left of a horizontal card', () => {
    const parts = linkCardParts(card({ layout: 'horizontal', width: 440, height: 120 }));
    expect(parts.image).toEqual({ x: 0, y: 0, width: 92, height: 120 });
    expect(parts.column.x).toBe(104);
    expect(parts.column.width).toBe(440 - 92 - 24);
  });

  it('gives a failed card no preview and no description', () => {
    const parts = linkCardParts(card({ status: 'failed', height: 72 }));
    expect(parts.image).toBeUndefined();
    expect(parts.description).toBeUndefined();
    expect(parts.column).toEqual({ x: 12, y: 12, width: 296, height: 48 });
  });

  it('never makes a part of negative size on a tiny card', () => {
    const parts = linkCardParts(card({ width: 10, height: 10 }));
    for (const box of [parts.column, parts.title, parts.domain, parts.description]) {
      expect(box?.width).toBeGreaterThanOrEqual(0);
      expect(box?.height).toBeGreaterThanOrEqual(0);
    }
  });

  it('draws the preview inside the hairline, and none on a failed card', () => {
    expect(linkPreviewBox(card())).toEqual({ x: 1, y: 1, width: 318, height: 167 });
    const wide = card({ layout: 'horizontal', width: 440, height: 120 });
    expect(linkPreviewBox(wide)).toEqual({ x: 1, y: 1, width: 91, height: 118 });
    expect(linkPreviewBox(card({ status: 'failed' }))).toBeUndefined();
  });

  it('shows the host without www, or the URL when it is not one', () => {
    expect(linkDomainOf('https://www.example.com/a')).toBe('example.com');
    expect(linkDomainOf('http://news.example.org')).toBe('news.example.org');
    expect(linkDomainOf('not a url')).toBe('not a url');
  });
});

describe('a link card’s shape records', () => {
  it('counts what it lists for each status', () => {
    for (const status of ['ready', 'pending', 'failed'] as const) {
      const object = card({ status });
      expect(linkCardRecords(object, LIGHT_PALETTE)).toHaveLength(linkCardRecordCount(object));
    }
    expect(linkCardRecordCount(card({ status: 'failed' }))).toBe(2);
    expect(linkCardRecordCount(card({ status: 'ready' }))).toBe(5);
    expect(linkCardRecordCount(card({ status: 'pending' }))).toBe(7);
  });

  it('draws the icon stand-in only where the site icon does not draw', () => {
    const iconic = card({
      faviconAssetId: 'asset-icon' as never,
      faviconSize: { width: 32, height: 32 },
    });
    expect(hasLinkFavicon(iconic)).toBe(true);
    expect(hasLinkFavicon(card({ faviconAssetId: 'asset-icon' as never }))).toBe(false);
    expect(linkCardRecordCount(iconic)).toBe(4);
    expect(linkCardRecords(iconic, LIGHT_PALETTE)).toHaveLength(4);
  });

  it('draws a soft shadow, then the paper with a hairline in the theme’s tokens', () => {
    const [shadow, paper] = linkCardRecords(card(), LIGHT_PALETTE);
    expect(shadow?.softness).toBeGreaterThan(0);
    expect(paper?.box).toEqual({ x: 0, y: 0, width: 320, height: 280 });
    expect(paper?.fill).toEqual(LIGHT_PALETTE.tokenColor('surface'));
    expect(paper?.outline?.color).toEqual(LIGHT_PALETTE.tokenColor('border'));
  });

  it('writes a record placed and turned by the card’s transform', () => {
    const object = card();
    const record = new Float32Array(SHAPE_INSTANCE_FLOATS);
    const turned = { x: 100, y: 200, cos: 0, sin: 1 };
    writeLinkCardRecord(record, object, turned, LIGHT_PALETTE, 1);
    expect([...record.slice(0, 4)]).toEqual([100, 200, 320, 280]);
    expect(record[8]).toBe(LINK_CARD_LOOK.radius);
    expect(record[11]).toBe(0);
    expect(record[12]).toBe(1);
    expect(record[17]).toBe(1);
    const shadow = new Float32Array(SHAPE_INSTANCE_FLOATS);
    writeLinkCardRecord(shadow, object, turned, LIGHT_PALETTE, 0);
    const placement = linkCardRecordPlacement(object, turned, LIGHT_PALETTE, 0);
    expect([shadow[0], shadow[1]]).toEqual([placement.x, placement.y]);
    expect(placement).toEqual({ x: 96, y: 202, cos: 0, sin: 1 });
  });

  it('writes nothing, and places at the card, for a record it does not have', () => {
    const record = new Float32Array(SHAPE_INSTANCE_FLOATS);
    writeLinkCardRecord(record, card(), IDENTITY, LIGHT_PALETTE, 9);
    expect(record.every((value) => value === 0)).toBe(true);
    expect(linkCardRecordPlacement(card(), IDENTITY, LIGHT_PALETTE, 9)).toBe(IDENTITY);
  });

  it('draws a translucent card in layer form, since it has several parts', () => {
    expect(isLayerForm(card({ opacity: 0.5 }))).toBe(true);
  });
});
