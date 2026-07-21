// Unit tests for the minimal ZIP writer/reader: round-trips, stored-entry
// and foreign-deflate fixtures (simulating Excel as producer), and error
// handling for truncated/encrypted/unknown-method archives.
// Recent changes: initial implementation.

import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createZip, readZip, type ZipEntry } from "./zip";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** CRC-32 mirror of the implementation, for hand-built fixtures. */
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    for (let n = (c ^ data[i]) & 0xff, k = 0; k < 8; k++) {
      n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
      if (k === 7) c = n ^ (c >>> 8);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Hand-assemble a one-entry archive with the given method and payload. */
function buildArchive(opts: {
  name: string;
  content: Uint8Array;
  payload: Uint8Array;
  method: number;
  flags?: number;
}): Uint8Array {
  const name = enc.encode(opts.name);
  const crc = crc32(opts.content);
  const local = new Uint8Array(30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, opts.flags ?? 0, true);
  lv.setUint16(8, opts.method, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, opts.payload.length, true);
  lv.setUint32(22, opts.content.length, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);

  const cen = new Uint8Array(46 + name.length);
  const cv = new DataView(cen.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, opts.flags ?? 0, true);
  cv.setUint16(10, opts.method, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, opts.payload.length, true);
  cv.setUint32(24, opts.content.length, true);
  cv.setUint16(28, name.length, true);
  cv.setUint32(42, 0, true); // local header offset
  cen.set(name, 46);

  const centralOffset = local.length + opts.payload.length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, cen.length, true);
  ev.setUint32(16, centralOffset, true);

  const out = new Uint8Array(centralOffset + cen.length + eocd.length);
  out.set(local, 0);
  out.set(opts.payload, local.length);
  out.set(cen, centralOffset);
  out.set(eocd, centralOffset + cen.length);
  return out;
}

describe("createZip / readZip round-trip", () => {
  it("round-trips multiple text and binary entries", async () => {
    const binary = new Uint8Array(1000);
    for (let i = 0; i < binary.length; i++) binary[i] = (i * 37) & 0xff;
    const entries: ZipEntry[] = [
      { name: "hello.txt", data: enc.encode("hello zip") },
      { name: "dir/nested.xml", data: enc.encode("<a>Ünïcode ✓</a>") },
      { name: "bin.dat", data: binary },
      { name: "empty.txt", data: new Uint8Array(0) },
    ];
    const zip = await createZip(entries);
    const back = await readZip(zip);
    expect([...back.keys()]).toEqual(entries.map((e) => e.name));
    expect(dec.decode(back.get("hello.txt"))).toBe("hello zip");
    expect(dec.decode(back.get("dir/nested.xml"))).toBe("<a>Ünïcode ✓</a>");
    expect(back.get("bin.dat")).toEqual(binary);
    expect(back.get("empty.txt")).toEqual(new Uint8Array(0));
  });

  it("starts with the PK local-header magic", async () => {
    const zip = await createZip([{ name: "a", data: enc.encode("x") }]);
    expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});

describe("readZip foreign producers", () => {
  it("reads stored (method 0) entries", async () => {
    const content = enc.encode("stored, not compressed");
    const zip = buildArchive({ name: "s.txt", content, payload: content, method: 0 });
    const back = await readZip(zip);
    expect(dec.decode(back.get("s.txt"))).toBe("stored, not compressed");
  });

  it("reads entries deflated by another producer (node:zlib)", async () => {
    const content = enc.encode("deflated elsewhere ".repeat(50));
    const payload = new Uint8Array(deflateRawSync(content));
    const zip = buildArchive({ name: "d.txt", content, payload, method: 8 });
    const back = await readZip(zip);
    expect(dec.decode(back.get("d.txt"))).toBe(dec.decode(content));
  });
});

describe("readZip errors", () => {
  it("rejects data with no EOCD record", async () => {
    await expect(readZip(enc.encode("this is not a zip file"))).rejects.toThrow(
      /end-of-central-directory/
    );
  });

  it("rejects truncated archives", async () => {
    const zip = await createZip([{ name: "a.txt", data: enc.encode("hello truncation") }]);
    // Keep the EOCD (last 22 bytes) but cut entry data out from the middle.
    const cut = new Uint8Array([...zip.subarray(0, 10), ...zip.subarray(zip.length - 22)]);
    await expect(readZip(cut)).rejects.toThrow(/zip:/);
  });

  it("rejects encrypted entries", async () => {
    const content = enc.encode("secret");
    const zip = buildArchive({ name: "e.txt", content, payload: content, method: 0, flags: 0x1 });
    await expect(readZip(zip)).rejects.toThrow(/encrypted/);
  });

  it("rejects unknown compression methods", async () => {
    const content = enc.encode("lzma?");
    const zip = buildArchive({ name: "l.txt", content, payload: content, method: 14 });
    await expect(readZip(zip)).rejects.toThrow(/unsupported compression method/);
  });

  it("rejects CRC mismatches", async () => {
    const content = enc.encode("checksum me");
    const wrong = enc.encode("checksum ME");
    const zip = buildArchive({ name: "c.txt", content, payload: wrong, method: 0 });
    await expect(readZip(zip)).rejects.toThrow(/CRC/);
  });
});
