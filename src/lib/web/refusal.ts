/** An error the window shows as its message alone, as the desktop backend's plain-string rejections read. */
export class Refusal extends Error {
  override toString(): string {
    return this.message;
  }
}
