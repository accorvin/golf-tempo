/**
 * SwingCamera.tsx
 *
 * Full-screen camera UI:
 *   - Live MediaPipe pose landmark overlay (wrists, shoulders, hips)
 *   - Swing phase indicator
 *   - Post-swing ratio + feedback card
 *   - Voice feedback via expo-speech
 *
 * Setup: prop phone up facing you from the front (tripod or propped against
 * your bag). Stand ~6-8 feet back so your full torso is visible.
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import * as Speech from 'expo-speech';
import { usePoseDetector } from '../hooks/usePoseDetector';
import { SwingPhase } from '../tempo/SwingDetector';

const { width: W, height: H } = Dimensions.get('window');

// ── Phase display config ─────────────────────────────────────────────────────

const PHASE_CONFIG: Record<SwingPhase, { label: string; color: string; emoji: string }> = {
  IDLE:      { label: 'Address',    color: '#555',    emoji: '🏌️' },
  BACKSWING: { label: 'Backswing',  color: '#F59E0B', emoji: '↗️' },
  DOWNSWING: { label: 'Downswing',  color: '#EF4444', emoji: '⚡' },
  COMPLETE:  { label: 'Complete',   color: '#10B981', emoji: '✅' },
};

const QUALITY_CONFIG = {
  good:      { color: '#10B981', emoji: '🎯', label: 'GREAT TEMPO' },
  too_fast:  { color: '#EF4444', emoji: '⚡', label: 'TOO FAST' },
  too_slow:  { color: '#F59E0B', emoji: '🐢', label: 'TOO SLOW' },
};

// ── Dot overlay ──────────────────────────────────────────────────────────────

interface DotProps {
  pos: { x: number; y: number } | null;
  color: string;
  size?: number;
}

function LandmarkDot({ pos, color, size = 14 }: DotProps) {
  if (!pos) return null;
  return (
    <View
      style={[
        styles.dot,
        {
          left:  pos.x * W - size / 2,
          top:   pos.y * H - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
      ]}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SwingCamera() {
  const { hasPermission, requestPermission } = useCameraPermission();
  // Front camera: camera faces golfer, backswing goes left in frame
  const device = useCameraDevice('front');

  const {
    phase,
    lastResult,
    landmarks,
    frameProcessor,
    cameraViewLayoutChangeHandler,
    reset,
  } = usePoseDetector();

  const spokenRef = useRef(false);
  const phaseConfig = PHASE_CONFIG[phase];

  // Speak feedback after each completed swing
  useEffect(() => {
    if (phase === 'COMPLETE' && lastResult && !spokenRef.current) {
      spokenRef.current = true;
      Speech.speak(lastResult.feedback, {
        rate:   0.88,
        pitch:  1.0,
      });
    }
    if (phase === 'IDLE') {
      spokenRef.current = false;
      Speech.stop();
    }
  }, [phase, lastResult]);

  // ── Permission gate ────────────────────────────────────────────────────────

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.gate}>
        <Text style={styles.gateTitle}>Camera Access Needed</Text>
        <Text style={styles.gateBody}>
          Golf Tempo needs your camera to analyze your swing in real time.
        </Text>
        <TouchableOpacity style={styles.gateBtn} onPress={requestPermission}>
          <Text style={styles.gateBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView style={styles.gate}>
        <Text style={styles.gateTitle}>No Camera Found</Text>
        <Text style={styles.gateBody}>A front-facing camera is required.</Text>
      </SafeAreaView>
    );
  }

  // ── Camera + overlay ───────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* Live camera feed */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
        onLayout={cameraViewLayoutChangeHandler}
      />

      {/* Landmark skeleton overlay */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Wrists — bright green */}
        <LandmarkDot pos={landmarks.leftWrist}  color="#22C55E" size={18} />
        <LandmarkDot pos={landmarks.rightWrist} color="#22C55E" size={18} />
        {/* Shoulders — blue */}
        <LandmarkDot pos={landmarks.leftShoulder}  color="#3B82F6" />
        <LandmarkDot pos={landmarks.rightShoulder} color="#3B82F6" />
        {/* Hips — purple */}
        <LandmarkDot pos={landmarks.leftHip}  color="#A855F7" size={10} />
        <LandmarkDot pos={landmarks.rightHip} color="#A855F7" size={10} />
      </View>

      {/* Phase chip — top center */}
      <SafeAreaView style={styles.phaseRow} pointerEvents="none">
        <View style={[styles.phaseChip, { backgroundColor: phaseConfig.color + 'CC' }]}>
          <Text style={styles.phaseEmoji}>{phaseConfig.emoji}</Text>
          <Text style={styles.phaseLabel}>{phaseConfig.label}</Text>
        </View>
      </SafeAreaView>

      {/* Result card — shown for 3.5s after each swing */}
      {phase === 'COMPLETE' && lastResult && (() => {
        const q = QUALITY_CONFIG[lastResult.quality];
        return (
          <View style={styles.resultCard}>
            <Text style={styles.resultRatio}>{lastResult.ratio.toFixed(2)}:1</Text>
            <Text style={[styles.resultQuality, { color: q.color }]}>
              {q.emoji}  {q.label}
            </Text>
            <Text style={styles.resultFeedback}>{lastResult.feedback}</Text>
            <View style={styles.resultTimingRow}>
              <View style={styles.timingBlock}>
                <Text style={styles.timingValue}>{lastResult.backswingMs}ms</Text>
                <Text style={styles.timingLabel}>Backswing</Text>
              </View>
              <View style={styles.timingDivider} />
              <View style={styles.timingBlock}>
                <Text style={styles.timingValue}>{lastResult.downswingMs}ms</Text>
                <Text style={styles.timingLabel}>Downswing</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.resetBtn} onPress={reset}>
              <Text style={styles.resetBtnText}>Next Swing</Text>
            </TouchableOpacity>
          </View>
        );
      })()}

      {/* Setup hint — shown only when idle and no landmarks detected */}
      {phase === 'IDLE' && !landmarks.leftWrist && (
        <View style={styles.hintBar} pointerEvents="none">
          <Text style={styles.hintText}>
            Stand 6–8 ft away · Face the camera · Full torso visible
          </Text>
        </View>
      )}

      {/* Ready indicator — landmarks detected, waiting for swing */}
      {phase === 'IDLE' && landmarks.leftWrist && (
        <View style={styles.readyBar} pointerEvents="none">
          <Text style={styles.readyText}>Swing when ready</Text>
        </View>
      )}

    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  gate: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  gateTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  gateBody: {
    color: '#aaa',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  gateBtn: {
    backgroundColor: '#22C55E',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  gateBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  dot: {
    position: 'absolute',
    opacity: 0.88,
  },
  phaseRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  phaseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 24,
  },
  phaseEmoji: {
    fontSize: 18,
  },
  phaseLabel: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  resultCard: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.88)',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  resultRatio: {
    color: '#fff',
    fontSize: 58,
    fontWeight: '800',
    letterSpacing: -1,
    lineHeight: 64,
  },
  resultQuality: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 10,
  },
  resultFeedback: {
    color: '#ccc',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  resultTimingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  timingBlock: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  timingValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  timingLabel: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  timingDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#444',
  },
  resetBtn: {
    backgroundColor: '#22C55E',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
  },
  resetBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  hintBar: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    textAlign: 'center',
  },
  readyBar: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  readyText: {
    color: '#22C55E',
    fontSize: 16,
    fontWeight: '600',
  },
});
