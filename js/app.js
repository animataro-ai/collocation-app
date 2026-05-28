
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInAnonymously, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getDatabase, ref, get, set, update } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ===== DATA =====
// ALL_DATA: loaded from Firebase

// RP_QUESTIONS: loaded from Firebase (chunk.rp_question)

// ===== FIREBASE =====
let db, auth, uid;
let srsCache = {};
let statsCache = {};

async function initFirebase() {
  try {
    document.getElementById('loading-status').textContent = 'Loading config...';
    const res = await fetch('/api/config');
    const config = await res.json();
    const app = initializeApp(config);
    db = getDatabase(app);
    auth = getAuth(app);
    document.getElementById('loading-status').textContent = 'Checking login...';

    // Redirectログイン結果を確認（Google redirect後）
    try {
      const redirectResult = await getRedirectResult(auth);
      if (redirectResult?.user) {
        uid = redirectResult.user.uid;
        await onLoginComplete();
        return;
      }
    } catch (e) {
      console.warn('Redirect result error:', e);
    }

    // 既存ログイン状態を確認
    await new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        unsub();
        // Googleまたはメールで認証済みの場合のみスキップ
        if (user && !user.isAnonymous) {
          uid = user.uid;
          resolve();
        } else {
          // 未ログインまたは匿名→ログインUIを表示
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
    updateHome();
  }
}

async function onLoginComplete() {
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
  updateHome();
}

window.googleLogin = async () => {
  try {
    // redirectのみ使用（popupはブラウザにブロックされるため）
    const provider = new GoogleAuthProvider();
    await signInWithRedirect(auth, provider);
    // ページ遷移するためここには到達しない
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

// Email認証エラーメッセージ変換
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

async function loadFromFirebase() {
  try {
    const srsSnap = await get(ref(db, `users/${uid}/srs`));
    srsCache = srsSnap.exists() ? srsSnap.val() : {};

    // マイグレーション: 旧levelフィールドを削除（n/efベースに統合）
    let migrated = false;
    for (const id in srsCache) {
      if ('level' in srsCache[id]) {
        delete srsCache[id].level;
        migrated = true;
      }
    }
    if (migrated) {
      await set(ref(db, `users/${uid}/srs`), srsCache);
      console.log('SRS migration: removed legacy "level" fields');
    }

    const statsSnap = await get(ref(db, `users/${uid}/stats`));
    statsCache = statsSnap.exists() ? statsSnap.val() : {};
    // localStorageにも同期
    localStorage.setItem('srs_v1', JSON.stringify(srsCache));
    localStorage.setItem('stats_v1', JSON.stringify(statsCache));
  } catch (e) {
    console.error('Firebase load error:', e);
    loadFromLocalStorage();
  }
}

function loadFromLocalStorage() {
  try { srsCache = JSON.parse(localStorage.getItem('srs_v1') || '{}'); } catch(e) { srsCache = {}; }
  try { statsCache = JSON.parse(localStorage.getItem('stats_v1') || '{}'); } catch(e) { statsCache = {}; }
}

function showSync(status) {
  const el = document.getElementById('sync-indicator');
  if (status === 'syncing') { el.className = 'sync-indicator syncing'; el.textContent = '↑ Syncing...'; }
  else if (status === 'synced') { el.className = 'sync-indicator synced'; el.textContent = '✓ Synced'; setTimeout(() => { el.className = 'sync-indicator'; }, 2000); }
}

async function saveToFirebase(path, data) {
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

// 定着率計算: R = exp(-elapsed / I(n))
function getInterval(n, ef = 2.5) {
  if (n <= 0) return 1;
  if (n === 1) return 6;
  return 6 * Math.pow(ef, n - 1);
}

function getRetention(id) {
  const s = srsCache[id];
  if (!s || s.n === undefined) return null; // 未学習
  const elapsed = Math.max(0, todayInt() - s.lastStudied);
  const I = getInterval(s.n, s.ef || 2.5);
  return Math.exp(-elapsed / I);
}

function getNextReviewDay(n, ef = 2.5, threshold = 0.8) {
  const I = getInterval(n, ef);
  return Math.round(-I * Math.log(threshold));
}
const SRS_DAYS = [0, 1, 3, 7, 14, 30];
const MAX_SESSION = 10;
let dayOffset = 0;

function todayInt() { const d = new Date(); d.setDate(d.getDate() + dayOffset); return parseInt(d.toISOString().slice(0,10).replace(/-/g,'')); }
function addDaysToInt(di, n) { const s = String(di); const d = new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`); d.setDate(d.getDate() + n); return parseInt(d.toISOString().slice(0,10).replace(/-/g,'')); }
function diffDays(a, b) { const toDate = n => { const s = String(n); return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`); }; return Math.round((toDate(b) - toDate(a)) / (1000*60*60*24)); }

function getSRS(id) {
  return srsCache[id] || { n: 0, ef: 2.5, lastStudied: 0, nextReview: 0 };
}

function updateSRSLocal(id, correct) {
  const s = srsCache[id] || { n: 0, ef: 2.5, lastStudied: 0 };
  const today = todayInt();
  if (correct) {
    s.n = Math.min(10, (s.n || 0) + 1);
    s.ef = Math.min(3.0, (s.ef || 2.5) + 0.1);
    s.nextReview = addDaysToInt(today, getNextReviewDay(s.n, s.ef));
  } else {
    // nはそのまま、ef-0.3、翌日強制復習
    s.ef = Math.max(1.3, (s.ef || 2.5) - 0.3);
    s.nextReview = addDaysToInt(today, 1);
  }
  s.lastStudied = today;
  srsCache[id] = s;
}

async function updateSRS(id, correct) {
  updateSRSLocal(id, correct);
  await saveToFirebase('srs', srsCache);
}

function getStats() { return statsCache; }

function updateStatsLocal(updates) {
  statsCache = { ...statsCache, ...updates };
  localStorage.setItem('stats_v1', JSON.stringify(statsCache));
}

async function saveStats() {
  await saveToFirebase('stats', statsCache);
}

function getStreak() {
  const stats = getStats();
  const today = todayInt();
  const lastStudied = stats.lastStudied || 0;
  if (lastStudied === 0) return 0;
  if (diffDays(lastStudied, today) > 1) return 0;
  return stats.streak || 0;
}

function recordStudySession() {
  const stats = getStats();
  const today = todayInt();
  if (stats.studiedToday === today) return;
  const lastStudied = stats.lastStudied || 0;
  let newStreak = 1;
  if (lastStudied > 0 && diffDays(lastStudied, today) === 1) newStreak = (stats.streak || 0) + 1;
  updateStatsLocal({ streak: newStreak, lastStudied: today, studiedToday: today });
}

function selectSession() {
  const size = sessionSizeMax;
  const THRESHOLD = 0.80;

  // 学習済み（n>0）の定着率を計算してソート
  const studied = ALL_DATA.filter(c => srsCache[c.id] && (srsCache[c.id].n || 0) > 0);
  const unstudied = ALL_DATA.filter(c => !srsCache[c.id] || (srsCache[c.id].n || 0) === 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  // 定着率を算出して昇順ソート（低い順＝復習優先）
  const withRetention = studied.map(c => ({
    chunk: c,
    retention: getRetention(c.id)
  })).sort((a, b) => a.retention - b.retention);

  // 閾値以下を復習対象に
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
let ALL_DATA = [];
let chunksMap = {};

async function loadChunks(level = 'A1') {
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

function getChunkById(id) {
  return chunksMap[id] || null;
}

// ===== SPEECH =====
let currentCollocation = '', currentExample = '', voices = [];
function loadVoices() { voices = speechSynthesis.getVoices(); }
loadVoices();
if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = loadVoices;
function getEnglishVoice() { return voices.find(v => v.lang === 'en-US' && v.localService) || voices.find(v => v.lang === 'en-US') || voices.find(v => v.lang.startsWith('en')) || null; }
function speak(text, rate = 0.85, onEnd = null) { if (isMuted) { if (onEnd) onEnd(); return; } speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = rate; u.pitch = 1.0; const v = getEnglishVoice(); if (v) u.voice = v; if (onEnd) u.onend = onEnd; speechSynthesis.speak(u); }
window.speakCollocation = () => { const b = document.getElementById('btn-audio-col'); b.classList.add('playing'); speak(currentCollocation, 0.8, () => b.classList.remove('playing')); };
window.speakExample = () => { const b = document.getElementById('btn-audio-ex'); b.classList.add('playing'); speak(currentExample, 0.85, () => b.classList.remove('playing')); };
function speakFeedback(t) { setTimeout(() => speak(t, 0.85), 300); }

// ===== 係数 =====
function freqCoef(f) { return [1.0, 1.5, 2.0, 3.0][f] || 1.0; }
function levelCoef(n) { if (n <= 1) return 1.0; if (n <= 3) return 2.0; if (n <= 5) return 3.0; return 5.0; }
function cefrCoef(c) { if (c <= 1.0) return 1.0; if (c <= 1.5) return 1.5; if (c <= 2.0) return 2.0; return 3.0; }
function calcScore(c, remainMs, n) { return remainMs * freqCoef(c.frequency) * levelCoef(n) * cefrCoef(c.cefr) / 1000; }

// ===== DEBUG =====
function showToast(msg) { const t = document.getElementById('debug-toast'); t.textContent = msg; t.style.display = 'block'; setTimeout(() => { t.style.display = 'none'; }, 2000); }
window.toggleDebug = () => { const b = document.getElementById('srs-panel-body'); const t = document.getElementById('debug-toggle'); b.classList.toggle('open'); t.textContent = b.classList.contains('open') ? '▲' : '▼'; };
window.forceCorrect = async (id) => { updateSRSLocal(id, true); await saveToFirebase('srs', srsCache); const srs = getSRS(id); showToast(`✓ n→${srs.n||0} ef→${(srs.ef||2.5).toFixed(1)} Next:D${String(srs.nextReview).slice(6)}`); updateHome(); };
window.forceIncorrect = async (id) => { updateSRSLocal(id, false); await saveToFirebase('srs', srsCache); const srs = getSRS(id); showToast(`✗ n→${srs.n||0} ef→${(srs.ef||2.5).toFixed(1)} Next:D${String(srs.nextReview).slice(6)}`); updateHome(); };

function renderSRSStatus() {
  const today = todayInt();
  const nColors = ['#aaa', '#7ac4e8', '#7ae8a0', '#e8c97a', '#e87a7a', '#2d6a4f'];
  document.getElementById('srs-status-list').innerHTML = ALL_DATA.map(c => {
    const s = srsCache[c.id] || { n: 0, ef: 2.5, nextReview: 0 };
    const isDue = s.nextReview > 0 && s.nextReview <= today;
    const dueText = s.nextReview === 0 ? 'New' : isDue ? '⚡Due' : 'D' + String(s.nextReview).slice(6);
    const nVal = s.n || 0;
    const efVal = (s.ef || 2.5).toFixed(1);
    const col = nColors[Math.min(nVal, nColors.length - 1)];
    return `<div class="srs-item"><span class="srs-col">${c.chunk}</span><span class="srs-level" style="color:${col}">n${nVal}/ef${efVal}</span><span class="srs-next">${dueText}</span><div class="srs-btn-group"><button class="btn-force-correct" onclick="forceCorrect('${c.id}')">✓</button><button class="btn-force-incorrect" onclick="forceIncorrect('${c.id}')">✗</button></div></div>`;
  }).join('');
}

window.simulateDays = (n) => { dayOffset += n; const today = todayInt(); const s = String(today); document.getElementById('day-offset-label').textContent = `+${dayOffset}`; document.getElementById('simulated-date').textContent = `${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6,8)}`; updateHome(); };
window.simulateStudy = () => { const today = todayInt(); const lastStudied = statsCache.lastStudied || 0; let newStreak = 1; if (lastStudied > 0 && diffDays(lastStudied, today) === 1) newStreak = (statsCache.streak || 0) + 1; updateStatsLocal({ streak: newStreak, lastStudied: today, studiedToday: today }); saveStats(); showToast(`📚 Studied: streak=${newStreak}`); updateHome(); };
window.simulateBreakStreak = () => { updateStatsLocal({ lastStudied: addDaysToInt(todayInt(), -3), studiedToday: 0 }); saveStats(); showToast('💔 Streak broken'); updateHome(); };
window.logoutUser = async () => {
  if (confirm('Sign out?')) {
    await signOut(auth);
    uid = null;
    srsCache = {};
    statsCache = {};
    location.reload();
  }
};

window.resetAll = async () => { srsCache = {}; statsCache = {}; dayOffset = 0; masteredCount = 0; highScore = 0; localStorage.removeItem('srs_v1'); localStorage.removeItem('stats_v1'); if (db && uid) { await set(ref(db, `users/${uid}/srs`), {}); await set(ref(db, `users/${uid}/stats`), {}); } document.getElementById('day-offset-label').textContent = '+0'; document.getElementById('simulated-date').textContent = 'today'; showToast('🔄 Reset'); updateHome(); };

function renderStreakDots() {
  const stats = getStats(); const today = todayInt(); const streak = getStreak(); const lastStudied = stats.lastStudied || 0;
  const dots = [];
  for (let i = 6; i >= 0; i--) { const d = addDaysToInt(today, -i); let type = 'future'; if (d === today) { type = stats.studiedToday === today ? 'done' : 'today'; } else if (d < today) { if (lastStudied > 0 && d >= addDaysToInt(lastStudied, -(streak - 1)) && d <= lastStudied) type = 'done'; else type = 'missed'; } const dayLabel = ['Su','Mo','Tu','We','Th','Fr','Sa'][new Date(String(d).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')).getDay()]; dots.push({ d, type, label: dayLabel }); }
  document.getElementById('streak-dots').innerHTML = dots.map(dot => `<div class="streak-dot ${dot.type}">${dot.label}</div>`).join('');
  const statusEl = document.getElementById('streak-status'); const isTodayDone = stats.studiedToday === today;
  if (streak === 0 && !isTodayDone) { statusEl.className = 'streak-status broken'; statusEl.textContent = 'Start your streak today!'; }
  else if (isTodayDone) { statusEl.className = 'streak-status active'; statusEl.textContent = `🔥 ${streak} day streak!`; }
  else if (lastStudied > 0 && diffDays(lastStudied, today) === 1) { statusEl.className = 'streak-status warning'; statusEl.textContent = `⚠ Keep your ${streak}-day streak!`; }
  else { statusEl.className = 'streak-status broken'; statusEl.textContent = 'Streak broken — start again!'; }
  document.getElementById('streak-count').textContent = `${streak} day${streak !== 1 ? 's' : ''}`;
}

// ===== STATE =====
let sessionSizeMax = 10;
let isMuted = false;
let knownItems = new Set(); // I already know this で除外するIDセット
let session = [], sessionMeta = [], inputIndex = 0, outputIndex = 0, rpIndex = 0;
let pendingSession = null; // バックグラウンド計算済みセッション
let results = [], rpResults = [], timerInterval = null, timeLeft = 15, answered = false, questionStartTime = 0;
let masteredCount = 0, highScore = 0;

function updateHome() {
  const sel = selectSession();
  session = [...sel.review, ...sel.newItems];
  sessionMeta = [...sel.review.map(() => ({ isReview: true })), ...sel.newItems.map(() => ({ isReview: false }))];
  const stats = getStats(); const streak = getStreak();
  masteredCount = stats.masteredCount || 0; highScore = stats.highScore || 0;
  document.getElementById('stat-total').textContent = session.length;
  document.getElementById('stat-streak').textContent = streak;
  document.getElementById('stat-mastered').textContent = masteredCount;
  document.getElementById('home-highscore').textContent = highScore > 0 ? highScore.toFixed(2) + 'pt' : '—';
  document.getElementById('sb-review').textContent = sel.review.length;
  document.getElementById('sb-new').textContent = sel.newItems.length;
  document.getElementById('sb-total').textContent = session.length;
  const notice = document.getElementById('overflow-notice');
  if (sel.overflow > 0) { notice.textContent = `⚠ ${sel.overflow} review(s) → tomorrow`; notice.className = 'overflow-notice show'; } else notice.className = 'overflow-notice';
  document.getElementById('start-btn').disabled = session.length === 0;
  document.getElementById('start-btn').textContent = session.length === 0 ? 'No items today ✓' : 'Start Learning →';
  const today = todayInt();
  document.getElementById('preview-tags').innerHTML = session.map(c => { const isReview = srsCache[c.id] && srsCache[c.id].nextReview > 0 && srsCache[c.id].nextReview <= today; return `<span class="preview-tag ${isReview ? 'review-tag' : ''}">${c.chunk}</span>`; }).join('');
  renderStreakDots(); renderSRSStatus();
}

function generateScene(c) {
  // example1からシーン文脈を自動生成
  const scenes = {
    'A1': 'You are in a workplace conversation with your manager.',
    'A2': 'You are having a professional discussion with a colleague.',
    'B1': 'You are in a business meeting with your team.',
    'B2': 'You are in a formal business context with stakeholders.',
  };
  return scenes[c.level] || 'You are having a conversation at work.';
}

function showChunkDialog(id) {
  const c = getChunkById(id);
  if (!c) return;
  document.getElementById('dialog-chunk').textContent = c.chunk;
  document.getElementById('dialog-level').textContent = c.level + ' · ' + (c.category || 'collocation');
  document.getElementById('dialog-meaning').textContent = c.meaning || '';
  document.getElementById('dialog-explanation').textContent = c.explanation || '';
  document.getElementById('dialog-example').textContent = c.example1 || '';
  document.getElementById('chunk-dialog-overlay').style.display = 'flex';
};

window.closeChunkDialog = (e) => {  // onclick属性から呼ばれるためwindow経由を維持

  if (e.target.id === 'chunk-dialog-overlay') {
    document.getElementById('chunk-dialog-overlay').style.display = 'none';
  }
};

window.setSessionSize = (n) => {
  sessionSizeMax = n;
  document.querySelectorAll('.config-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.config-btn').forEach(b => { if (b.textContent == n) b.classList.add('active'); });
  updateHome();
};

window.toggleMute = () => {
  isMuted = !isMuted;
  const btn = document.getElementById('mute-toggle');
  btn.textContent = isMuted ? 'ON' : 'OFF';
  btn.className = isMuted ? 'mute-toggle muted' : 'mute-toggle';
};

window.startSession = () => { if (session.length === 0) return; inputIndex = 0; results = []; knownItems = new Set(); pendingSession = null; showScreen('input'); showInput(); };

function showInput() {
  const c = session[inputIndex]; const meta = sessionMeta[inputIndex];
  currentCollocation = c.chunk; currentExample = c.example1;
  document.getElementById('input-progress').style.width = `${(inputIndex / session.length) * 100}%`;
  document.getElementById('input-counter').textContent = `${inputIndex + 1} / ${session.length}`;
  document.getElementById('col-main').textContent = c.chunk;
  document.getElementById('col-type').textContent = c.type;
  document.getElementById('col-example').innerHTML = c.example1.replace(c.chunk, `<mark>${c.chunk}</mark>`);
  document.getElementById('col-explanation').textContent = c.explanation;
  // similar/oppositeをIDから取得してクリッカブルタグで表示
  let tags = '';
  if (c.similar && Array.isArray(c.similar) && c.similar.length > 0) {
    c.similar.forEach(id => {
      const sc = getChunkById(id);
      if (sc) {
        tags += `<span class="similar-tag chunk-ref" data-chunk-id="${id}">${sc.chunk}</span>`;
      } else if (typeof id === 'string' && !id.includes('_col_')) {
        tags += `<span class="similar-tag">${id}</span>`;
      }
    });
  }
  if (c.opposite) {
    const oc = getChunkById(c.opposite);
    if (oc) {
      tags += `<span class="opposite-tag chunk-ref" data-chunk-id="${c.opposite}">↔ ${oc.chunk}</span>`;
    } else if (typeof c.opposite === 'string' && !c.opposite.includes('_col_')) {
      tags += `<span class="opposite-tag">↔ ${c.opposite}</span>`;
    }
  }
  document.getElementById('col-similar').innerHTML = tags;
  const badge = document.getElementById('input-type-badge');
  badge.textContent = meta && meta.isReview ? 'Review' : 'New';
  badge.className = meta && meta.isReview ? 'phase-badge' : 'phase-badge new-badge';
  document.getElementById('btn-audio-col').classList.remove('playing');
  document.getElementById('btn-audio-ex').classList.remove('playing');
  setTimeout(() => speak(c.chunk, 0.8), 400);
}

window.nextInput = (action) => {
  speechSynthesis.cancel();
  if (action === 'return') { showInput(); return; }
  if (action === 'known') {
    // アウトプット・ロールプレイから除外・30日後に1回テスト
    const c = session[inputIndex];
    knownItems.add(c.id); // 除外セットに追加
    const s = srsCache[c.id] || { n: 0, ef: 2.5 };
    s.n = 6;  // 高い復習回数 → 長い間隔
    s.ef = 2.5;
    s.lastStudied = todayInt();
    s.nextReview = addDaysToInt(todayInt(), 30);
    srsCache[c.id] = s;
    saveToFirebase('srs', srsCache);
    // resultsには追加しない（スコアに影響させない）
  }
  inputIndex++;
  if (inputIndex >= session.length) { outputIndex = 0; showScreen('output'); showOutput(); }
  else showInput();
};

function makeChoices(correct) {
  const c = session[outputIndex];
  const correctLower = correct.toLowerCase();
  // 正解と類似語を除外
  const similarChunks = (c.similar || []).map(id => {
    const sc = getChunkById(id);
    return sc ? sc.chunk.toLowerCase() : '';
  }).filter(Boolean);
  const excluded = new Set([correctLower, ...similarChunks]);
  // 同タイプ優先で重複なしプール生成
  const sameType = ALL_DATA.filter(d => {
    const al = d.chunk.toLowerCase();
    return !excluded.has(al) && d.type === c.type;
  });
  const otherType = ALL_DATA.filter(d => {
    const al = d.chunk.toLowerCase();
    return !excluded.has(al) && d.type !== c.type;
  });
  const pool = [...new Set([...sameType, ...otherType].map(d => d.chunk))];
  const distractors = pool.sort(() => Math.random() - 0.5).slice(0, 3);
  return [...distractors, correct].sort(() => Math.random() - 0.5);
}

function showOutput() {
  // knownItemsに含まれるものをスキップ
  while (outputIndex < session.length && knownItems.has(session[outputIndex].id)) {
    outputIndex++;
  }
  if (outputIndex >= session.length) {
    rpIndex = 0; rpResults = []; showScreen('roleplay'); showRoleplay(); return;
  }
  // 最後の問題を提示する時点でバックグラウンド計算開始
  if (outputIndex === session.length - 1) {
    setTimeout(() => {
      pendingSession = selectSession();
    }, 0);
  }
  answered = false; questionStartTime = Date.now(); const c = session[outputIndex];
  document.getElementById('output-progress').style.width = `${(outputIndex / session.length) * 100}%`;
  document.getElementById('output-counter').textContent = `${outputIndex + 1} / ${session.length}`;
  document.getElementById('blank-sentence').innerHTML = c.example2.replace('_____', `<span class="blank">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>`);
  document.getElementById('feedback-box').className = 'feedback-box';
  document.getElementById('next-btn').style.display = 'none'; document.getElementById('score-pop').textContent = '';
  const choices = makeChoices(c.chunk);
  document.getElementById('choices-grid').innerHTML = choices.map(ch => `<button class="choice-btn" onclick="selectChoice(this,'${ch.replace(/'/g, "\\'")}')"><span>${ch}</span></button>`).join('');
  startTimer();
}

window.selectChoice = async (btn, chosen) => {
  if (answered) return; answered = true; clearInterval(timerInterval);
  const c = session[outputIndex]; const correct = c.chunk;
  const elapsed = Date.now() - questionStartTime; const remainMs = Math.max(0, 15000 - elapsed);
  const isCorrect = chosen === correct;
  document.querySelectorAll('.choice-btn').forEach(b => { b.disabled = true; const l = b.querySelector('span').textContent; if (l === correct) b.classList.add('correct'); else if (l === chosen && !isCorrect) b.classList.add('wrong'); });
  const srs = getSRS(c.id); const qScore = isCorrect ? calcScore(c, remainMs, srs.n || 0) : 0;
  await updateSRS(c.id, isCorrect); const newSRS = getSRS(c.id);
  const fb = document.getElementById('feedback-box');
  if (isCorrect) { fb.className = 'feedback-box correct'; fb.textContent = `✓ Correct! +${qScore.toFixed(2)}pt  n:${srs.n||0}→${newSRS.n||0}`; document.getElementById('score-pop').textContent = `+${qScore.toFixed(2)}pt`; }
  else { fb.className = 'feedback-box wrong'; fb.textContent = `✗ "${correct}"  n:${srs.n||0} ef:${(newSRS.ef||2.5).toFixed(1)} (review tomorrow)`; document.getElementById('score-pop').textContent = '+0pt'; }
  speakFeedback(correct); results.push({ collocation: c.chunk, correct: isCorrect, score: qScore, remainMs, srs });
  document.getElementById('next-btn').style.display = 'block';
};

function startTimer() { clearInterval(timerInterval); timeLeft = 15; updateTimer(); timerInterval = setInterval(() => { timeLeft -= 0.1; if (timeLeft <= 0) { timeLeft = 0; clearInterval(timerInterval); if (!answered) timeUp(); } updateTimer(); }, 100); }
function updateTimer() { const d = document.getElementById('timer-display'); d.textContent = Math.ceil(timeLeft); d.className = timeLeft <= 2 ? 'timer-circle warning' : 'timer-circle'; }
async function timeUp() {
  answered = true; const c = session[outputIndex];
  document.querySelectorAll('.choice-btn').forEach(b => { b.disabled = true; if (b.querySelector('span').textContent === c.chunk) b.classList.add('correct'); });
  await updateSRS(c.id, false);
  document.getElementById('feedback-box').className = 'feedback-box wrong';
  document.getElementById('feedback-box').textContent = `⏱ Time's up! "${c.chunk}"`;
  document.getElementById('score-pop').textContent = '+0pt'; speakFeedback(c.chunk);
  results.push({ collocation: c.chunk, correct: false, score: 0, remainMs: 0, srs: getSRS(c.id) });
  document.getElementById('next-btn').style.display = 'block';
}
window.nextOutput = () => { speechSynthesis.cancel(); outputIndex++; if (outputIndex >= session.length) { rpIndex = 0; rpResults = []; showScreen('roleplay'); showRoleplay(); } else showOutput(); };

function showRoleplay() {
  // knownItemsに含まれるものをスキップ
  while (rpIndex < session.length && knownItems.has(session[rpIndex].id)) {
    rpIndex++;
  }
  if (rpIndex >= session.length) { showResults(); return; }
  const c = session[rpIndex];
  const rpQuestion = c.rp_question;
  if (!rpQuestion) { nextRoleplay(); return; }
  document.getElementById('rp-progress').style.width = `${(rpIndex / session.length) * 100}%`;
  document.getElementById('rp-counter').textContent = `${rpIndex + 1} / ${session.length}`;
  // sceneをexample1から生成（rp_sceneフィールドがない場合）
  const sceneText = c.rp_scene || generateScene(c);
  document.getElementById('rp-scene').textContent = sceneText;
  const conv = document.getElementById('rp-conversation');
  conv.innerHTML = `<div class="rp-bubble-wrap"><div class="rp-speaker">Manager</div><div class="rp-bubble manager">"${rpQuestion}"</div></div>`;
  document.getElementById('rp-answer').value = '';
  document.getElementById('rp-input-area').style.display = 'block'; document.getElementById('rp-btn-row').style.display = 'grid';
  document.getElementById('rp-next-btn').style.display = 'none'; document.getElementById('rp-loading').className = 'rp-loading';
  document.getElementById('voice-status').textContent = '';
  document.getElementById('voice-status').className = 'voice-status';
  stopVoiceInput();
  setTimeout(() => speak(rpQuestion, 0.85), 400);
}
// ===== 音声入力 =====
let recognition = null;
let isRecording = false;

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech Recognition not supported');
    return null;
  }
  const r = new SpeechRecognition();
  r.lang = 'en-US';
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 1;
  return r;
}

window.toggleVoiceInput = () => {
  if (isRecording) {
    stopVoiceInput();
  } else {
    startVoiceInput();
  }
};

function startVoiceInput() {
  recognition = initSpeechRecognition();
  if (!recognition) {
    document.getElementById('voice-status').textContent = 'Voice input not supported on this browser.';
    return;
  }
  const btn = document.getElementById('rp-mic-btn');
  const status = document.getElementById('voice-status');

  recognition.onstart = () => {
    isRecording = true;
    btn.className = 'rp-mic recording';
    btn.textContent = 'Stop';
    status.className = 'voice-status active';
    status.textContent = '🎤 Listening...';
  };

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += t;
      else interim += t;
    }
    const textarea = document.getElementById('rp-answer');
    if (final) {
      // テキストエリアに追記（カーソル位置を末尾に）
      const current = textarea.value;
      textarea.value = (current + (current ? ' ' : '') + final.trim());
      textarea.scrollTop = textarea.scrollHeight;
      // カーソルを末尾に移動
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      status.textContent = '✓ Added: "' + final.trim() + '"';
      status.className = 'voice-status';
    } else if (interim) {
      status.textContent = '...' + interim;
      status.className = 'voice-status active';
    }
  };

  recognition.onerror = (event) => {
    stopVoiceInput();
    status.textContent = 'Error: ' + event.error + '. Try again.';
    status.className = 'voice-status';
  };

  recognition.onend = () => {
    stopVoiceInput();
    if (document.getElementById('voice-status').textContent.startsWith('🎤')) {
      document.getElementById('voice-status').textContent = 'Done. Check your text above.';
    }
  };

  recognition.start();
}

function stopVoiceInput() {
  isRecording = false;
  const btn = document.getElementById('rp-mic-btn');
  btn.className = 'rp-mic';
  btn.textContent = '🎤 Speak';
  if (recognition) {
    try { recognition.stop(); } catch(e) {}
    recognition = null;
  }
}

window.submitRoleplay = async () => {
  stopVoiceInput();
  const userAnswer = document.getElementById('rp-answer').value.trim(); if (!userAnswer) return;
  speechSynthesis.cancel(); const c = session[rpIndex];
  document.getElementById('rp-input-area').style.display = 'none'; document.getElementById('rp-btn-row').style.display = 'none';
  const conv = document.getElementById('rp-conversation');
  conv.insertAdjacentHTML('beforeend', `<div class="rp-bubble-wrap"><div class="rp-speaker">You</div><div class="rp-bubble user">"${userAnswer}"</div></div>`);
  document.getElementById('rp-loading').className = 'rp-loading show';
  try {
    const rpQ = c.rp_question;
    const prompt = `You are a professional and supportive workplace manager having a brief English conversation.

The collocation the user is practicing: "${c.chunk}"
The user said: "${userAnswer}"

Instructions:
1. First, silently judge which case applies:
   - CASE A: The user correctly used "${c.chunk}" or a natural equivalent.
   - CASE B: The user's response is natural and relevant, but did not use "${c.chunk}".
   - CASE C: The user's response is unnatural, unclear, or off-topic.

2. Then reply in exactly 1-2 sentences:
   - CASE A: Praise the user naturally (e.g. "Great!" or "Exactly!"), then continue the conversation naturally.
   - CASE B: Give a natural reply that includes "${c.chunk}" to model the expected expression, without saying "you should say" or "the correct phrase is".
   - CASE C: Respond with a sentence that naturally includes "${c.chunk}" and gently redirects the conversation.

3. Always sound like a real manager — warm, professional, and brief. Never break character or explain grammar.`;
    const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 200, messages: [{ role: "user", content: prompt }] }) });
    const data = await response.json(); const reply = data.content?.[0]?.text || "Good effort!";
    document.getElementById('rp-loading').className = 'rp-loading';
    const highlighted = reply.replace(new RegExp(c.chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), match => `<mark class="rp-highlight">${match}</mark>`);
    conv.insertAdjacentHTML('beforeend', `<div class="rp-bubble-wrap"><div class="rp-speaker">Manager</div><div class="rp-bubble reply">"${highlighted}"</div></div>`);
    rpResults.push({ collocation: c.chunk, used: true }); setTimeout(() => speak(reply, 0.85), 300);
  } catch (e) {
    document.getElementById('rp-loading').className = 'rp-loading';
    const mock = `Good response! Keep practicing "${c.chunk}" naturally.`;
    conv.insertAdjacentHTML('beforeend', `<div class="rp-bubble-wrap"><div class="rp-speaker">Manager</div><div class="rp-bubble reply">"${mock}"</div></div>`);
    rpResults.push({ collocation: c.chunk, used: true }); setTimeout(() => speak(mock, 0.85), 300);
  }
  document.getElementById('rp-next-btn').style.display = 'block';
};
window.skipRoleplay = () => { stopVoiceInput(); speechSynthesis.cancel(); rpResults.push({ collocation: session[rpIndex].collocation, used: false }); nextRoleplay(); };
window.nextRoleplay = () => { speechSynthesis.cancel(); rpIndex++; if (rpIndex >= session.length) showResults(); else showRoleplay(); };

