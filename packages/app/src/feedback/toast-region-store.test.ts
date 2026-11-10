// @vitest-environment jsdom
// The toast region's state (UI-18, item 4): D-TOAST's timing per kind, roles, what can
// be dismissed, the order toasts show in and where they show. In React: toast-region.test.tsx.
import { describe, expect, it, vi } from 'vitest';

import {
  isDismissibleToast,
  isSamePosting,
  toastLifetimeMs,
  ToastRegionStore,
  toastRole,
  type RegionToast,
} from './toast-region-store.js';
import { TOAST_DURATION_MS } from './toast.js';

const INFO: RegionToast = { kind: 'info', message: 'Moved to Two.' };

describe('toast timing and roles (D-TOAST)', () => {
  it('lets Info and Success go after 4 s, and keeps an Error and a condition', () => {
    expect(TOAST_DURATION_MS).toBe(4000);
    expect(toastLifetimeMs({ kind: 'info' })).toBe(TOAST_DURATION_MS);
    expect(toastLifetimeMs({ kind: 'success' })).toBe(TOAST_DURATION_MS);
    expect(toastLifetimeMs({ kind: 'error' })).toBeUndefined();
    expect(toastLifetimeMs({ kind: 'info', isPersistent: true })).toBeUndefined();
    expect(toastLifetimeMs({ kind: 'success', isPersistent: false })).toBe(TOAST_DURATION_MS);
  });

  it('speaks politely for Info and Success and assertively for an Error', () => {
    expect(toastRole('info')).toBe('status');
    expect(toastRole('success')).toBe('status');
    expect(toastRole('error')).toBe('alert');
  });

  it('can dismiss a timed toast or one with a handler, never a condition without one', () => {
    expect(isDismissibleToast({ kind: 'info' })).toBe(true);
    expect(isDismissibleToast({ kind: 'error' })).toBe(false);
    expect(isDismissibleToast({ kind: 'error', onDismiss: () => undefined })).toBe(true);
    expect(isDismissibleToast({ kind: 'info', isPersistent: true })).toBe(false);
    expect(
      isDismissibleToast({ kind: 'info', isPersistent: true, onDismiss: () => undefined }),
    ).toBe(true);
  });

  it('counts a posting as the same while it shows the same, whatever its handlers', () => {
    const retry = { label: 'Retry', onAction: () => undefined };
    const base: RegionToast = { kind: 'error', message: 'No', action: retry };
    expect(isSamePosting(base, { ...base, action: { ...retry, onAction: vi.fn() } })).toBe(true);
    expect(isSamePosting(base, { ...base, message: 'Still no' })).toBe(false);
    expect(isSamePosting(base, { ...base, kind: 'info' })).toBe(false);
    expect(isSamePosting(base, { ...base, key: 2 })).toBe(false);
    expect(isSamePosting(base, { ...base, label: 'Notice' })).toBe(false);
    expect(isSamePosting(base, { ...base, tone: 'inverse' })).toBe(false);
    expect(isSamePosting(base, { ...base, isPersistent: true })).toBe(false);
    expect(isSamePosting(base, { ...base, onDismiss: () => undefined })).toBe(false);
    expect(isSamePosting(base, { ...base, action: undefined })).toBe(false);
    expect(isSamePosting(base, { ...base, action: { ...retry, label: 'Undo' } })).toBe(false);
    expect(isSamePosting(base, { ...base, action: { ...retry, isAvailable: false } })).toBe(false);
  });
});

