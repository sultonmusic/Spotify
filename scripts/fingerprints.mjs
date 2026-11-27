// Site build: the station's own "ovoz izi" for every song (library/fingerprints.json), so the search page's
// microphone finds station songs that Shazam's catalog doesn't know. Only new songs are processed: the
// fingerprints of the live site are reused.
// Usage: node scripts/fingerprints.mjs <site dir> [live site url]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { encodePeaks, signaturePeaks, strongest } from "../web/js/fingerprint.js";

const [site, liveUrl = ""] = process.argv.slice(2);
const BUDGET_MS = Number(process.env.FP_BUDGET_SECONDS || 480) * 1000; // the rest waits for the next build
const CHUNK = 16000 * 12; // samples
const CHUNK_PASSES = CHUNK / 128;
const started = Date.now();
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(site, "library", "fingerprints.json");

function loadVibra() {
  const js = path.join(here, "..", "web", "vendor", "vibra", "vibra.js");
  return new Promise((resolve, reject) => {
    globalThis.Module = {
      instantiateWasm(imports, done) {
        WebAssembly.instantiate(fs.readFileSync(js.replace(/\.js$/, ".wasm")), imports)
          .then((r) => done(r.instance), reject);
        return {};
      },
      onRuntimeInitialized() { resolve(globalThis.Module); },
      onAbort: reject,
    };
    vm.runInThisContext(fs.readFileSync(js, "utf8"));
  });
}

function signature(M, pcm) {
  const raw = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const input = M._malloc(raw.byteLength);
  let sig = 0;
  try {
    M.HEAPU8.set(raw, input);
    sig = M.ccall("GetFloatPcmSignature", "number", ["number", "number", "number", "number", "number"],
      [input, raw.byteLength, 16000, 32, 1]);
    return M.ccall("GetFingerprint", "string", ["number"], [sig]);
  } finally {
    if (sig) M.ccall("FreeFingerprint", null, ["number"], [sig]);
    M._free(input);
  }
}

const library = JSON.parse(fs.readFileSync(path.join(site, "library", "songs.json"), "utf8"));
const songs = (Array.isArray(library) ? library : library.songs || []).filter((s) => s.src && !s.previewOnly);
let previous = {};
if (liveUrl) {
  try {
    const res = await fetch(`${liveUrl.replace(/\/$/, "")}/library/fingerprints.json`, { signal: AbortSignal.timeout(30000) });
    if (res.ok) previous = (await res.json()).songs || {};
  } catch (error) { console.log(`fingerprints: live file not read (${error.message})`); }
}
const result = {};
const todo = [];
for (const s of songs) (previous[s.id] ? (result[s.id] = previous[s.id]) : todo.push(s));

let made = 0, failed = 0;
if (todo.length) {
  let M;
  try { M = await loadVibra(); } catch (error) { console.log(`fingerprints: vibra failed (${error})`); }
  for (const s of M ? todo : []) {
    if (Date.now() - started > BUDGET_MS) break;
    const local = path.join(site, s.src);
    const input = /^https?:/.test(s.src) ? s.src : local;
    try {
      const pcmBytes = execFileSync("ffmpeg", ["-loglevel", "error", "-i", input, "-t", "540", "-ac", "1",
        "-ar", "16000", "-f", "f32le", "pipe:1"], { maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
      const pcm = new Float32Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength >> 2);
      // the signature library reads ~12 s at a time: the song in 12-second pieces, on one timeline
      const peaks = [];
      for (let start = 0; start + 16000 * 3 <= pcm.length; start += CHUNK) {
        const shift = (start / CHUNK) * CHUNK_PASSES;
        for (const p of signaturePeaks(signature(M, pcm.subarray(start, start + CHUNK)))) peaks.push({ ...p, t: p.t + shift });
      }
      result[s.id] = encodePeaks(strongest(peaks));
      made++;
    } catch (error) {
      failed++;
      console.log(`fingerprints: ${s.id} failed (${String(error.message || error).split("\n")[0]})`);
    }
  }
}
fs.writeFileSync(out, JSON.stringify({ v: 1, songs: result }));
console.log(`fingerprints: ${Object.keys(result).length}/${songs.length} songs (${made} new, ${failed} failed, ` +
  `${todo.length - made - failed} left for the next build), ${Math.round(fs.statSync(out).size / 1024)} KB`);
