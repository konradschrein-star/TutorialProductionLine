import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { MediaPreviewModal } from '../media-preview-modal';
import type { AssetCardAsset } from '../asset-card';

// Mock the preview components
vi.mock('../video-preview', () => ({
  VideoPreview: ({ assetId, name }: { assetId: string; name: string }) => (
    <div data-testid="video-preview">
      VideoPreview: {assetId} - {name}
    </div>
  ),
}));

vi.mock('../audio-preview', () => ({
  AudioPreview: ({
    assetId,
    name,
    waveformData,
  }: {
    assetId: string;
    name: string;
    waveformData?: number[];
  }) => (
    <div data-testid="audio-preview">
      AudioPreview: {assetId} - {name} - {waveformData?.length ?? 0} samples
    </div>
  ),
}));

vi.mock('../image-preview', () => ({
  ImagePreview: ({ assetId, name }: { assetId: string; name: string }) => (
    <div data-testid="image-preview">
      ImagePreview: {assetId} - {name}
    </div>
  ),
}));

const mockVideoAsset: AssetCardAsset = {
  id: 'video-123',
  name: 'Test Video',
  description: 'A test video asset',
  asset_type: 'video/raw-va-footage',
  origin: 'real_footage',
  status: 'approved',
  file_format: 'mp4',
  tags: ['test'],
  quality_rating: 4,
  archetype_id: null,
  character_id: null,
  size_bytes: 5242880,
  created_at: '2026-04-17T10:00:00Z',
  file_path: '/test/video.mp4',
  thumbnail_path: null,
  waveform_data: null,
  duration_seconds: 60,
};

const mockAudioAsset: AssetCardAsset = {
  id: 'audio-456',
  name: 'Test Audio',
  description: 'A test audio asset',
  asset_type: 'audio/tts',
  origin: 'ai_generated',
  status: 'approved',
  file_format: 'mp3',
  tags: ['tts'],
  quality_rating: 5,
  archetype_id: null,
  character_id: null,
  size_bytes: 1048576,
  created_at: '2026-04-17T11:00:00Z',
  file_path: '/test/audio.mp3',
  thumbnail_path: null,
  waveform_data: [0.5, 0.7, 0.3, 0.9],
  duration_seconds: 30,
};

const mockImageAsset: AssetCardAsset = {
  id: 'image-789',
  name: 'Test Image',
  description: 'A test image asset',
  asset_type: 'image/thumbnail',
  origin: 'ai_generated',
  status: 'draft',
  file_format: 'png',
  tags: ['thumbnail'],
  quality_rating: null,
  archetype_id: null,
  character_id: null,
  size_bytes: 204800,
  created_at: '2026-04-17T12:00:00Z',
  file_path: '/test/image.png',
  thumbnail_path: null,
  waveform_data: null,
  duration_seconds: null,
};

