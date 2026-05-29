
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInAnonymously, signInWithPopup, signOut, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getDatabase, ref, get, set } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ===== FIREBASE =====
export let db, auth;
export let uid = null;
export let srsCache = {};
export let statsCache = {};

export async function initFirebase() {
  try {
    document.getElementById('loading-status').textContent = 'Loading config...';
    const res = await fetch('/api/config');
    const config = await res.json();
    const app = initializeApp(config);
    db = getDatabase(app);
    auth = getAuth(app);
    document.getElementById('loading-status').textContent = 'Checking login...';

    // 既存ログイン状態を確認
    await new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        unsub();
        if (user && !user.isAnonymous) {
          uid = user.uid;
          resolve();
        } else {
          document.getElementById('loading-bar').style.display = 'none';
          document.getElementById('loading-status').textContent = '';
          document.getElementById('login-ui').style.display = 'block';
          window._loginResolve = resolve;
        }
      });
    });

    await onLoginComplete();
  } catch (e) {
    console.error('Firebase init error:', e);
    document.getElementById('loading-status').textContent = 'Offline mode';
    loadFromLocalStorage();
    document.getElementById('loading-screen').style.display = 'none';
    // updateHome は app.js 側で定義 → window経由で呼ぶ
    if (window.updateHome) window.updateHome();
  }
}

export async function onLoginComplete() {
  document.getElementById('login-ui').style.display = 'none';
  document.getElementById('loading-bar').style.display = 'block';
  document.getElementById('loading-status').textContent = 'Loading data...';
  await loadFromFirebase();
  await loadChunks('A1');
  const userInfo = auth.currentUser;
  const isAnon = userInfo?.isAnonymous;
  document.getElementById('uid-display').textContent = isAnon
    ? `UID: ${uid} (Guest)`
    : `${userInfo?.displayName || userInfo?.email || uid}`;
  document.getElementById('loading-screen').style.display = 'none';
  if (window.updateHome) window.updateHome();
}

// ===== 認証 =====

window.googleLogin = async () => {
  try {
    document.getElementById('login-ui').style.display = 'none';
    document.getElementById('loading-bar').style.display = 'block';
    document.getElementById('loading-status').textContent = 'Waiting for Google...';
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    uid = cred.user.uid;
    if (window._loginResolve) { window._loginResolve(); window._loginResolve = null; }
    else await onLoginComplete();
  } catch (e) {
    console.error('Google login error:', e);
    document.getElementById('loading-status').textContent = 'Login failed. Try again.';
    document.getElementById('login-ui').style.display = 'block';
    document.getElementById('loading-bar').style.display = 'none';
  }
};

window.anonLogin = async () => {
  try {
    document.getElementById('login-ui').style.display = 'none';
    document.getElementById('loading-bar').style.display = 'block';
    document.getElementById('loading-status').textContent = 'Connecting as guest...';
    const cred = await signInAnonymously(auth);
    uid = cred.user.uid;
    if (window._loginResolve) { window._loginResolve(); window._loginResolve = null; }
    else await onLoginComplete();
  } catch (e) {
    console.error('Anon login error:', e);
    document.getElementById('loading-status').textContent = 'Connection failed.';
    document.getElementById('login-ui').style.display = 'block';
  }
};

function getAuthErrorMsg(code) {
  const msgs = {
    'auth/invalid-email': 'Invalid email address.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/email-already-in-use': 'This email is already registered.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Please try again later.',
    'auth/invalid-credential': 'Incorrect email or password.',
  };
  return msgs[code] || 'An error occurred. Please try again.';
}

window.emailLogin = async () => {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  if (!email || !password) { errEl.textContent = 'Please enter email and password.'; return; }
  try {
    errEl.textContent = '';
    const cred = await signInWithEmailAndPassword(auth, email, password);
    uid = cred.user.uid;
    document.getElementById('login-ui').style.display = 'none';
    document.getElementById('loading-bar').style.display = 'block';
    document.getElementById('loading-status').textContent = 'Signing in...';
    if (window._loginResolve) { window._loginResolve(); window._loginResolve = null; }
    else await onLoginComplete();
  } catch (e) {
    errEl.textContent = getAuthErrorMsg(e.code);
  }
};

window.emailSignup = async () => {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  if (!email || !password) { errEl.textContent = 'Please enter email and password.'; return; }
  try {
    errEl.textContent = '';
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    uid = cred.user.uid;
    document.getElementById('login-ui').style.display = 'none';
    document.getElementById('loading-bar').style.display = 'block';
    document.getElementById('loading-status').textContent = 'Creating account...';
    if (window._loginResolve) { window._loginResolve(); window._loginResolve = null; }
    else await onLoginComplete();
  } catch (e) {
    errEl.textContent = getAuthErrorMsg(e.code);
  }
};

