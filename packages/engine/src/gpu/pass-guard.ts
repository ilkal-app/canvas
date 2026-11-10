/**
 * Enforces the one rule both backends must share about open passes: while a render pass is open
 * no other pass may begin, the frame may not be submitted, and buffers and textures may not be
 * written. WebGPU forbids queue writes that would overtake a recorded pass; WebGL2 would allow
 * them silently, so both backends check here and a renderer fails the same way on each.
 */
export class OpenPassGuard {
  private isPassOpen = false;

  /**
   * Records that a pass has begun.
   *
   * @throws {Error} When a pass is already open.
   */
  open(): void {
    this.assertClosed('begin a render pass');
    this.isPassOpen = true;
  }

  /** Records that the open pass has ended. */
  close(): void {
    this.isPassOpen = false;
  }

  /**
   * Checks that no pass is open.
   *
   * @param action - What the caller is about to do, for the message ("write a buffer").
   * @throws {Error} When a pass is open.
   */
  assertClosed(action: string): void {
    if (this.isPassOpen) {
      throw new Error(`Cannot ${action} while a render pass is open; end() the pass first.`);
    }
  }
}
