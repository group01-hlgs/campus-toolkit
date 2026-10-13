export interface JpegPhotoProperties {
  width: number;
  height: number;
  precision: number;
  components: number;
  orientation: number;
  dpiX: number | null;
  dpiY: number | null;
}

interface ExifProperties {
  xResolution: number | null;
  yResolution: number | null;
  resolutionUnit: number;
  orientation: number;
}

function readExifProperties(buffer: Buffer, start: number, end: number): ExifProperties | null {
  if (end - start < 14 || buffer.toString("ascii", start, start + 6) !== "Exif\0\0") return null;
  const tiff = start + 6;
  const littleEndian = buffer.toString("ascii", tiff, tiff + 2) === "II";
  if (!littleEndian && buffer.toString("ascii", tiff, tiff + 2) !== "MM") return null;

  const read16 = (offset: number): number | null =>
    offset >= tiff && offset + 2 <= end
      ? littleEndian
        ? buffer.readUInt16LE(offset)
        : buffer.readUInt16BE(offset)
      : null;
  const read32 = (offset: number): number | null =>
    offset >= tiff && offset + 4 <= end
      ? littleEndian
        ? buffer.readUInt32LE(offset)
        : buffer.readUInt32BE(offset)
      : null;

  if (read16(tiff + 2) !== 42) return null;
  const ifdOffset = read32(tiff + 4);
  if (ifdOffset === null) return null;
  const ifd = tiff + ifdOffset;
  const entryCount = read16(ifd);
  if (entryCount === null) return null;

  let xResolution: number | null = null;
  let yResolution: number | null = null;
  let resolutionUnit = 2;
  let orientation = 1;

  for (let index = 0; index < entryCount; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) break;
    const tag = read16(entry);
    const type = read16(entry + 2);
    const count = read32(entry + 4);
    if (tag === null || type === null || count === null) continue;
    const inlineValue = entry + 8;

    if (tag === 0x0112 && type === 3 && count >= 1) {
      orientation = read16(inlineValue) ?? 1;
    } else if (tag === 0x0128 && type === 3 && count >= 1) {
      resolutionUnit = read16(inlineValue) ?? 2;
    } else if ((tag === 0x011a || tag === 0x011b) && type === 5 && count >= 1) {
      const relative = read32(inlineValue);
      if (relative === null) continue;
      const rational = tiff + relative;
      const numerator = read32(rational);
      const denominator = read32(rational + 4);
      if (numerator === null || denominator === null || denominator === 0) continue;
      const value = numerator / denominator;
      if (tag === 0x011a) xResolution = value;
      else yResolution = value;
    }
  }

  return { xResolution, yResolution, resolutionUnit, orientation };
}

function toDpi(value: number, unit: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit === 2) return value;
  if (unit === 3) return value * 2.54;
  return null;
}

/** 從 JPEG 標頭讀取尺寸、色彩分量、方向與 JFIF/EXIF 解析度資訊。 */
export function inspectJpegPhoto(buffer: Buffer): JpegPhotoProperties | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  let width = 0;
  let height = 0;
  let precision = 0;
  let components = 0;
  let orientation = 1;
  let jfifDpiX: number | null = null;
  let jfifDpiY: number | null = null;
  let exif: ExifProperties | null = null;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2) return null;
    const segmentStart = offset + 2;
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > buffer.length) return null;

    if (
      marker === 0xe0 &&
      segmentEnd - segmentStart >= 12 &&
      buffer.toString("ascii", segmentStart, segmentStart + 5) === "JFIF\0"
    ) {
      const units = buffer[segmentStart + 7];
      const xDensity = buffer.readUInt16BE(segmentStart + 8);
      const yDensity = buffer.readUInt16BE(segmentStart + 10);
      if (units === 1) {
        jfifDpiX = xDensity;
        jfifDpiY = yDensity;
      } else if (units === 2) {
        jfifDpiX = xDensity * 2.54;
        jfifDpiY = yDensity * 2.54;
      }
    } else if (marker === 0xe1) {
      exif = readExifProperties(buffer, segmentStart, segmentEnd) ?? exif;
      if (exif) orientation = exif.orientation;
    } else if (
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
      marker === 0xc5 || marker === 0xc6 || marker === 0xc7 || marker === 0xc9 ||
      marker === 0xca || marker === 0xcb || marker === 0xcd || marker === 0xce || marker === 0xcf
    ) {
      if (segmentEnd - segmentStart < 6) return null;
      precision = buffer[segmentStart];
      height = buffer.readUInt16BE(segmentStart + 1);
      width = buffer.readUInt16BE(segmentStart + 3);
      components = buffer[segmentStart + 5];
    }
    offset = segmentEnd;
  }

  const exifUnit = exif?.resolutionUnit ?? 2;
  const exifDpiX = exif?.xResolution === null || exif?.xResolution === undefined
    ? null
    : toDpi(exif.xResolution, exifUnit);
  const exifDpiY = exif?.yResolution === null || exif?.yResolution === undefined
    ? null
    : toDpi(exif.yResolution, exifUnit);
  const candidates = [
    ...(jfifDpiX !== null && jfifDpiY !== null ? [{ x: jfifDpiX, y: jfifDpiY }] : []),
    ...(exifDpiX !== null && exifDpiY !== null ? [{ x: exifDpiX, y: exifDpiY }] : []),
  ];
  const resolution = candidates.find((candidate) => candidate.x >= 300 && candidate.y >= 300)
    ?? candidates[0];

  return {
    width,
    height,
    precision,
    components,
    orientation,
    dpiX: resolution?.x ?? null,
    dpiY: resolution?.y ?? null,
  };
}
