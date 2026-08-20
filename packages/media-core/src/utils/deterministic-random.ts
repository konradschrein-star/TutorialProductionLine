/**
 * mulberry32 Pseudo-Random Number Generator (PRNG)
 *
 * Deterministic randomization - same seed always produces the same sequence.
 * Used for Ken Burns effects to ensure reproducible renders across languages.
 *
 * @param seed - Integer seed value
 * @returns Function that returns next random number in [0, 1)
 */
export function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
