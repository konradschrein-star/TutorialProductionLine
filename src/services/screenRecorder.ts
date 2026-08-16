export interface ScreenRecorderOptions {
  includeMic?: boolean;
  videoBitsPerSecond?: number;
}

export class ScreenRecorderService {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private micStream: MediaStream | null = null;

  async startRecording(
    options: ScreenRecorderOptions = {},
    onDataAvailable?: (blob: Blob) => void
  ): Promise<MediaStream> {
    this.recordedChunks = [];

    // 1. Capture screen stream
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: true, // System audio if shared
    });

    let combinedStream = displayStream;

    // 2. Mix microphone if requested
    if (options.includeMic) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          }
        });

        const audioContext = new AudioContext();
        const dest = audioContext.createMediaStreamDestination();

        // Add display audio tracks if present
        if (displayStream.getAudioTracks().length > 0) {
          const displaySource = audioContext.createMediaStreamSource(new MediaStream(displayStream.getAudioTracks()));
          displaySource.connect(dest);
        }

        // Add mic audio track
        const micSource = audioContext.createMediaStreamSource(this.micStream);
        micSource.connect(dest);

        // Combine video track + mixed audio tracks
        const mixedTracks = [
          ...displayStream.getVideoTracks(),
          ...dest.stream.getAudioTracks()
        ];
        combinedStream = new MediaStream(mixedTracks);
      } catch (err) {
        console.warn('Microphone access denied or failed, recording screen audio only:', err);
      }
    }

    this.stream = combinedStream;

    // 3. Determine best supported mime type
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ];
    const selectedMime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';

    this.mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType: selectedMime,
      videoBitsPerSecond: options.videoBitsPerSecond || 5000000 // 5 Mbps clean HD
    });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.recordedChunks.push(e.data);
      }
    };

    // Auto-stop when user stops sharing via browser UI
    displayStream.getVideoTracks()[0].onended = () => {
      this.stopRecording();
    };

    this.mediaRecorder.start(1000); // 1s timeslices
    return combinedStream;
  }

  pauseRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
    }
  }

  resumeRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
    }
  }

  async stopRecording(): Promise<{ blob: Blob; url: string; file: File }> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('No active recorder'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const mime = this.mediaRecorder?.mimeType || 'video/webm';
        const blob = new Blob(this.recordedChunks, { type: mime });
        const url = URL.createObjectURL(blob);
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: mime });

        // Clean up tracks
        if (this.stream) {
          this.stream.getTracks().forEach(t => t.stop());
        }
        if (this.micStream) {
          this.micStream.getTracks().forEach(t => t.stop());
        }

        resolve({ blob, url, file });
      };

      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    });
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  isPaused(): boolean {
    return this.mediaRecorder?.state === 'paused';
  }
}

export const screenRecorder = new ScreenRecorderService();