describe('ToastRegionStore', () => {
  it('shows toasts oldest first, a changed one becoming the newest', () => {
    const store = new ToastRegionStore();
    const [a, b, c] = [store.newId(), store.newId(), store.newId()];
    store.post(a, { ...INFO, message: 'A' });
    store.post(b, { ...INFO, message: 'B' });
    store.post(c, { ...INFO, message: 'C' });
    const messages = (): string[] => store.snapshot().entries.map((entry) => entry.toast.message);
    expect(messages()).toEqual(['A', 'B', 'C']);
    store.post(a, { ...INFO, message: 'A again' });
    expect(messages()).toEqual(['B', 'C', 'A again']);
    store.post(b, undefined);
    expect(messages()).toEqual(['C', 'A again']);
  });

  it('keeps a toast posted again unchanged where it is, its content the same object', () => {
    const store = new ToastRegionStore();
    const listener = vi.fn<() => void>();
    store.subscribe(listener);
    const id = store.newId();
    store.post(id, INFO);
    const [entry] = store.snapshot().entries;
    const before = store.snapshot();
    store.post(id, { ...INFO });
    expect(store.snapshot()).toBe(before);
    expect(store.snapshot().entries[0]?.content).toBe(entry?.content);
    expect(listener).toHaveBeenCalledTimes(1);
    // A new key is a new posting, as the shell notice's sequence is.
    store.post(id, { ...INFO, key: 2 });
    expect(store.snapshot().entries[0]?.content).not.toBe(entry?.content);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('times the content by its kind and runs the latest action', () => {
    const store = new ToastRegionStore();
    const id = store.newId();
    const first = vi.fn<() => void>();
    const latest = vi.fn<() => void>();
    store.post(id, { kind: 'error', message: 'No', action: { label: 'Retry', onAction: first } });
    store.post(id, { kind: 'error', message: 'No', action: { label: 'Retry', onAction: latest } });
    const content = store.snapshot().entries[0]?.content;
    expect(content?.isTimed).toBe(false);
    content?.action?.onAction();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    store.post(id, INFO);
    expect(store.snapshot().entries[0]?.content.isTimed).toBe(true);
    expect(store.snapshot().entries[0]?.content.action).toBeUndefined();
  });

  it('hides a dismissed toast, tells its poster once, and shows it again when it changes', () => {
    const store = new ToastRegionStore();
    const id = store.newId();
    const onDismiss = vi.fn<() => void>();
    store.post(id, { ...INFO, onDismiss });
    store.dismiss(id);
    store.dismiss(id);
    store.dismiss(store.newId());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(store.snapshot().entries).toEqual([]);
    store.post(id, { ...INFO, onDismiss });
    expect(store.snapshot().entries).toEqual([]);
    store.post(id, { ...INFO, message: 'Something else', onDismiss });
    expect(store.snapshot().entries).toHaveLength(1);
  });

  it('dismisses the newest toast that can be dismissed, passing over conditions', () => {
    const store = new ToastRegionStore();
    const [older, newer, condition] = [store.newId(), store.newId(), store.newId()];
    store.post(older, { ...INFO, message: 'Older' });
    store.post(newer, { kind: 'error', message: 'Newer', onDismiss: () => undefined });
    store.post(condition, { kind: 'info', message: 'Offline', isPersistent: true });
    expect(store.dismissNewest()).toBe(true);
    expect(store.snapshot().entries.map((entry) => entry.toast.message)).toEqual([
      'Older',
      'Offline',
    ]);
    expect(store.dismissNewest()).toBe(true);
    expect(store.dismissNewest()).toBe(false);
    expect(store.snapshot().entries.map((entry) => entry.toast.message)).toEqual(['Offline']);
  });

  it('shows in an open dialog first, then a shell’s home, then its own place', () => {
    const store = new ToastRegionStore();
    const [own, home, dialog, inner] = ['own', 'home', 'dialog', 'inner'].map(() =>
      document.createElement('div'),
    ) as [HTMLDivElement, HTMLDivElement, HTMLDivElement, HTMLDivElement];
    expect(store.snapshot().target).toBeUndefined();
    store.addTarget(own, 'default');
    const removeHome = store.addTarget(home, 'home');
    expect(store.snapshot().target?.element).toBe(home);
    const removeDialog = store.addTarget(dialog, 'modal');
    // A shell mounted while the dialog is open does not take the toasts out of it.
    const removeLaterHome = store.addTarget(document.createElement('div'), 'home');
    expect(store.snapshot().target?.element).toBe(dialog);
    const removeInner = store.addTarget(inner, 'modal');
    expect(store.snapshot().target?.element).toBe(inner);
    removeInner();
    removeInner();
    expect(store.snapshot().target?.element).toBe(dialog);
    removeDialog();
    removeLaterHome();
    expect(store.snapshot().target).toEqual({ element: home, kind: 'home' });
    removeHome();
    expect(store.snapshot().target?.element).toBe(own);
  });

  it('keeps the dock it clears, telling its listeners only of a change', () => {
    const store = new ToastRegionStore();
    const listener = vi.fn<() => void>();
    const unsubscribe = store.subscribe(listener);
    const dock = document.createElement('div');
    store.setDock(dock);
    store.setDock(dock);
    expect(store.snapshot().dock).toBe(dock);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.setDock(undefined);
    expect(store.snapshot().dock).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('times a posting from when it is posted, in the store, and stops on withdrawal', () => {
    vi.useFakeTimers();
    const store = new ToastRegionStore();
    const [timed, withdrawn, error] = [store.newId(), store.newId(), store.newId()];
    const onDismiss = vi.fn<() => void>();
    store.post(timed, { ...INFO, onDismiss });
    store.post(withdrawn, { ...INFO, message: 'Gone' });
    store.post(error, { kind: 'error', message: 'No' });
    expect(vi.getTimerCount()).toBe(2);
    store.post(withdrawn, undefined);
    expect(vi.getTimerCount()).toBe(1);
    // The same posting again does not restart the time.
    vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    store.post(timed, { ...INFO, onDismiss });
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(store.snapshot().entries.map((entry) => entry.toast.message)).toEqual(['No']);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('stops a dismissed posting’s timer, and remembers which postings were announced', () => {
    vi.useFakeTimers();
    const store = new ToastRegionStore();
    const id = store.newId();
    store.post(id, INFO);
    const content = store.snapshot().entries[0]?.content;
    if (content === undefined) throw new Error('no entry');
    store.dismiss(id);
    expect(vi.getTimerCount()).toBe(0);
    expect(store.wasAnnounced(content)).toBe(false);
    store.markAnnounced(content);
    expect(store.wasAnnounced(content)).toBe(true);
    vi.useRealTimers();
  });
});