window.resetPassword = async () => {
  const email = document.getElementById('auth-email').value.trim();
  const errEl = document.getElementById('auth-error');
  if (!email) { errEl.textContent = 'Please enter your email address first.'; return; }
  try {
    await sendPasswordResetEmail(auth, email);
    errEl.style.color = '#1e6b3a';
    errEl.textContent = 'Password reset email sent!';
    setTimeout(() => { errEl.style.color = '#a93226'; errEl.textContent = ''; }, 4000);
  } catch (e) {
    errEl.textContent = getAuthErrorMsg(e.code);
  }
};

// ===== Firebase読み書き =====

export async function loadFromFirebase() {
  try {
    const srsSnap = await get(ref(db, `users/${uid}/srs`));
    srsCache = srsSnap.exists() ? srsSnap.val() : {};
    const statsSnap = await get(ref(db, `users/${uid}/stats`));
    statsCache = statsSnap.exists() ? statsSnap.val() : {};
    localStorage.setItem('srs_v1', JSON.stringify(srsCache));
    localStorage.setItem('stats_v1', JSON.stringify(statsCache));
  } catch (e) {
    console.error('Firebase load error:', e);
    loadFromLocalStorage();
  }
}

export function loadFromLocalStorage() {
  try { srsCache = JSON.parse(localStorage.getItem('srs_v1') || '{}'); } catch(e) { srsCache = {}; }
  try { statsCache = JSON.parse(localStorage.getItem('stats_v1') || '{}'); } catch(e) { statsCache = {}; }
}

function showSync(status) {
  const el = document.getElementById('sync-indicator');
  if (status === 'syncing') { el.className = 'sync-indicator syncing'; el.textContent = '↑ Syncing...'; }
  else if (status === 'synced') { el.className = 'sync-indicator synced'; el.textContent = '✓ Synced'; setTimeout(() => { el.className = 'sync-indicator'; }, 2000); }
}

export async function saveToFirebase(path, data) {
  if (!db || !uid) { localStorage.setItem(path === 'srs' ? 'srs_v1' : 'stats_v1', JSON.stringify(data)); return; }
  showSync('syncing');
  try {
    await set(ref(db, `users/${uid}/${path}`), data);
    showSync('synced');
  } catch (e) {
    console.error('Firebase save error:', e);
    showSync('synced');
  }
}

// ===== SRS（定着率ベース） =====

export let dayOffset = 0;
const MAX_SESSION = 10;

export function todayInt() { const d = new Date(); d.setDate(d.getDate() + dayOffset); return parseInt(d.toISOString().slice(0,10).replace(/-/g,'')); }
export function addDaysToInt(di, n) { const s = String(di); const d = new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`); d.setDate(d.getDate() + n); return parseInt(d.toISOString().slice(0,10).replace(/-/g,'')); }
export function diffDays(a, b) { const toDate = n => { const s = String(n); return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`); }; return Math.round((toDate(b) - toDate(a)) / (1000*60*60*24)); }

function getInterval(n, ef = 2.5) {
  if (n <= 0) return 1;
  if (n === 1) return 6;
  return 6 * Math.pow(ef, n - 1);
}

export function getRetention(id) {
  const s = srsCache[id];
  if (!s || s.n === undefined) return null;
  const elapsed = Math.max(0, todayInt() - s.lastStudied);
  const I = getInterval(s.n, s.ef || 2.5);
  return Math.exp(-elapsed / I);
}

export function getNextReviewDay(n, ef = 2.5, threshold = 0.8) {
  const I = getInterval(n, ef);
  return Math.round(-I * Math.log(threshold));
}

export function getSRS(id) {
  return srsCache[id] || { n: 0, ef: 2.5, lastStudied: 0, nextReview: 0 };
}

export function updateSRSLocal(id, correct) {
  const s = srsCache[id] || { n: 0, ef: 2.5, lastStudied: 0 };
  const today = todayInt();
  if (correct) {
    s.n = Math.min(10, (s.n || 0) + 1);
    s.ef = Math.min(3.0, (s.ef || 2.5) + 0.1);
    s.lastStudied = today;
    s.nextReview = addDaysToInt(today, getNextReviewDay(s.n, s.ef));
  } else {
    // 不正解: nはそのまま、ef-0.3、翌日強制
    s.ef = Math.max(1.3, (s.ef || 2.5) - 0.3);
    s.lastStudied = today;
    s.nextReview = addDaysToInt(today, 1);
  }
  srsCache[id] = s;
}

