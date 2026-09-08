// src/lib/order.ts
// The one comparator every path that produces output bytes must use. Spec section 12 requires
// same input -> identical output, byte for byte, across runs and machines. `String.prototype
// .localeCompare()` with no locale argument resolves against the runtime's ICU and the `LANG`
// environment variable, so it can reorder output between two machines -- or two Node builds --
// that never disagree about anything else. Plain codepoint order has no such dependency.
export function codepointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
