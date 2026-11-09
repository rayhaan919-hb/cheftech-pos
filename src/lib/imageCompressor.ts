export interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

export interface CompressResult {
  dataUrl: string;
  originalBytes: number;
  compressedBytes: number;
  compressionRatio: number;
  width: number;
  height: number;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Client-side local image auto-compression.
 * Resizes large images (e.g., high-res mobile camera photos) to responsive food menu dimensions
 * and applies WebP/JPEG compression to produce lightweight, high-performance data URLs.
 */
export async function compressImageFile(
  file: File,
  options: CompressOptions = {}
): Promise<CompressResult> {
  const maxWidth = options.maxWidth ?? 800;
  const maxHeight = options.maxHeight ?? 800;
  const quality = options.quality ?? 0.82;
  const originalBytes = file.size;

  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file (PNG, JPG, JPEG, WEBP, etc.).');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read the local image file.'));
    reader.onload = (event) => {
      const src = event.target?.result as string;
      if (!src) {
        return reject(new Error('The selected image was empty.'));
      }

      const img = new Image();
      img.onerror = () => reject(new Error('Unable to parse image data.'));
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        // Maintain aspect ratio while bounding within max dimensions
        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Failed to create canvas rendering context.'));
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Try modern WebP format first, fallback to JPEG
        let dataUrl = canvas.toDataURL('image/webp', quality);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        const headIndex = dataUrl.indexOf(',');
        const b64 = headIndex >= 0 ? dataUrl.slice(headIndex + 1) : dataUrl;
        const compressedBytes = Math.round((b64.length * 3) / 4);

        const ratio = originalBytes > 0
          ? Math.round((1 - compressedBytes / originalBytes) * 100)
          : 0;

        resolve({
          dataUrl,
          originalBytes,
          compressedBytes,
          compressionRatio: Math.max(0, ratio),
          width,
          height,
        });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
