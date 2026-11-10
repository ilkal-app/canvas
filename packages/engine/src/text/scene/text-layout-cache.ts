import type { ObjectId } from '@canvas/schema';
import { fontFaceId } from '@canvas/text';
import type { TextLayout } from '@canvas/text';

import type { FontLibrary } from '../font/font-library.js';
import { isLayoutShaperLoaded, preloadLayoutShaper, requestLayout } from '../layout/layout-job.js';
import { createLayoutJobRequest } from '../layout/layout-request.js';

import { SharedTextLayouts } from './shared-text-layouts.js';
import { TextLayoutKey } from './text-layout-key.js';
import type { TextPassResources } from './text-pass-resources.js';
import type { TextBoxGeometry } from './text-placement.js';

/** One object's layouts: the one drawn and the one asked for. */
interface LayoutEntry {
  /** Exact input key, reused while immutable layout inputs stay unchanged. */
  readonly key: TextLayoutKey;
  /** The key of the layout drawn now. */
  drawnKey: string | undefined;
  /** The layout drawn now: the last that landed. */
  layout: TextLayout | undefined;
  /** The key of the layout last asked for. */
  requestedKey: string | undefined;
}

/**
 * The key of the faces loaded: a layout is valid only for the faces it was made with.
 *
 * @param fonts - The font library.
 * @returns The faces' ids, in order.
 */
export function fontsKeyOf(fonts: FontLibrary): string {
  return fonts.faces.map(fontFaceId).join(',');
}

/**
 * The scene text pass's per-object layout cache, which keeps per-frame CPU bounded: a text box's
 * layout is asked of the job pool at `visible` priority whenever its content, wrapping width,
 * alignment or the loaded faces change (the cache key), and the previous layout keeps drawing until
 * the new one lands, when `onLanded` names the object so the pass rewrites its records. A layout
 * that lands for a key no longer wanted is dropped. The thread that renders.
 */
export class TextLayoutCache {
  private readonly entries = new Map<ObjectId, LayoutEntry>();
  private readonly shared = new SharedTextLayouts();

  /**
   * Creates an empty cache.
   *
   * @param resources - The fonts and the job pool.
   * @param onLanded - Called with an object whose new layout landed.
   * @param onRequested - Called after a layout is asked for, so the frame loop runs the job.
   */
  constructor(
    private readonly resources: TextPassResources,
    private readonly onLanded: (id: ObjectId) => void,
    private readonly onRequested: () => void,
  ) {}

  /**
   * The layout an object draws now, asking for the one its box needs when that differs.
   *
   * @param id - The object.
   * @param geometry - Its text box.
   * @param fontsKey - The loaded faces (`fontsKeyOf`).
   * @returns The layout drawn now; `undefined` until the first one lands.
   */
  layoutOf(id: ObjectId, geometry: TextBoxGeometry, fontsKey: string): TextLayout | undefined {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = {
        key: new TextLayoutKey(),
        drawnKey: undefined,
        layout: undefined,
        requestedKey: undefined,
      };
      this.entries.set(id, entry);
    }
    if (fontsKey === '') return entry.layout;
    const key = entry.key.of(geometry, fontsKey);

    if (key !== entry.drawnKey && key !== entry.requestedKey)
      this.request(id, entry, key, geometry);
    return entry.layout;
  }

  /**
   * Checks readiness without requesting or accepting a layout.
   *
   * @param id - The text object.
   * @param geometry - Its current text box.
   * @param fontsKey - Current loaded face catalogue key.
   * @param built - The exact layout used by its uploaded records.
   * @returns Whether those records use the current successfully completed layout.
   */
  isCurrent(id: ObjectId, geometry: TextBoxGeometry, fontsKey: string, built: TextLayout): boolean {
    const entry = this.entries.get(id);
    return (
      entry?.layout === built &&
      entry.requestedKey === undefined &&
      entry.drawnKey === entry.key.of(geometry, fontsKey)
    );
  }

  /**
   * Forgets an object's layouts; one still in flight is dropped when it lands.
   *
   * @param id - The object.
   */
  forget(id: ObjectId): void {
    this.entries.delete(id);
  }

  private request(id: ObjectId, entry: LayoutEntry, key: string, geometry: TextBoxGeometry): void {
    entry.requestedKey = key;
    const { text, runs, wrapWidth, align, direction, fitHeight, lineCaps, paragraphs } = geometry;
    const input = {
      objectId: id,
      text,
      runs,
      maxWidth: wrapWidth,
      align,
      direction,
      ...(fitHeight === undefined ? {} : { fitHeight }),
      ...(lineCaps === undefined ? {} : { lineCaps }),
      ...(paragraphs === undefined ? {} : { paragraphs }),
    };
    const result = this.shared.get(key, text.length, this.resources.fonts.revision, () => {
      // The faces' files go with the job (once per worker), so it is shaped.
      const submit = (): Promise<TextLayout> => {
        const { fonts, jobs } = this.resources;
        return requestLayout(jobs, createLayoutJobRequest(input, fonts), 'visible', fonts).layout;
      };
      if (isLayoutShaperLoaded()) return submit();
      // Not before the shaper has loaded: a job queued earlier would wait on the load and then
      // shape outside a budgeted drain. The load starts with the first text that needs it.
      return preloadLayoutShaper().then(() => {
        const layout = submit();
        this.onRequested();
        return layout;
      });
    });
    result.then(
      (layout) => {
        if (this.entries.get(id) !== entry || entry.requestedKey !== key) return;
        entry.layout = layout;
        entry.drawnKey = key;
        entry.requestedKey = undefined;
        this.onLanded(id);
      },
      () => {
        // A failed or cancelled layout is asked for again the next time the object changes.
        if (entry.requestedKey === key) entry.requestedKey = undefined;
      },
    );
    this.onRequested();
  }
}
