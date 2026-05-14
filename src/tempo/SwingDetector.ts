/**
 * SwingDetector.ts
 *
 * Pure TypeScript swing tempo analyzer — zero React Native dependencies.
 * Feed PoseFrame objects in via processFrame(); get SwingResult out when complete.
 *
 * TARGET: 3:1 ratio (Jake Knapp style) — ~750ms backswing / ~250ms downswing
 *
 * DESIGN NOTES:
 * - addressX is locked after the first MIN_ADDRESS_FRAMES stable idle frames so
 *   early-backswing movement doesn't cause the reference to drift upward.
 * - A small SWING_START_DISPLACEMENT (0.01) detects the swing start very early,
 *   capturing most of the physical backswing duration.
 * - The measured ratio will be slightly less than the physical ratio because a few
 *   frames are always missed at the very start; quality bands are calibrated for this.
 *
 * MediaPipe BlazePose landmark indices used:
 *   15 = left wrist  (lead wrist, right-handed golfer)
 *   16 = right wrist
 *   11 = left shoulder, 12 = right shoulder
 *   23 = left hip,     24 = right hip
 */

export interface PoseLandmark {
  x: number;          // 0–1 normalized horizontal (left=0, right=1)
  y: number;          // 0–1 normalized vertical   (top=0, bottom=1)
  z: number;
  visibility: number; // 0–1; frames with visibility < 0.5 are skipped
}

export interface PoseFrame {
  timestampMs: number;
  landmarks: PoseLandmark[]; // 33 BlazePose landmarks
}

export type SwingPhase = 'IDLE' | 'BACKSWING' | 'DOWNSWING' | 'COMPLETE';

export interface SwingResult {
  ratio: number;          // measured backswingMs / downswingMs
  backswingMs: number;
  downswingMs: number;
  quality: 'good' | 'too_fast' | 'too_slow';
  feedback: string;       // spoken aloud after each swing
}

// ── Landmark indices ───────────────────────────────────────────────────────
const LEAD_WRIST = 15; // left wrist = lead wrist for right-handed golfer (front view)

// ── Smoothing ──────────────────────────────────────────────────────────────
const SMOOTH_WINDOW = 3;       // 3-frame rolling average
const MIN_ADDRESS_FRAMES = 5;  // lock addressX after this many stable smoothed frames

// ── Swing detection thresholds (in normalized 0–1 screen coordinates) ─────
/**
 * Minimum wrist displacement from address before calling it a swing.
 * Kept small (0.01 = 1% of frame width) so the backswing start is detected
 * as early as possible, capturing most of the physical backswing in the ratio.
 */
const SWING_START_DISPLACEMENT = 0.01;

/**
 * How far back from the peak the wrist must drop before we record the transition
 * from backswing to downswing.
 */
const DOWNSWING_START_DISPLACEMENT = 0.03;

/**
 * How far past the address position the wrist must reach to register as impact
 * / follow-through completion.
 */
const IMPACT_PAST_ADDRESS = 0.03;

// ── Quality classification (measured ratios, calibrated for this algorithm) ──
const GOOD_LOW  = 2.0;   // measured ratios typically 10–15% lower than physical
const GOOD_HIGH = 3.5;
const TOO_FAST_THRESHOLD = 1.8;
const TOO_SLOW_THRESHOLD = 4.0;

// ─────────────────────────────────────────────────────────────────────────────

interface SmoothedPoint {
  x: number;
  y: number;
  timestampMs: number;
}

/**
 * SwingDetector
 *
 * Usage:
 *   const det = new SwingDetector();
 *   for (const frame of cameraFrames) {
 *     det.processFrame(frame);
 *     if (det.getPhase() === 'COMPLETE') {
 *       console.log(det.getResult());
 *       det.reset();
 *     }
 *   }
 */
export class SwingDetector {
  // State
  private phase: SwingPhase = 'IDLE';
  private rawBuffer: Array<{ x: number; y: number; timestampMs: number }> = [];
  private smoothed: SmoothedPoint[] = [];

  // Address position — locked after first MIN_ADDRESS_FRAMES stable frames
  private addressX: number = 0.5;
  private addressLocked: boolean = false;

  // Timing anchors
  private backswingStartMs: number = 0;
  private peakX: number = 0;
  private peakTimestampMs: number = 0;
  private impactTimestampMs: number = 0;

