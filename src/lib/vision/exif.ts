/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Reads orientation and focal length EXIF fields from a JPEG.
 */

/**
 * The few EXIF fields room placement needs, read from a JPEG in the browser.
 *
 * A JPEG is a sequence of segments, each `FF xx` plus a big-endian 16-bit
 * length. EXIF lives in the APP1 segment (`FF E1`) that starts with "Exif\0\0",
 * followed by a TIFF structure: a byte-order mark ("II" little-endian or "MM"
 * big-endian), the number 42, and the offset of the first image file directory
 * (IFD). An IFD is a count followed by 12-byte entries (tag, type, count,
 * value-or-offset). The camera settings are in a sub-directory, the EXIF IFD,
 * whose offset is tag 0x8769 of IFD0.
 *
 * Only three tags are read, and the parser never throws on malformed input: a
 * photo without usable EXIF falls back to the field-of-view slider.
 *
 * The photo never leaves the browser; this runs on the bytes of the local file.
 */

export type CameraExif = {
  /** FocalLengthIn35mmFilm (0xA405), millimetres. */
  focal35?: number;
  /** FocalLength (0x920A), millimetres on the real sensor. Informational only: without the sensor size it cannot give f_px. */
  focalLength?: number;
  /** Orientation (0x0112), 1–8. Browsers apply it when decoding, so the geometry uses the displayed size. */
  orientation?: number;
};

const TAG_EXIF_IFD = 0x8769;
const TAG_ORIENTATION = 0x0112;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_FOCAL_35 = 0xa405;

const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

export function readCameraExif(buffer: ArrayBuffer): CameraExif {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return {};

    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) return {};
      const marker = view.getUint8(offset + 1);
      // Start of scan: compressed image data follows, no more metadata.
      if (marker === 0xda || marker === 0xd9) return {};
      const length = view.getUint16(offset + 2);
      if (length < 2) return {};
      if (marker === 0xe1 && isExifHeader(view, offset + 4)) {
        return readTiff(view, offset + 10, Math.min(view.byteLength, offset + 2 + length));
      }
      offset += 2 + length;
    }
    return {};
  } catch {
    return {};
  }
}

function isExifHeader(view: DataView, at: number): boolean {
  if (at + 6 > view.byteLength) return false;
  // "Exif\0\0"
  return view.getUint32(at) === 0x45786966 && view.getUint16(at + 4) === 0;
}

function readTiff(view: DataView, start: number, end: number): CameraExif {
  if (start + 8 > end) return {};
  const order = view.getUint16(start);
  if (order !== 0x4949 && order !== 0x4d4d) return {};
  const little = order === 0x4949;
  if (view.getUint16(start + 2, little) !== 42) return {};

  const result: CameraExif = {};
  const ifd0 = readIfd(view, start, start + view.getUint32(start + 4, little), end, little);
  const orientation = ifd0.get(TAG_ORIENTATION);
  if (orientation !== undefined && orientation >= 1 && orientation <= 8) result.orientation = orientation;

  const exifOffset = ifd0.get(TAG_EXIF_IFD);
  if (exifOffset !== undefined) {
    const exif = readIfd(view, start, start + exifOffset, end, little);
    const focal35 = exif.get(TAG_FOCAL_35);
    if (focal35 !== undefined && focal35 > 0) result.focal35 = focal35;
    const focal = exif.get(TAG_FOCAL_LENGTH);
    if (focal !== undefined && focal > 0) result.focalLength = focal;
  }
  return result;
}

/** Reads the numeric SHORT, LONG and RATIONAL entries of one IFD. Offsets are relative to the TIFF start. */
function readIfd(view: DataView, tiffStart: number, at: number, end: number, little: boolean): Map<number, number> {
  const values = new Map<number, number>();
  if (at + 2 > end) return values;
  const count = view.getUint16(at, little);
  for (let i = 0; i < count; i += 1) {
    const entry = at + 2 + i * 12;
    if (entry + 12 > end) break;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    if (type === TYPE_SHORT) {
      values.set(tag, view.getUint16(entry + 8, little));
    } else if (type === TYPE_LONG) {
      values.set(tag, view.getUint32(entry + 8, little));
    } else if (type === TYPE_RATIONAL) {
      // Eight bytes do not fit in the entry, so the value holds an offset to them.
      const pointer = tiffStart + view.getUint32(entry + 8, little);
      if (pointer + 8 > end) continue;
      const numerator = view.getUint32(pointer, little);
      const denominator = view.getUint32(pointer + 4, little);
      if (denominator !== 0) values.set(tag, numerator / denominator);
    }
  }
  return values;
}
