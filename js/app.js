import {
  initFirebase, uid, srsCache, statsCache,
  saveToFirebase, saveStats, db,
  todayInt, addDaysToInt, diffDays,
  getSRS, updateSRSLocal, updateSRS,
  getStats, updateStatsLocal, getStreak, recordStudySession,
  selectSession,
  ALL_DATA, getChunkById,
  speak, speakFeedback, setMuted,
  calcScore,
  showToast
} from './core.js';

import { ref, set } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ===== STATE =====
let sessionSizeMax = 10;
let isMuted = false;
let knownItems = new Set();
let session = [], sessionMeta = [], inputIndex = 0, outputIndex = 0, rpIndex = 0;
let pendingSession = null;
let results = [], rpResults = [], timerInterval = null, timeLeft = 15, answered = false, questionStartTime = 0;
let masteredCount = 0, highScore = 0;

// 不正解後の再インプット管理
let reviewInputPending = false;
let reviewInputChunk = null;

// ===== HOME =====

window.updateHome = function() {
  const sel = selectSession(sessionSizeMax);
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
  document.getElementById('preview-tags').innerHTML = session.map(c => {
    const isReview = srsCache[c.id] && srsCache[c.id].nextReview > 0 && srsCache[c.id].nextReview <= today;
    return `<span class="preview-tag ${isReview ? 'review-tag' : ''}">${c.chunk}</span>`;
  }).join('');
  renderStreakDots(); renderSRSStatus();
};

