import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const MAX_KB = 100;
const path = new URL("../dist/widget.js", import.meta.url);
const raw = readFileSync(path);
const gzKb = gzipSync(raw).length / 1024;

if (gzKb > MAX_KB) {
  console.error(`widget.js gzip ${gzKb.toFixed(1)} kB exceeds ${MAX_KB} kB limit`);
  process.exit(1);
}

console.log(`widget.js gzip ${gzKb.toFixed(1)} kB (limit ${MAX_KB} kB)`);
