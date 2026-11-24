// Fractional indexing: order keys are base-62 strings compared as plain strings.
// A key can always be made between two others, so a reorder changes one node only
// (and two people reordering at once never rewrite each other's keys).

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const digit = (ch: string) => DIGITS.indexOf(ch);

/** A key strictly between `a` and `b` (null means open-ended). Requires a < b. */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`keyBetween: "${a}" is not before "${b}"`);
  let out = '';
  for (let i = 0; ; i++) {
    const lo = a !== null && i < a.length ? digit(a[i]!) : 0;
    const hi = b !== null && i < b.length ? digit(b[i]!) : BASE;
    if (lo === hi) { out += DIGITS[lo]; continue; }       // shared prefix
    const mid = Math.floor((lo + hi) / 2);
    if (mid > lo) return out + DIGITS[mid];               // room at this position
    // Adjacent digits: keep a's digit, then anything above a's remainder fits.
    out += DIGITS[lo];
    b = null;
  }
}

/** `n` evenly made keys after `a` (for inserting several nodes at once). */
export function keysAfter(a: string | null, n: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < n; i++) keys.push((a = keyBetween(a, null)));
  return keys;
}
