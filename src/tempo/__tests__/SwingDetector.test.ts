/**
 * SwingDetector.test.ts
 *
 * Tests for the pure-TS SwingDetector algorithm.
 * Uses synthetic frame generation — no device or native deps required.
 *
 * NOTE ON RATIOS:
 * The algorithm measures from "first detected movement" to "peak" to "impact detected."
 * Due to the SMOOTH_WINDOW=3 buffer and displacement thresholds, measured ratios
 * are typically 85–100% of the physical (true) ratio. Assertions use realistic bands.
 */

import { SwingDetector, PoseFrame, PoseLandmark } from '../SwingDetector';

// ─────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────

/**
 * Build a 33-landmark array with the lead wrist (index 15) set to (x, y).
 * All other landmarks are set to (0.5, 0.5) with high visibility.
 */
function makeLandmarks(x: number, y: number): PoseLandmark[] {
  const empty: PoseLandmark = { x: 0.5, y: 0.5, z: 0, visibility: 0.9 };
  const landmarks = Array.from({ length: 33 }, () => ({ ...empty }));
  landmarks[15] = { x, y, z: 0, visibility: 0.95 };
  return landmarks;
}

/**
 * Simulate a complete golf swing as an array of PoseFrames.
 *
 * Models a right-handed swing (camera facing golfer, or down-the-line):
 *   Address  : wrist at x=0.40
 *   Backswing: wrist moves RIGHT to x=0.70  (over backswingMs)
 *   Pause    : ~50ms stationary at top
 *   Downswing: wrist moves LEFT to x=0.30   (over downswingMs)
 *   Follow   : continues left past impact
 *
 * @param backswingMs  Physical backswing duration in ms
 * @param downswingMs  Physical downswing duration in ms
 * @param fps          Camera frame rate (default 60)
 * @param jitter       Optional noise amplitude in normalized units (0–0.01 reasonable)
 */
function simulateSwing(
  backswingMs: number,
  downswingMs: number,
  fps: number = 60,
  jitter: number = 0,
): PoseFrame[] {
  const frames: PoseFrame[] = [];
  const msPerFrame = 1000 / fps;

  const startX  = 0.40; // address / impact reference
  const topX    = 0.70; // top of backswing
  const impactX = 0.30; // follow-through target (must be < startX - IMPACT_PAST_ADDRESS)
  const wristY  = 0.60;

  let t = 0;
  const j = () => (Math.random() - 0.5) * 2 * jitter;

  // ── Phase 1: IDLE (10 stationary frames so addressX locks cleanly) ──
  for (let i = 0; i < 10; i++) {
    frames.push({ timestampMs: t, landmarks: makeLandmarks(startX + j(), wristY + j()) });
    t += msPerFrame;
  }

  // ── Phase 2: BACKSWING — ease-in-out arc leftward ──
  const backswingFrames = Math.round(backswingMs / msPerFrame);
  for (let i = 0; i < backswingFrames; i++) {
    const p = i / backswingFrames;
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    frames.push({
      timestampMs: t,
      landmarks: makeLandmarks(startX + e * (topX - startX) + j(), wristY + j()),
    });
    t += msPerFrame;
  }

  // ── Phase 3: PAUSE at top (ensure ≥3 frames so peak is stable) ──
  const pauseMs = Math.max(4 * msPerFrame, 50);
  const pauseFrames = Math.ceil(pauseMs / msPerFrame);
  for (let i = 0; i < pauseFrames; i++) {
    frames.push({
      timestampMs: t,
      landmarks: makeLandmarks(topX + j() * 0.1, wristY + j() * 0.1),
    });
    t += msPerFrame;
  }

  // ── Phase 4: DOWNSWING — accelerating arc back left ──
  const downswingFrames = Math.round(downswingMs / msPerFrame);
  for (let i = 0; i < downswingFrames; i++) {
    const p = i / downswingFrames;
    const e = p * p; // ease-in (acceleration)
    frames.push({
      timestampMs: t,
      landmarks: makeLandmarks(topX + e * (impactX - topX) + j(), wristY + j()),
    });
    t += msPerFrame;
  }

  // ── Phase 5: Follow-through (continue left) ──
  for (let i = 0; i < 10; i++) {
    frames.push({
      timestampMs: t,
      landmarks: makeLandmarks(impactX - 0.02 * i + j(), wristY + j()),
    });
    t += msPerFrame;
  }

  return frames;
}

/**
 * Run a simulated swing through the detector and return the final result.
 * Continues until COMPLETE is detected or all frames are exhausted.
 */
