// Firebase web config. The build (scripts/build-site.sh) replaces this file with the repository variable
// FIREBASE_CONFIG (the JSON from Firebase console -> Project settings -> Your apps -> Web app). It is public by
// design (access is protected by Firestore rules, see firebase/firestore.rules). null = accounts are switched off.
export const FIREBASE = null;
