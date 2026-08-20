import { render, screen, waitFor } from '@testing-library/react';
import { ImagePreview } from '../image-preview';

describe('ImagePreview', () => {
  it('renders image with correct src', () => {
    render(<ImagePreview assetId="test-123" name="Test Image" />);

    const img = screen.getByAltText('Test Image');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/api/assets/test-123/stream');
  });

  it('shows loading state initially', () => {
    render(<ImagePreview assetId="test-123" name="Test Image" />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows error state when image fails to load', async () => {
    render(<ImagePreview assetId="invalid" name="Test Image" />);

    const img = screen.getByAltText('Test Image');

    // Simulate image load error
    img.dispatchEvent(new Event('error'));

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    });
  });
});
