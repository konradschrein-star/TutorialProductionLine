import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Download, Volume2 } from 'lucide-react';

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
    <div className="p-3.5 rounded-xl bg-surface-100 border border-border">
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
        onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration)}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        
        {/* Play / Pause & Time */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            onClick={togglePlay}
            className="w-10 h-10 rounded-lg bg-foreground text-background flex items-center justify-center hover:opacity-90 transition-opacity"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <Volume2 className="w-3.5 h-3.5 text-muted" />
              <span>Fairlight Audio Track</span>
            </div>
            <div className="text-[11px] text-muted font-mono">
              {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')} /{' '}
              {Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}
            </div>
          </div>
        </div>

        {/* DaVinci Precision Audio Waveform Monitor */}
        <div className="flex-1 w-full flex items-center gap-0.5 h-7 px-3 bg-surface-200 rounded-lg border border-border overflow-hidden">
          {Array.from({ length: 48 }).map((_, i) => {
            const progress = duration > 0 ? currentTime / duration : 0;
            const barProgress = i / 48;
            const isPassed = barProgress <= progress;
            const heights = [25, 40, 65, 80, 50, 90, 100, 75, 40, 60, 85, 95, 70, 50, 80, 65, 40, 75, 90, 100, 60, 85, 45, 70, 90, 80, 55, 65, 45, 35, 25, 20];
            const height = heights[i % heights.length];

            return (
              <div
                key={i}
                className={`flex-1 rounded-sm transition-all duration-100 ${
                  isPassed
                    ? 'bg-foreground'
                    : 'bg-muted/30'
                }`}
                style={{ height: `${isPlaying ? Math.max(15, height * (0.6 + Math.sin(i + currentTime * 6) * 0.4)) : height}%` }}
              />
            );
          })}
        </div>

        {/* Speed & Download */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <div className="flex items-center bg-surface-200 rounded-lg p-0.5 border border-border text-xs font-semibold">
            {[1.0, 1.15, 1.25].map(s => (
              <button
                key={s}
                onClick={() => handleSpeedChange(s)}
                className={`px-2 py-1 rounded text-[11px] font-mono font-bold transition-colors ${
                  playbackSpeed === s ? 'bg-surface-100 text-foreground shadow-subtle' : 'text-muted hover:text-foreground'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          <button
            onClick={handleDownload}
            className="btn-outline flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export WAV</span>
          </button>
        </div>

      </div>
    </div>
  );
};