function renderStreakDots() {
  const stats = getStats(); const today = todayInt(); const streak = getStreak(); const lastStudied = stats.lastStudied || 0;
  const dots = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDaysToInt(today, -i); let type = 'future';
    if (d === today) { type = stats.studiedToday === today ? 'done' : 'today'; }
    else if (d < today) { if (lastStudied > 0 && d >= addDaysToInt(lastStudied, -(streak - 1)) && d <= lastStudied) type = 'done'; else type = 'missed'; }
    const dayLabel = ['Su','Mo','Tu','We','Th','Fr','Sa'][new Date(String(d).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')).getDay()];
    dots.push({ d, type, label: dayLabel });
  }
  document.getElementById('streak-dots').innerHTML = dots.map(dot => `<div class="streak-dot ${dot.type}">${dot.label}</div>`).join('');
  const statusEl = document.getElementById('streak-status'); const isTodayDone = stats.studiedToday === today;
  if (streak === 0 && !isTodayDone) { statusEl.className = 'streak-status broken'; statusEl.textContent = 'Start your streak today!'; }
  else if (isTodayDone) { statusEl.className = 'streak-status active'; statusEl.textContent = `🔥 ${streak} day streak!`; }
  else if (lastStudied > 0 && diffDays(lastStudied, today) === 1) { statusEl.className = 'streak-status warning'; statusEl.textContent = `⚠ Keep your ${streak}-day streak!`; }
  else { statusEl.className = 'streak-status broken'; statusEl.textContent = 'Streak broken — start again!'; }
  document.getElementById('streak-count').textContent = `${streak} day${streak !== 1 ? 's' : ''}`;
}

// ===== DEBUG PANEL =====

function renderSRSStatus() {
  const today = todayInt();
  const colors = ['#aaa', '#7ac4e8', '#7ae8a0', '#e8c97a', '#e87a7a', '#2d6a4f'];
  document.getElementById('srs-status-list').innerHTML = ALL_DATA.map(c => {
    const s = srsCache[c.id] || { n: 0, nextReview: 0 };
    const isDue = s.nextReview > 0 && s.nextReview <= today;
    const dueText = s.nextReview === 0 ? 'New' : isDue ? '⚡Due' : 'D' + String(s.nextReview).slice(6);
    const nVal = s.n || 0;
    const colorIdx = Math.min(nVal, colors.length - 1);
    return `<div class="srs-item"><span class="srs-col">${c.chunk}</span><span class="srs-level" style="color:${colors[colorIdx]}">n:${nVal}</span><span class="srs-next">${dueText}</span><div class="srs-btn-group"><button class="btn-force-correct" onclick="forceCorrect('${c.id}')">✓</button><button class="btn-force-incorrect" onclick="forceIncorrect('${c.id}')">✗</button></div></div>`;
  }).join('');
}

window.toggleDebug = () => { const b = document.getElementById('srs-panel-body'); const t = document.getElementById('debug-toggle'); b.classList.toggle('open'); t.textContent = b.classList.contains('open') ? '▲' : '▼'; };
window.forceCorrect = async (id) => { updateSRSLocal(id, true); await saveToFirebase('srs', srsCache); const srs = getSRS(id); showToast(`✓ n→${srs.n||0} ef→${(srs.ef||2.5).toFixed(1)} Next:D${String(srs.nextReview).slice(6)}`); window.updateHome(); };
window.forceIncorrect = async (id) => { updateSRSLocal(id, false); await saveToFirebase('srs', srsCache); const srs = getSRS(id); showToast(`✗ n→${srs.n||0} ef→${(srs.ef||2.5).toFixed(1)} Next:D${String(srs.nextReview).slice(6)}`); window.updateHome(); };
window.simulateStudy = () => { const today = todayInt(); const lastStudied = statsCache.lastStudied || 0; let newStreak = 1; if (lastStudied > 0 && diffDays(lastStudied, today) === 1) newStreak = (statsCache.streak || 0) + 1; updateStatsLocal({ streak: newStreak, lastStudied: today, studiedToday: today }); saveStats(); showToast(`📚 Studied: streak=${newStreak}`); window.updateHome(); };
window.simulateBreakStreak = () => { updateStatsLocal({ lastStudied: addDaysToInt(todayInt(), -3), studiedToday: 0 }); saveStats(); showToast('💔 Streak broken'); window.updateHome(); };

window.logoutUser = async () => {
  if (confirm('Sign out?')) {
    const { getAuth, signOut } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    await signOut(getAuth()); location.reload();
  }
};

window.resetAll = async () => {
  Object.keys(srsCache).forEach(k => delete srsCache[k]);
  Object.keys(statsCache).forEach(k => delete statsCache[k]);
  masteredCount = 0; highScore = 0;
  localStorage.removeItem('srs_v1'); localStorage.removeItem('stats_v1');
  if (db && uid) { await set(ref(db, `users/${uid}/srs`), {}); await set(ref(db, `users/${uid}/stats`), {}); }
  document.getElementById('day-offset-label').textContent = '+0';
  document.getElementById('simulated-date').textContent = 'today';
  showToast('🔄 Reset'); window.updateHome();
};

// ===== CHUNK DIALOG =====

function generateScene(c) {
  const scenes = { 'A1': 'You are in a workplace conversation with your manager.', 'A2': 'You are having a professional discussion with a colleague.', 'B1': 'You are in a business meeting with your team.', 'B2': 'You are in a formal business context with stakeholders.' };
  return scenes[c.level] || 'You are having a conversation at work.';
}

function showChunkDialog(id) {
  const c = getChunkById(id); if (!c) return;
  document.getElementById('dialog-chunk').textContent = c.chunk;
  document.getElementById('dialog-level').textContent = c.level + ' · ' + (c.category || 'collocation');
  document.getElementById('dialog-meaning').textContent = c.meaning || '';
  document.getElementById('dialog-explanation').textContent = c.explanation || '';
  document.getElementById('dialog-example').textContent = c.example1 || '';
  document.getElementById('chunk-dialog-overlay').style.display = 'flex';
}

window.closeChunkDialog = (e) => { if (e.target.id === 'chunk-dialog-overlay') document.getElementById('chunk-dialog-overlay').style.display = 'none'; };
window.setSessionSize = (n) => { sessionSizeMax = n; document.querySelectorAll('.config-btn').forEach(b => b.classList.remove('active')); document.querySelectorAll('.config-btn').forEach(b => { if (b.textContent == n) b.classList.add('active'); }); window.updateHome(); };
window.toggleMute = () => { isMuted = !isMuted; setMuted(isMuted); const btn = document.getElementById('mute-toggle'); btn.textContent = isMuted ? 'ON' : 'OFF'; btn.className = isMuted ? 'mute-toggle muted' : 'mute-toggle'; };

// ===== SESSION START =====

window.startSession = () => {
  if (session.length === 0) return;
  inputIndex = 0; results = []; knownItems = new Set(); pendingSession = null;
  reviewInputPending = false; reviewInputChunk = null;
  showScreen('input'); showInput();
};

// ===== INPUT フェーズ =====

function showInput() {
  const c = session[inputIndex]; const meta = sessionMeta[inputIndex];
  // 学習済み（n>0）はインプットをスキップ
  const isLearned = srsCache[c.id] && (srsCache[c.id].n || 0) > 0;
  if (isLearned) {
    inputIndex++;
    if (inputIndex >= session.length) { outputIndex = 0; showScreen('output'); showOutput(); }
    else showInput();
    return;
  }
  renderInputCard(c, meta && meta.isReview ? 'Review' : 'New', false);
}

function showReviewInput(c) {
  renderInputCard(c, 'Review', true);
}

function renderInputCard(c, badgeLabel, isReviewMode) {
  window._currentCollocation = c.chunk;
  window._currentExample = c.example1;
  const progressPct = isReviewMode ? (outputIndex / session.length) * 100 : (inputIndex / session.length) * 100;
  const counterText = isReviewMode ? `${outputIndex + 1} / ${session.length}` : `${inputIndex + 1} / ${session.length}`;
  document.getElementById('input-progress').style.width = `${progressPct}%`;
  document.getElementById('input-counter').textContent = counterText;
  document.getElementById('col-main').textContent = c.chunk;
  document.getElementById('col-type').textContent = c.type;
  document.getElementById('col-example').innerHTML = c.example1.replace(c.chunk, `<mark>${c.chunk}</mark>`);
  document.getElementById('col-explanation').textContent = c.explanation;
  let tags = '';
  if (c.similar && Array.isArray(c.similar)) {
    c.similar.forEach(id => { const sc = getChunkById(id); if (sc) tags += `<span class="similar-tag chunk-ref" data-chunk-id="${id}">${sc.chunk}</span>`; else if (typeof id === 'string' && !id.includes('_col_')) tags += `<span class="similar-tag">${id}</span>`; });
  }
  if (c.opposite) { const oc = getChunkById(c.opposite); if (oc) tags += `<span class="opposite-tag chunk-ref" data-chunk-id="${c.opposite}">↔ ${oc.chunk}</span>`; else if (typeof c.opposite === 'string' && !c.opposite.includes('_col_')) tags += `<span class="opposite-tag">↔ ${c.opposite}</span>`; }
  document.getElementById('col-similar').innerHTML = tags;
  const badge = document.getElementById('input-type-badge');
  badge.textContent = isReviewMode ? '⚠ Review Again' : badgeLabel;
  badge.className = isReviewMode ? 'phase-badge review-again-badge' : (badgeLabel === 'New' ? 'phase-badge new-badge' : 'phase-badge');
  // 再インプット時はGot it / I already know this を非表示 → Next のみ
  const btnKnown = document.querySelector('.btn-known');
  const btnGotIt = document.querySelector('.btn-got');
  const btnReviewNext = document.querySelector('.btn-review-next');
  if (btnKnown) btnKnown.style.display = isReviewMode ? 'none' : '';
  if (btnGotIt) btnGotIt.style.display = isReviewMode ? 'none' : '';
  if (btnReviewNext) btnReviewNext.style.display = isReviewMode ? 'block' : 'none';
  document.getElementById('btn-audio-col').classList.remove('playing');
  document.getElementById('btn-audio-ex').classList.remove('playing');
  setTimeout(() => speak(c.chunk, 0.8), 400);
}

window.nextInput = (action) => {
  speechSynthesis.cancel();
  // 再インプット後は次のoutputへ
  if (reviewInputPending) {
    reviewInputPending = false; reviewInputChunk = null;
    const btnKnown = document.querySelector('.btn-known');
    const btnGotIt = document.querySelector('.btn-got');
    const btnReviewNext = document.querySelector('.btn-review-next');
    if (btnKnown) btnKnown.style.display = '';
    if (btnGotIt) btnGotIt.style.display = '';
    if (btnReviewNext) btnReviewNext.style.display = 'none';
    outputIndex++; showScreen('output'); showOutput();
    return;
  }
  if (action === 'return') { showInput(); return; }
  if (action === 'known') {
    const c = session[inputIndex];
    knownItems.add(c.id);
    const s = srsCache[c.id] || { n: 0, ef: 2.5 };
    s.n = 6; s.ef = 2.5; s.lastStudied = todayInt(); s.nextReview = addDaysToInt(todayInt(), 30);
    srsCache[c.id] = s; saveToFirebase('srs', srsCache);
  }
  inputIndex++;
  if (inputIndex >= session.length) { outputIndex = 0; showScreen('output'); showOutput(); }
  else showInput();
};

// ===== OUTPUT フェーズ =====

function makeChoices(correct) {
  const c = session[outputIndex];
  const correctLower = correct.toLowerCase();
  const similarChunks = (c.similar || []).map(id => { const sc = getChunkById(id); return sc ? sc.chunk.toLowerCase() : ''; }).filter(Boolean);
  const excluded = new Set([correctLower, ...similarChunks]);
  const sameType = ALL_DATA.filter(d => { const al = d.chunk.toLowerCase(); return !excluded.has(al) && d.type === c.type; });
  const otherType = ALL_DATA.filter(d => { const al = d.chunk.toLowerCase(); return !excluded.has(al) && d.type !== c.type; });
  const pool = [...new Set([...sameType, ...otherType].map(d => d.chunk))];
  const distractors = pool.sort(() => Math.random() - 0.5).slice(0, 3);
  return [...distractors, correct].sort(() => Math.random() - 0.5);
}

function showOutput() {
  while (outputIndex < session.length && knownItems.has(session[outputIndex].id)) outputIndex++;
  if (outputIndex >= session.length) { rpIndex = 0; rpResults = []; showScreen('roleplay'); showRoleplay(); return; }
  if (outputIndex === session.length - 1) { setTimeout(() => { pendingSession = selectSession(sessionSizeMax); }, 0); }
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
  const srs = getSRS(c.id); const qScore = isCorrect ? calcScore(c, remainMs, srs.n) : 0;
  await updateSRS(c.id, isCorrect); const newSRS = getSRS(c.id);
  const fb = document.getElementById('feedback-box');
  if (isCorrect) {
    fb.className = 'feedback-box correct';
    fb.textContent = `✓ Correct! +${qScore.toFixed(2)}pt  n:${srs.n}→${newSRS.n}`;
    document.getElementById('score-pop').textContent = `+${qScore.toFixed(2)}pt`;
  } else {
    fb.className = 'feedback-box wrong';
    fb.textContent = `✗ "${correct}"  n:${srs.n}→${newSRS.n}`;
    document.getElementById('score-pop').textContent = '+0pt';
    reviewInputPending = true; reviewInputChunk = c;
  }
  speakFeedback(correct);
  results.push({ collocation: c.chunk, correct: isCorrect, score: qScore, remainMs, srs });
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
  reviewInputPending = true; reviewInputChunk = c;
  document.getElementById('next-btn').style.display = 'block';
}

window.nextOutput = () => {
  speechSynthesis.cancel();
  if (reviewInputPending && reviewInputChunk) {
    showScreen('input'); showReviewInput(reviewInputChunk); return;
  }
  outputIndex++;
  if (outputIndex >= session.length) { rpIndex = 0; rpResults = []; showScreen('roleplay'); showRoleplay(); }
  else showOutput();
};

// ===== ROLEPLAY フェーズ =====

function showRoleplay() {
  while (rpIndex < session.length && knownItems.has(session[rpIndex].id)) rpIndex++;
  if (rpIndex >= session.length) { showResults(); return; }
  const c = session[rpIndex];
  if (!c.rp_question) { window.nextRoleplay(); return; }
  document.getElementById('rp-progress').style.width = `${(rpIndex / session.length) * 100}%`;
  document.getElementById('rp-counter').textContent = `${rpIndex + 1} / ${session.length}`;
  document.getElementById('rp-scene').textContent = c.rp_scene || generateScene(c);
  const conv = document.getElementById('rp-conversation');
  conv.innerHTML = `<div class="rp-bubble-wrap"><div class="rp-speaker">Manager</div><div class="rp-bubble manager">"${c.rp_question}"</div></div>`;
  document.getElementById('rp-answer').value = '';
  document.getElementById('rp-input-area').style.display = 'block'; document.getElementById('rp-btn-row').style.display = 'grid';
  document.getElementById('rp-next-btn').style.display = 'none'; document.getElementById('rp-loading').className = 'rp-loading';
  document.getElementById('voice-status').textContent = ''; document.getElementById('voice-status').className = 'voice-status';
  stopVoiceInput();
  setTimeout(() => speak(c.rp_question, 0.85), 400);
}

// ===== 音声入力 =====
let recognition = null, isRecording = false;

function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { console.warn('Speech Recognition not supported'); return null; }
  const r = new SR(); r.lang = 'en-US'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
  return r;
}

