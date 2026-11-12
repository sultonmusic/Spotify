// Firebase account (email / Google / phone) + Firestore sync of the listener's personal data,
// so favourites and history survive clearing the browser and follow the listener across devices.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup, RecaptchaVerifier, signInWithPhoneNumber,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { exportUser, importUser, setRemoteSync } from "./store.js";

const firebaseConfig = {
  apiKey: "AIzaSyAYpiYWAJ9x0rj7AkD9RxNwlumr_i26K4I",
  authDomain: "cavi-music-app.firebaseapp.com",
  projectId: "cavi-music-app",
  storageBucket: "cavi-music-app.firebasestorage.app",
  messagingSenderId: "882671671012",
  appId: "1:882671671012:web:fd66fa73f94ad71bb4bef1",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.useDeviceLanguage();
const db = getFirestore(app);

let current = null;
let ready = false;
let pushTimer = null;
const subs = new Set();

export const currentUser = () => current;
export const authReady = () => ready;
export function onAuth(fn) { subs.add(fn); return () => subs.delete(fn); }
const notify = () => { for (const fn of subs) { try { fn(current); } catch (e) { console.error(e); } } };

/** Short label for the signed-in account. */
export function accountLabel(u = current) {
  return u ? (u.email || u.phoneNumber || u.displayName || "") : "";
}

const ref = (uid) => doc(db, "users", uid);
const SYNC_FLAG = "ms.fb.uid";

async function pull(user) {
  try {
    const snap = await getDoc(ref(user.uid));
    let first = true;
    try { first = localStorage.getItem(SYNC_FLAG) !== user.uid; } catch { /* ignore */ }
    // First time this device meets this account: keep favourites from both sides instead of letting one win.
    importUser(snap.exists() ? snap.data() : null, { union: first });
    try { localStorage.setItem(SYNC_FLAG, user.uid); } catch { /* ignore */ }
    await push();
  } catch (e) {
    console.warn("account pull failed", e);
  }
}

async function push() {
  if (!current) return;
  try { await setDoc(ref(current.uid), { ...exportUser(), updatedAt: Date.now() }); }
  catch (e) { console.warn("account push failed", e); }
}

function pushSoon() {
  if (!current) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 2500);
}

setRemoteSync(pushSoon);

onAuthStateChanged(auth, (u) => {
  current = u;
  ready = true;
  notify();
  if (u) pull(u);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && current) push();
});

// ------------------------------------------------------------------ sign in / up / out
export const signUp = (email, pass) => createUserWithEmailAndPassword(auth, email, pass);
export const signIn = (email, pass) => signInWithEmailAndPassword(auth, email, pass);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export const signInGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
export async function logout() { await push(); try { localStorage.removeItem(SYNC_FLAG); } catch { /* ignore */ } await signOut(auth); }

let verifier = null;
/** Sends an SMS code. `host` is an element that stays in the page for the invisible reCAPTCHA. */
export async function sendCode(phone, host) {
  if (verifier) { try { verifier.clear(); } catch { /* ignore */ } verifier = null; }
  verifier = new RecaptchaVerifier(auth, host, { size: "invisible" });
  return signInWithPhoneNumber(auth, phone, verifier);
}

/** Human readable message for a Firebase error code. */
export function authError(e, tr) {
  const c = (e && e.code) || "";
  const map = {
    "auth/invalid-email": "bad_email", "auth/missing-email": "bad_email",
    "auth/weak-password": "weak", "auth/email-already-in-use": "in_use",
    "auth/invalid-credential": "wrong", "auth/wrong-password": "wrong", "auth/user-not-found": "wrong",
    "auth/too-many-requests": "many", "auth/network-request-failed": "net",
    "auth/invalid-phone-number": "bad_phone", "auth/invalid-verification-code": "bad_code",
    "auth/code-expired": "bad_code", "auth/popup-closed-by-user": "", "auth/cancelled-popup-request": "",
    "auth/unauthorized-domain": "domain", "auth/operation-not-allowed": "region", "auth/quota-exceeded": "many",
  };
  const k = c in map ? map[c] : "other";
  return k ? tr(k) : "";
}
