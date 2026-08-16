import React from 'react';
import { Check } from 'lucide-react';

interface Step {
  num: number;
  label: string;
  desc: string;
}

const STEPS: Step[] = [
  { num: 1, label: 'Topic & Idea', desc: 'Claimed SEO keywords' },
  { num: 2, label: 'AI Scriptwriter', desc: 'Spoken pacing & hook' },
  { num: 3, label: 'Voiceover Synthesis', desc: 'Real neural TTS' },
  { num: 4, label: 'Video Attachment', desc: 'Screen recording' },
  { num: 5, label: 'Review & Dispatch', desc: 'Stealth upload queue' },
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
    <div className="w-full bg-surface-100/80 backdrop-blur-md p-3 rounded-2xl border border-border">
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 sm:pb-0">
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
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left transition-all flex-shrink-0 ${
                  isCurrent
                    ? 'bg-gradient-to-r from-accent-purple to-accent-violet text-white shadow-glow'
                    : isDone
                    ? 'bg-accent-emerald/10 border border-accent-emerald/30 text-accent-emerald hover:bg-accent-emerald/20'
                    : isUnlocked
                    ? 'bg-white/5 text-slate-300 hover:bg-white/10'
                    : 'bg-white/[0.02] text-slate-500 cursor-not-allowed opacity-50'
                }`}
              >
                {/* Step circle */}
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
                    isCurrent
                      ? 'bg-white/20 text-white'
                      : isDone
                      ? 'bg-accent-emerald/20 text-accent-emerald'
                      : 'bg-white/5 text-slate-400'
                  }`}
                >
                  {isDone ? <Check className="w-4 h-4" /> : step.num}
                </div>

                {/* Step details */}
                <div className="hidden lg:block">
                  <div className="text-xs font-bold leading-tight">
                    {step.label}
                  </div>
                  <div className="text-[10px] opacity-75 font-normal">
                    {step.desc}
                  </div>
                </div>
              </button>

              {idx < STEPS.length - 1 && (
                <div
                  className={`h-0.5 w-6 rounded-full flex-shrink-0 ${
                    isDone ? 'bg-accent-emerald/40' : 'bg-white/10'
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
