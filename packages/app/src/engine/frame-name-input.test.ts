// @vitest-environment jsdom
// The input over a frame's title band while its name is edited: shown, filled and
// focused for a FrameNameMode; Enter commits, Escape cancels, losing focus commits. In Chrome:
// tooling/scenario/specs/tools/frame.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCommand, YjsDocumentStore, createObjectCommand } from '@canvas/document';
import type { Camera } from '@canvas/engine';
import type { ObjectId, PrincipalId } from '@canvas/schema';
import { FrameNameMode } from '@canvas/tools';

import { bindFrameNameInput, type FrameNameInput } from './frame-name-input.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const ENVIRONMENT = { clock: () => 1, createId: () => 'id' as ObjectId };
const CAMERA: Camera = { x: 0, y: 0, zoom: 2, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

let bound: FrameNameInput | undefined;

afterEach(() => {
  bound?.destroy();
  bound = undefined;
  document.body.replaceChildren();
});

/**
 * A board holding one frame, `f` named "Old", 100 units wide at (10, 20), and an input bound to
 * a name editor on it.
 *
 * @param camera - The camera now; {@link CAMERA} by default.
 * @returns The store, the mode, the input and the active mode's setter.
 */
function setUp(camera: () => Camera = () => CAMERA) {
  const store = new YjsDocumentStore();
  const frame = {
    type: 'frame',
    id: 'f',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    name: 'Old',
    clip: false,
    background: null,
  } as const;
  runCommand(store, ORIGIN, createObjectCommand, { object: frame }, ENVIRONMENT);
  const context = {
    store,
    origin: ORIGIN,
    environment: ENVIRONMENT,
    capture: {
      command: (run: () => void) => {
        run();
      },
    },
    requestExit: () => undefined,
    onChange: () => undefined,
  };
  const mode = new FrameNameMode(context, 'f' as ObjectId);
  let active: unknown = mode;
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.append(canvas);
  document.body.append(container);
  bound = bindFrameNameInput(canvas, () => active, camera);
  const nameOf = () => {
    const object = store.get('f' as ObjectId);
    return object?.type === 'frame' ? object.name : undefined;
  };
  return { mode, input: bound, nameOf, setActive: (next: unknown) => (active = next) };
}

/**
 * Types a value into the input, as a person does.
 *
 * @param input - The input.
 * @param value - The new value.
 */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

/**
 * Presses a key in the input.
 *
 * @param input - The input.
 * @param key - The key.
 * @param isComposing - Whether an input method is composing.
 * @returns The event, to read whether it was stopped.
 */
function press(input: HTMLInputElement, key: string, isComposing = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, isComposing, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
}

describe('the frame name input', () => {
  it('shows over the title band, filled with the name, focused and selected', () => {
    const { input } = setUp();
    input.sync();
    const { element } = input;
    expect(element.style.display).toBe('block');
    expect(element.value).toBe('Old');
    expect(document.activeElement).toBe(element);
    expect(element.style.left).toBe('20px');
    expect(element.style.top).toBe('40px');
    expect(element.style.width).toBe('200px');
    expect(element.style.transform).toBe('rotate(0rad) translateY(-100%)');
    expect(element.getAttribute('aria-label')).toBe('Frame name');
  });

  it('follows the camera on every animation frame while it shows, and stops once hidden', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    let camera = CAMERA;
    const { input, setActive } = setUp(() => camera);
    input.sync();
    expect(frames).toHaveLength(1);
    camera = { ...CAMERA, x: 5, zoom: 3 };
    frames[0]?.(16);
    expect(input.element.style.left).toBe('15px');
    expect(input.element.style.width).toBe('300px');
    expect(frames).toHaveLength(2);
    setActive(undefined);
    input.sync();
    expect(input.element.style.display).toBe('none');
    expect(cancel).toHaveBeenCalledWith(2);
  });

  it('commits what was typed on Enter, then hides', () => {
    const { input, nameOf, mode } = setUp();
    input.sync();
    type(input.element, 'New name');
    expect(mode.draft).toBe('New name');
    expect(press(input.element, 'Enter').defaultPrevented).toBe(true);
    expect(nameOf()).toBe('New name');
    expect(input.element.style.display).toBe('none');
  });

  it('leaves Enter and Escape to an input method while it composes, then commits on Enter', () => {
    const { input, nameOf, mode } = setUp();
    input.sync();
    type(input.element, 'にほ');
    // Accepting the candidate: Enter during composition, which must not commit the pre-edit text.
    expect(press(input.element, 'Enter', true).defaultPrevented).toBe(false);
    expect(press(input.element, 'Escape', true).defaultPrevented).toBe(false);
    expect(press(input.element, 'Process').defaultPrevented).toBe(false);
    expect(nameOf()).toBe('Old');
    expect(input.element.style.display).toBe('block');
    type(input.element, '日本');
    expect(mode.draft).toBe('日本');
    expect(press(input.element, 'Enter').defaultPrevented).toBe(true);
    expect(nameOf()).toBe('日本');
    expect(input.element.style.display).toBe('none');
  });

  it('writes nothing on Escape, and keeps other keys from the shortcuts', () => {
    const { input, nameOf } = setUp();
    input.sync();
    type(input.element, 'Dropped');
    let isPageReached = false;
    document.addEventListener(
      'keydown',
      () => {
        isPageReached = true;
      },
      { once: true },
    );
    press(input.element, 'v');
    expect(isPageReached).toBe(false);
    press(input.element, 'Escape');
    expect(nameOf()).toBe('Old');
    expect(input.element.style.display).toBe('none');
  });

  it('commits when it loses focus, and hides when the mode is no longer active', () => {
    const blurred = setUp();
    blurred.input.sync();
    type(blurred.input.element, 'Kept');
    blurred.input.element.blur();
    expect(blurred.nameOf()).toBe('Kept');
    bound?.destroy();
    const ended = setUp();
    ended.input.sync();
    ended.setActive(undefined);
    ended.input.sync();
    expect(ended.input.element.style.display).toBe('none');
    expect(ended.nameOf()).toBe('Old');
  });

  it('shows nothing again on the blur of its removal, the mode still open', () => {
    const { input, nameOf } = setUp();
    input.sync();
    type(input.element, 'Renamed');
    const frames = vi.spyOn(window, 'requestAnimationFrame');
    frames.mockClear();
    input.destroy();
    expect(nameOf()).toBe('Old');
    expect(frames).not.toHaveBeenCalled();
    frames.mockRestore();
  });

  it('is removed with its listeners', () => {
    const { input } = setUp();
    input.sync();
    input.destroy();
    expect(document.querySelector('input')).toBeNull();
  });
});
