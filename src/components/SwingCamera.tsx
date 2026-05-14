/**
 * SwingCamera.tsx
 *
 * Full-screen camera component with:
 * - Live MediaPipe pose landmark overlay (wrists + shoulders)
 * - Swing phase indicator
 * - Post-swing ratio + feedback display
 * - Voice feedback via expo-speech
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import * as Speech from 'expo-speech';
import { usePoseDetector } from '../hooks/usePoseDetector';
import { PoseFrame } from '../tempo/SwingDetector';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const PHASE_COLORS: Record<string, string> = {
  IDLE: '#888888',
  BACKSWING: '#4CAF50',
  TRANSITION: '#FF9800',
  DOWNSWING: '#F44336',
  COMPLETE: '#2196F3',
};

const PHASE_LABELS: Record<string, string> = {
  IDLE: 'Address',
  BACKSWING: '↗ Backswing',
  TRANSITION: '⏸ Top',
  DOWNSWING: '↙ Downswing',
  COMPLETE: '✓ Complete',
};

export function SwingCamera() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const { phase, lastResult, landmarks, onPoseDetected } = usePoseDetector();
  const spokenRef = useRef(false);

  // Speak feedback when a swing completes
  useEffect(() => {
    if (phase === 'COMPLETE' && lastResult && !spokenRef.current) {
      spokenRef.current = true;
      Speech.speak(lastResult.feedback, { rate: 0.9 });
    }
    if (phase === 'IDLE') {
      spokenRef.current = false;
    }
  }, [phase, lastResult]);

  if (!hasPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionText}>Camera permission required</Text>
        <Text style={styles.permissionButton} onPress={requestPermission}>
          Grant Permission
        </Text>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionText}>No camera found</Text>
      </View>
    );
  }

  // Render a dot for a landmark position (normalized 0–1 coords → screen coords)
  const renderDot = (pos: { x: number; y: number } | null, color: string, key: string) => {
    if (!pos) return null;
    return (
      <View
        key={key}
        style={[
          styles.dot,
          {
            left: pos.x * SCREEN_W - 8,
            top: pos.y * SCREEN_H - 8,
            backgroundColor: color,
          },
        ]}
      />
    );
  };

  return (
    <View style={styles.container}>
      {/* Camera feed */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        // Frame processor would be wired here in production with
        // react-native-mediapipe-posedetection's usePoseDetection hook
      />

      {/* Landmark overlay */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {renderDot(landmarks.leftWrist, '#00FF00', 'lw')}
        {renderDot(landmarks.rightWrist, '#00FF00', 'rw')}
        {renderDot(landmarks.leftShoulder, '#00BFFF', 'ls')}
        {renderDot(landmarks.rightShoulder, '#00BFFF', 'rs')}
      </View>

      {/* Phase indicator */}
      <View style={[styles.phaseChip, { backgroundColor: PHASE_COLORS[phase] ?? '#888' }]}>
        <Text style={styles.phaseText}>{PHASE_LABELS[phase] ?? phase}</Text>
      </View>

      {/* Result overlay */}
      {phase === 'COMPLETE' && lastResult && (
        <View style={styles.resultCard}>
          <Text style={styles.ratioText}>{lastResult.ratio.toFixed(2)}:1</Text>
          <Text style={styles.qualityText}>
            {lastResult.quality === 'good' ? '✅' : '⚠️'} {lastResult.quality.replace('_', ' ').toUpperCase()}
          </Text>
          <Text style={styles.feedbackText}>{lastResult.feedback}</Text>
          <Text style={styles.timingText}>
            Back {lastResult.backswingMs}ms · Down {lastResult.downswingMs}ms
          </Text>
        </View>
      )}

      {/* Instructions when idle */}
      {phase === 'IDLE' && (
        <View style={styles.instructionBar}>
          <Text style={styles.instructionText}>Address the ball and take your swing</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  permissionText: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 16,
  },
  permissionButton: {
    color: '#4CAF50',
    fontSize: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderRadius: 8,
  },
  dot: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    opacity: 0.85,
  },
  phaseChip: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    opacity: 0.9,
  },
  phaseText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  resultCard: {
    position: 'absolute',
    bottom: 80,
    left: 24,
    right: 24,
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  ratioText: {
    color: '#fff',
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -1,
  },
  qualityText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginTop: 4,
  },
  feedbackText: {
    color: '#ccc',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
  timingText: {
    color: '#888',
    fontSize: 13,
    marginTop: 10,
  },
  instructionBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  instructionText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 15,
  },
});
