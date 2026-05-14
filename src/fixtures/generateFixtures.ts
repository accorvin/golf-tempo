/**
 * generateFixtures.ts
 *
 * Generates realistic pose landmark fixtures for integration testing.
 * Run this script to regenerate fixtures:
 *   npx ts-node src/fixtures/generateFixtures.ts
 *
 * Each fixture is a JSON array of PoseFrames that simulate a real golfer's
 * wrist/shoulder/hip movement through the swing phases.
 *
 * Fixture design:
 * - All 33 BlazePose landmarks are populated (not just the wrist)
 * - Shoulder and hip positions move realistically during the swing
 * - Visibility values simulate real detection confidence (drops briefly at impact)
 * - Random seed is fixed for determinism
 */

import { PoseFrame, PoseLandmark } from '../tempo/SwingDetector';
import * as fs from 'fs';
import * as path from 'path';

// Fixed "random" for determinism — simple LCG
class SeededRandom {
  private seed: number;
  constructor(seed: number) { this.seed = seed; }
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) & 0xffffffff;
    return (this.seed >>> 0) / 0xffffffff;
  }
  jitter(amplitude: number): number {
    return (this.next() - 0.5) * 2 * amplitude;
  }
}

interface BodyPosition {
  leftWristX: number;   leftWristY: number;
  rightWristX: number;  rightWristY: number;
  leftShoulderX: number; leftShoulderY: number;
  rightShoulderX: number; rightShoulderY: number;
  leftHipX: number;    leftHipY: number;
  rightHipX: number;   rightHipY: number;
}

// Address position (at setup, before swing)
const ADDRESS: BodyPosition = {
  leftWristX: 0.40,  leftWristY: 0.72,
  rightWristX: 0.45, rightWristY: 0.70,
  leftShoulderX: 0.38, leftShoulderY: 0.45,
  rightShoulderX: 0.58, rightShoulderY: 0.44,
  leftHipX: 0.40,  leftHipY: 0.62,
  rightHipX: 0.56, rightHipY: 0.62,
};

// Top of backswing position
const TOP: BodyPosition = {
  leftWristX: 0.72,  leftWristY: 0.35,
  rightWristX: 0.68, rightWristY: 0.32,
  leftShoulderX: 0.44, leftShoulderY: 0.44,
  rightShoulderX: 0.56, rightShoulderY: 0.43,
  leftHipX: 0.43,  leftHipY: 0.62,
  rightHipX: 0.54, rightHipY: 0.63,
};

// Impact / follow-through position
const IMPACT: BodyPosition = {
  leftWristX: 0.30,  leftWristY: 0.68,
  rightWristX: 0.35, rightWristY: 0.66,
  leftShoulderX: 0.36, leftShoulderY: 0.44,
  rightShoulderX: 0.60, rightShoulderY: 0.43,
  leftHipX: 0.38,  leftHipY: 0.62,
  rightHipX: 0.58, rightHipY: 0.62,
};

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function easeIn(t: number): number { return t * t; }

function lerpBody(a: BodyPosition, b: BodyPosition, t: number, easeFn: (t: number) => number): BodyPosition {
  const e = easeFn(t);
  return {
    leftWristX:    lerp(a.leftWristX, b.leftWristX, e),
    leftWristY:    lerp(a.leftWristY, b.leftWristY, e),
    rightWristX:   lerp(a.rightWristX, b.rightWristX, e),
    rightWristY:   lerp(a.rightWristY, b.rightWristY, e),
    leftShoulderX: lerp(a.leftShoulderX, b.leftShoulderX, e),
    leftShoulderY: lerp(a.leftShoulderY, b.leftShoulderY, e),
    rightShoulderX:lerp(a.rightShoulderX, b.rightShoulderX, e),
    rightShoulderY:lerp(a.rightShoulderY, b.rightShoulderY, e),
    leftHipX:      lerp(a.leftHipX, b.leftHipX, e),
    leftHipY:      lerp(a.leftHipY, b.leftHipY, e),
    rightHipX:     lerp(a.rightHipX, b.rightHipX, e),
    rightHipY:     lerp(a.rightHipY, b.rightHipY, e),
  };
}