export async function updateSRS(id, correct) {
  updateSRSLocal(id, correct);
  await saveToFirebase('srs', srsCache);
}

export function getStats() { return statsCache; }

export function updateStatsLocal(updates) {
  statsCache = { ...statsCache, ...updates };
  localStorage.setItem('stats_v1', JSON.stringify(statsCache));
}

export async function saveStats() {
  await saveToFirebase('stats', statsCache);
}

export function getStreak() {
  const stats = getStats();
  const today = todayInt();
  const lastStudied = stats.lastStudied || 0;
  if (lastStudied === 0) return 0;
  if (diffDays(lastStudied, today) > 1) return 0;
  return stats.streak || 0;
}

export function recordStudySession() {
  const stats = getStats();
  const today = todayInt();
  if (stats.studiedToday === today) return;
  const lastStudied = stats.lastStudied || 0;
  let newStreak = 1;
  if (lastStudied > 0 && diffDays(lastStudied, today) === 1) newStreak = (stats.streak || 0) + 1;
  updateStatsLocal({ streak: newStreak, lastStudied: today, studiedToday: today });
}

export function selectSession(sessionSizeMax) {
  const size = sessionSizeMax || 10;
  const THRESHOLD = 0.80;

  const studied = ALL_DATA.filter(c => srsCache[c.id] && (srsCache[c.id].n || 0) > 0);
  const unstudied = ALL_DATA.filter(c => !srsCache[c.id] || (srsCache[c.id].n || 0) === 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  const withRetention = studied.map(c => ({
    chunk: c,
    retention: getRetention(c.id)
  })).sort((a, b) => a.retention - b.retention);

  const toReview = withRetention
    .filter(r => r.retention <= THRESHOLD)
    .map(r => r.chunk);

  const reviewCount = Math.min(toReview.length, size);
  const remaining = size - reviewCount;
  const newItems = unstudied.slice(0, remaining);

  return {
    review: toReview.slice(0, reviewCount),
    newItems,
    overflow: unstudied.slice(remaining).length
  };
}

// ===== チャンクデータ =====
export let ALL_DATA = [];
export let chunksMap = {};

export async function loadChunks(level = 'A1') {
  try {
    const snap = await get(ref(db, 'chunks'));
    if (!snap.exists()) { console.warn('No chunks found'); return; }
    const all = snap.val();
    ALL_DATA = Object.values(all).filter(c => c.level === level);
    chunksMap = all;
    console.log('Loaded', ALL_DATA.length, 'chunks (' + level + ')');
  } catch(e) {
    console.error('loadChunks error:', e);
  }
}

export function getChunkById(id) {
  return chunksMap[id] || null;
}

// ===== SPEECH =====
export let currentCollocation = '', currentExample = '';
let voices = [];
let isMutedCore = false;

export function setMuted(val) { isMutedCore = val; }
export function getMuted() { return isMutedCore; }

function loadVoices() { voices = speechSynthesis.getVoices(); }
loadVoices();
if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = loadVoices;
function getEnglishVoice() { return voices.find(v => v.lang === 'en-US' && v.localService) || voices.find(v => v.lang === 'en-US') || voices.find(v => v.lang.startsWith('en')) || null; }
export function speak(text, rate = 0.85, onEnd = null) { if (isMutedCore) { if (onEnd) onEnd(); return; } speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = rate; u.pitch = 1.0; const v = getEnglishVoice(); if (v) u.voice = v; if (onEnd) u.onend = onEnd; speechSynthesis.speak(u); }
export function speakFeedback(t) { setTimeout(() => speak(t, 0.85), 300); }

// ===== スコア係数 =====
export function freqCoef(f) { return [1.0, 1.5, 2.0, 3.0][f] || 1.0; }
export function levelCoef(l) { if (l <= 1) return 1.0; if (l <= 3) return 2.0; if (l === 4) return 3.0; return 5.0; }
export function cefrCoef(c) { if (c <= 1.0) return 1.0; if (c <= 1.5) return 1.5; if (c <= 2.0) return 2.0; return 3.0; }
export function calcScore(c, remainMs, level) { return remainMs * freqCoef(c.frequency) * levelCoef(level) * cefrCoef(c.cefr) / 1000; }

// ===== DEBUG =====
export function showToast(msg) { const t = document.getElementById('debug-toast'); t.textContent = msg; t.style.display = 'block'; setTimeout(() => { t.style.display = 'none'; }, 2000); }
