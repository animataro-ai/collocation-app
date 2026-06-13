/**
 * speaking.js — Speaking Room
 * Chank Master派生ページ
 *
 * 依存: /js/core.js (initFirebase, uid, db, speak, speakFeedback)
 * API: /api/chat (既存エンドポイントをそのまま使用)
 * DB:  Firebase Realtime Database  users/{uid}/speaking_logs/{sessionId}/{turnIndex}
 *      保存フィールド: ts (ISO), speaker ("user"|"ai"), content (string)
 */

import { initFirebase, uid, db, speak } from './core.js';
import { ref, push, set } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ===== PERSONAS =====
const PERSONAS = {
  tutor: 'You are a warm, patient, encouraging English tutor. Make the learner feel comfortable and confident. Gently correct notable mistakes in a natural way, then continue the conversation.',
  friend: 'You are a relaxed, friendly peer chatting casually. Use natural everyday English and a light, fun tone. Correct mistakes rarely and only when it really matters.',
  strict: 'You are a precise, demanding English instructor. Correct mistakes carefully and briefly explain the rule each time, while staying respectful.',
  business: 'You are a professional business counterpart. Use polite, professional English and realistic workplace situations. Correct unnatural phrasing professionally.',
};

const buildSystem = (personaDesc) =>
  `You are an English conversation partner for a Japanese adult learner at an intermediate level.
Persona: ${personaDesc}
Rules:
- Keep a natural, flowing conversation and end each reply with one engaging follow-up question.
- When the learner makes a notable grammar or vocabulary mistake, weave a brief, natural correction into your reply, then continue.
- Replies should be concise and conversational (2–4 sentences).
- Respond only in English.`;

// ===== STATE =====
let currentPersonaId = 'tutor';
let customPersonaText = '';
let currentTopic = '';
let conversationHistory = []; // [{role, content}]
let sessionLogRef = null;     // Firebase ref for this session
let turnIndex = 0;
let voiceOn = true;
let isListening = false;
let speechRecog = null;
let inputBase = '';           // 音声開始前の既存テキスト

const speechSupported =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

// ===== INIT =====
(async () => {
  await initFirebase();
  initChips();
})();

function initChips() {
  const topicInput = document.getElementById('sp-topic-input');
  document.querySelectorAll('.sp-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.textContent.trim();
      topicInput.value = val;
      document.querySelectorAll('.sp-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  topicInput.addEventListener('input', () => {
    document.querySelectorAll('.sp-chip').forEach(b => b.classList.remove('active'));
  });
}

// ===== PERSONA SELECTION =====
window.selectPersona = function(btn) {
  document.querySelectorAll('.sp-persona-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentPersonaId = btn.dataset.id;
  const customArea = document.getElementById('sp-custom-area');
  customArea.style.display = currentPersonaId === 'custom' ? 'block' : 'none';
};

window.setTopic = function(t) {
  document.getElementById('sp-topic-input').value = t;
  document.querySelectorAll('.sp-chip').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === t);
  });
};

// ===== START =====
window.startConversation = async function() {
  currentTopic = document.getElementById('sp-topic-input').value.trim();
  customPersonaText = document.getElementById('sp-custom-text')?.value.trim() || '';

  const personaDesc = currentPersonaId === 'custom'
    ? (customPersonaText || 'A friendly English conversation partner.')
    : PERSONAS[currentPersonaId];

  const systemPrompt = buildSystem(personaDesc);

  // 画面切替
  showScreen('sp-screen-chat');
  const personaLabel = currentPersonaId === 'custom' ? 'Custom' :
    { tutor: 'Tutor', friend: 'Friend', strict: 'Strict', business: 'Business' }[currentPersonaId];
  document.getElementById('sp-chat-title').textContent = personaLabel;

  // Firebaseにセッション枠を確保
  if (uid && db) {
    sessionLogRef = ref(db, `users/${uid}/speaking_logs/${Date.now()}`);
  }
  conversationHistory = [];
  turnIndex = 0;

  // AI最初の発話
  const primer = 'Greet me warmly in English and open a short, easy conversation with one friendly question.'
    + (currentTopic ? ` The topic is: ${currentTopic}.` : '');

  await aiTurn([{ role: 'user', content: primer }], systemPrompt, true);
  window._spSystem = systemPrompt; // セッション中保持
};

// ===== AI TURN =====
async function aiTurn(messages, systemPrompt, isPrimer = false) {
  showThinking(true);
  try {
    const body = {
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: systemPrompt || window._spSystem,
      messages,
    };
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const aiText = (data.content || [])
      .filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      || 'Sorry, could you say that again?';

    if (!isPrimer) {
      conversationHistory.push({ role: 'assistant', content: aiText });
    } else {
      conversationHistory = [{ role: 'assistant', content: aiText }];
    }

    appendBubble('ai', aiText);
    await logTurn('ai', aiText);

    showThinking(false);
    if (voiceOn) {
      speak(aiText, 0.95, () => maybeAutoMic());
    } else {
      maybeAutoMic();
    }
  } catch (e) {
    showThinking(false);
    appendBubble('ai', '⚠ Connection error. Please try again.');
  }
}

