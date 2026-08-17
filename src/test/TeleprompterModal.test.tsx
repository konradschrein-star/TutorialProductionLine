import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TeleprompterModal } from '../components/TeleprompterModal';

describe('TeleprompterModal Component Tests', () => {
  it('renders script when open', () => {
    const handleClose = vi.fn();
    render(<TeleprompterModal script="Step 1: Click on settings." isOpen={true} onClose={handleClose} />);

    expect(screen.getByText('TELEPROMPTER PRO')).toBeInTheDocument();
    expect(screen.getByText('Step 1: Click on settings.')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    const handleClose = vi.fn();
    render(<TeleprompterModal script="Step 1: Click on settings." isOpen={false} onClose={handleClose} />);

    expect(screen.queryByText('TELEPROMPTER PRO')).not.toBeInTheDocument();
  });
});
