// Accounts (Firebase Auth) and cloud copy of the listener's data (Firestore: users/{uid}).
// The Firebase SDK is loaded on demand, after the app has started; without a config the site works as before
// (localStorage + Telegram CloudStorage).
import { FIREBASE } from "./firebase-config.js";
import { snapshotUser, mergeUser, setRemote } from "./store.js";

const SDK = "https://www.gstatic.com/firebasejs/10.14.1";
export const authEnabled = !!FIREBASE;

let fb = null;
let account = null;
let status = "idle"; // idle | syncing | synced | error
const subs = new Set();
let ready;

export const getAccount = () => account;
export const syncStatus = () => status;
export function onAuth(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify() { for (const fn of subs) { try { fn(account, status); } catch (e) { console.error(e); } } }

async function load() {
  if (fb) return fb;
  const [app, auth, store] = await Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
  ]);
  const a = app.initializeApp(FIREBASE);
  fb = { auth: auth.getAuth(a), db: store.getFirestore(a), A: auth, F: store };
  return fb;
}

// ------------------------------------------------------------------ sync
const docRef = () => fb.F.doc(fb.db, "users", account.uid);
const seenKey = () => `ms.fb.${account.uid}`;
let pushTimer = null;
let canPush = false;

async function pull() {
  status = "syncing"; notify();
  const snap = await fb.F.getDoc(docRef());
  let first = false;
  try { first = !localStorage.getItem(seenKey()); } catch { /* ignore */ }
  if (snap.exists()) mergeUser(snap.data().data, { union: first });
  try { localStorage.setItem(seenKey(), "1"); } catch { /* ignore */ }
  canPush = true;
  await push(); // writes the merged result (also creates the document for a new account)
}

async function push() {
  if (!account || !canPush) return;
  try {
    status = "syncing"; notify();
    await fb.F.setDoc(docRef(), { v: 1, updatedAt: fb.F.serverTimestamp(), data: snapshotUser() });
    status = "synced";
  } catch (e) {
    console.warn("account sync failed", e);
    status = "error";
  }
  notify();
}

const hooks = {
  changed() { if (!account) return; clearTimeout(pushTimer); pushTimer = setTimeout(push, 2500); },
  flush() { if (account) { clearTimeout(pushTimer); push(); } },
};

// ------------------------------------------------------------------ sign in / out
export function initAuth() {
  if (!authEnabled) return Promise.resolve();
  ready ||= load().then((f) => new Promise((resolve) => {
    let first = true;
    f.A.onAuthStateChanged(f.auth, async (u) => {
      account = u ? { uid: u.uid, email: u.email, name: u.displayName } : null;
      canPush = false;
      if (u) {
        setRemote(hooks);
        try { await pull(); } catch (e) { console.warn("account pull failed", e); status = "error"; notify(); }
      } else {
        setRemote(null);
        status = "idle";
      }
      notify();
      if (first) { first = false; resolve(); }
    });
  })).catch((e) => { console.warn("Firebase failed to load", e); });
  return ready;
}

async function ensure() { await initAuth(); if (!fb) throw Object.assign(new Error("offline"), { code: "auth/network-request-failed" }); return fb; }

export async function signUp(email, password) {
  const f = await ensure();
  await f.A.createUserWithEmailAndPassword(f.auth, email, password);
}
export async function signIn(email, password) {
  const f = await ensure();
  await f.A.signInWithEmailAndPassword(f.auth, email, password);
}
export async function signInGoogle() {
  const f = await ensure();
  await f.A.signInWithPopup(f.auth, new f.A.GoogleAuthProvider());
}
export async function resetPassword(email) {
  const f = await ensure();
  await f.A.sendPasswordResetEmail(f.auth, email);
}
export async function signOutNow() {
  const f = await ensure();
  hooks.flush();
  await f.A.signOut(f.auth);
}

/** Maps Firebase error codes to the key of a message in i18n.js. */
export function errorKey(e) {
  const c = String(e?.code || "");
  if (/invalid-email/.test(c)) return "auth.err.email";
  if (/weak-password/.test(c)) return "auth.err.weak";
  if (/email-already-in-use/.test(c)) return "auth.err.exists";
  if (/user-not-found|wrong-password|invalid-credential|invalid-login/.test(c)) return "auth.err.creds";
  if (/too-many-requests/.test(c)) return "auth.err.many";
  if (/popup-closed|cancelled-popup/.test(c)) return "";
  if (/network/.test(c)) return "auth.err.network";
  return "auth.err.other";
}
