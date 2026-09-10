// ============================================================
// L2L — 3D model converter (pure JS, no native deps)
// STL / OBJ / PLY / 3MF / GLB — all read into one Mesh model
// (vertices + triangles) and written back out. Colors, normals,
// materials and scene structure are intentionally not preserved:
// the goal is geometry conversion for 3D printing / CAD / DCC.
// ============================================================

import fs from "node:fs";
import path from "node:path";

import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";

import type { Quality } from "../../shared/formats";
import { Reporter, uniquePath } from "./common";

export interface Mesh {
  vertices: number[]; // flat [x,y,z, x,y,z, ...]
  triangles: number[]; // flat [i0,j0,k0, i1,j1,k1, ...]
}

export interface ModelJob {
  inputPath: string;
  target: string;
  quality: Quality;
  outputDir: string;
  report: Reporter;
}

// ------------------------------------------------------------
// Triangle count helpers
// ------------------------------------------------------------

function triCount(m: Mesh): number {
  return m.triangles.length / 3;
}

function crossNormal(a: number[], b: number[], c: number[], out: number[]): void {
  const ax = a[0], ay = a[1], az = a[2];
  const bx = b[0], by = b[1], bz = b[2];
  const cx = c[0], cy = c[1], cz = c[2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / len;
  out[1] = ny / len;
  out[2] = nz / len;
}

// ------------------------------------------------------------
// STL
// ------------------------------------------------------------

function parseStl(buf: Buffer): Mesh {
  const len = buf.length;
  // Binary STL: 80-byte header + uint32 count + count*50 bytes.
  // Validate by exact size match before trusting the header count.
  if (len >= 84 && (len - 84) % 50 === 0) {
    const count = buf.readUInt32LE(80);
    if (84 + count * 50 === len) {
      const vertices: number[] = [];
      const triangles: number[] = [];
      for (let t = 0; t < count; t++) {
        const off = 84 + t * 50;
        const base = vertices.length;
        for (let v = 0; v < 3; v++) {
          const vo = off + 12 + v * 12;
          vertices.push(buf.readFloatLE(vo), buf.readFloatLE(vo + 4), buf.readFloatLE(vo + 8));
        }
        triangles.push(base, base + 1, base + 2);
      }
      return { vertices, triangles };
    }
  }

  // ASCII STL
  const text = buf.toString("utf8");
  const vertices: number[] = [];
  const triangles: number[] = [];
  const vRe = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  const loopRe = /outer loop([\s\S]*?)endloop/g;
  let m: RegExpExecArray | null;
  while ((m = loopRe.exec(text)) !== null) {
    const base = vertices.length;
    let count = 0;
    const local: number[] = [];
    let vm: RegExpExecArray | null;
    const vr = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    while ((vm = vr.exec(m[1])) !== null) {
      local.push(parseFloat(vm[1]), parseFloat(vm[2]), parseFloat(vm[3]));
      count++;
    }
    if (count === 3) {
      vertices.push(...local);
      triangles.push(base, base + 1, base + 2);
    }
  }
  if (triangles.length === 0) throw new Error("No triangles found in STL file.");
  return { vertices, triangles };
}

function writeStl(m: Mesh): Buffer {
  const count = triCount(m);
  const out = Buffer.alloc(84 + count * 50);
  out.write("L2L binary STL", 0, "ascii");
  out.writeUInt32LE(count, 80);
  const n = [0, 0, 0];
  for (let t = 0; t < count; t++) {
    const a = m.triangles[t * 3];
    const b = m.triangles[t * 3 + 1];
    const c = m.triangles[t * 3 + 2];
    crossNormal(
      [m.vertices[a * 3], m.vertices[a * 3 + 1], m.vertices[a * 3 + 2]],
      [m.vertices[b * 3], m.vertices[b * 3 + 1], m.vertices[b * 3 + 2]],
      [m.vertices[c * 3], m.vertices[c * 3 + 1], m.vertices[c * 3 + 2]],
      n,
    );
    const off = 84 + t * 50;
    out.writeFloatLE(n[0], off);
    out.writeFloatLE(n[1], off + 4);
    out.writeFloatLE(n[2], off + 8);
    for (let v = 0; v < 3; v++) {
      const idx = [a, b, c][v];
      const vo = off + 12 + v * 12;
      out.writeFloatLE(m.vertices[idx * 3], vo);
      out.writeFloatLE(m.vertices[idx * 3 + 1], vo + 4);
      out.writeFloatLE(m.vertices[idx * 3 + 2], vo + 8);
    }
  }
  return out;
}

// ------------------------------------------------------------
// OBJ
// ------------------------------------------------------------

function parseObj(buf: Buffer): Mesh {
  const text = buf.toString("utf8");
  const vertices: number[] = [];
  const triangles: number[] = [];
  const allVerts: number[][] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("v ")) {
      const p = line.slice(2).trim().split(/\s+/);
      if (p.length >= 3) {
        const x = parseFloat(p[0]);
        const y = parseFloat(p[1]);
        const z = parseFloat(p[2]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          allVerts.push([x, y, z]);
        }
      }
    } else if (line.startsWith("f ")) {
      const parts = line.slice(2).trim().split(/\s+/);
      const idx: number[] = [];
      for (const part of parts) {
        const first = part.split("/")[0];
        if (!first) continue;
        let i = parseInt(first, 10);
        if (!Number.isFinite(i)) continue;
        // OBJ indices are 1-based; negative counts back from the end
        if (i < 0) i = allVerts.length + i + 1;
        else i -= 1;
        if (i >= 0 && i < allVerts.length) idx.push(i);
      }
      if (idx.length >= 3) {
        for (let v = 1; v < idx.length - 1; v++) {
          triangles.push(idx[0], idx[v], idx[v + 1]);
        }
      }
    }
  }
  if (triangles.length === 0) throw new Error("No triangles found in OBJ file.");
  for (const v of allVerts) vertices.push(v[0], v[1], v[2]);
  return { vertices, triangles };
}

