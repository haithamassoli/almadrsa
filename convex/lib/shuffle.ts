/**
 * M8 — deterministic shuffling for exam delivery. Pure module (no Convex
 * imports): the same (seed, salt) always yields the same permutation, so a
 * student's question/option order is stable across reloads without storing
 * per-question permutations. The per-attempt `seed` is djb2 of the attempt id
 * (set once at start); each list gets its own `salt` ("questions",
 * "options:<qid>", "right:<qid>", "items:<qid>") so orders are independent.
 */

/** djb2 string hash (hash·33 + char), kept in uint32 range. */
export function djb2(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** mulberry32 PRNG — tiny, fast, good-enough distribution for shuffling. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates over a copy, driven by mulberry32(seed ^ djb2(salt)).
 * Never mutates the input array.
 */
export function seededShuffle<T>(
  array: ReadonlyArray<T>,
  seed: number,
  salt: string,
): Array<T> {
  const rand = mulberry32((seed ^ djb2(salt)) >>> 0);
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
