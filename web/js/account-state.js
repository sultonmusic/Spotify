// Light-weight account state kept outside auth.js, so the app never depends on the Firebase CDN to start.
let name = "";
const subs = new Set();
export const accountName = () => name;
export function onAccount(fn) { subs.add(fn); return () => subs.delete(fn); }
export function setAccount(label) { name = label || ""; for (const fn of subs) { try { fn(name); } catch (e) { console.error(e); } } }