  private result: SwingResult | null = null;

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Process one camera frame. Call this for every frame from the pose detector.
   * Returns the current swing phase.
   */
  processFrame(frame: PoseFrame): SwingPhase {
    const lm = frame.landmarks[LEAD_WRIST];
    if (!lm || lm.visibility < 0.5) return this.phase; // skip low-confidence frames

    // Maintain rolling raw buffer for smoothing
    this.rawBuffer.push({ x: lm.x, y: lm.y, timestampMs: frame.timestampMs });
    if (this.rawBuffer.length > SMOOTH_WINDOW) this.rawBuffer.shift();
    if (this.rawBuffer.length < SMOOTH_WINDOW) return this.phase; // need full window

    const pt = this.computeSmoothed();
    this.smoothed.push(pt);

    switch (this.phase) {
      case 'IDLE':      this.updateIdle(pt);      break;
      case 'BACKSWING': this.updateBackswing(pt); break;
      case 'DOWNSWING': this.updateDownswing(pt); break;
      case 'COMPLETE':  break;
    }

    return this.phase;
  }

  getPhase(): SwingPhase         { return this.phase; }
  getResult(): SwingResult | null { return this.result; }

  /**
   * Reset for the next swing. Always call this after retrieving the result.
   */
  reset(): void {
    this.phase = 'IDLE';
    this.rawBuffer = [];
    this.smoothed = [];
    this.addressX = 0.5;
    this.addressLocked = false;
    this.backswingStartMs = 0;
    this.peakX = 0;
    this.peakTimestampMs = 0;
    this.impactTimestampMs = 0;
    this.result = null;
  }

  // ── Phase handlers ────────────────────────────────────────────────────────

  private updateIdle(pt: SmoothedPoint): void {
    // Lock addressX after MIN_ADDRESS_FRAMES stable frames, then stop updating.
    // This prevents early backswing movement from drifting the reference point.
    if (!this.addressLocked) {
      const stableFrames = this.smoothed.slice(0, MIN_ADDRESS_FRAMES);
      if (stableFrames.length > 0) {
        this.addressX = stableFrames.reduce((s, f) => s + f.x, 0) / stableFrames.length;
      }
      if (this.smoothed.length >= MIN_ADDRESS_FRAMES) {
        this.addressLocked = true;
      }
    }

    // Trigger backswing when wrist moves right beyond address + small threshold
    if (pt.x > this.addressX + SWING_START_DISPLACEMENT) {
      this.phase = 'BACKSWING';
      this.backswingStartMs = pt.timestampMs;
      this.peakX = pt.x;
      this.peakTimestampMs = pt.timestampMs;
    }
  }

  private updateBackswing(pt: SmoothedPoint): void {
    // Track the rightmost point (top of swing)
    if (pt.x > this.peakX) {
      this.peakX = pt.x;
      this.peakTimestampMs = pt.timestampMs;
    }

    // Detect downswing: wrist has moved left of peak by enough to be deliberate
    if (pt.x < this.peakX - DOWNSWING_START_DISPLACEMENT) {
      this.phase = 'DOWNSWING';
    }
  }

  private updateDownswing(pt: SmoothedPoint): void {
    // Impact / follow-through: wrist passes back through address and beyond
    if (pt.x <= this.addressX - IMPACT_PAST_ADDRESS) {
      this.impactTimestampMs = pt.timestampMs;
      this.phase = 'COMPLETE';
      this.finalize();
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private computeSmoothed(): SmoothedPoint {
    const n = this.rawBuffer.length;
    return {
      x: this.rawBuffer.reduce((s, f) => s + f.x, 0) / n,
      y: this.rawBuffer.reduce((s, f) => s + f.y, 0) / n,
      timestampMs: this.rawBuffer[n - 1].timestampMs,
    };
  }

  private finalize(): void {
    const backswingMs = this.peakTimestampMs - this.backswingStartMs;
    const downswingMs = this.impactTimestampMs - this.peakTimestampMs;

    if (backswingMs <= 0 || downswingMs <= 0) return;

    const ratio = backswingMs / downswingMs;

    let quality: SwingResult['quality'];
    let feedback: string;

    if (ratio >= GOOD_LOW && ratio <= GOOD_HIGH) {
      quality = 'good';
      feedback = `Great tempo! ${ratio.toFixed(1)} to 1 — right in the Jake Knapp zone.`;
    } else if (ratio < TOO_FAST_THRESHOLD) {
      quality = 'too_fast';
      feedback = `Too quick! ${ratio.toFixed(1)} to 1 — pause longer at the top.`;
    } else if (ratio < GOOD_LOW) {
      quality = 'too_fast';
      feedback = `A bit rushed. ${ratio.toFixed(1)} to 1 — slow the backswing slightly.`;
    } else if (ratio > TOO_SLOW_THRESHOLD) {
      quality = 'too_slow';
      feedback = `Too slow! ${ratio.toFixed(1)} to 1 — try a more decisive downswing.`;
    } else {
      // between GOOD_HIGH and TOO_SLOW_THRESHOLD
      quality = 'too_slow';
      feedback = `Slightly slow. ${ratio.toFixed(1)} to 1 — keep accelerating through impact.`;
    }

    this.result = { ratio, backswingMs, downswingMs, quality, feedback };
  }
}