window.toggleVoiceInput = () => { if (isRecording) stopVoiceInput(); else startVoiceInput(); };

function startVoiceInput() {
  recognition = initSpeechRecognition();
  if (!recognition) { document.getElementById('voice-status').textContent = 'Voice input not supported on this browser.'; return; }
  const btn = document.getElementById('rp-mic-btn'); const status = document.getElementById('voice-status');
  recognition.onstart = () => { isRecording = true; btn.className = 'rp-mic recording'; btn.textContent = 'Stop'; status.className = 'voice-status active'; status.textContent = '🎤 Listening...'; };
  recognition.onresult = (event) => {
    let interim = '', final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) { const t = event.results[i][0].transcript; if (event.results[i].isFinal) final += t; else interim += t; }
    const textarea = document.getElementById('rp-answer');
    if (final) { const current = textarea.value; textarea.value = (current + (current ? ' ' : '') + final.trim()); textarea.scrollTop = textarea.scrollHeight; textarea.setSelectionRange(textarea.value.length, textarea.value.length); status.textContent = '✓ Added: "' + final.trim() + '"'; status.className = 'voice-status'; }
    else if (interim) { status.textContent = '...' + interim; status.className = 'voice-status active'; }
  };
  recognition.onerror = (event) => { stopVoiceInput(); document.getElementById('voice-status').textContent = 'Error: ' + event.error + '. Try again.'; document.getElementById('voice-status').className = 'voice-status'; };
  recognition.onend = () => { stopVoiceInput(); if (document.getElementById('voice-status').textContent.startsWith('🎤')) document.getElementById('voice-status').textContent = 'Done. Check your text above.'; };
  recognition.start();
}