describe('MediaPreviewModal', () => {
  const mockOnClose = vi.fn();
  const mockOnEdit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic rendering', () => {
    it('does not render when asset is null', () => {
      const { container } = render(
        <MediaPreviewModal asset={null} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders modal when asset is provided', () => {
      render(
        <MediaPreviewModal asset={mockVideoAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders with correct aria-label', () => {
      render(
        <MediaPreviewModal asset={mockVideoAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-label', 'Media Preview');
    });
  });

  describe('Preview routing', () => {
    it('renders VideoPreview for video asset type', () => {
      render(
        <MediaPreviewModal asset={mockVideoAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.getByTestId('video-preview')).toBeInTheDocument();
      expect(screen.getByTestId('video-preview')).toHaveTextContent('video-123');
      expect(screen.getByTestId('video-preview')).toHaveTextContent('Test Video');
    });

    it('renders AudioPreview for audio asset type', () => {
      render(
        <MediaPreviewModal asset={mockAudioAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.getByTestId('audio-preview')).toBeInTheDocument();
      expect(screen.getByTestId('audio-preview')).toHaveTextContent('audio-456');
      expect(screen.getByTestId('audio-preview')).toHaveTextContent('Test Audio');
      expect(screen.getByTestId('audio-preview')).toHaveTextContent('4 samples');
    });

    it('renders ImagePreview for image asset type', () => {
      render(
        <MediaPreviewModal asset={mockImageAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.getByTestId('image-preview')).toBeInTheDocument();
      expect(screen.getByTestId('image-preview')).toHaveTextContent('image-789');
      expect(screen.getByTestId('image-preview')).toHaveTextContent('Test Image');
    });
  });

  describe('Metadata panel', () => {
    it('displays asset name', () => {
      render(
        <MediaPreviewModal asset={mockVideoAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.getByText('Test Video')).toBeInTheDocument();
    });

    it('displays file format', () => {
      render(
        <MediaPreviewModal asset={mockVideoAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.getByText(/mp4/i)).toBeInTheDocument();
    });

    it('displays file size in human-readable format', () => {
      render(
        <MediaPreviewModal asset={mockVideoAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.getByText(/5\.00 MB/i)).toBeInTheDocument();
    });

    it('displays duration for video assets', () => {
      render(
        <MediaPreviewModal asset={mockVideoAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.getByText(/1:00/i)).toBeInTheDocument();
    });

    it('displays duration for audio assets', () => {
      render(
        <MediaPreviewModal asset={mockAudioAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.getByText(/0:30/i)).toBeInTheDocument();
    });

    it('does not display duration for image assets', () => {
      render(
        <MediaPreviewModal asset={mockImageAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.queryByText(/duration/i)).not.toBeInTheDocument();
    });

    it('displays creation date', () => {
      render(
        <MediaPreviewModal asset={mockVideoAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.getByText(/apr 17, 2026/i)).toBeInTheDocument();
    });
  });

  describe('Interactions', () => {
    it('closes modal when X button is clicked', () => {
      render(
        <MediaPreviewModal asset={mockVideoAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      const closeButton = screen.getByLabelText('Close');
      fireEvent.click(closeButton);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('closes modal when backdrop is clicked', () => {
      render(
        <MediaPreviewModal asset={mockVideoAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      const backdrop = screen.getByTestId('modal-backdrop');
      fireEvent.click(backdrop);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('closes modal when Escape key is pressed', async () => {
      render(
        <MediaPreviewModal asset={mockVideoAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalledTimes(1);
      });
    });

    it('does not close on Escape when modal is not open', () => {
      render(
        <MediaPreviewModal asset={null} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('calls onEdit when Edit button is clicked', () => {
      render(
        <MediaPreviewModal asset={mockVideoAsset} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      const editButton = screen.getByRole('button', { name: /edit/i });
      fireEvent.click(editButton);
      expect(mockOnEdit).toHaveBeenCalledTimes(1);
      expect(mockOnEdit).toHaveBeenCalledWith(mockVideoAsset);
    });
  });

  describe('Edge cases', () => {
    it('handles missing size_bytes gracefully', () => {
      const assetWithoutSize = { ...mockVideoAsset, size_bytes: null };
      render(
        <MediaPreviewModal asset={assetWithoutSize} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.getByText(/unknown/i)).toBeInTheDocument();
    });

    it('handles missing duration_seconds gracefully', () => {
      const assetWithoutDuration = { ...mockVideoAsset, duration_seconds: null };
      render(
        <MediaPreviewModal asset={assetWithoutDuration} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.queryByText(/duration/i)).not.toBeInTheDocument();
    });

    it('handles missing waveform_data for audio', () => {
      const audioWithoutWaveform = { ...mockAudioAsset, waveform_data: null };
      render(
        <MediaPreviewModal asset={audioWithoutWaveform} onClose={mockOnClose} onEdit={mockOnEdit} />
      );
      expect(screen.getByTestId('audio-preview')).toHaveTextContent('0 samples');
    });
  });
});
