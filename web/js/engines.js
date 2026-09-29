// Playback engines with one interface:
//  - AudioEngine: songs stored on the site (uploaded files) — HTML5 audio, background play, lock screen.
//  - YTEngine:    songs added by name — the official YouTube embed (never downloaded), shown as video.
// Events passed to the listener: play, pause, time, ended, error, waiting, playing, meta, seeked, blocked.

export class AudioEngine {
  constructor(listener) {
    this.emit = listener;
    this.el = new Audio();
    this.el.preload = "auto";
    this.el.setAttribute("playsinline", "");
    this.song = null;
    this.retried = false;
    const on = (ev, name = ev) => this.el.addEventListener(ev, () => this.emit(name));
    on("play"); on("pause"); on("ended"); on("waiting"); on("playing"); on("seeked");
    on("timeupdate", "time");
    on("loadedmetadata", "meta");
    this.el.addEventListener("error", () => {
      if (!this.song || !this.el.getAttribute("src")) return;
      // Signed release-asset URLs expire: reload once at the same position before giving up.
      if (!this.retried && this.el.currentTime > 0) {
        this.retried = true;
        const at = this.el.currentTime;
        this.el.src = this.song.src;
        this.el.addEventListener("loadedmetadata", () => { this.el.currentTime = at; this.play(); }, { once: true });
        return;
      }
      this.emit("error");
    });
  }
  load(song, { autoplay = true, at = 0 } = {}) {
    this.song = song;
    this.retried = false;
    this.el.src = song.src;
    if (at > 0) this.el.addEventListener("loadedmetadata", () => { this.el.currentTime = at; }, { once: true });
    if (autoplay) this.play();
  }
  play() {
    const p = this.el.play();
    if (p && p.catch) p.catch((e) => { if (e.name !== "AbortError") this.emit("pause"); });
  }
  pause() { this.el.pause(); }
  seek(t) { this.el.currentTime = t; }
  stop() { this.el.pause(); this.el.removeAttribute("src"); this.el.load(); this.song = null; }
  setVolume(v) { this.el.volume = Math.max(0, Math.min(1, v)); }
  get time() { return this.el.currentTime || 0; }
  get duration() { return isFinite(this.el.duration) ? this.el.duration : this.song?.duration || 0; }
  get paused() { return this.el.paused || this.el.ended; }
}

// ------------------------------------------------------------------ YouTube
let apiPromise = null;
function loadApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) { resolve(window.YT); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => { apiPromise = null; reject(new Error("YouTube API failed to load")); };
    document.head.append(s);
  });
  return apiPromise;
}

const host = document.createElement("div");
host.className = "yt-host";
host.hidden = true;
host.innerHTML = '<div id="yt-frame"></div><button class="yt-expand" aria-label="Open"></button>';
document.body.append(host);
let expandHandler = () => {};
host.querySelector(".yt-expand").addEventListener("click", () => expandHandler());
export function onVideoExpand(fn) { expandHandler = fn; }

let videoActive = false;
/** Positions the video: over the "now playing" artwork slot when it is open, otherwise as a small card. */
export function placeVideo() {
  if (!videoActive) { host.hidden = true; return; }
  host.hidden = false;
  const slot = document.querySelector(".np.open #np-video-slot");
  if (slot) {
    const r = slot.getBoundingClientRect();
    host.classList.remove("pip");
    host.classList.add("in-np");
    Object.assign(host.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  } else {
    host.classList.remove("in-np");
    host.classList.add("pip");
    Object.assign(host.style, { left: "", top: "", width: "", height: "" });
  }
}
window.addEventListener("resize", placeVideo);

export class YTEngine {
  constructor(listener) {
    this.emit = listener;
    this.yt = null;
    this.ready = null;
    this.ids = [];
    this.idx = 0;
    this.at = 0;
    this.want = false;
    this._paused = true;
    this.poll = null;
    this.blockTimer = null;
    this.volume = 1;
  }
  ensure() {
    if (this.ready) return this.ready;
    this.ready = loadApi().then((YT) => new Promise((resolve) => {
      this.yt = new YT.Player("yt-frame", {
        width: "100%", height: "100%",
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, origin: location.origin },
        events: {
          onReady: () => { this.yt.setVolume(Math.round(this.volume * 100)); resolve(); },
          onStateChange: (e) => this.onState(e.data),
          onError: (e) => this.onError(e.data),
        },
      });
    }));
    this.ready.catch(() => { this.ready = null; this.emit("error"); });
    return this.ready;
  }
  async load(song, { autoplay = true, at = 0 } = {}) {
    this.ids = song.yt || [];
    this.idx = 0;
    this.at = at;
    this.want = autoplay;
    this._paused = true;
    videoActive = true;
    placeVideo();
    try { await this.ensure(); } catch { return; }
    this.cue();
  }
  cue() {
    const videoId = this.ids[this.idx];
    if (!videoId || !this.yt) { this.emit("error"); return; }
    if (this.want) {
      this.yt.loadVideoById({ videoId, startSeconds: this.at || 0 });
      clearTimeout(this.blockTimer);
      // Mobile browsers may refuse to start a video that wasn't tapped: ask the listener to tap it.
      this.blockTimer = setTimeout(() => { if (this.want && this._paused) this.emit("blocked"); }, 3500);
    } else {
      this.yt.cueVideoById({ videoId, startSeconds: this.at || 0 });
    }
    this.emit("meta");
  }
  onState(s) {
    if (s === 1) {
      this._paused = false;
      clearTimeout(this.blockTimer);
      this.emit("play");
      this.emit("playing");
      clearInterval(this.poll);
      this.poll = setInterval(() => this.emit("time"), 250);
    } else if (s === 2 || s === 0 || s === 5) {
      if (!this._paused || s === 0) {
        this._paused = true;
        clearInterval(this.poll);
        this.emit(s === 0 ? "ended" : "pause");
      }
    } else if (s === 3) {
      this.emit("waiting");
    }
  }
  onError(code) {
    // 100: removed/private, 101/150: owner disabled embedding, 2/5: bad id / player error -> try the next video
    if (this.idx < this.ids.length - 1) {
      this.idx += 1;
      this.cue();
    } else {
      this.emit("error");
    }
    console.warn("YouTube error", code);
  }
  play() { this.want = true; if (this.yt) this.yt.playVideo(); else this.ensure().then(() => this.cue()); }
  pause() { this.want = false; this.yt?.pauseVideo(); }
  seek(t) { this.yt?.seekTo(t, true); setTimeout(() => this.emit("seeked"), 50); }
  stop() {
    this.want = false;
    clearInterval(this.poll);
    clearTimeout(this.blockTimer);
    try { this.yt?.stopVideo(); } catch { /* not ready */ }
    this._paused = true;
    videoActive = false;
    placeVideo();
  }
  setVolume(v) { this.volume = v; try { this.yt?.setVolume(Math.round(v * 100)); } catch { /* not ready */ } }
  get time() { try { return this.yt?.getCurrentTime?.() || 0; } catch { return 0; } }
  get duration() { try { return this.yt?.getDuration?.() || 0; } catch { return 0; } }
  get paused() { return this._paused; }
}
