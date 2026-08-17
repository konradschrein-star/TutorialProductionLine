import '@testing-library/jest-dom';

// Mock Web Audio API for JSDOM
if (typeof window !== 'undefined') {
  window.AudioContext = class {
    createMediaStreamDestination() {
      return { stream: { getAudioTracks: () => [] } };
    }
    createMediaStreamSource() {
      return { connect: () => {} };
    }
  } as any;
}
