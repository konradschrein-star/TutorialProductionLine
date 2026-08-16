import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Download, Volume2, RotateCcw } from 'lucide-react';

interface AudioPlayerProps {
  blob: Blob | null;
  url?: string;
  topicTitle?: string;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ blob, url, topicTitle = 'voiceover' }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>('');

  useEffect(() => {
    if (blob) {
      const u = URL.createObjectURL(blob);
      setAudioUrl(u);
      return () => URL.revokeObjectURL(u);
    } else if (url) {
      setAudioUrl(url);
    }
  }, [blob, url]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `${topicTitle.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-voiceover.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!audioUrl) return null;

  return (
    <div className="p-4 rounded-2xl bg-gradient-to-r from-surface-100 to-surface-200 border border-white/10 shadow-glass">
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
        onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration)}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        
        {/* Play / Pause & Time */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            onClick={togglePlay}
            className="w-12 h-12 rounded-xl bg-gradient-to-tr from-accent-purple to-accent-cyan flex items-center justify-center text-white shadow-glow hover:scale-105 transition-transform"
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>

          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Volume2 className="w-3.5 h-3.5 text-accent-cyan" />
              <span>Voiceover Master</span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')} /{' '}
              {Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}
            </div>
          </div>
        </div>

        {/* Dynamic Waveform Visualizer simulation */}
        <div className="flex-1 w-full flex items-center gap-1 h-8 px-4 bg-black/40 rounded-xl border border-white/5 overflow-hidden">
          {Array.from({ length: 32 }).map((_, i) => {
            const progress = duration > 0 ? currentTime / duration : 0;
            const barProgress = i / 32;
            const isPassed = barProgress <= progress;
            const heights = [30, 45, 60, 80, 50, 90, 100, 75, 40, 60, 85, 95, 70, 50, 80, 65, 40, 75, 90, 100, 60, 85, 45, 70, 90, 80, 55, 65, 45, 35, 25, 20];
            const height = heights[i % heights.length];

            return (
              <div
                key={i}
                className={`flex-1 rounded-full transition-all duration-150 ${
                  isPassed
                    ? 'bg-gradient-to-t from-accent-purple to-accent-cyan'
                    : 'bg-white/10'
                }`}
                style={{ height: `${isPlaying ? Math.max(15, height * (0.6 + Math.sin(i + currentTime * 5) * 0.4)) : height}%` }}
              />
            );
          })}
        </div>

        {/* Speed & Download */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <div className="flex items-center bg-white/5 rounded-lg p-1 border border-white/10 text-xs font-semibold">
            {[1.0, 1.15, 1.25].map(s => (
              <button
                key={s}
                onClick={() => handleSpeedChange(s)}
                className={`px-2 py-1 rounded text-[11px] font-bold ${
                  playbackSpeed === s ? 'bg-accent-purple text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-200 hover:bg-surface-50 border border-white/10 text-xs font-semibold text-white transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>
        </div>

      </div>
    </div>
  );
};
