/** Read bounded image dimensions without decoding untrusted pixels. */
export function imageDimensions(bytes: Buffer, mimeType: string): { width: number; height: number } | null {
  if (mimeType === "image/png") {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (mimeType !== "image/jpeg" || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 255) return null;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda || marker === undefined) return null;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}

export function inpaintDimensionsAllowed(dimensions: { width: number; height: number }): boolean {
  return dimensions.width >= 256 && dimensions.height >= 256 &&
    dimensions.width <= 4096 && dimensions.height <= 4096 &&
    dimensions.width * dimensions.height <= 16_000_000;
}
