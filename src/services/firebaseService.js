/**
 * firebaseService.js
 *
 * Wraps Firebase Realtime Database for session sharing.
 * Firebase is loaded via CDN scripts in index.html, so the global `firebase`
 * object is accessed through `globalThis.firebase`.
 *
 * Supported operations:
 *   - saveSession  → writes datasets to Firebase and returns a short ID
 *   - loadSession  → reads datasets back from Firebase given the session ID
 *   - buildShareUrl → builds the full shareable URL from a session ID
 */

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBp5jjj0SaFuN3xK_ZCsHBknntLwP7LG48',
  authDomain: 'ev-binows.firebaseapp.com',
  databaseURL: 'https://ev-binows-default-rtdb.firebaseio.com',
  projectId: 'ev-binows',
  storageBucket: 'ev-binows.firebasestorage.app',
  messagingSenderId: '769525305200',
  appId: '1:769525305200:web:8d1fbdab5f97577a55c9b5',
}

/** @returns {object} Initialized Firebase Realtime Database instance */
function getDb() {
  const fb = globalThis.firebase
  if (!fb) throw new Error('Firebase SDK not loaded. Check CDN scripts in index.html.')
  if (!fb.apps || fb.apps.length === 0) fb.initializeApp(FIREBASE_CONFIG)
  return fb.database()
}

/**
 * Saves the current datasets to Firebase under a random session ID.
 * Sessions expire after 24 hours (expiry is stored alongside data).
 *
 * @param {Array} datasets - Array of dataset objects to persist
 * @returns {Promise<string>} The generated session ID
 */
export async function saveSession(datasets) {
  const db = getDb()
  const id = Math.random().toString(36).substr(2, 8)
  const expiry = Date.now() + 24 * 60 * 60 * 1000
  await db.ref(`sessoes/${id}`).set({ datasets, expiry })
  return id
}

/**
 * Loads datasets from Firebase for a given session ID.
 * Throws if the session does not exist or is expired (expired records are
 * retained in the DB until Firebase TTL rules remove them).
 *
 * @param {string} sessionId - The session ID returned by saveSession
 * @returns {Promise<Array>} Array of dataset objects
 */
export async function loadSession(sessionId) {
  const db = getDb()
  const snapshot = await db.ref(`sessoes/${sessionId}`).get()
  const data = snapshot.val()
  if (!data || !data.datasets) throw new Error('Link expirado ou invalido.')
  if (typeof data.expiry === 'number' && Date.now() > data.expiry) {
    throw new Error('Link expirado ou invalido.')
  }
  return data.datasets
}

/**
 * Builds an absolute share URL pointing to this session.
 *
 * @param {string} sessionId
 * @returns {string} Full URL with `?s=<sessionId>`
 */
export function buildShareUrl(sessionId) {
  return `${window.location.origin}${window.location.pathname}?s=${sessionId}`
}
