import { CONFIG } from "./config.js";

const CLIP_MS = 8_000;
let vibraReady;

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Recording stopped", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function loadVibra() {
  if (window.Module?.HEAPU8 && window.Module?._malloc && window.Module?.ccall) {
    return Promise.resolve(window.Module);
  }
  if (vibraReady) return vibraReady;

  vibraReady = new Promise((resolve, reject) => {
    const mod = window.Module || {};
    const version = new URL(import.meta.url).searchParams.get("v");
    const wasmUrl = new URL("../vendor/vibra/vibra.wasm", import.meta.url);
    if (version) wasmUrl.searchParams.set("v", version);
    mod.locateFile = (file) => file.endsWith(".wasm") ? wasmUrl.href : file;
    const timeout = setTimeout(() => reject(new Error("Shazam moduli yuklanmadi")), 20_000);
    mod.onRuntimeInitialized = () => {
      clearTimeout(timeout);
      resolve(mod);
    };
    mod.onAbort = (reason) => {
      clearTimeout(timeout);
      reject(new Error(String(reason || "Shazam moduli ishga tushmadi")));
    };
    window.Module = mod;

    const script = document.createElement("script");
    script.src = new URL("../vendor/vibra/vibra.js", import.meta.url).href;
    if (version) script.src += `?v=${encodeURIComponent(version)}`;
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Shazam moduli yuklanmadi"));
    };
    document.head.append(script);
  }).catch((error) => {
    vibraReady = null;
    throw error;
  });
  return vibraReady;
}

function fingerprint(mod, pcm, sampleRate) {
  const raw = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const input = mod._malloc(raw.byteLength);
  let signature = 0;
  try {
    mod.HEAPU8.set(raw, input);
    signature = mod.ccall("GetFloatPcmSignature", "number",
      ["number", "number", "number", "number", "number"],
      [input, raw.byteLength, sampleRate, 32, 1]);
    const uri = mod.ccall("GetFingerprint", "string", ["number"], [signature]);
    const samplems = mod.ccall("GetSampleMs", "number", ["number"], [signature]);
    if (!uri || !samplems) throw new Error("Ovoz izi yaratilmadi");
    return { uri, samplems };
  } finally {
    if (signature && mod._FreeFingerprint) mod.ccall("FreeFingerprint", null, ["number"], [signature]);
    mod._free(input);
  }
}

export async function identifyNearbySong(onStatus, signal) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Bu brauzer mikrofonni qo'llamaydi");

  let stream, context, source, recorder;
  const chunks = [];
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (signal?.aborted) throw new DOMException("Recording stopped", "AbortError");

    context = new AudioContext({ latencyHint: "interactive" });
    await context.resume();
    const sampleRate = context.sampleRate;
    const workletUrl = new URL("./audio-search-worklet.js", import.meta.url);
    await context.audioWorklet.addModule(workletUrl.href);
    source = context.createMediaStreamSource(stream);
    recorder = new AudioWorkletNode(context, "cavi-audio-recorder", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    recorder.port.onmessage = (event) => chunks.push(event.data);
    source.connect(recorder);
    recorder.connect(context.destination);

    onStatus("search.voiceListening");
    const modPromise = loadVibra();
    await wait(CLIP_MS, signal);
    onStatus("search.voiceSearching");

    recorder.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
    recorder = source = context = stream = null;

    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (length < 16_000) throw new Error("Mikrofondan ovoz olinmadi");
    const pcm = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    chunks.length = 0;

    const mod = await modPromise;
    const signature = fingerprint(mod, pcm, sampleRate);
    pcm.fill(0);

    const response = await fetch(`${CONFIG.statsUrl}/identify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signature),
      signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Qo'shiqni aniqlashda xatolik");
    return data.track || null;
  } finally {
    recorder?.disconnect();
    source?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== "closed") await context.close().catch(() => {});
    chunks.length = 0;
  }
}
