/**
 * generate-dummy-glb.js
 *
 * Node.js スクリプト: 最小限のGLB（立方体）を生成し、
 * public/sample.glb として保存します。
 *
 * 実行方法: node scripts/generate-dummy-glb.js
 *
 * GLB はバイナリGLTF形式です。
 * このスクリプトは外部ライブラリ不要で、仕様に従ったバイナリを直接組み立てます。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../public/sample.glb');

// ── GLTF JSON ────────────────────────────────────────────────
// 1m × 1m × 1m の立方体 (BoxGeometry)
const gltfJson = {
  asset: { version: '2.0', generator: 'WebAR dummy generator' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'Cube' }],
  meshes: [{
    name: 'Cube',
    primitives: [{
      attributes: { POSITION: 0, NORMAL: 1 },
      indices: 2,
      material: 0,
    }],
  }],
  materials: [{
    name: 'Material',
    pbrMetallicRoughness: {
      baseColorFactor: [0.4, 0.5, 1.0, 1.0],
      metallicFactor: 0.1,
      roughnessFactor: 0.7,
    },
  }],
  accessors: [
    // 0: POSITION (24 vertices × vec3)
    {
      bufferView: 0,
      componentType: 5126, // FLOAT
      count: 24,
      type: 'VEC3',
      min: [-0.5, -0.5, -0.5],
      max: [0.5, 0.5, 0.5],
    },
    // 1: NORMAL (24 vertices × vec3)
    {
      bufferView: 1,
      componentType: 5126,
      count: 24,
      type: 'VEC3',
    },
    // 2: INDICES (36 uint16)
    {
      bufferView: 2,
      componentType: 5123, // UNSIGNED_SHORT
      count: 36,
      type: 'SCALAR',
    },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0,   byteLength: 288 }, // positions: 24*3*4 = 288
    { buffer: 0, byteOffset: 288, byteLength: 288 }, // normals:   24*3*4 = 288
    { buffer: 0, byteOffset: 576, byteLength: 72  }, // indices:   36*2   = 72
  ],
  buffers: [{ byteLength: 648 }],
};

// ── Build binary buffer ───────────────────────────────────────
// Box vertices (4 vertices per face × 6 faces = 24)
const positions = new Float32Array([
  // +Z face
  -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5,
  // -Z face
   0.5, -0.5, -0.5,  -0.5, -0.5, -0.5,  -0.5,  0.5, -0.5,   0.5,  0.5, -0.5,
  // +X face
   0.5, -0.5,  0.5,   0.5, -0.5, -0.5,   0.5,  0.5, -0.5,   0.5,  0.5,  0.5,
  // -X face
  -0.5, -0.5, -0.5,  -0.5, -0.5,  0.5,  -0.5,  0.5,  0.5,  -0.5,  0.5, -0.5,
  // +Y face
  -0.5,  0.5,  0.5,   0.5,  0.5,  0.5,   0.5,  0.5, -0.5,  -0.5,  0.5, -0.5,
  // -Y face
  -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5, -0.5,  0.5,  -0.5, -0.5,  0.5,
]);

const normals = new Float32Array([
  // +Z
   0,0,1,  0,0,1,  0,0,1,  0,0,1,
  // -Z
   0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
  // +X
   1,0,0,  1,0,0,  1,0,0,  1,0,0,
  // -X
  -1,0,0, -1,0,0, -1,0,0, -1,0,0,
  // +Y
   0,1,0,  0,1,0,  0,1,0,  0,1,0,
  // -Y
   0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
]);

// 2 triangles per face × 6 faces = 12 triangles = 36 indices
const indices = new Uint16Array([
   0, 1, 2,   0, 2, 3,   // +Z
   4, 5, 6,   4, 6, 7,   // -Z
   8, 9,10,   8,10,11,   // +X
  12,13,14,  12,14,15,   // -X
  16,17,18,  16,18,19,   // +Y
  20,21,22,  20,22,23,   // -Y
]);

// Concatenate into a single buffer
const binaryBuffer = Buffer.concat([
  Buffer.from(positions.buffer),
  Buffer.from(normals.buffer),
  Buffer.from(indices.buffer),
]);

// Update buffer byteLength in JSON
gltfJson.buffers[0].byteLength = binaryBuffer.byteLength;

// ── GLB structure ─────────────────────────────────────────────
// GLB = header (12B) + JSON chunk + BIN chunk

const jsonText = JSON.stringify(gltfJson);
// JSON chunk must be 4-byte aligned (padded with spaces)
const jsonPadded = jsonText.padEnd(Math.ceil(jsonText.length / 4) * 4, ' ');
const jsonBytes = Buffer.from(jsonPadded, 'utf-8');

// BIN chunk must be 4-byte aligned (padded with zeros)
const binPadLength = (4 - (binaryBuffer.length % 4)) % 4;
const binPadded = Buffer.concat([binaryBuffer, Buffer.alloc(binPadLength)]);

const jsonChunkLength = jsonBytes.length;
const binChunkLength  = binPadded.length;
const totalLength     = 12 + 8 + jsonChunkLength + 8 + binChunkLength;

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546C67, 0);  // magic: 'glTF'
header.writeUInt32LE(2,           4);  // version
header.writeUInt32LE(totalLength, 8);  // total file length

const jsonChunkHeader = Buffer.alloc(8);
jsonChunkHeader.writeUInt32LE(jsonChunkLength, 0);
jsonChunkHeader.writeUInt32LE(0x4E4F534A,     4); // type: JSON

const binChunkHeader = Buffer.alloc(8);
binChunkHeader.writeUInt32LE(binChunkLength, 0);
binChunkHeader.writeUInt32LE(0x004E4942,     4);  // type: BIN\0

const glbBuffer = Buffer.concat([
  header,
  jsonChunkHeader, jsonBytes,
  binChunkHeader,  binPadded,
]);

// ── Write output ──────────────────────────────────────────────
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, glbBuffer);
console.log(`✓ sample.glb を生成しました: ${OUTPUT_PATH} (${glbBuffer.length} bytes)`);