function runSwing(
  backswingMs: number,
  downswingMs: number,
  fps: number = 60,
  jitter: number = 0,
) {
  const detector = new SwingDetector();
  const frames = simulateSwing(backswingMs, downswingMs, fps, jitter);
  for (const frame of frames) {
    detector.processFrame(frame);
    if (detector.getPhase() === 'COMPLETE') break;
  }
  return detector.getResult();
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe('SwingDetector', () => {

  // ── Core detection ──────────────────────────────────────────
  describe('phase detection and ratio calculation', () => {
    test('perfect 3:1 swing (750ms/250ms) → detected, quality = good', () => {
      const result = runSwing(750, 250);
      expect(result).not.toBeNull();
      // Physical ratio is 3:1; algorithm captures most of it
      expect(result!.ratio).toBeGreaterThan(1.5);
      expect(result!.ratio).toBeLessThan(5.0);
      expect(result!.quality).toBe('good');
    });

    test('too fast swing (400ms back / 200ms down) → quality = too_fast', () => {
      const result = runSwing(400, 200);
      expect(result).not.toBeNull();
      expect(result!.ratio).toBeLessThan(2.0);
      expect(result!.quality).toBe('too_fast');
    });

    test('too slow swing (1200ms back / 250ms down) → quality = too_slow', () => {
      const result = runSwing(1200, 250);
      expect(result).not.toBeNull();
      expect(result!.ratio).toBeGreaterThan(3.5);
      expect(result!.quality).toBe('too_slow');
    });

    test('result includes human-readable feedback string', () => {
      const result = runSwing(750, 250);
      expect(result).not.toBeNull();
      expect(typeof result!.feedback).toBe('string');
      expect(result!.feedback.length).toBeGreaterThan(10);
    });

    test('result includes positive timing values', () => {
      const result = runSwing(750, 250);
      expect(result).not.toBeNull();
      expect(result!.backswingMs).toBeGreaterThan(50);
      expect(result!.downswingMs).toBeGreaterThan(50);
    });

    test('ratio field equals backswingMs / downswingMs', () => {
      const result = runSwing(750, 250);
      expect(result).not.toBeNull();
      const expectedRatio = result!.backswingMs / result!.downswingMs;
      expect(result!.ratio).toBeCloseTo(expectedRatio, 5);
    });
  });

  // ── Robustness ──────────────────────────────────────────────
  describe('robustness', () => {
    test('handles noisy frames (jitter=0.005) — still produces a result', () => {
      const result = runSwing(750, 250, 60, 0.005);
      expect(result).not.toBeNull();
      expect(result!.ratio).toBeGreaterThan(0.5);
      expect(result!.ratio).toBeLessThan(15.0);
    });

    test('handles 30fps — detects swing and produces reasonable ratio', () => {
      const result = runSwing(750, 250, 30);
      expect(result).not.toBeNull();
      expect(result!.ratio).toBeGreaterThan(1.0);
    });

    test('handles 120fps — detects swing and produces reasonable ratio', () => {
      const result = runSwing(750, 250, 120);
      expect(result).not.toBeNull();
      expect(result!.ratio).toBeGreaterThan(1.0);
    });
  });

  // ── Incomplete swing ────────────────────────────────────────
  describe('incomplete swing', () => {
    test('returns null when only backswing frames are fed', () => {
      const detector = new SwingDetector();
      const frames = simulateSwing(750, 250);
      // Feed only the first 30 frames (idle + beginning of backswing)
      for (const frame of frames.slice(0, 30)) {
        detector.processFrame(frame);
      }
      expect(detector.getResult()).toBeNull();
      expect(detector.getPhase()).not.toBe('COMPLETE');
    });

    test('returns null with no frames at all', () => {
      const detector = new SwingDetector();
      expect(detector.getResult()).toBeNull();
      expect(detector.getPhase()).toBe('IDLE');
    });
  });

  // ── Reset ───────────────────────────────────────────────────
  describe('reset', () => {
    test('resets to IDLE with no result', () => {
      const detector = new SwingDetector();
      const frames = simulateSwing(750, 250);
      for (const f of frames) {
        detector.processFrame(f);
        if (detector.getPhase() === 'COMPLETE') break;
      }
      detector.reset();
      expect(detector.getPhase()).toBe('IDLE');
      expect(detector.getResult()).toBeNull();
    });

    test('can detect a second swing after reset', () => {
      const detector = new SwingDetector();

      // First swing
      const frames1 = simulateSwing(750, 250);
      for (const f of frames1) {
        detector.processFrame(f);
        if (detector.getPhase() === 'COMPLETE') break;
      }
      const r1 = detector.getResult();
      expect(r1).not.toBeNull();

      // Reset
      detector.reset();
      expect(detector.getPhase()).toBe('IDLE');

      // Second swing (offset timestamps to avoid any hypothetical caching)
      const offset = 10000;
      const frames2 = simulateSwing(750, 250).map(f => ({
        ...f,
        timestampMs: f.timestampMs + offset,
      }));
      for (const f of frames2) {
        detector.processFrame(f);
        if (detector.getPhase() === 'COMPLETE') break;
      }
      const r2 = detector.getResult();
      expect(r2).not.toBeNull();
      expect(r2!.quality).toBe('good');
    });
  });

  // ── Low visibility ──────────────────────────────────────────
  describe('low visibility frames', () => {
    test('skips frames where lead wrist visibility < 0.5', () => {
      const detector = new SwingDetector();
      const frame: PoseFrame = {
        timestampMs: 0,
        landmarks: Array.from({ length: 33 }, (_, i) =>
          i === 15
            ? { x: 0.8, y: 0.5, z: 0, visibility: 0.1 } // low confidence
            : { x: 0.5, y: 0.5, z: 0, visibility: 0.9 }
        ),
      };
      detector.processFrame(frame);
      expect(detector.getPhase()).toBe('IDLE'); // should not advance to BACKSWING
    });
  });

});
