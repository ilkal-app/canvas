/**
 * The keyboard convention a shortcut follows. `mac` covers macOS, iPadOS and iOS, where `mod`
 * is Command (⌘); `other` covers Windows, Linux and ChromeOS, where `mod` is Control.
 */
export type KeyboardPlatform = 'mac' | 'other';

/** Matches the platform strings Apple devices report. */
const APPLE_PLATFORM_PATTERN = /mac|iphone|ipad|ipod/i;

/**
 * Decides which keyboard convention to follow from a platform string, such as
 * `navigator.userAgentData.platform`, `navigator.platform` or, failing both, the user agent.
 *
 * @param platformHint - The platform string the browser reports; may be empty.
 * @returns `mac` for Apple platforms, `other` for everything else.
 */
export function detectKeyboardPlatform(platformHint: string): KeyboardPlatform {
  return APPLE_PLATFORM_PATTERN.test(platformHint) ? 'mac' : 'other';
}
