/**
 * Upload file with progress tracking using XMLHttpRequest
 *
 * @param file - File to upload
 * @param url - Upload endpoint URL
 * @param onProgress - Progress callback (0-100)
 * @returns Upload response data
 */
export async function uploadFileWithProgress<T = any>(
  file: File,
  url: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);
    // Send file's lastModified timestamp (creation/modification date)
    formData.append("lastModified", file.lastModified.toString());

    // Allow the caller to cancel an in-progress upload via an AbortSignal.
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
      } else {
        signal.addEventListener("abort", () => xhr.abort(), { once: true });
      }
    }

    // Track upload progress
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        const progress = Math.round((e.loaded / e.total) * 100);
        onProgress(progress);
      }
    });

    // Handle completion
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch (err) {
          reject(new Error("Failed to parse response"));
        }
      } else {
        try {
          const errorData = JSON.parse(xhr.responseText);
          reject(new Error(errorData.error || "Upload failed"));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    });

    // Handle errors
    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload cancelled"));
    });

    // Send request
    xhr.open("POST", url);
    xhr.send(formData);
  });
}