// ===== SEND =====
window.sendMessage = async function() {
  const input = document.getElementById('sp-input');
  const text = input.value.trim();
  if (!text) return;
  stopListening();
  input.value = '';
  inputBase = '';
  autoResizeInput();

  conversationHistory.push({ role: 'user', content: text });
  appendBubble('user', text);
  await logTurn('user', text);

  // 送信するメッセージ: 最初のAI発話を含む直近20ターン
  const msgs = buildApiMessages();
  await aiTurn(msgs);
};

window.handleKey = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendMessage(); }
};

function buildApiMessages() {
  // history の最初が assistant の場合はダミーuserを先頭に追加
  const hist = conversationHistory.slice(-20);
  if (hist.length && hist[0].role === 'assistant') {
    return [{ role: 'user', content: '(Continuing our conversation.)' }, ...hist];
  }
  return hist;
}

// ===== MIC =====
window.toggleMic = function() {
  if (isListening) stopListening();
  else startListening();
};

function startListening() {
  if (!speechSupported) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = 'en-US'; r.interimResults = true; r.continuous = true;
  inputBase = document.getElementById('sp-input').value;
  let accumulatedFinal = '';

  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        const sep = accumulatedFinal && t.trim() ? ' ' : '';
        accumulatedFinal = (accumulatedFinal + sep + t.trim()).trim();
      } else {
        interim += t;
      }
    }
    const parts = [inputBase.trim(), accumulatedFinal, interim.trim()].filter(Boolean);
    document.getElementById('sp-input').value = parts.join(' ');
    autoResizeInput();
  };
  r.onend = () => {
    if (isListening) {
      try { r.start(); } catch(_) { setListeningState(false); }
    }
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech') return;
    setListeningState(false);
  };
  speechRecog = r;
  setListeningState(true);
  try { r.start(); } catch(_) { setListeningState(false); }
}

function stopListening() {
  try { speechRecog?.stop(); } catch(_) {}
  setListeningState(false);
}

function setListeningState(val) {
  isListening = val;
  speechRecog = val ? speechRecog : null;
  const btn = document.getElementById('sp-mic-btn');
  const ripple = document.getElementById('sp-mic-ripple');
  const input = document.getElementById('sp-input');
  if (btn) btn.classList.toggle('listening', val);
  if (ripple) ripple.classList.toggle('active', val);
  if (input) input.classList.toggle('listening', val);
}

function maybeAutoMic() {
  if (speechSupported && !isListening) startListening();
}

// ===== VOICE TOGGLE =====
window.toggleVoice = function() {
  voiceOn = !voiceOn;
  const btn = document.getElementById('sp-voice-toggle');
  if (btn) { btn.textContent = voiceOn ? '🔊' : '🔇'; btn.classList.toggle('muted', !voiceOn); }
  if (!voiceOn) speechSynthesis?.cancel();
};

// ===== REPLAY =====
function replayText(text) {
  speechSynthesis?.cancel();
  speak(text, 0.95);
}

// ===== FIREBASE LOG =====
async function logTurn(speaker, content) {
  const entry = { ts: new Date().toISOString(), speaker, content };
  if (sessionLogRef && uid && db) {
    try {
      await set(ref(db, `users/${uid}/speaking_logs/${sessionLogRef.key}/${turnIndex}`), entry);
    } catch(e) { console.warn('Log save error:', e); }
  }
  turnIndex++;
}

// ===== UI HELPERS =====
function appendBubble(role, text) {
  const container = document.getElementById('sp-messages');
  const wrap = document.createElement('div');
  wrap.className = `sp-bubble-wrap ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'sp-bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);

  if (role === 'ai') {
    const replay = document.createElement('button');
    replay.className = 'sp-replay-btn';
    replay.innerHTML = '▶ 再生';
    replay.addEventListener('click', () => replayText(text));
    wrap.appendChild(replay);
  }
  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;
}

function showThinking(val) {
  const el = document.getElementById('sp-thinking');
  if (el) el.style.display = val ? 'flex' : 'none';
  const send = document.getElementById('sp-send-btn');
  if (send) send.disabled = val;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function autoResizeInput() {
  const el = document.getElementById('sp-input');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 110) + 'px';
}
document.getElementById('sp-input')?.addEventListener('input', autoResizeInput);

// ===== NAVIGATION =====
window.endConversation = function() {
  stopListening();
  speechSynthesis?.cancel();
  conversationHistory = [];
  sessionLogRef = null;
  turnIndex = 0;
  window._spSystem = null;
  document.getElementById('sp-messages').innerHTML = '';
  document.getElementById('sp-input').value = '';
  showScreen('sp-screen-home');
};

window.goBackToMain = function() {
  window.location.href = '/';
};
