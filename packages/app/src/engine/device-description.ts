import type { EngineDeviceOptions } from '@canvas/engine';

/** What the device description reads from the page. */
export interface DeviceScope {
  /** `navigator`, with Chrome's `deviceMemory` where present. */
  readonly navigator: object;
  /**
   * `window.matchMedia`; absent where the environment has none (jsdom), which reads as a
   * desktop.
   *
   * @param query - A media query.
   * @returns Whether it matches.
   */
  readonly matchMedia?: (query: string) => Pick<MediaQueryList, 'matches'>;
}

/**
 * The device facts the engine's GPU memory budget depends on (512 MB desktop, 128 MB mobile,
 * refined by `navigator.deviceMemory`): the memory where the browser reports it, and a phone or
 * tablet where the only pointer is coarse.
 *
 * @param scope - The page's window.
 * @returns The description, plain data for the engine host's options.
 */
export function describeDevice(scope: DeviceScope): EngineDeviceOptions {
  const { navigator } = scope;
  const memory: unknown = 'deviceMemory' in navigator ? navigator.deviceMemory : undefined;
  const matches = (query: string): boolean => scope.matchMedia?.(query).matches ?? false;
  const isMobile = matches('(pointer: coarse)') && !matches('(any-pointer: fine)');
  return typeof memory === 'number' && memory > 0
    ? { deviceMemoryGb: memory, isMobile }
    : { isMobile };
}
