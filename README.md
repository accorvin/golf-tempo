# ⛳ Golf Tempo

Real-time golf swing tempo analyzer using MediaPipe pose detection.

Film your swing → get instant feedback on your backswing:downswing ratio → improve your timing.

## What Is Tempo?

Tour professionals overwhelmingly swing with a **3:1 ratio**: the backswing takes 3× as long as the downswing. A fast pro swing is ~750ms back and ~250ms down. A slower swing might be 900ms/300ms — still 3:1.

**Jake Knapp** (PGA Tour) went viral for having arguably the *best* tempo on tour. His long backswing and smooth acceleration through the ball is the gold standard this app targets.

Getting the ratio right — not swinging harder — is what creates effortless power.

## The App

- 📱 **Live camera** — point your phone at the golfer (side view works best)
- 🦴 **Pose detection** — MediaPipe BlazePose tracks your wrists and shoulders in real time
- ⏱️ **Phase detection** — automatically finds: Address → Backswing → Top → Downswing → Impact
- 📊 **Instant feedback** — ratio displayed and *spoken aloud* after every swing
- 🎯 **Target: 3:1** — green = good, red = too fast, orange = too slow

## Architecture

```
App.tsx
└── SwingCamera.tsx          ← Camera UI + landmark overlay + result display
    └── usePoseDetector.ts   ← React hook bridging camera frames → SwingDetector
        └── SwingDetector.ts ← Pure TS algorithm, zero native deps, fully testable
```

The key design decision: **SwingDetector.ts is pure TypeScript** — no React Native, no MediaPipe, no camera. It just takes pose frames in and emits swing results. This means:
- Full test coverage with Jest, no device needed
- Easy to iterate on the algorithm without rebuilding
- CI runs on every push

## Setup

```bash
# Prerequisites: Node 20+, Expo CLI, Xcode (iOS) or Android Studio

git clone https://github.com/accorvin/golf-tempo.git
cd golf-tempo
npm install
npx expo run:ios   # or run:android
```

## Running Tests

```bash
npm test           # run once
npm run test:watch # watch mode for development
```

Tests cover:
- Perfect 3:1 swing detection
- Too fast / too slow classification
- Noisy frame robustness
- Incomplete swing handling
- Multi-swing reset behavior

## How It Works

1. **Frame input** — Vision Camera feeds ~60fps frames to the MediaPipe pose detector
2. **Landmark extraction** — Left wrist position (landmark #15) is the primary tracking point
3. **Smoothing** — 3-frame rolling average reduces sensor noise
4. **Phase detection** — velocity-based: movement → near-zero (top) → movement back
5. **Ratio calc** — `backswingMs / downswingMs`, compared to 3.0 ± 0.3 target band
6. **Feedback** — result spoken via on-device TTS (AVSpeechSynthesizer, no API key needed)

## Target Model: Jake Knapp

| Metric | Jake Knapp | Target Band |
|--------|-----------|-------------|
| Clubhead speed | 127+ MPH | — |
| Ball speed | 190+ MPH | — |
| Backswing | ~750ms | 700–900ms |
| Downswing | ~250ms | 230–300ms |
| **Ratio** | **~3:1** | **2.7–3.3** |

## Contributing

PRs welcome. The algorithm lives in `src/tempo/SwingDetector.ts` — write a failing test first, then fix it.

## License

MIT
