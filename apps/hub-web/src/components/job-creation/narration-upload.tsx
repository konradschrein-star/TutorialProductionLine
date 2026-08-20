"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

interface NarrationUploadProps {
  onUpload: (filePath: string) => void;
  disabled?: boolean;
}

export function NarrationUpload({
  onUpload,
  disabled = false,
}: NarrationUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const selectedFile = acceptedFiles[0];
      if (!selectedFile) return;

      setError(null);
      setFile(selectedFile);
      setUploading(true);

      try {
        const formData = new FormData();
        formData.append("file", selectedFile);

        const response = await fetch("/api/narration-upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || "Upload failed");
        }

        const result = await response.json();
        onUpload(result.path);
      } catch (err) {
        console.error("Narration upload failed:", err);
        setError(err instanceof Error ? err.message : "Upload failed");
        setFile(null);
      } finally {
        setUploading(false);
      }
    },
    [onUpload],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    accept: {
      "audio/mpeg": [".mp3"],
      "audio/wav": [".wav"],
      "audio/mp4": [".m4a"],
      "audio/ogg": [".ogg"],
      "audio/flac": [".flac"],
      "video/mp4": [".mp4"],
      "video/quicktime": [".mov"],
    },
    disabled: disabled || uploading,
    maxFiles: 1,
    maxSize: 500 * 1024 * 1024, // 500MB
  });

  const handleRemove = () => {
    setFile(null);
    setError(null);
    onUpload("");
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-200 mb-2">
        Custom Narration (Optional)
      </label>

      {!file ? (
        <div
          {...getRootProps()}
          className={`
            border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
            transition-colors
            ${
              isDragActive
                ? "border-[#aaff00] bg-[#aaff00]/5"
                : "border-gray-700 hover:border-gray-600"
            }
            ${disabled || uploading ? "opacity-50 cursor-not-allowed" : ""}
          `}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-2">
            <svg
              className="w-10 h-10 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-sm text-gray-300">
              {isDragActive
                ? "Drop your narration file here"
                : "Drag & drop narration, or click to browse"}
            </p>
            <p className="text-xs text-gray-500">
              Audio: MP3, WAV, M4A, OGG, FLAC • Video: MP4, MOV (max 500MB)
            </p>
          </div>
        </div>
      ) : (
        <div className="border border-gray-700 rounded-lg p-4 bg-gray-800/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg
                className="w-8 h-8 text-[#aaff00]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-gray-200">{file.name}</p>
                <p className="text-xs text-gray-500">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                  {uploading && " • Uploading..."}
                </p>
              </div>
            </div>
            {!uploading && (
              <button
                type="button"
                onClick={handleRemove}
                className="text-gray-400 hover:text-red-400 transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      <p className="mt-2 text-xs text-gray-400">
        Upload your own voice recording to bypass TTS generation. The audio will
        be used for timing and narration.
      </p>
    </div>
  );
}