function writeObj(m: Mesh): string {
  const lines: string[] = ["# Exported by L2L Converter"];
  for (let i = 0; i < m.vertices.length; i += 3) {
    lines.push(`v ${fmt(m.vertices[i])} ${fmt(m.vertices[i + 1])} ${fmt(m.vertices[i + 2])}`);
  }
  for (let t = 0; t < m.triangles.length; t += 3) {
    lines.push(
      `f ${m.triangles[t] + 1} ${m.triangles[t + 1] + 1} ${m.triangles[t + 2] + 1}`,
    );
  }
  return lines.join("\n") + "\n";
}

// ------------------------------------------------------------
// PLY
// ------------------------------------------------------------

// PLY scalar type → byte size
const PLY_TYPE_SIZE: Record<string, number> = {
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

function parsePly(buf: Buffer): Mesh {
  // Header is ASCII and ends with "end_header"
  const headEnd = buf.indexOf("\nend_header");
  if (headEnd === -1) throw new Error("Invalid PLY header.");
  const header = buf.slice(0, headEnd).toString("utf8");
  const formatMatch = /format\s+(\w+)\s+([\d.]+)/.exec(header);
  if (!formatMatch) throw new Error("PLY format line missing.");
  const format = formatMatch[1];

  let vertexCount = 0;
  let faceCount = 0;
  const vertexProps: { name: string; type: string }[] = [];
  const faceList = { countType: "uchar", indexType: "int" };
  const lines = header.split("\n");
  let inVertex = false;
  let inFace = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("element vertex")) {
      vertexCount = parseInt(line.split(/\s+/)[2], 10);
      inVertex = true;
      inFace = false;
    } else if (line.startsWith("element face")) {
      faceCount = parseInt(line.split(/\s+/)[2], 10);
      inFace = true;
      inVertex = false;
    } else if (line.startsWith("property ") && inVertex) {
      const p = line.split(/\s+/);
      vertexProps.push({ type: p[1], name: p[2] });
    } else if (line.startsWith("property list") && inFace) {
      const p = line.split(/\s+/);
      faceList.countType = p[2];
      faceList.indexType = p[3];
    }
  }

  // Find x/y/z column offsets among vertex properties
  let xCol = -1, yCol = -1, zCol = -1;
  vertexProps.forEach((prop, i) => {
    if (prop.name === "x") xCol = i;
    if (prop.name === "y") yCol = i;
    if (prop.name === "z") zCol = i;
  });
  if (xCol < 0 || yCol < 0 || zCol < 0) throw new Error("PLY vertex x/y/z properties missing.");

  const vertices: number[] = [];
  const triangles: number[] = [];
  const data = buf.slice(headEnd + "\nend_header".length + 1);

  const readScalar = (type: string, offset: number, le: boolean): number => {
    switch (PLY_TYPE_SIZE[type]) {
      case 1:
        return data[offset];
      case 2:
        return le ? data.readInt16LE(offset) : data.readInt16BE(offset);
      case 8:
        return le ? data.readDoubleLE(offset) : data.readDoubleBE(offset);
      default:
        return le ? data.readFloatLE(offset) : data.readFloatBE(offset);
    }
  };

  if (format === "ascii") {
    const text = data.toString("utf8");
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    let pos = 0;
    for (let i = 0; i < vertexCount; i++) {
      const row: number[] = [];
      for (let c = 0; c < vertexProps.length; c++) {
        row.push(parseFloat(tokens[pos++]));
      }
      vertices.push(row[xCol], row[yCol], row[zCol]);
    }
    for (let i = 0; i < faceCount; i++) {
      const cnt = parseInt(tokens[pos++], 10);
      const idx: number[] = [];
      for (let c = 0; c < cnt; c++) idx.push(parseInt(tokens[pos++], 10));
      if (idx.length >= 3) {
        for (let v = 1; v < idx.length - 1; v++) triangles.push(idx[0], idx[v], idx[v + 1]);
      }
    }
  } else {
    // binary little/big endian
    const le = format !== "binary_big_endian";
    const idxSize = PLY_TYPE_SIZE[faceList.indexType] ?? 4;
    const countSize = PLY_TYPE_SIZE[faceList.countType] ?? 1;
    let p = 0;
    for (let i = 0; i < vertexCount; i++) {
      const row: number[] = [];
      for (let c = 0; c < vertexProps.length; c++) {
        const type = vertexProps[c].type;
        row.push(readScalar(type, p, le));
        p += PLY_TYPE_SIZE[type] ?? 4;
      }
      vertices.push(row[xCol], row[yCol], row[zCol]);
    }
    for (let i = 0; i < faceCount; i++) {
      const cnt = countSize === 1 ? data[p] : data.readUInt16LE(p);
      p += countSize;
      const idx: number[] = [];
      for (let c = 0; c < cnt; c++) {
        idx.push(idxSize === 2 ? data.readUInt16LE(p) : data.readUInt32LE(p));
        p += idxSize;
      }
      if (idx.length >= 3) {
        for (let v = 1; v < idx.length - 1; v++) triangles.push(idx[0], idx[v], idx[v + 1]);
      }
    }
  }
  if (triangles.length === 0) throw new Error("No triangles found in PLY file.");
  return { vertices, triangles };
}

