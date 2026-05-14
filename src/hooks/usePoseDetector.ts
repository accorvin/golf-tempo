/**
 * usePoseDetector.ts
 *
 * React hook that wires MediaPipe pose detection to SwingDetector.
 * Processes camera frames in real-time and tracks swing phase + result.
 */

import { useRef, useState, useCallback } from 'react';
import { SwingDetector, SwingPhase, SwingResult, PoseFrame } from '../tempo/SwingDetector';

export interface PoseDetectorState {
  phase: SwingPhase;
  lastResult: SwingResult | null;
  /** Raw wrist/shoulder landmark positions for overlay rendering */
  landmarks: {
    leftWrist: { x: number; y: number } | null;
    rightWrist: { x: number; y: number } | null;
    leftShoulder: { x: number; y: number } | null;
    rightShoulder: { x: number; y: number } | null;
  };
}

export function usePoseDetector() {
  const detectorRef = useRef(new SwingDetector());
  const [state, setState] = useState<PoseDetectorState>({
    phase: 'IDLE',
    lastResult: null,
    landmarks: {
      leftWrist: null,
      rightWrist: null,
      leftShoulder: null,
      rightShoulder: null,
    },
  });

  /**
   * Call this from the Vision Camera frame processor with each pose result.
   * The frame processor runs on a worklet thread — state updates are batched
   * back to the JS thread via setState.
   */
  const onPoseDetected = useCallback((frame: PoseFrame) => {
    const detector = detectorRef.current;
    const phase = detector.processFrame(frame);

    const lm = frame.landmarks;
    const landmarks = {
      leftWrist: lm[15] ? { x: lm[15].x, y: lm[15].y } : null,
      rightWrist: lm[16] ? { x: lm[16].x, y: lm[16].y } : null,
      leftShoulder: lm[11] ? { x: lm[11].x, y: lm[11].y } : null,
      rightShoulder: lm[12] ? { x: lm[12].x, y: lm[12].y } : null,
    };

    if (phase === 'COMPLETE') {
      const result = detector.getResult();
      setState({ phase, lastResult: result, landmarks });
      // Auto-reset after 3.5 seconds to allow follow-through display
      setTimeout(() => {
        detector.reset();
        setState(prev => ({ ...prev, phase: 'IDLE' }));
      }, 3500);
    } else {
      setState(prev => ({
        ...prev,
        phase,
        landmarks,
      }));
    }
  }, []);

  const reset = useCallback(() => {
    detectorRef.current.reset();
    setState({
      phase: 'IDLE',
      lastResult: null,
      landmarks: {
        leftWrist: null,
        rightWrist: null,
        leftShoulder: null,
        rightShoulder: null,
      },
    });
  }, []);

  return { ...state, onPoseDetected, reset };
}
