import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, X, Type, FastForward, Minimize2, Maximize2 } from 'lucide-react';

interface TeleprompterModalProps {
  script: string;
  isOpen: boolean;
  onClose: () => void;
}

export const TeleprompterModal: React.FC<TeleprompterModalProps> = ({ script, isOpen, onClose }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(2); // 1 to 10
  const [fontSize, setFontSize] = useState(36); // px
  const [mirror, setMirror] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let animationFrameId: number;

    const scroll = () => {
      if (isPlaying && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop += scrollSpeed * 0.5;
        // Stop when reached end
        if (
          scrollContainerRef.current.scrollTop + scrollContainerRef.current.clientHeight >=
          scrollContainerRef.current.scrollHeight - 10
        ) {
          setIsPlaying(false);
        }
      }
      if (isPlaying) {
        animationFrameId = requestAnimationFrame(scroll);
      }
    };

    if (isPlaying) {
      animationFrameId = requestAnimationFrame(scroll);
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, scrollSpeed]);

  if (!isOpen) return null;

  const words = script.split(/\s+/).filter(Boolean);
  const estSeconds = Math.round(words.length / 2.5);

  const handleReset = () => {
    setIsPlaying(false);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex flex-col items-center justify-between p-4 sm:p-8 animate-fadeIn select-none">
      
      {/* Top Header Control Bar */}
      <div className="w-full max-w-5xl flex items-center justify-between bg-surface-100/90 border border-border p-3 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="font-mono text-xs font-bold text-foreground">TELEPROMPTER PRO</div>
          <span className="text-[11px] font-mono text-muted">
            {words.length} words (~{estSeconds}s)
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          
          {/* Font Size Adjust */}
          <div className="flex items-center gap-1 bg-surface-200 px-2 py-1 rounded-lg border border-border text-xs">
            <Type className="w-3.5 h-3.5 text-muted" />
            <button
              onClick={() => setFontSize(prev => Math.max(20, prev - 4))}
              className="px-1.5 py-0.5 rounded hover:bg-surface-300 font-bold"
            >
              -
            </button>
            <span className="font-mono text-[11px] px-1">{fontSize}px</span>
            <button
              onClick={() => setFontSize(prev => Math.min(64, prev + 4))}
              className="px-1.5 py-0.5 rounded hover:bg-surface-300 font-bold"
            >
              +
            </button>
          </div>

          {/* Speed Adjust */}
          <div className="flex items-center gap-1 bg-surface-200 px-2 py-1 rounded-lg border border-border text-xs">
            <FastForward className="w-3.5 h-3.5 text-muted" />
            <button
              onClick={() => setScrollSpeed(prev => Math.max(1, prev - 1))}
              className="px-1.5 py-0.5 rounded hover:bg-surface-300 font-bold"
            >
              -
            </button>
            <span className="font-mono text-[11px] px-1">Speed {scrollSpeed}</span>
            <button
              onClick={() => setScrollSpeed(prev => Math.min(10, prev + 1))}
              className="px-1.5 py-0.5 rounded hover:bg-surface-300 font-bold"
            >
              +
            </button>
          </div>

          {/* Mirror Toggle */}
          <button
            onClick={() => setMirror(!mirror)}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-colors ${
              mirror ? 'btn-solid' : 'btn-outline'
            }`}
          >
            Mirror {mirror ? 'ON' : 'OFF'}
          </button>

          {/* Close Button */}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-surface-200 hover:bg-surface-300 border border-border text-foreground"
          >
            <X className="w-4 h-4" />
          </button>

        </div>
      </div>

      {/* Prompter Scrolling Viewport */}
      <div
        ref={scrollContainerRef}
        className="w-full max-w-4xl flex-1 overflow-y-auto my-6 px-6 py-20 text-center font-sans tracking-wide leading-relaxed"
        style={{
          transform: mirror ? 'scaleX(-1)' : 'none',
          fontSize: `${fontSize}px`,
        }}
      >
        <div className="max-w-3xl mx-auto text-white font-medium whitespace-pre-line">
          {script}
        </div>
      </div>

      {/* Bottom Floating Play/Pause Controls */}
      <div className="flex items-center gap-3 bg-surface-100/90 border border-border px-6 py-3 rounded-2xl shadow-elevation">
        <button
          onClick={handleReset}
          className="btn-outline p-2.5 rounded-xl text-foreground"
          title="Reset to Top"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="btn-solid px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2"
        >
          {isPlaying ? (
            <>
              <Pause className="w-4 h-4 fill-current" />
              Pause Prompter
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              Start Scrolling
            </>
          )}
        </button>
      </div>

    </div>
  );
};