function writePly(m: Mesh): Buffer {
  const vCount = m.vertices.length / 3;
  const tCount = triCount(m);
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    "comment Exported by L2L Converter",
    `element vertex ${vCount}`,
    "property float x",
    "property float y",
    "property float z",
    `element face ${tCount}`,
    "property list uchar int vertex_indices",
    "end_header",
    "",
  ].join("\n");
  const bodySize = vCount * 12 + tCount * (1 + 12);
  const out = Buffer.alloc(Buffer.byteLength(header) + bodySize);
  let p = out.write(header, 0, "ascii");
  for (let i = 0; i < m.vertices.length; i += 3) {
    out.writeFloatLE(m.vertices[i], p);
    out.writeFloatLE(m.vertices[i + 1], p + 4);
    out.writeFloatLE(m.vertices[i + 2], p + 8);
    p += 12;
  }
  for (let t = 0; t < m.triangles.length; t += 3) {
    out.writeUInt8(3, p);
    p += 1;
    out.writeInt32LE(m.triangles[t], p);
    out.writeInt32LE(m.triangles[t + 1], p + 4);
    out.writeInt32LE(m.triangles[t + 2], p + 8);
    p += 12;
  }
  return out;
}

// ------------------------------------------------------------
// 3MF
// ------------------------------------------------------------

const THREE_MF_XML_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
const MAX_MODEL_BYTES = 128 * 1024 * 1024;
const MAX_3MF_UNPACKED_BYTES = 256 * 1024 * 1024;

