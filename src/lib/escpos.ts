/**
 * ESC/POS (Epson Standard Code for POS) encoder.
 * Converts formatting commands, text, and raster bitmaps into a Uint8Array for thermal printers.
 */
export class EscPosEncoder {
  private bytes: Uint8Array[] = [];
  private currentSize = 0;

  private append(bytes: number[] | Uint8Array) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.currentSize += arr.length;
    this.bytes.push(arr);
  }

  private sanitizeAscii(str: string): string {
    return str
      .replace(/\u00A0/g, ' ')
      .replace(/[–—]/g, '-')
      .replace(/[•·]/g, '-');
  }

  /** Resets printer to default settings. */
  initialize() {
    this.append([0x1b, 0x40]);
  }

  /** Sets text alignment. */
  align(position: 'left' | 'center' | 'right') {
    const map = { left: 0, center: 1, right: 2 };
    this.append([0x1b, 0x61, map[position]]);
  }

  /** Sets bold mode. */
  bold(on: boolean) {
    this.append([0x1b, 0x45, on ? 1 : 0]);
  }

  /**
   * Sets character size multiplier via GS ! n.
   * width: 0 = 1x (normal), 1 = 2x (double width)
   * height: 0 = 1x (normal), 1 = 2x (double height)
   * Note: GS ! uses bits 4..6 for width and bits 0..2 for height.
   */
  setSize(width: number, height: number) {
    const w = Math.max(0, Math.min(7, width));
    const h = Math.max(0, Math.min(7, height));
    this.append([0x1d, 0x21, (w << 4) | h]);
  }

  /** Appends text without a trailing newline (useful for inline size/style changes on the same line). */
  rawText(str: string) {
    this.append(new TextEncoder().encode(this.sanitizeAscii(str)));
  }

  /** Appends a line of text with a trailing newline. */
  text(str: string) {
    this.append(new TextEncoder().encode(this.sanitizeAscii(str) + '\n'));
  }

  /**
   * Appends a monochrome 1-bit raster image using GS v 0 in 24-row strips
   * so Bluetooth / Serial thermal printers never overflow their receive buffer.
   */
  rasterImage(widthPx: number, heightPx: number, packedBytes: Uint8Array) {
    const bytesPerRow = Math.ceil(widthPx / 8);
    const bandHeight = 24;
    for (let y = 0; y < heightPx; y += bandHeight) {
      const rows = Math.min(bandHeight, heightPx - y);
      const xL = bytesPerRow & 0xff;
      const xH = (bytesPerRow >> 8) & 0xff;
      const yL = rows & 0xff;
      const yH = (rows >> 8) & 0xff;
      this.append([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
      const start = y * bytesPerRow;
      const end = start + rows * bytesPerRow;
      this.append(packedBytes.slice(start, end));
    }
  }

  /** Feeds a few lines of paper. */
  feed(lines: number = 1) {
    this.append([0x1b, 0x64, lines]);
  }

  /** Full/partial cut command. */
  cut() {
    this.append([0x1d, 0x56, 0x00]);
  }

  /** Combines all segments into a single Uint8Array. */
  build(): Uint8Array {
    const result = new Uint8Array(this.currentSize);
    let offset = 0;
    for (const chunk of this.bytes) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}