async function showResults() {
  speechSynthesis.cancel();
  recordStudySession();
  // バックグラウンド計算済みがあればそれを使用、なければ計算
  const sel = pendingSession || selectSession();
  pendingSession = null; // キャッシュをクリア
  session = [...sel.review, ...sel.newItems];
  const stats = getStats(); const newStreak = getStreak();
  const correctResults = results.filter(r => r.correct);
  const baseAvg = results.length > 0 ? (results.reduce((s, r) => s + r.score, 0) / results.length) : 0;
  masteredCount = (stats.masteredCount || 0) + correctResults.length;
  const masteredBonus = masteredCount * 0.1; const streakBonus = newStreak * 0.05;
  const isPerfect = results.every(r => r.correct); const subtotal = baseAvg + masteredBonus + streakBonus;
  const total = isPerfect ? subtotal * 1.2 : subtotal; const isNewHigh = total > (stats.highScore || 0);
  updateStatsLocal({ masteredCount, ...(isNewHigh ? { highScore: total } : {}) });
  await saveStats();
  highScore = statsCache.highScore || 0;
  const banner = document.getElementById('session-complete-banner');
  if (newStreak >= 2) { banner.className = 'session-complete-banner show'; document.getElementById('session-complete-text').textContent = `🔥 ${newStreak} Day Streak!`; document.getElementById('session-complete-sub').textContent = newStreak >= 7 ? 'Amazing!' : 'Keep it up!'; }
  else banner.className = 'session-complete-banner';
  document.getElementById('highscore-banner').className = isNewHigh ? 'highscore-banner show' : 'highscore-banner';
  document.getElementById('final-score-display').textContent = total.toFixed(2);
  document.getElementById('b-base').textContent = baseAvg.toFixed(2) + 'pt';
  document.getElementById('b-mastered').textContent = '+' + masteredBonus.toFixed(2) + 'pt';
  document.getElementById('b-streak').textContent = `+${streakBonus.toFixed(2)}pt (${newStreak}d)`;
  document.getElementById('b-perfect').textContent = isPerfect ? 'Applied' : '—';
  document.getElementById('b-total').textContent = total.toFixed(2) + 'pt';
  document.getElementById('result-list-body').innerHTML = results.map(r => `
    <div class="result-item">
      <div class="result-left"><div class="result-collocation">${r.chunk}</div><div class="result-phase">Output · ${r.remainMs > 0 ? (r.remainMs / 1000).toFixed(1) + 's' : '-'}</div></div>
      <span class="result-score-col">${r.correct ? '+' + r.score.toFixed(2) + 'pt' : '+0pt'}</span>
      <span class="${r.correct ? 'result-ok' : 'result-ng'}">${r.correct ? '✓' : '✗'}</span>
    </div>`).join('');
  showScreen('result');
}
window.goHome = () => { speechSynthesis.cancel(); showScreen('home'); updateHome(); };
function showScreen(name) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); document.getElementById(`screen-${name}`).classList.add('active'); }

// chunk-refタグのクリックイベントをdocumentレベルで処理
document.addEventListener('click', (e) => {
  const el = e.target.closest('.chunk-ref');
  if (el) {
    const id = el.dataset.chunkId;
    if (id) showChunkDialog(id);
  }
});

// 起動
initFirebase();