function parse3mf(buf: Buffer): Mesh {
  const files = unzipSync(new Uint8Array(buf));
  const unpackedBytes = Object.values(files).reduce((total, file) => total + file.byteLength, 0);
  if (unpackedBytes > MAX_3MF_UNPACKED_BYTES) {
    throw new Error("3MF archive expands beyond L2L's 256 MB safety limit.");
  }
  const modelPath = Object.keys(files).find((k) => /3dmodel\.model$/i.test(k));
  if (!modelPath) throw new Error("3MF archive contains no 3D model.");
  const xml = strFromU8(files[modelPath]);

  const vertices: number[] = [];
  const triangles: number[] = [];
  const vRe = /<vertex\s+([^>]*)\/>/g;
  const tRe = /<triangle\s+([^>]*)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = vRe.exec(xml)) !== null) {
    const attrs = m[1];
    const x = /x="([-\d.eE+]+)"/.exec(attrs);
    const y = /y="([-\d.eE+]+)"/.exec(attrs);
    const z = /z="([-\d.eE+]+)"/.exec(attrs);
    if (x && y && z) vertices.push(parseFloat(x[1]), parseFloat(y[1]), parseFloat(z[1]));
  }
  while ((m = tRe.exec(xml)) !== null) {
    const attrs = m[1];
    const v1 = /v1="(\d+)"/.exec(attrs);
    const v2 = /v2="(\d+)"/.exec(attrs);
    const v3 = /v3="(\d+)"/.exec(attrs);
    if (v1 && v2 && v3) triangles.push(parseInt(v1[1], 10), parseInt(v2[1], 10), parseInt(v3[1], 10));
  }
  if (triangles.length === 0) throw new Error("No triangles found in 3MF file.");
  return { vertices, triangles };
}