function stopVoiceInput() {
  isRecording = false;
  const btn = document.getElementById('rp-mic-btn'); btn.className = 'rp-mic'; btn.textContent = '🎤 Speak';
  if (recognition) { try { recognition.stop(); } catch(e) {} recognition = null; }
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
    const prompt = `You are a professional and supportive workplace manager having a brief English conversation.\n\nThe collocation the user is practicing: "${c.chunk}"\nThe user said: "${userAnswer}"\n\nInstructions:\n1. First, silently judge which case applies:\n   - CASE A: The user correctly used "${c.chunk}" or a natural equivalent.\n   - CASE B: The user's response is natural and relevant, but did not use "${c.chunk}".\n   - CASE C: The user's response is unnatural, unclear, or off-topic.\n\n2. Then reply in exactly 1-2 sentences:\n   - CASE A: Praise the user naturally (e.g. "Great!" or "Exactly!"), then continue the conversation naturally.\n   - CASE B: Give a natural reply that includes "${c.chunk}" to model the expected expression, without saying "you should say" or "the correct phrase is".\n   - CASE C: Respond with a sentence that naturally includes "${c.chunk}" and gently redirects the conversation.\n\n3. Always sound like a real manager — warm, professional, and brief. Never break character or explain grammar.`;
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

window.skipRoleplay = () => { stopVoiceInput(); speechSynthesis.cancel(); rpResults.push({ collocation: session[rpIndex].chunk, used: false }); window.nextRoleplay(); };
window.nextRoleplay = () => { speechSynthesis.cancel(); rpIndex++; if (rpIndex >= session.length) showResults(); else showRoleplay(); };

// ===== RESULTS =====

async function showResults() {
  speechSynthesis.cancel(); recordStudySession();
  const sel = pendingSession || selectSession(sessionSizeMax); pendingSession = null;
  session = [...sel.review, ...sel.newItems];
  const stats = getStats(); const newStreak = getStreak();
  const correctResults = results.filter(r => r.correct);
  const baseAvg = results.length > 0 ? (results.reduce((s, r) => s + r.score, 0) / results.length) : 0;
  masteredCount = (stats.masteredCount || 0) + correctResults.length;
  const masteredBonus = masteredCount * 0.1; const streakBonus = newStreak * 0.05;
  const isPerfect = results.every(r => r.correct); const subtotal = baseAvg + masteredBonus + streakBonus;
  const total = isPerfect ? subtotal * 1.2 : subtotal; const isNewHigh = total > (stats.highScore || 0);
  updateStatsLocal({ masteredCount, ...(isNewHigh ? { highScore: total } : {}) });
  await saveStats(); highScore = statsCache.highScore || 0;
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
      <div class="result-left"><div class="result-collocation">${r.collocation}</div><div class="result-phase">Output · ${r.remainMs > 0 ? (r.remainMs / 1000).toFixed(1) + 's' : '-'}</div></div>
      <span class="result-score-col">${r.correct ? '+' + r.score.toFixed(2) + 'pt' : '+0pt'}</span>
      <span class="${r.correct ? 'result-ok' : 'result-ng'}">${r.correct ? '✓' : '✗'}</span>
    </div>`).join('');
  showScreen('result');
}

window.goHome = () => { speechSynthesis.cancel(); showScreen('home'); window.updateHome(); };
function showScreen(name) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); document.getElementById(`screen-${name}`).classList.add('active'); }

window.speakCollocation = () => { const b = document.getElementById('btn-audio-col'); b.classList.add('playing'); speak(window._currentCollocation || '', 0.8, () => b.classList.remove('playing')); };
window.speakExample = () => { const b = document.getElementById('btn-audio-ex'); b.classList.add('playing'); speak(window._currentExample || '', 0.85, () => b.classList.remove('playing')); };

document.addEventListener('click', (e) => { const el = e.target.closest('.chunk-ref'); if (el) { const id = el.dataset.chunkId; if (id) showChunkDialog(id); } });

// ===== 起動 =====
initFirebase();
