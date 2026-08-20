import { render, screen, waitFor } from '@testing-library/react';
import { AudioPreview } from '../audio-preview';

describe('AudioPreview', () => {
  it('renders audio element with correct src', () => {
    render(<AudioPreview assetId="test-audio-123" name="Test Audio" waveformData={[]} />);

    const audio = screen.getByTestId('audio-player');
    expect(audio).toBeInTheDocument();
    expect(audio).toHaveAttribute('src', '/api/assets/test-audio-123/stream');
  });

  it('renders waveform when data is provided', () => {
    const waveformData = [0.1, 0.5, 0.8, 0.3, 0.6];
    render(<AudioPreview assetId="test-audio-123" name="Test Audio" waveformData={waveformData} />);

    // AudioWaveform component should be rendered
    expect(screen.getByTestId('audio-waveform')).toBeInTheDocument();
  });

  it('shows error state when audio fails to load', async () => {
    render(<AudioPreview assetId="invalid" name="Test Audio" waveformData={[]} />);

    const audio = screen.getByTestId('audio-player');

    // Simulate audio load error
    audio.dispatchEvent(new Event('error'));

    await waitFor(() => {
      expect(screen.getByText(/failed to load audio/i)).toBeInTheDocument();
    });
  });
});
