/**
 * Pose fixture factory — used by integration tests.
 *
 * Generates deterministic, realistic PoseFrame arrays simulating a full
 * golf swing. All 33 BlazePose landmarks populated; key ones move realistically.
 *
 * For integration tests import generateSwingFixture() directly.
 * To regenerate JSON fixtures on disk, run:
 *   npm run generate-fixtures
 */

import { PoseFrame, PoseLandmark } from '../tempo/SwingDetector';

// ── Fixed-seed PRNG for deterministic tests ───────────────────────────────
class SeededRandom {
  private seed: number;
  constructor(seed: number) { this.seed = seed >>> 0; }
  next(): number {
    this.seed = Math.imul(this.seed ^ (this.seed >>> 16), 0x45d9f3b);
    this.seed = Math.imul(this.seed ^ (this.seed >>> 16), 0x45d9f3b);
    this.seed ^= this.seed >>> 16;
    return (this.seed >>> 0) / 0xffffffff;
  }
  jitter(amp: number): number { return (this.next() - 0.5) * 2 * amp; }
}

// ── Body keypoint positions at each swing phase ───────────────────────────

interface Body {
  // Wrists
  lWx: number; lWy: number;
  rWx: number; rWy: number;
  // Shoulders
  lSx: number; lSy: number;
  rSx: number; rSy: number;
  // Hips
  lHx: number; lHy: number;
  rHx: number; rHy: number;
}

const ADDRESS: Body = {
  lWx: 0.40, lWy: 0.72,  rWx: 0.45, rWy: 0.70,
  lSx: 0.38, lSy: 0.45,  rSx: 0.58, rSy: 0.44,
  lHx: 0.40, lHy: 0.62,  rHx: 0.56, rHy: 0.62,
};

const TOP: Body = {
  lWx: 0.72, lWy: 0.35,  rWx: 0.68, rWy: 0.32,
  lSx: 0.44, lSy: 0.44,  rSx: 0.56, rSy: 0.43,
  lHx: 0.43, lHy: 0.62,  rHx: 0.54, rHy: 0.63,
};

const FOLLOW: Body = {
  lWx: 0.30, lWy: 0.68,  rWx: 0.35, rWy: 0.66,
  lSx: 0.36, lSy: 0.44,  rSx: 0.60, rSy: 0.43,
  lHx: 0.38, lHy: 0.62,  rHx: 0.58, rHy: 0.62,
};

// ── Interpolation helpers ─────────────────────────────────────────────────

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function easeIn(t: number): number { return t * t; }

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

function lerpBody(a: Body, b: Body, t: number, ease: (t: number) => number): Body {
  const e = ease(Math.max(0, Math.min(1, t)));
  return {
    lWx: lerp(a.lWx, b.lWx, e), lWy: lerp(a.lWy, b.lWy, e),
    rWx: lerp(a.rWx, b.rWx, e), rWy: lerp(a.rWy, b.rWy, e),
    lSx: lerp(a.lSx, b.lSx, e), lSy: lerp(a.lSy, b.lSy, e),
    rSx: lerp(a.rSx, b.rSx, e), rSy: lerp(a.rSy, b.rSy, e),
    lHx: lerp(a.lHx, b.lHx, e), lHy: lerp(a.lHy, b.lHy, e),
    rHx: lerp(a.rHx, b.rHx, e), rHy: lerp(a.rHy, b.rHy, e),
  };
}

