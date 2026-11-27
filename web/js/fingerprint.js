// The station's own song recognition, for songs Shazam's catalog doesn't know (e.g. new or independent
// releases). The site makes the same "ovoz izi" (Shazam-format signature: spectral peaks) for every station
// song when it is built; a recording is matched against them by peaks that line up in time.
// Used by the browser (search → microphone) and by scripts/fingerprints.mjs (site build).

const PASSES_PER_SECOND = 125; // one FFT pass every 128 samples at 16 kHz
export const INDEX_PEAKS_PER_SECOND = 5;

/** Peaks of a Shazam signature ("data:audio/vnd.shazam.sig;base64,…"): [{t, f, m}] in time order.
 *  t: FFT pass (8 ms), f: frequency bin ×64, m: magnitude. */
export function signaturePeaks(uri) {
  const b64 = String(uri || "").split(",")[1] || "";
  const bin = typeof atob === "function" ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    : Uint8Array.from(Buffer.from(b64, "base64"));
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const peaks = [];
  let at = 48 + 8; // header + the 0x40000000 tag and its size
  while (at + 8 <= bin.length) {
    const tag = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    at += 8;
    const end = Math.min(at + size, bin.length);
    if ((tag & 0xfffffff0) === 0x60030040) {
      let p = at, pass = 0;
      while (p < end) {
        let step = bin[p];
        if (step === 0xff) { // absolute pass number follows
          if (p + 5 > end) break;
          pass = view.getUint32(p + 1, true);
          p += 5;
          step = bin[p];
        }
        if (p + 5 > end) break;
        pass += step;
        peaks.push({ t: pass, m: view.getUint16(p + 1, true), f: view.getUint16(p + 3, true) });
        p += 5;
      }
    }
    at = end + ((4 - (size % 4)) % 4);
  }
  return peaks.sort((a, b) => a.t - b.t);
}

/** The strongest few peaks of every second: what the station keeps for each song. */
export function strongest(peaks, perSecond = INDEX_PEAKS_PER_SECOND) {
  const bySecond = new Map();
  for (const p of peaks) {
    const s = Math.floor(p.t / PASSES_PER_SECOND);
    if (!bySecond.has(s)) bySecond.set(s, []);
    bySecond.get(s).push(p);
  }
  const out = [];
  for (const list of bySecond.values()) out.push(...list.sort((a, b) => b.m - a.m).slice(0, perSecond));
  return out.sort((a, b) => a.t - b.t);
}

/** Song peaks → compact base64 (uint16 pairs: pass, frequency). */
export function encodePeaks(peaks) {
  const kept = peaks.filter((p) => p.t < 65536);
  const arr = new Uint16Array(kept.length * 2);
  kept.forEach((p, i) => { arr[i * 2] = p.t; arr[i * 2 + 1] = p.f; });
  const bytes = new Uint8Array(arr.buffer);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function decodePeaks(b64) {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Uint16Array(raw.buffer, 0, raw.length >> 1);
}

let index = null;
/** {songs: {id: base64}} → frequency-bin buckets of [song, pass]. */
export function buildIndex(data) {
  const ids = Object.keys(data?.songs || {});
  const buckets = new Map();
  ids.forEach((id, n) => {
    const arr = decodePeaks(data.songs[id]);
    for (let i = 0; i < arr.length; i += 2) {
      const key = arr[i + 1] >> 6;
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(n, arr[i], arr[i + 1]);
    }
  });
  return { ids, buckets };
}

/** Station songs ranked by how many of the recording's peaks line up with them: [{id, score}]. */
export function matchPeaks(idx, peaks) {
  const votes = new Map(); // song*200000 + offset/2 → count
  for (const q of peaks) {
    const bin = q.f >> 6;
    for (let b = bin - 1; b <= bin + 1; b++) {
      const list = idx.buckets.get(b);
      if (!list) continue;
      for (let i = 0; i < list.length; i += 3) {
        if (Math.abs(list[i + 2] - q.f) > 48) continue;
        const key = list[i] * 200000 + ((list[i + 1] - q.t + 100000) >> 1);
        votes.set(key, (votes.get(key) || 0) + 1);
      }
    }
  }
  const perSong = new Map(); // best offset (with its neighbours) per song
  for (const [key, n] of votes) {
    const total = n + (votes.get(key - 1) || 0) + (votes.get(key + 1) || 0);
    const song = Math.floor(key / 200000);
    if (total > (perSong.get(song) || 0)) perSong.set(song, total);
  }
  return [...perSong].sort((a, b) => b[1] - a[1]).map(([n, score]) => ({ id: idx.ids[n], score }));
}

export const MIN_SCORE = 12;

/** Browser: the recording's signature against the station's own fingerprints → song id or null.
 *  sameSong(a, b): true when two ids are copies of one song (those don't count as a rival match). */
export async function matchStation(signatureUri, url, sameSong = () => false) {
  if (!index) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    index = buildIndex(await res.json());
  }
  const [best, ...rest] = matchPeaks(index, signaturePeaks(signatureUri));
  if (!best || best.score < MIN_SCORE) return null;
  const rival = rest.find((r) => !sameSong(best.id, r.id));
  return !rival || best.score >= rival.score * 1.8 ? best.id : null;
}
