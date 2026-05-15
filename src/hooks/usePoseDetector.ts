/**
 * usePoseDetector.ts
 *
 * Wires react-native-mediapipe-posedetection into SwingDetector.
 * Returns camera props + live swing state for SwingCamera to render.
 *
 * CAMERA: Front-facing camera, right-handed golfer (backswing goes left).
 */

import { useRef, useState, useCallback } from 'react';
import {
  usePoseDetection,
  RunningMode,
  Delegate,
} from 'react-native-mediapipe-posedetection';
import { SwingDetector, SwingPhase, SwingResult, PoseFrame } from '../tempo/SwingDetector';

// Model bundled in assets/models/ via app.json plugin config
const MODEL_FILE = 'pose_landmarker_lite.task';

export interface PoseLandmark2D {
  x: number;
  y: number;
}

export interface PoseDetectorState {
  phase: SwingPhase;
  lastResult: SwingResult | null;
  landmarks: {
    leftWrist:     PoseLandmark2D | null;
    rightWrist:    PoseLandmark2D | null;
    leftShoulder:  PoseLandmark2D | null;
    rightShoulder: PoseLandmark2D | null;
    leftHip:       PoseLandmark2D | null;
    rightHip:      PoseLandmark2D | null;
  };
}

const EMPTY_LANDMARKS: PoseDetectorState['landmarks'] = {
  leftWrist: null, rightWrist: null,
  leftShoulder: null, rightShoulder: null,
  leftHip: null, rightHip: null,
};

export function usePoseDetector() {
  const detectorRef = useRef(new SwingDetector());
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useState<PoseDetectorState>({
    phase: 'IDLE',
    lastResult: null,
    landmarks: EMPTY_LANDMARKS,
  });

  const poseDetection = usePoseDetection(
    {
      onResults: useCallback((result: any) => {
        // result.landmarks is an array of poses; each pose is an array of 33 landmarks
        // We only care about the first detected person
        const poseLandmarks: Array<{ x: number; y: number; z: number; visibility: number }> =
          result?.landmarks?.[0] ?? [];

        if (poseLandmarks.length < 33) return;

        // Build a PoseFrame for SwingDetector
        const frame: PoseFrame = {
          timestampMs: result.timestampMs ?? Date.now(),
          landmarks: poseLandmarks.map((lm: any) => ({
            x: lm.x,
            y: lm.y,
            z: lm.z ?? 0,
            visibility: lm.visibility ?? 0.9,
          })),
        };

        const detector = detectorRef.current;
        const phase = detector.processFrame(frame);

        // Extract key landmarks for overlay rendering
        const lm = poseLandmarks;
        const landmarks: PoseDetectorState['landmarks'] = {
          leftWrist:     lm[15] ? { x: lm[15].x, y: lm[15].y } : null,
          rightWrist:    lm[16] ? { x: lm[16].x, y: lm[16].y } : null,
          leftShoulder:  lm[11] ? { x: lm[11].x, y: lm[11].y } : null,
          rightShoulder: lm[12] ? { x: lm[12].x, y: lm[12].y } : null,
          leftHip:       lm[23] ? { x: lm[23].x, y: lm[23].y } : null,
          rightHip:      lm[24] ? { x: lm[24].x, y: lm[24].y } : null,
        };

        if (phase === 'COMPLETE') {
          const swingResult = detector.getResult();
          setState({ phase, lastResult: swingResult, landmarks });

          // Auto-reset after 3.5s to show result then accept next swing
          if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
          resetTimerRef.current = setTimeout(() => {
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
      }, []),

      onError: useCallback((error: any) => {
        console.error('[PoseDetector] MediaPipe error:', error?.message ?? error);
      }, []),
    },
    RunningMode.LIVE_STREAM,
    MODEL_FILE,
    {
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      delegate: Delegate.GPU,
    },
  );

  const reset = useCallback(() => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    detectorRef.current.reset();
    setState({ phase: 'IDLE', lastResult: null, landmarks: EMPTY_LANDMARKS });
  }, []);

  return {
    ...state,
    // Pass these to the <Camera> component
    frameProcessor: poseDetection.frameProcessor,
    cameraViewLayoutChangeHandler: poseDetection.cameraViewLayoutChangeHandler,
    reset,
  };
}
