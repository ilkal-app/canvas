import type { ReactElement } from 'react';

import { useToast } from '../feedback/toast-region.js';

import { CONNECTION_DROPPED_MESSAGE, OFFLINE_BANNER_MESSAGE } from './connection-label.js';

/** What the banner's compact form says while the device is offline (Figma MX2). */
export const OFFLINE_BANNER_COMPACT_MESSAGE = 'Offline · edits kept on this device';

/** What the banner's compact form says while the relay dropped the connection. */
export const CONNECTION_DROPPED_COMPACT_MESSAGE = 'Connection dropped · reconnecting…';

/**
 * What the banner says: the full sentence, or below 768 px wide its compact form. Pure.
 *
 * @param isDeviceOffline - Whether the device itself is offline.
 * @param isCompact - Whether the compact form shows.
 * @returns The message.
 */
export function offlineBannerMessageOf(isDeviceOffline: boolean, isCompact: boolean): string {
  if (isCompact) {
    return isDeviceOffline ? OFFLINE_BANNER_COMPACT_MESSAGE : CONNECTION_DROPPED_COMPACT_MESSAGE;
  }
  return isDeviceOffline ? OFFLINE_BANNER_MESSAGE : CONNECTION_DROPPED_MESSAGE;
}

/** Props of {@link OfflineBanner}. */
export interface OfflineBannerProps {
  /** Whether the board is away from the relay (`isAwayFromRelay`), so the banner shows. */
  readonly isShown: boolean;
  /**
   * Whether the device itself is offline (the connection's state is `offline`): the banner
   * then says edits are kept on the device; otherwise the relay refused or dropped the
   * connection and the banner says it is reconnecting. False if absent.
   */
  readonly isDeviceOffline?: boolean;
  /** Asks the connection to reconnect at once (`BoardConnection.retryNow`); no Retry now if absent. */
  readonly onRetry: (() => void) | undefined;
  /**
   * Whether the shell shows its compact form below 768 px wide (Figma MX2): the banner
   * then says it in fewer words, under the compact top bar. False if absent.
   */
  readonly isCompact?: boolean | undefined;
}

/**
 * The offline banner, an Info toast in the toast region over the dock while
 * a synced board is away from the relay (item 4, our decision of 2026-10-07):
 * "You’re offline. Edits are kept on this device and sync when you reconnect." while the device
 * is offline, "Connection dropped. Reconnecting…" while the relay refused or dropped the
 * connection and the client reconnects by itself (item 6), and Retry now, which asks the
 * connection to reconnect at once. A polite `role="status"` region labelled "Board sync",
 * announced each time the board goes away or the reason changes; it has no Dismiss and stays
 * until the board is back. The region is outside the shell's `inert` layout and inside an open
 * dialog, so Retry now is always reachable. Below 768 px wide (`isCompact`, Figma MX2)
 * it says "Offline · edits kept on this device" (or "Connection dropped · reconnecting…"), still
 * with Retry now. Main thread.
 *
 * @param props - Whether it shows, why, and Retry now's handler.
 * @returns Nothing inside the toast region; without one, the toast in place.
 */
export function OfflineBanner(props: OfflineBannerProps): ReactElement | null {
  const { isShown, onRetry } = props;
  const shown = useToast(
    isShown
      ? {
          kind: 'info',
          message: offlineBannerMessageOf(props.isDeviceOffline === true, props.isCompact === true),
          label: 'Board sync',
          isPersistent: true,
          action: onRetry === undefined ? undefined : { label: 'Retry now', onAction: onRetry },
        }
      : undefined,
  );
  return shown;
}