function write3mf(m: Mesh): Buffer {
  const vCount = m.vertices.length / 3;
  const tCount = triCount(m);
  const parts: string[] = [];
  for (let i = 0; i < m.vertices.length; i += 3) {
    parts.push(
      `<vertex x="${fmt(m.vertices[i])}" y="${fmt(m.vertices[i + 1])}" z="${fmt(m.vertices[i + 2])}"/>`,
    );
  }
  const verts = parts.join("");
  parts.length = 0;
  for (let t = 0; t < m.triangles.length; t += 3) {
    parts.push(
      `<triangle v1="${m.triangles[t]}" v2="${m.triangles[t + 1]}" v3="${m.triangles[t + 2]}"/>`,
    );
  }
  const tris = parts.join("");
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="${THREE_MF_XML_NS}">\n` +
    `<resources>\n<object id="1" type="model">\n<mesh>\n<vertices>\n${verts}\n</vertices>\n` +
    `<triangles>\n${tris}\n</triangles>\n</mesh>\n</object>\n</resources>\n` +
    `<build>\n<item objectid="1"/>\n</build>\n</model>\n`;

  return Buffer.from(
    zipSync({
      "3D/3dmodel.model": strToU8(xml),
      "[Content_Types].xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
          `</Types>`,
      ),
      "_rels/.rels": strToU8(
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Target="/3D/3dmodel.model" Id="rel0" ` +
          `Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
          `</Relationships>`,
      ),
    }),
  );
}

// ------------------------------------------------------------
// GLB (glTF 2.0 binary)
// ------------------------------------------------------------

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

function parseGlb(buf: Buffer): Mesh {
  if (buf.length < 12) throw new Error("GLB file too small.");
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error("Not a GLB file.");
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported glTF version ${version}.`);
  const declaredLength = buf.readUInt32LE(8);
  if (declaredLength !== buf.length) throw new Error("GLB file length is invalid.");

  let off = 12;
  let jsonBuf: Buffer | null = null;
  let binBuf: Buffer | null = null;
  while (off < buf.length) {
    if (off + 8 > buf.length) throw new Error("GLB chunk header is truncated.");
    const chunkLen = buf.readUInt32LE(off);
    const chunkType = buf.readUInt32LE(off + 4);
    const start = off + 8;
    if (chunkLen > buf.length - start) throw new Error("GLB chunk length is invalid.");
    if (chunkType === CHUNK_JSON) jsonBuf = buf.subarray(start, start + chunkLen);
    else if (chunkType === CHUNK_BIN) binBuf = buf.subarray(start, start + chunkLen);
    off = start + chunkLen + (chunkLen % 4 !== 0 ? 4 - (chunkLen % 4) : 0);
  }
  if (!jsonBuf) throw new Error("GLB has no JSON chunk.");

  const json = JSON.parse(jsonBuf.toString("utf8"));
  const mesh = json.meshes?.[0];
  const primitive = mesh?.primitives?.[0];
  if (!primitive) throw new Error("GLB contains no mesh primitives.");

  const accessors: Record<string, unknown> = json.accessors || [];
  const bufferViews: Record<string, unknown> = json.bufferViews || [];
  const buffers: Record<string, unknown> = json.buffers || [];

  const readAccessor = (accessorIdx: number): { data: Buffer; count: number; type: string } => {
    const acc = accessors[accessorIdx] as {
      bufferView?: number; byteOffset?: number; componentType?: number; count?: number; type?: string;
    };
    const bv = bufferViews[acc.bufferView ?? 0] as {
      buffer?: number; byteOffset?: number; byteLength?: number;
    };
    const bin = buffers[bv.buffer ?? 0];
    // GLB convention: buffer 0 = the BIN chunk
    if (bin !== undefined && bv.buffer === 0) {
      const base = binBuf ?? Buffer.alloc(0);
      const start = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      return { data: base.subarray(start, start + (bv.byteLength ?? 0)), count: acc.count ?? 0, type: acc.type ?? "" };
    }
    throw new Error("GLB uses external buffers — not supported.");
  };

  const posAcc = primitive.attributes?.POSITION;
  const idxAcc = primitive.indices;
  if (posAcc === undefined) throw new Error("GLB primitive has no POSITION attribute.");

  const pos = readAccessor(posAcc);
  const componentSize = 4; // FLOAT32
  const perVertex = pos.type === "VEC3" ? 3 : pos.type === "VEC2" ? 2 : 1;
  const vertices: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const off = i * perVertex * componentSize;
    const x = pos.data.readFloatLE(off);
    const y = pos.data.readFloatLE(off + 4);
    const z = perVertex >= 3 ? pos.data.readFloatLE(off + 8) : 0;
    vertices.push(x, y, z);
  }

  const triangles: number[] = [];
  if (idxAcc !== undefined) {
    const idx = readAccessor(idxAcc);
    const componentType = (accessors[idxAcc] as { componentType?: number }).componentType;
    const size = componentType === 5125 ? 4 : 2; // UINT32 vs UINT16
    for (let i = 0; i < idx.count; i++) {
      const off = i * size;
      triangles.push(size === 4 ? idx.data.readUInt32LE(off) : idx.data.readUInt16LE(off));
    }
  } else {
    // non-indexed mesh
    for (let i = 0; i < pos.count; i++) triangles.push(i);
  }
  if (triangles.length === 0) throw new Error("No triangles found in GLB file.");
  return { vertices, triangles };
}

