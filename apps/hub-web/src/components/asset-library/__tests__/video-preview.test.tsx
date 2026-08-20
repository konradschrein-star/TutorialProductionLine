import { render, screen, waitFor } from '@testing-library/react';
import { VideoPreview } from '../video-preview';

describe('VideoPreview', () => {
  it('renders video element with correct src', () => {
    render(<VideoPreview assetId="test-video-123" name="Test Video" />);

    const video = screen.getByTestId('video-player');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('src', '/api/assets/test-video-123/stream');
  });

  it('has native controls enabled', () => {
    render(<VideoPreview assetId="test-video-123" name="Test Video" />);

    const video = screen.getByTestId('video-player');
    expect(video).toHaveAttribute('controls');
  });

  it('shows error state when video fails to load', async () => {
    render(<VideoPreview assetId="invalid" name="Test Video" />);

    const video = screen.getByTestId('video-player');

    // Simulate video load error
    video.dispatchEvent(new Event('error'));

    await waitFor(() => {
      expect(screen.getByText(/failed to load video/i)).toBeInTheDocument();
    });
  });
});
