/**
 * integration.test.ts
 *
 * End-to-end pipeline tests using realistic pose fixtures.
 *
 * These tests exercise the FULL data pipeline:
 *   PoseFrame fixture → SwingDetector → SwingResult
 *
 * They also validate the hook-level behavior (auto-reset timing, result
 * delivery) by running the detector in the same sequence the hook would.
 *
 * No device, simulator, or React Native runtime needed.
 */

import { SwingDetector, SwingPhase, SwingResult } from '../../tempo/SwingDetector';
import { FIXTURES, generateSwingFixture, SwingFixture } from '../../fixtures';

// ── Helper: run a fixture through the detector ────────────────────────────

interface RunResult {
  result: SwingResult | null;
  phaseHistory: SwingPhase[];
  totalFrames: number;
  framesUntilComplete: number | null;
}

function runFixture(fixture: SwingFixture): RunResult {
  const detector = new SwingDetector();
  const phaseHistory: SwingPhase[] = [];
  let prev: SwingPhase = 'IDLE';
  let framesUntilComplete: number | null = null;

  for (let i = 0; i < fixture.frames.length; i++) {
    const phase = detector.processFrame(fixture.frames[i]);
    if (phase !== prev) {
      phaseHistory.push(phase);
      prev = phase;
    }
    if (phase === 'COMPLETE' && framesUntilComplete === null) {
      framesUntilComplete = i + 1;
      break;
    }
  }

  return {
    result: detector.getResult(),
    phaseHistory,
    totalFrames: fixture.frames.length,
    framesUntilComplete,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: full pipeline with realistic pose fixtures', () => {

  // ── Phase progression ─────────────────────────────────────────────────────
  describe('phase progression', () => {
    test('good 3:1 swing passes through expected phases in order', () => {
      const { phaseHistory } = runFixture(FIXTURES.good3to1);
      expect(phaseHistory).toContain('BACKSWING');
      expect(phaseHistory).toContain('DOWNSWING');
      expect(phaseHistory).toContain('COMPLETE');
      // Phases must appear in the correct order
      const bsIdx = phaseHistory.indexOf('BACKSWING');
      const dsIdx = phaseHistory.indexOf('DOWNSWING');
      const cpIdx = phaseHistory.indexOf('COMPLETE');
      expect(bsIdx).toBeLessThan(dsIdx);
      expect(dsIdx).toBeLessThan(cpIdx);
    });

    test('swing completes before end of fixture frames', () => {
      const { framesUntilComplete, totalFrames } = runFixture(FIXTURES.good3to1);
      expect(framesUntilComplete).not.toBeNull();
      expect(framesUntilComplete!).toBeLessThan(totalFrames);
    });
  });

  // ── Quality classification ────────────────────────────────────────────────
  describe('quality classification by fixture type', () => {
    test('good_3to1 fixture → quality = good', () => {
      const { result } = runFixture(FIXTURES.good3to1);
      expect(result).not.toBeNull();
      expect(result!.quality).toBe('good');
    });

    test('knapp_style fixture (780ms/240ms) → quality = good', () => {
      const { result } = runFixture(FIXTURES.knapp);
      expect(result).not.toBeNull();
      expect(result!.quality).toBe('good');
    });

    test('too_fast fixture (400ms/200ms) → quality = too_fast', () => {
      const { result } = runFixture(FIXTURES.tooFast);
      expect(result).not.toBeNull();
      expect(result!.quality).toBe('too_fast');
    });

    test('too_slow fixture (1250ms/250ms) → quality = too_slow', () => {
      const { result } = runFixture(FIXTURES.tooSlow);
      expect(result).not.toBeNull();
      expect(result!.quality).toBe('too_slow');
    });
  });

  // ── Ratio accuracy ────────────────────────────────────────────────────────
  describe('ratio accuracy', () => {
    test('measured ratio for 3:1 swing is within ±40% of physical ratio', () => {
      const { result } = runFixture(FIXTURES.good3to1);
      expect(result).not.toBeNull();
      // Physical ratio is 3.0; allow wide band for detection timing offsets
      expect(result!.ratio).toBeGreaterThan(3.0 * 0.6);
      expect(result!.ratio).toBeLessThan(3.0 * 1.4);
    });

    test('fast swing measured ratio is lower than slow swing measured ratio', () => {
      const { result: fast } = runFixture(FIXTURES.tooFast);
      const { result: slow } = runFixture(FIXTURES.tooSlow);
      expect(fast).not.toBeNull();
      expect(slow).not.toBeNull();
      expect(fast!.ratio).toBeLessThan(slow!.ratio);
    });

    test('ratio field = backswingMs / downswingMs', () => {
      const { result } = runFixture(FIXTURES.good3to1);
      expect(result).not.toBeNull();
      expect(result!.ratio).toBeCloseTo(result!.backswingMs / result!.downswingMs, 4);
    });
  });

  // ── Robustness ────────────────────────────────────────────────────────────
  describe('robustness', () => {
    test('noisy fixture still completes and produces a result', () => {
      const { result } = runFixture(FIXTURES.noisy);
      expect(result).not.toBeNull();
      expect(result!.ratio).toBeGreaterThan(0.5);
    });

    test('30fps fixture completes and produces a result', () => {
      const { result } = runFixture(FIXTURES.good30fps);
      expect(result).not.toBeNull();
    });

    test('120fps fixture completes and produces a result', () => {
      const { result } = runFixture(FIXTURES.good120fps);
      expect(result).not.toBeNull();
    });
  });

  // ── Feedback strings ──────────────────────────────────────────────────────
  describe('feedback strings', () => {
    test('good swing feedback mentions positive reinforcement', () => {
      const { result } = runFixture(FIXTURES.good3to1);
      expect(result).not.toBeNull();
      expect(result!.feedback.toLowerCase()).toMatch(/great|good|zone/);
    });

    test('too_fast feedback tells golfer to slow down', () => {
      const { result } = runFixture(FIXTURES.tooFast);
      expect(result).not.toBeNull();
      expect(result!.feedback.toLowerCase()).toMatch(/quick|rushed|slow|pause/);
    });

    test('too_slow feedback tells golfer to speed up', () => {
      const { result } = runFixture(FIXTURES.tooSlow);
      expect(result).not.toBeNull();
      expect(result!.feedback.toLowerCase()).toMatch(/slow|decisive|accelerat/);
    });
  });

  // ── Hook-level behavior ───────────────────────────────────────────────────
  describe('hook-level behavior (detector lifecycle)', () => {
    test('detector resets cleanly and detects second swing correctly', () => {
      const detector = new SwingDetector();

      // First swing
      for (const frame of FIXTURES.good3to1.frames) {
        detector.processFrame(frame);
        if (detector.getPhase() === 'COMPLETE') break;
      }
      const r1 = detector.getResult();
      expect(r1).not.toBeNull();
      expect(r1!.quality).toBe('good');

      // Reset (as the hook would after 3.5s)
      detector.reset();
      expect(detector.getPhase()).toBe('IDLE');
      expect(detector.getResult()).toBeNull();

      // Second swing — use a different fixture to confirm no state bleed
      const tOffset = 10000;
      for (const frame of FIXTURES.tooFast.frames) {
        detector.processFrame({ ...frame, timestampMs: frame.timestampMs + tOffset });
        if (detector.getPhase() === 'COMPLETE') break;
      }
      const r2 = detector.getResult();
      expect(r2).not.toBeNull();
      expect(r2!.quality).toBe('too_fast'); // correct classification after reset
    });

    test('multiple sequential swings all produce results', () => {
      const swings = [FIXTURES.good3to1, FIXTURES.tooFast, FIXTURES.tooSlow, FIXTURES.knapp];
      const detector = new SwingDetector();
      let tOffset = 0;

      for (const fixture of swings) {
        for (const frame of fixture.frames) {
          detector.processFrame({ ...frame, timestampMs: frame.timestampMs + tOffset });
          if (detector.getPhase() === 'COMPLETE') break;
        }
        expect(detector.getResult()).not.toBeNull();
        tOffset += 10000;
        detector.reset();
      }
    });
  });

  // ── Parameterised sweep ───────────────────────────────────────────────────
  describe('parameterised ratio sweep', () => {
    const cases: Array<{ back: number; down: number; expectedQuality: 'good' | 'too_fast' | 'too_slow' }> = [
      { back: 750, down: 250, expectedQuality: 'good' },     // 3:1 — ideal
      { back: 800, down: 280, expectedQuality: 'good' },     // ~2.86:1 — still good
      { back: 350, down: 200, expectedQuality: 'too_fast' }, // 1.75:1 — too fast
      { back: 1300, down: 250, expectedQuality: 'too_slow' },// 5.2:1 — too slow
    ];

    test.each(cases)(
      'back=$back ms / down=$down ms → $expectedQuality',
      ({ back, down, expectedQuality }) => {
        const fixture = generateSwingFixture(`sweep_${back}_${down}`, back, down, 60, 0.003, 99);
        const { result } = runFixture(fixture);
        expect(result).not.toBeNull();
        expect(result!.quality).toBe(expectedQuality);
      }
    );
  });

});
