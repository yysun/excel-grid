// Minimal ZIP archive writer/reader for the xlsx open/save feature.
// Features: createZip (always deflate-raw via native CompressionStream,
// local file headers + central directory + EOCD) and readZip (EOCD
// backscan, central-directory walk, stored and deflated entries via
// DecompressionStream, CRC-32 verification). Supported subset: no zip64,
// no encryption, no multi-disk; sizes are taken from the central directory
// so producers using data descriptors (flag bit 3) still read fine.
// Recent changes: initial implementation.

/** Reject obviously out-of-scope archives early with a clear error. */
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 1000;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

// ---- CRC-32 (IEEE, poly 0xEDB88320) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---- deflate helpers (native streams; Node >= 18 and all modern browsers) ----

async function pipeThrough(
  data: Uint8Array,
  stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> }
): Promise<Uint8Array> {
  // Drive the transform directly (no Blob/Response): write the input
  // without awaiting first — the write only completes as the readable
  // side is drained below. Copy the input so the transform never holds
  // a view into a buffer the caller may reuse.
  const copy = new Uint8Array(data.length);
  copy.set(data);
  const writer = stream.writable.getWriter();
  const writing = writer.write(copy).then(() => writer.close());
  writing.catch(() => {}); // surfaced via reader.read() below
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await writing;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(data, new CompressionStream("deflate-raw"));
}

function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(data, new DecompressionStream("deflate-raw"));
}

// ---- writer ----

/** DOS date/time pair (little-endian words) for "now"; second resolution 2s. */
function dosDateTime(): { date: number; time: number } {
  const d = new Date();
  const year = Math.max(1980, d.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Build a ZIP archive from named entries; every entry is deflated. */
export async function createZip(entries: ZipEntry[]): Promise<Uint8Array> {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`zip: too many entries (${entries.length})`);
  }
  const enc = new TextEncoder();
  const { date, time } = dosDateTime();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const compressed = await deflateRaw(entry.data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names flag
    lv.setUint16(8, 8, true); // method: deflate
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra length
    local.set(name, 30);
    parts.push(local, compressed);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 8, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressed.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    // comment/extra lengths, disk, attrs all zero (offsets 30-37).
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);

    offset += local.length + compressed.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, entries.length, true); // entries this disk
  ev.setUint16(10, entries.length, true); // entries total
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true); // central directory offset
  // comment length zero.

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of [...parts, ...central, eocd]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

// ---- reader ----

/**
 * Parse a ZIP archive into a name -> content map. Handles stored and
 * deflated entries; rejects encrypted, zip64, and unknown-method archives.
 */
export async function readZip(data: Uint8Array): Promise<Map<string, Uint8Array>> {
  if (data.length > MAX_BYTES) throw new Error("zip: archive too large");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // EOCD backscan: the record is 22 bytes plus an up-to-64K comment.
  let eocd = -1;
  const stop = Math.max(0, data.length - (22 + 0xffff));
  for (let i = data.length - 22; i >= stop; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: end-of-central-directory not found");

  const count = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || centralOffset === 0xffffffff) {
    throw new Error("zip: zip64 archives are not supported");
  }
  if (count > MAX_ENTRIES) throw new Error(`zip: too many entries (${count})`);

  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let pos = centralOffset;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > data.length || view.getUint32(pos, true) !== SIG_CENTRAL) {
      throw new Error("zip: corrupt central directory");
    }
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    const compSize = view.getUint32(pos + 20, true);
    const uncompSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(data.subarray(pos + 46, pos + 46 + nameLen));

    if (flags & 0x1) throw new Error(`zip: entry "${name}" is encrypted`);
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("zip: zip64 archives are not supported");
    }

    // The local header's name/extra lengths can differ from the central
    // record's; re-read them to find where the entry data starts.
    if (localOffset + 30 > data.length || view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Error(`zip: corrupt local header for "${name}"`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > data.length) {
      throw new Error(`zip: truncated entry data for "${name}"`);
    }
    const raw = data.subarray(dataStart, dataStart + compSize);

    let content: Uint8Array;
    if (method === 0) content = raw.slice();
    else if (method === 8) content = await inflateRaw(raw);
    else throw new Error(`zip: unsupported compression method ${method} for "${name}"`);

    if (content.length !== uncompSize || crc32(content) !== crc) {
      throw new Error(`zip: corrupt entry "${name}" (size/CRC mismatch)`);
    }
    out.set(name, content);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
