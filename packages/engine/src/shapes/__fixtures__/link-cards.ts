import type { LinkObject, ObjectId, PrincipalId } from '@canvas/schema';

/**
 * A ready vertical link card at (100, 200), 320 × 280, without images.
 *
 * @param overrides - Fields to change.
 * @returns The card.
 */
export function linkCard(overrides: Partial<Omit<LinkObject, 'type'>> = {}): LinkObject {
  return {
    id: 'card' as ObjectId,
    type: 'link',
    parentId: null,
    x: 100,
    y: 200,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:fixture' as PrincipalId,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    width: 320,
    height: 280,
    url: 'https://www.example.com/story',
    title: 'Story',
    description: 'What it says.',
    siteName: 'Example',
    layout: 'vertical',
    status: 'ready',
    unfurlKey: 'k',
    ...overrides,
  };
}