function writeGlb(m: Mesh): Buffer {
  const vCount = m.vertices.length / 3;
  const tCount = triCount(m);

  // ---- build BIN chunk ----
  const posBytes = m.vertices.length * 4;
  const useUint16 = vCount <= 65535;
  const idxBytes = m.triangles.length * (useUint16 ? 2 : 4);
  // align index start to 4
  const idxStart = posBytes + (posBytes % 4 !== 0 ? 4 - (posBytes % 4) : 0);
  const totalBin = idxStart + idxBytes;
  const bin = Buffer.alloc(totalBin);
  for (let i = 0; i < m.vertices.length; i += 3) {
    bin.writeFloatLE(m.vertices[i], i * 4);
    bin.writeFloatLE(m.vertices[i + 1], i * 4 + 4);
    bin.writeFloatLE(m.vertices[i + 2], i * 4 + 8);
  }
  for (let t = 0; t < m.triangles.length; t += 3) {
    const off = idxStart + t * (useUint16 ? 2 : 4);
    if (useUint16) {
      bin.writeUInt16LE(m.triangles[t], off);
      bin.writeUInt16LE(m.triangles[t + 1], off + 2);
      bin.writeUInt16LE(m.triangles[t + 2], off + 4);
    } else {
      bin.writeUInt32LE(m.triangles[t], off);
      bin.writeUInt32LE(m.triangles[t + 1], off + 4);
      bin.writeUInt32LE(m.triangles[t + 2], off + 8);
    }
  }

  // min/max for the position accessor
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < m.vertices.length; i += 3) {
    minX = Math.min(minX, m.vertices[i]);
    minY = Math.min(minY, m.vertices[i + 1]);
    minZ = Math.min(minZ, m.vertices[i + 2]);
    maxX = Math.max(maxX, m.vertices[i]);
    maxY = Math.max(maxY, m.vertices[i + 1]);
    maxZ = Math.max(maxZ, m.vertices[i + 2]);
  }

  const json = {
    asset: { version: "2.0", generator: "L2L Converter" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
          },
        ],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: vCount,
        type: "VEC3",
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
      {
        bufferView: 1,
        componentType: useUint16 ? 5123 : 5125,
        count: m.triangles.length,
        type: "SCALAR",
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes },
      { buffer: 0, byteOffset: idxStart, byteLength: idxBytes },
    ],
    buffers: [{ byteLength: totalBin }],
  };

  const jsonStr = JSON.stringify(json);
  // glTF spec: JSON chunk must be padded with 0x20 (spaces), not null bytes
  const jsonPadded = Buffer.alloc(jsonStr.length + ((4 - (jsonStr.length % 4)) % 4), 0x20);
  jsonPadded.write(jsonStr, 0, "utf8");
  const binPadded = Buffer.alloc(totalBin + ((4 - (totalBin % 4)) % 4));
  bin.copy(binPadded);

  const out = Buffer.alloc(12 + 8 + jsonPadded.length + 8 + binPadded.length);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonPadded.length, 12);
  out.writeUInt32LE(CHUNK_JSON, 16);
  jsonPadded.copy(out, 20);
  let o = 20 + jsonPadded.length;
  out.writeUInt32LE(binPadded.length, o);
  out.writeUInt32LE(CHUNK_BIN, o + 4);
  binPadded.copy(out, o + 8);
  return out;
}

// ------------------------------------------------------------
// Formatting / dispatch
// ------------------------------------------------------------

function fmt(n: number): string {
  const s = Number.isInteger(n) ? String(n) : n.toPrecision(10);
  return s;
}

export function getMeshInfo(buf: Buffer, ext: string): { vertices: number; triangles: number } | null {
  try {
    const reader = READERS[ext.toLowerCase()];
    if (!reader) return null;
    const mesh = reader(buf);
    return { vertices: mesh.vertices.length / 3, triangles: mesh.triangles.length / 3 };
  } catch {
    return null;
  }
}

const READERS: Record<string, (buf: Buffer) => Mesh> = {
  stl: parseStl,
  obj: parseObj,
  ply: parsePly,
  "3mf": parse3mf,
  glb: parseGlb,
};

const WRITERS: Record<string, (m: Mesh) => Buffer> = {
  stl: writeStl,
  obj: (m) => Buffer.from(writeObj(m), "utf8"),
  ply: writePly,
  "3mf": write3mf,
  glb: writeGlb,
};

export async function convertModel(opts: ModelJob): Promise<string[]> {
  const { inputPath, target, outputDir, report } = opts;
  const base = path.basename(inputPath, path.extname(inputPath));
  const ext = path.extname(inputPath).slice(1).toLowerCase();

  const reader = READERS[ext];
  const writer = WRITERS[target];
  if (!reader) throw new Error(`Unsupported 3D source: .${ext}`);
  if (!writer) throw new Error(`Unsupported 3D target: ${target}`);
  if (fs.statSync(inputPath).size > MAX_MODEL_BYTES) {
    throw new Error("3D model is larger than L2L's 128 MB safety limit.");
  }

  report({ percent: 20, stage: "Reading mesh…" });
  const mesh = reader(fs.readFileSync(inputPath));

  report({ percent: 60, stage: `Writing ${target.toUpperCase()}…` });
  const outExt = target === "glb" ? "glb" : target === "3mf" ? "3mf" : target;
  const outputPath = uniquePath(outputDir, base, outExt);
  fs.writeFileSync(outputPath, writer(mesh));

  report({ percent: 100, stage: "Done" });
  return [outputPath];
}
