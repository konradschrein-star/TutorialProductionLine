import React from 'react';
import { Check } from 'lucide-react';

interface Step {
  num: number;
  label: string;
  desc: string;
}

const STEPS: Step[] = [
  { num: 1, label: 'Topic & Idea', desc: 'Claimed SEO keywords' },
  { num: 2, label: 'Scriptwriting', desc: 'High-retention structure' },
  { num: 3, label: 'Voiceover', desc: 'Neural TTS synthesis' },
  { num: 4, label: 'Video Attachment', desc: 'Screen recording' },
  { num: 5, label: 'Review & Queue', desc: 'Stealth dispatch' },
];

interface StepBarProps {
  activeStep: number;
  highestStep: number;
  onStepClick: (step: number) => void;
}

export const StepBar: React.FC<StepBarProps> = ({
  activeStep,
  highestStep,
  onStepClick,
}) => {
  return (
    <div className="w-full bg-surface-100 p-2 rounded-xl border border-border">
      <div className="flex items-center justify-between gap-1 overflow-x-auto">
        {STEPS.map((step, idx) => {
          const isCurrent = step.num === activeStep;
          const isDone = step.num < activeStep;
          const isUnlocked = step.num <= highestStep;

          return (
            <React.Fragment key={step.num}>
              <button
                type="button"
                disabled={!isUnlocked}
                onClick={() => onStepClick(step.num)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all flex-shrink-0 ${
                  isCurrent
                    ? 'bg-surface-300 text-foreground font-bold border border-border-strong'
                    : isDone
                    ? 'bg-surface-200/50 text-foreground hover:bg-surface-200'
                    : isUnlocked
                    ? 'text-muted hover:text-foreground hover:bg-surface-200/30'
                    : 'text-muted/40 cursor-not-allowed opacity-50'
                }`}
              >
                {/* Step indicator */}
                <div
                  className={`w-5 h-5 rounded-md flex items-center justify-center font-mono text-[11px] font-bold ${
                    isCurrent
                      ? 'bg-foreground text-background'
                      : isDone
                      ? 'bg-foreground/15 text-foreground'
                      : 'bg-surface-300 text-muted'
                  }`}
                >
                  {isDone ? <Check className="w-3 h-3 stroke-[3]" /> : step.num}
                </div>

                {/* Step details */}
                <div className="hidden sm:block">
                  <div className="text-xs font-semibold leading-tight">
                    {step.label}
                  </div>
                  <div className="text-[10px] text-muted font-normal">
                    {step.desc}
                  </div>
                </div>
              </button>

              {idx < STEPS.length - 1 && (
                <div
                  className={`h-[1px] flex-1 min-w-4 max-w-8 ${
                    isDone ? 'bg-foreground/30' : 'bg-border'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
