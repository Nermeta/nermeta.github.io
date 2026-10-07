/* ═══════════════════════════════════════════════════════════════
   Wynter's Wonderland — Chat + UI JavaScript
   ═══════════════════════════════════════════════════════════════ */

const WORKER_URL = 'https://wynters-wonderland-ai.nermeta.workers.dev';

/* ── STAR FIELD ─────────────────────────────────────────────── */
(function initStars() {
  const canvas = document.getElementById('stars');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let stars = [];

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    buildStars();
  }

  function buildStars() {
    stars = [];
    const n = Math.floor((canvas.width * canvas.height) / 4000);
    for (let i = 0; i < n; i++) {
      stars.push({
        x:     Math.random() * canvas.width,
        y:     Math.random() * canvas.height,
        r:     Math.random() * 1.0 + 0.2,
        a:     Math.random(),
        speed: Math.random() * 0.004 + 0.001,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  let t = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    t += 0.012;
    stars.forEach(s => {
      const alpha = s.a * (0.5 + 0.5 * Math.sin(t * s.speed * 60 + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,215,240,${alpha.toFixed(3)})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener('resize', resize, { passive: true });
  draw();
})();


/* ── NAVIGATION TOGGLE ──────────────────────────────────────── */
(function initNav() {
  const toggle = document.querySelector('.nav-toggle');
  const menu   = document.getElementById('nav-menu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    menu.classList.toggle('is-open', !isOpen);
  });
})();

/* ── CHAT ENGINE ─────────────────────────────────────────────── */

// Session memory — persists for the browser session
const chatHistory = [];

/**
 * sendMessage — sends text to the Cloudflare Worker, gets JSON envelope back
 * @param {string} userText
 * @returns {Promise<{message:string, cards:Array, action:Object}>}
 */
async function sendMessage(userText) {
  chatHistory.push({ role: 'user', content: userText });

  const response = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: chatHistory })
  });

  if (!response.ok) {
    throw new Error(`Worker returned ${response.status}`);
  }

  const data = await response.json();
  const assistantText = data.message || '…';

  // Store assistant reply in history
  chatHistory.push({ role: 'assistant', content: assistantText });

  return data;
}

/**
 * appendUserBubble — adds a user message bubble to a messages container
 */
function appendUserBubble(container, text) {
  const div = document.createElement('div');
  div.className = 'msg-user';
  div.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div>`;
  container.appendChild(div);
  scrollToBottom(container);
  return div;
}

/**
 * appendTyping — adds an animated "typing" indicator
 */
function appendTyping(container) {
  const div = document.createElement('div');
  div.className = 'msg-ai msg-typing';
  div.innerHTML = `
    <div class="msg-ai-avatar" aria-hidden="true">🐱</div>
    <div class="msg-bubble">curling through the corridors…</div>`;
  container.appendChild(div);
  scrollToBottom(container);
  return div;
}

/**
 * appendAiResponse — adds the AI message + optional result cards
 */
function appendAiResponse(container, data) {
  const div = document.createElement('div');
  div.className = 'msg-ai';

  let html = `<div class="msg-ai-avatar" aria-hidden="true">🐱</div>
    <div class="msg-bubble">${formatMessage(data.message)}</div>`;

  div.innerHTML = html;
  container.appendChild(div);

  // Result cards
  if (data.cards && data.cards.length > 0) {
    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'msg-cards';
    data.cards.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'result-card';
      const tagHtml = card.type
        ? `<span class="result-card-tag">${escapeHtml(card.type)}</span>` : '';
      const dateHtml = card.date
        ? `<span>${escapeHtml(card.date)}</span>` : '';
      cardEl.innerHTML = `
        <a href="${escapeHtml(card.url || '#')}">${escapeHtml(card.title || 'Untitled')}</a>
        <div class="result-card-meta">${tagHtml}${dateHtml}</div>`;
      cardsDiv.appendChild(cardEl);
    });
    container.appendChild(cardsDiv);
  }

  scrollToBottom(container);

  // Fire site action event if present
  if (data.action && data.action.type) {
    window.dispatchEvent(new CustomEvent('site:action', {
      detail: { type: data.action.type, params: data.action.params || {} }
    }));
  }
}

/**
 * appendErrorBubble — shows a friendly error message
 */
function appendErrorBubble(container, err) {
  console.error('[Chat]', err);
  const div = document.createElement('div');
  div.className = 'msg-ai';
  div.innerHTML = `
    <div class="msg-ai-avatar" aria-hidden="true">🐱</div>
    <div class="msg-bubble" style="color:var(--fg-secondary)">
      Hmm, something got lost in the looking-glass. Try again?
    </div>`;
  container.appendChild(div);
  scrollToBottom(container);
}

/** Scroll a container to the bottom */
function scrollToBottom(el) {
  el.scrollTop = el.scrollHeight;
}

/** Basic HTML escape */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert newlines to <br> and bold **text** */
function formatMessage(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

/**
 * wireChat — attaches send logic to a form + messages container pair
 */
function wireChat(formId, inputId, messagesId, chipsId) {
  const form     = document.getElementById(formId);
  const input    = document.getElementById(inputId);
  const messages = document.getElementById(messagesId);
  const chips    = document.getElementById(chipsId);

  if (!form || !input || !messages) return;

  // Auto-grow textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
  });

  // Chip clicks → fill input
  if (chips) {
    chips.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        input.value = chip.textContent.trim();
        input.dispatchEvent(new Event('input'));
        input.focus();
      });
    });
  }

  // Enter to submit (Shift+Enter for newline)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';

    appendUserBubble(messages, text);
    const typing = appendTyping(messages);

    try {
      const data = await sendMessage(text);
      typing.remove();
      appendAiResponse(messages, data);
    } catch (err) {
      typing.remove();
      appendErrorBubble(messages, err);
    }
  });
}

/* ── WIRE HOMEPAGE CHAT ─────────────────────────────────────── */
wireChat('homeChatForm', 'homeChatInput', 'homeChatMessages', 'homeChatChips');

/* ── FLOATING DRAWER ─────────────────────────────────────────── */
(function initDrawer() {
  const trigger = document.getElementById('chatTrigger');
  const drawer  = document.getElementById('chatDrawer');
  const close   = document.getElementById('chatClose');

  if (!trigger || !drawer) return;

  trigger.addEventListener('click', () => {
    const isOpen = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', String(!isOpen));
    drawer.hidden = isOpen;
    if (!isOpen) {
      // Wire drawer chat on first open
      wireChat('drawerForm', 'drawerInput', 'drawerMessages', 'drawerChips');
      document.getElementById('drawerInput')?.focus();
    }
  });

  if (close) {
    close.addEventListener('click', () => {
      trigger.setAttribute('aria-expanded', 'false');
      drawer.hidden = true;
    });
  }
})();
