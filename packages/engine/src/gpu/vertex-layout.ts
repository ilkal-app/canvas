/**
 * Vertex attribute formats, named as in WebGPU: `float32`…`float32x4` for positions, sizes and
 * colours; `unorm8x4` for packed colours read as four floats in [0, 1].
 */
export type GpuVertexFormat = 'float32' | 'float32x2' | 'float32x3' | 'float32x4' | 'unorm8x4';

/** Whether a buffer advances once per vertex or once per instance. */
export type GpuVertexStepMode = 'vertex' | 'instance';

/** One shader input read from a vertex buffer. */
export interface GpuVertexAttribute {
  /** The WGSL `@location(n)` it feeds. */
  readonly location: number;
  /** How its bytes are read. */
  readonly format: GpuVertexFormat;
}

/**
 * One vertex buffer's record layout. Attributes are packed in the order given, with no padding:
 * the byte offsets and the stride follow from the formats (the prototype's `createVao` rule).
 */
export interface GpuVertexBufferLayout {
  /** Whether a record is per vertex or per instance. */
  readonly stepMode: GpuVertexStepMode;
  /** The attributes of one record, in memory order. */
  readonly attributes: readonly GpuVertexAttribute[];
}

/** How a backend reads a vertex format's components. */
export interface GpuVertexFormatInfo {
  /** Components per attribute (1–4). */
  readonly componentCount: number;
  /** The type of each component in memory. */
  readonly componentType: 'float32' | 'uint8';
  /** Bytes per attribute. */
  readonly byteSize: number;
  /** Whether integer components are mapped to [0, 1]. */
  readonly isNormalized: boolean;
}

/** A vertex attribute with its byte offset inside the record. */
export interface ResolvedVertexAttribute extends GpuVertexAttribute, GpuVertexFormatInfo {
  /** Offset of the attribute from the start of its record, in bytes. */
  readonly byteOffset: number;
}

/** A vertex buffer layout with every offset and the stride computed. */
export interface ResolvedVertexBufferLayout {
  /** Whether a record is per vertex or per instance. */
  readonly stepMode: GpuVertexStepMode;
  /** Bytes from one record to the next. */
  readonly byteStride: number;
  /** The attributes with their byte offsets, in memory order. */
  readonly attributes: readonly ResolvedVertexAttribute[];
}

const FORMAT_INFO: Readonly<Record<GpuVertexFormat, GpuVertexFormatInfo>> = {
  float32: { componentCount: 1, componentType: 'float32', byteSize: 4, isNormalized: false },
  float32x2: { componentCount: 2, componentType: 'float32', byteSize: 8, isNormalized: false },
  float32x3: { componentCount: 3, componentType: 'float32', byteSize: 12, isNormalized: false },
  float32x4: { componentCount: 4, componentType: 'float32', byteSize: 16, isNormalized: false },
  unorm8x4: { componentCount: 4, componentType: 'uint8', byteSize: 4, isNormalized: true },
};

/**
 * Describes how a vertex format's bytes are read.
 *
 * @param format - The vertex format.
 * @returns Its component count and type, byte size and normalization.
 */
export function vertexFormatInfo(format: GpuVertexFormat): GpuVertexFormatInfo {
  return FORMAT_INFO[format];
}

/**
 * Computes the byte offset of every attribute and the stride of every vertex buffer of a
 * pipeline. Every format is a multiple of 4 bytes, so each offset meets WebGPU's alignment.
 *
 * @param layouts - The pipeline's vertex buffers, in slot order.
 * @returns The resolved layouts, in the same order.
 * @throws {RangeError} When a buffer has no attributes or a shader location is used twice.
 */
export function resolveVertexBufferLayouts(
  layouts: readonly GpuVertexBufferLayout[],
): ResolvedVertexBufferLayout[] {
  const usedLocations = new Set<number>();
  return layouts.map((layout, slot) => {
    if (layout.attributes.length === 0) {
      throw new RangeError(`Vertex buffer ${String(slot)} has no attributes.`);
    }
    let byteOffset = 0;
    const attributes = layout.attributes.map((attribute) => {
      if (usedLocations.has(attribute.location)) {
        throw new RangeError(`Shader location ${String(attribute.location)} is used twice.`);
      }
      usedLocations.add(attribute.location);
      const info = vertexFormatInfo(attribute.format);
      const resolved = { ...attribute, ...info, byteOffset };
      byteOffset += info.byteSize;
      return resolved;
    });
    return { stepMode: layout.stepMode, byteStride: byteOffset, attributes };
  });
}