function bodyToLandmarks(body: Body, rng: SeededRandom, noise: number, wristVis = 0.94): PoseLandmark[] {
  const def: PoseLandmark = { x: 0.5, y: 0.5, z: 0, visibility: 0.85 };
  const lm: PoseLandmark[] = Array.from({ length: 33 }, () => ({ ...def }));
  const j = (n = noise) => rng.jitter(n);

  lm[15] = { x: body.lWx + j(), y: body.lWy + j(), z: 0, visibility: wristVis };
  lm[16] = { x: body.rWx + j(), y: body.rWy + j(), z: 0, visibility: wristVis };
  lm[11] = { x: body.lSx + j(noise * 0.5), y: body.lSy + j(noise * 0.5), z: 0, visibility: 0.96 };
  lm[12] = { x: body.rSx + j(noise * 0.5), y: body.rSy + j(noise * 0.5), z: 0, visibility: 0.96 };
  lm[23] = { x: body.lHx + j(noise * 0.3), y: body.lHy + j(noise * 0.3), z: 0, visibility: 0.98 };
  lm[24] = { x: body.rHx + j(noise * 0.3), y: body.rHy + j(noise * 0.3), z: 0, visibility: 0.98 };
  return lm;
}

// ── Public fixture factory ─────────────────────────────────────────────────

export interface SwingFixture {
  label: string;
  backswingMs: number;
  downswingMs: number;
  physicalRatio: number;
  fps: number;
  frames: PoseFrame[];
}

export function generateSwingFixture(
  label: string,
  backswingMs: number,
  downswingMs: number,
  fps = 60,
  noise = 0.003,
  seed = 42,
): SwingFixture {
  const rng = new SeededRandom(seed);
  const mspf = 1000 / fps;
  const frames: PoseFrame[] = [];
  let t = 0;

  // IDLE — 10 stationary frames so addressX locks cleanly
  for (let i = 0; i < 10; i++) {
    frames.push({ timestampMs: t, landmarks: bodyToLandmarks(ADDRESS, rng, noise) });
    t += mspf;
  }

  // BACKSWING
  const bsf = Math.round(backswingMs / mspf);
  for (let i = 0; i < bsf; i++) {
    const body = lerpBody(ADDRESS, TOP, i / bsf, easeInOut);
    frames.push({ timestampMs: t, landmarks: bodyToLandmarks(body, rng, noise) });
    t += mspf;
  }

  // PAUSE at top (5 near-stationary frames)
  for (let i = 0; i < 5; i++) {
    frames.push({ timestampMs: t, landmarks: bodyToLandmarks(TOP, rng, noise * 0.25) });
    t += mspf;
  }

  // DOWNSWING
  const dsf = Math.round(downswingMs / mspf);
  for (let i = 0; i < dsf; i++) {
    const body = lerpBody(TOP, FOLLOW, i / dsf, easeIn);
    const wristVis = i > dsf * 0.8 ? 0.75 : 0.94; // slight drop at impact
    frames.push({ timestampMs: t, landmarks: bodyToLandmarks(body, rng, noise, wristVis) });
    t += mspf;
  }

  // FOLLOW-THROUGH
  for (let i = 0; i < 10; i++) {
    const body: Body = { ...FOLLOW, lWx: FOLLOW.lWx - 0.02 * i, rWx: FOLLOW.rWx - 0.02 * i };
    frames.push({ timestampMs: t, landmarks: bodyToLandmarks(body, rng, noise) });
    t += mspf;
  }

  return { label, backswingMs, downswingMs, physicalRatio: backswingMs / downswingMs, fps, frames };
}

// ── Pre-built named fixtures ───────────────────────────────────────────────

export const FIXTURES = {
  good3to1:   generateSwingFixture('good_3to1_60fps',  750, 250, 60,  0.003, 42),
  good30fps:  generateSwingFixture('good_3to1_30fps',  750, 250, 30,  0.003, 43),
  good120fps: generateSwingFixture('good_3to1_120fps', 750, 250, 120, 0.003, 44),
  tooFast:    generateSwingFixture('too_fast_2to1',    400, 200, 60,  0.003, 45),
  tooSlow:    generateSwingFixture('too_slow_5to1',   1250, 250, 60,  0.003, 46),
  noisy:      generateSwingFixture('noisy_3to1',       750, 250, 60,  0.008, 47),
  knapp:      generateSwingFixture('knapp_style',      780, 240, 60,  0.002, 48),
} as const;
