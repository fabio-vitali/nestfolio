/**
 * Returns a jittered duration in the half-open range [mean * 0.75, mean * 1.25).
 * Used to decorrelate lockstep polling across parallel test workers — see
 * spec docs/superpowers/specs/2026-05-12-trap-empty-family-hardening-design.md.
 */
export function jitter(mean: number, random: () => number = Math.random): number {
  return mean * (0.75 + random() * 0.5);
}
