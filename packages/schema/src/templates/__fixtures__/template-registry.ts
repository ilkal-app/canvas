import { SCHEMA_VERSION, type PortableBoardJson } from '../../index.js';

/** Test-only metadata, passed to the registry's optional list argument. */
export const FIXTURE_TEMPLATES = [
  {
    id: 'test-retrospective',
    name: 'Rétrospective',
    category: 'meetings-retros',
    mode: 'whiteboard',
    requires: ['templates'] as string[],
  },
  {
    id: 'test-design-map',
    name: 'Design map',
    category: 'research-mapping',
    mode: 'uiux',
    requires: ['templates', 'mode.design'] as string[],
  },
] as const;

/** Minimal portable document with a visible object for relay and sync tests. */
export const FIXTURE_TEMPLATE_DOCUMENT = {
  format: 'canvas.board',
  schemaVersion: SCHEMA_VERSION,
  objects: [
    {
      id: 'fixture-sticky',
      type: 'sticky',
      parentId: null,
      x: 40,
      y: 60,
      rotation: 0,
      z: 'a0',
      locked: false,
      createdBy: 'user:fixture',
      createdAt: 1_760_000_000_000,
      updatedAt: 1_760_000_000_000,
      width: 200,
      height: 200,
      text: 'Start',
      runs: [
        {
          length: 5,
          style: {
            fontFamily: 'Inter',
            fontSize: 16,
            color: [0, 0, 0, 1],
            weight: 400,
            italic: false,
          },
        },
      ],
      align: 'left',
      verticalAlign: 'top',
      autoWidth: false,
      color: [1, 0.92, 0.55, 1],
    },
  ],
} as unknown as PortableBoardJson;
