module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/__mocks__/react-native.js',
    '^expo-speech$': '<rootDir>/__mocks__/expo-speech.js',
    '^react-native-vision-camera$': '<rootDir>/__mocks__/react-native-vision-camera.js',
    '^react-native-mediapipe-posedetection$': '<rootDir>/__mocks__/react-native-mediapipe-posedetection.js',
  },
};
