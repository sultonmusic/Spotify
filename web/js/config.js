// Site settings. Change the name/bot here if you rename things.
export const CONFIG = {
  appName: "Cavi Music",
  botUsername: "CaviSpotifybot",
  library: "library/songs.json",
  // Spotify standard: a play counts after 30 seconds of actual listening.
  playThreshold: 30,
  // How often to look for newly added songs while the app is open (ms).
  refreshEvery: 90_000,
  // Cloudflare Worker (relay/) that counts ad views, skips and clicks for the bot's /ads command.
  statsUrl: "https://cavi-music-relay.sales-infarmatik-tj.workers.dev",
  // The Android app (android/, published by .github/workflows/android.yml).
  apkUrl: "https://github.com/sultonmusic/Spotify/releases/download/android/cavi-music.apk",
};