function bodyToLandmarks(body: BodyPosition, rng: SeededRandom, noise: number, impactPhase = false): PoseLandmark[] {
  const empty: PoseLandmark = { x: 0.5, y: 0.5, z: 0, visibility: 0.85 };
  const lm = Array.from({ length: 33 }, () => ({ ...empty }));

  // Wrist visibility drops slightly at impact (fast motion blur)
  const wristVis = impactPhase ? 0.72 : 0.94;

  lm[15] = { x: body.leftWristX  + rng.jitter(noise), y: body.leftWristY  + rng.jitter(noise), z: 0, visibility: wristVis };
  lm[16] = { x: body.rightWristX + rng.jitter(noise), y: body.rightWristY + rng.jitter(noise), z: 0, visibility: wristVis };
  lm[11] = { x: body.leftShoulderX  + rng.jitter(noise * 0.5), y: body.leftShoulderY  + rng.jitter(noise * 0.5), z: 0, visibility: 0.96 };
  lm[12] = { x: body.rightShoulderX + rng.jitter(noise * 0.5), y: body.rightShoulderY + rng.jitter(noise * 0.5), z: 0, visibility: 0.96 };
  lm[23] = { x: body.leftHipX  + rng.jitter(noise * 0.3), y: body.leftHipY  + rng.jitter(noise * 0.3), z: 0, visibility: 0.98 };
  lm[24] = { x: body.rightHipX + rng.jitter(noise * 0.3), y: body.rightHipY + rng.jitter(noise * 0.3), z: 0, visibility: 0.98 };

  return lm;
}

function generateSwingFixture(
  label: string,
  backswingMs: number,
  downswingMs: number,
  fps: number = 60,
  noise: number = 0.003,
  seed: number = 42,
): { label: string; backswingMs: number; downswingMs: number; physicalRatio: number; frames: PoseFrame[] } {
  const rng = new SeededRandom(seed);
  const msPerFrame = 1000 / fps;
  const frames: PoseFrame[] = [];
  let t = 0;

  // Idle / address (10 frames)
  for (let i = 0; i < 10; i++) {
    frames.push({ timestampMs: t, landmarks: bodyToLandmarks(ADDRESS, rng, noise) });
    t += msPerFrame;
  }

  // Backswing
  const backswingFrames = Math.round(backswingMs / msPerFrame);
  for (let i = 0; i < backswingFrames; i++) {
    const body = lerpBody(ADDRESS, TOP, i / backswingFrames, easeInOut);
    frames.push({ timestampMs: t, landmarks: bodyToLandmarks(body, rng, noise) });
    t += msPerFrame;
  }

  // Pause at top (4–6 frames)
  for (let i = 0; i < 5; i++) {
    frames.push({ timestampMs: t, landmarks: bodyToLandmarks(TOP, rng, noise * 0.3) });
    t += msPerFrame;
  }

  // Downswing
  const downswingFrames = Math.round(downswingMs / msPerFrame);
  for (let i = 0; i < downswingFrames; i++) {
    const body = lerpBody(TOP, IMPACT, i / downswingFrames, easeIn);
    const isImpact = i > downswingFrames * 0.8;
    frames.push({ timestampMs: t, landmarks: bodyToLandmarks(body, rng, noise, isImpact) });
    t += msPerFrame;
  }

  // Follow-through (10 frames)
  for (let i = 0; i < 10; i++) {
    const followX = IMPACT.leftWristX - 0.02 * i;
    const body: BodyPosition = { ...IMPACT, leftWristX: followX, rightWristX: followX + 0.05 };
    frames.push({ timestampMs: t, landmarks: bodyToLandmarks(body, rng, noise) });
    t += msPerFrame;
  }

  return { label, backswingMs, downswingMs, physicalRatio: backswingMs / downswingMs, frames };
}

// ── Generate all fixtures ─────────────────────────────────────────────────────

const fixtures = [
  generateSwingFixture('good_3to1_60fps',  750, 250, 60, 0.003, 42),
  generateSwingFixture('good_3to1_30fps',  750, 250, 30, 0.003, 43),
  generateSwingFixture('good_3to1_120fps', 750, 250, 120, 0.003, 44),
  generateSwingFixture('too_fast_2to1',    400, 200, 60, 0.003, 45),
  generateSwingFixture('too_slow_5to1',   1250, 250, 60, 0.003, 46),
  generateSwingFixture('noisy_3to1',       750, 250, 60, 0.008, 47),
  generateSwingFixture('knapp_style',      780, 240, 60, 0.002, 48),  // Jake Knapp-ish
];

const outDir = path.join(__dirname);
for (const fixture of fixtures) {
  const outPath = path.join(outDir, `${fixture.label}.json`);
  fs.writeFileSync(outPath, JSON.stringify(fixture, null, 2));
  console.log(`✓ ${fixture.label}.json  (${fixture.frames.length} frames, physical ratio ${fixture.physicalRatio.toFixed(1)}:1)`);
}

console.log('\nFixtures written to src/fixtures/');
