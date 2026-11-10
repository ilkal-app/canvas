// An in-memory stand-in for msdfgen's WebAssembly module: records what the generator asks of
// it, returns a configurable glyph shape, and fills bitmaps with a byte ramp, so the MSDF path
// is tested without WebAssembly (the real module runs in the GPU text test).
/* eslint-disable @typescript-eslint/naming-convention -- mirrors msdfgen's Embind names */
import type {
  MsdfgenBitmap,
  MsdfgenByteVector,
  MsdfgenFont,
  MsdfgenGlyphShape,
  MsdfgenModule,
} from '../msdfgen-module.js';

/** One `generateMSDFWithOverlapFix` call's arguments. */
export interface GenerateCall {
  /** The codepoint. */
  readonly codepoint: number;
  /** Bitmap width. */
  readonly width: number;
  /** Bitmap height. */
  readonly height: number;
  /** Field range, in texels. */
  readonly range: number;
  /** Shape translation x, in em. */
  readonly translateX: number;
  /** Shape translation y, in em. */
  readonly translateY: number;
  /** Texels per em. */
  readonly scale: number;
}

/** What the fake records, shared by the classes it hands out. */
interface FakeState {
  shape: MsdfgenGlyphShape;
  readonly canLoad: boolean;
  readonly generateCalls: GenerateCall[];
  readonly loadedBytes: number[][];
  liveVectors: number;
  liveFonts: number;
  liveBitmaps: number;
}

class FakeByteVector implements MsdfgenByteVector {
  readonly bytes: number[] = [];

  constructor(private readonly state: FakeState) {
    state.liveVectors += 1;
  }

  push_back(value: number): void {
    this.bytes.push(value);
  }

  delete(): void {
    this.state.liveVectors -= 1;
  }
}

class FakeFont implements MsdfgenFont {
  constructor(private readonly state: FakeState) {
    state.liveFonts += 1;
  }

  loadFromMemory(bytes: MsdfgenByteVector): boolean {
    this.state.loadedBytes.push(bytes instanceof FakeByteVector ? bytes.bytes : []);
    return this.state.canLoad;
  }

  getGlyphShape(): MsdfgenGlyphShape {
    return this.state.shape;
  }

  generateMSDFWithOverlapFix(
    codepoint: number,
    width: number,
    height: number,
    range: number,
    translateX: number,
    translateY: number,
    scale: number,
  ): MsdfgenBitmap {
    const { state } = this;
    state.generateCalls.push({ codepoint, width, height, range, translateX, translateY, scale });
    state.liveBitmaps += 1;
    return {
      width,
      height,
      data: {
        get: (index) => index % 256,
        size: () => width * height * 3,
        delete: () => {
          state.liveBitmaps -= 1;
        },
      },
    };
  }

  delete(): void {
    this.state.liveFonts -= 1;
  }
}

/** A fake msdfgen module. */
export class FakeMsdfgenModule implements MsdfgenModule {
  /** Creates fonts that record into this fake. */
  readonly Font: new () => MsdfgenFont;
  /** Creates byte vectors that record into this fake. */
  readonly VectorUnsignedChar: new () => MsdfgenByteVector;
  private readonly state: FakeState;

  /**
   * Creates the fake.
   *
   * @param options - Behaviour switches.
   * @param options.canLoad - Whether `loadFromMemory` succeeds. Default true.
   */
  constructor(options: { readonly canLoad?: boolean } = {}) {
    const state: FakeState = {
      shape: { advance: 0.5, left: 0, bottom: 0, right: 0.5, top: 0.7 },
      canLoad: options.canLoad ?? true,
      generateCalls: [],
      loadedBytes: [],
      liveVectors: 0,
      liveFonts: 0,
      liveBitmaps: 0,
    };
    this.state = state;
    this.Font = class extends FakeFont {
      constructor() {
        super(state);
      }
    };
    this.VectorUnsignedChar = class extends FakeByteVector {
      constructor() {
        super(state);
      }
    };
  }

  /**
   * The shape every glyph reports.
   *
   * @returns The shape.
   */
  get shape(): MsdfgenGlyphShape {
    return this.state.shape;
  }

  /**
   * Sets the shape every glyph reports.
   *
   * @param shape - The shape.
   */
  set shape(shape: MsdfgenGlyphShape) {
    this.state.shape = shape;
  }

  /**
   * Every generate call, in order.
   *
   * @returns The calls.
   */
  get generateCalls(): readonly GenerateCall[] {
    return this.state.generateCalls;
  }

  /**
   * The bytes of every font loaded, in order.
   *
   * @returns The byte lists.
   */
  get loadedBytes(): readonly number[][] {
    return this.state.loadedBytes;
  }

  /**
   * Vectors created and not deleted.
   *
   * @returns The count.
   */
  get liveVectors(): number {
    return this.state.liveVectors;
  }

  /**
   * Fonts created and not deleted.
   *
   * @returns The count.
   */
  get liveFonts(): number {
    return this.state.liveFonts;
  }

  /**
   * Bitmaps generated and not deleted.
   *
   * @returns The count.
   */
  get liveBitmaps(): number {
    return this.state.liveBitmaps;
  }
}
