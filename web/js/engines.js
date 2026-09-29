// Playback engine: HTML5 audio (background play, lock screen) for the songs uploaded through the bot.
// Events passed to the listener: play, pause, time, ended, error, waiting, playing, meta, seeked.

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
