/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the JPEG EXIF reader.
 */

import { describe, expect, it } from "vitest";

import { readCameraExif } from "@/lib/vision/exif";

type Entry = { tag: number; type: 3 | 4 | 5; value: number | [number, number] };

/**
 * Builds a minimal JPEG: SOI, an optional APP0, an APP1 Exif segment with IFD0
 * (orientation + pointer to the EXIF IFD) and the EXIF IFD (focal lengths),
 * then SOS and EOI. Byte order is selectable, because phones write both.
 */
function jpeg({ little, ifd0 = [], exif = [], app0 = true }: { little: boolean; ifd0?: Entry[]; exif?: Entry[]; app0?: boolean }): ArrayBuffer {
  const tiff: number[] = [];
  const u16 = (value: number) => (little ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff]);
  const u32 = (value: number) => {
    const bytes = [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    return little ? bytes.reverse() : bytes;
  };

  const ifd0Entries = [...ifd0, { tag: 0x8769, type: 4 as const, value: 0 }];
  const ifd0Size = 2 + ifd0Entries.length * 12 + 4;
  const exifOffset = 8 + ifd0Size;
  const exifSize = 2 + exif.length * 12 + 4;
  let dataOffset = exifOffset + exifSize;
  const data: number[] = [];

  const writeIfd = (entries: Entry[]) => {
    tiff.push(...u16(entries.length));
    for (const entry of entries) {
      tiff.push(...u16(entry.tag), ...u16(entry.type), ...u32(1));
      if (entry.type === 5) {
        const [numerator, denominator] = entry.value as [number, number];
        tiff.push(...u32(dataOffset));
        data.push(...u32(numerator), ...u32(denominator));
        dataOffset += 8;
      } else if (entry.type === 3) {
        tiff.push(...u16(entry.value as number), 0, 0);
      } else {
        tiff.push(...u32(entry.value as number));
      }
    }
    tiff.push(...u32(0));
  };

  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  writeIfd(ifd0Entries.map((entry) => (entry.tag === 0x8769 ? { ...entry, value: exifOffset } : entry)));
  writeIfd(exif);
  tiff.push(...data);

  const app1Body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const bytes = [0xff, 0xd8];
  if (app0) bytes.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);
  bytes.push(0xff, 0xe1, (app1Body.length + 2) >> 8, (app1Body.length + 2) & 0xff, ...app1Body);
  bytes.push(0xff, 0xda, 0x00, 0x02, 0xff, 0xd9);
  return new Uint8Array(bytes).buffer;
}

const phoneTags = {
  ifd0: [{ tag: 0x0112, type: 3 as const, value: 6 }],
  exif: [
    { tag: 0x920a, type: 5 as const, value: [567, 100] as [number, number] },
    { tag: 0xa405, type: 3 as const, value: 26 },
  ],
};

describe("reading camera EXIF from a JPEG", () => {
  it.each([true, false])("reads focal lengths and orientation (little-endian: %s)", (little) => {
    expect(readCameraExif(jpeg({ little, ...phoneTags }))).toEqual({ focal35: 26, focalLength: 5.67, orientation: 6 });
  });

  it("finds the EXIF segment without a JFIF segment before it", () => {
    expect(readCameraExif(jpeg({ little: true, app0: false, ...phoneTags })).focal35).toBe(26);
  });

  it("returns nothing for a photo without a 35 mm focal length", () => {
    expect(readCameraExif(jpeg({ little: true, exif: [] }))).toEqual({});
  });

  it("ignores a zero focal length and an out-of-range orientation", () => {
    const result = readCameraExif(
      jpeg({ little: true, ifd0: [{ tag: 0x0112, type: 3, value: 42 }], exif: [{ tag: 0xa405, type: 3, value: 0 }] }),
    );
    expect(result).toEqual({});
  });

  it("never throws on files that are not JPEGs or are cut short", () => {
    expect(readCameraExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({});
    expect(readCameraExif(new ArrayBuffer(0))).toEqual({});
    const full = new Uint8Array(jpeg({ little: false, ...phoneTags }));
    for (let length = 0; length < full.length; length += 7) {
      expect(() => readCameraExif(full.slice(0, length).buffer)).not.toThrow();
    }
  });
});
