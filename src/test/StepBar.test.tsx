import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StepBar } from '../components/StepBar';

describe('StepBar Component Tests', () => {
  it('renders all 5 steps', () => {
    const handleClick = vi.fn();
    render(<StepBar activeStep={1} highestStep={3} onStepClick={handleClick} />);

    expect(screen.getByText('Topic & Idea')).toBeInTheDocument();
    expect(screen.getByText('Scriptwriting')).toBeInTheDocument();
    expect(screen.getByText('Voiceover')).toBeInTheDocument();
    expect(screen.getByText('Video Attachment')).toBeInTheDocument();
    expect(screen.getByText('Review & Queue')).toBeInTheDocument();
  });

  it('triggers step click for unlocked steps', () => {
    const handleClick = vi.fn();
    render(<StepBar activeStep={1} highestStep={3} onStepClick={handleClick} />);

    const step2Btn = screen.getByText('Scriptwriting').closest('button');
    if (step2Btn) fireEvent.click(step2Btn);

    expect(handleClick).toHaveBeenCalledWith(2);
  });
});
