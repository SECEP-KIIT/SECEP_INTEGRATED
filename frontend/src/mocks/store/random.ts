// Seeded PRNG (mulberry32), so the generated mailbox is the same on every run without a faker dependency.
export type Rng = () => number

export function rng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)]
export const int = (r: Rng, min: number, max: number) => min + Math.floor(r() * (max - min + 1))
export const chance = (r: Rng, p: number) => r() < p
export const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits

/** Deterministic UUID-shaped id from a namespace number and a counter. */
export const uid = (ns: number, n: number) =>
  `${ns.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
