module.exports = {
  Camera: 'Camera',
  useCameraDevice: jest.fn(() => ({ id: 'mock-camera' })),
  useCameraPermission: jest.fn(() => ({ hasPermission: true, requestPermission: jest.fn() })),
};
