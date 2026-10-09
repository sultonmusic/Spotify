// Firebase Authentication: email/password + Google. The SDK is loaded from the CDN only when
// CONFIG.firebase.apiKey is set, so the site works exactly as before until Firebase is configured.
import { CONFIG } from "./config.js";
import { emit } from "./store.js";
import { inTelegram } from "./tg.js";

const SDK = "https://www.gstatic.com/firebasejs/10.14.1";
export const authEnabled = !!CONFIG.firebase?.apiKey;

export let currentUser = null;
let fb = null, auth = null, ready = null;

function load() {
  if (!authEnabled) return Promise.resolve(false);
  ready ||= (async () => {
    const [app, mod] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`)]);
    fb = mod;
    auth = mod.getAuth(app.initializeApp(CONFIG.firebase));
    mod.onAuthStateChanged(auth, (u) => {
      currentUser = u ? { uid: u.uid, email: u.email, name: u.displayName, photo: u.photoURL } : null;
      emit("auth", currentUser);
    });
    return true;
  })().catch((e) => { console.warn("firebase failed to load", e); ready = null; return false; });
  return ready;
}

export const initAuth = () => { load(); };

const need = async () => { if (!(await load())) throw Object.assign(new Error("offline"), { code: "auth/network-request-failed" }); };

export async function signUp(email, password) { await need(); await fb.createUserWithEmailAndPassword(auth, email, password); }
export async function signIn(email, password) { await need(); await fb.signInWithEmailAndPassword(auth, email, password); }
export async function resetPassword(email) { await need(); await fb.sendPasswordResetEmail(auth, email); }
export async function signOut() { await need(); await fb.signOut(auth); }

export async function signInGoogle() {
  await need();
  const provider = new fb.GoogleAuthProvider();
  // Popups are blocked inside Telegram's webview and many mobile browsers; fall back to a redirect.
  try { await fb.signInWithPopup(auth, provider); }
  catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") await fb.signInWithRedirect(auth, provider);
    else throw e;
  }
}

/** Google sign-in doesn't work inside Telegram's webview (Google blocks it); email/password does. */
export const googleAllowed = !inTelegram;

/** Maps a Firebase error code to an i18n key. */
export function errorKey(e) {
  switch (e?.code) {
    case "auth/invalid-credential": case "auth/wrong-password": case "auth/user-not-found": case "auth/invalid-login-credentials": return "auth.err.invalid";
    case "auth/email-already-in-use": return "auth.err.exists";
    case "auth/weak-password": return "auth.err.weak";
    case "auth/invalid-email": case "auth/missing-email": return "auth.err.email";
    case "auth/network-request-failed": return "auth.err.network";
    case "auth/popup-closed-by-user": case "auth/cancelled-popup-request": return null;
    default: return "auth.err.other";
  }
}
