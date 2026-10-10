import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
await mkdir(directory, { recursive: true });

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name, data) {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function makePng(size) {
  const scale = size / 192;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const outer = [[96, 15], [111, 43], [139, 78], [153, 108], [150, 134], [137, 157], [116, 171], [90, 176], [65, 167], [47, 148], [39, 124], [44, 101], [57, 79], [66, 102], [79, 94], [87, 68], [96, 15]];
  const inner = [[98, 94], [113, 113], [122, 129], [118, 145], [105, 155], [88, 155], [75, 145], [73, 132], [81, 118], [88, 136], [100, 129], [98, 94]];

  for (let y = 0; y < size; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      const inOuter = insidePolygon(px, py, outer);
      const inInner = insidePolygon(px, py, inner);
      if (!inOuter) continue;
      const offset = row + 1 + x * 4;
      const warm = Math.max(0, Math.min(1, (py - 15) / 155));
      raw[offset] = inInner ? 255 : Math.round(255 - 22 * warm);
      raw[offset + 1] = inInner ? Math.round(187 - 54 * warm) : Math.round(72 + 30 * warm);
      raw[offset + 2] = inInner ? Math.round(82 - 25 * warm) : Math.round(142 + 56 * warm);
      raw[offset + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="46" fill="#100c17"/><path fill="#f2488d" d="M96 15c15 28 43 63 57 93 8 18 2 39-16 53-21 16-53 20-78 6-24-14-34-37-23-66 6-15 16-29 22-43 2 15 10 18 19 15 10-4 14-25 19-58Z"/><path fill="#ffbd52" d="M98 94c15 19 24 35 20 51-4 17-25 22-39 11-13-10-8-23 2-38 4 18 16 11 17-24Z"/></svg>`;
await Promise.all([
  writeFile(path.join(directory, 'spark-192.png'), makePng(192)),
  writeFile(path.join(directory, 'spark-512.png'), makePng(512)),
  writeFile(path.join(directory, 'favicon.svg'), favicon),
]);
