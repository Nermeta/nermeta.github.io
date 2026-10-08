/* ═══════════════════════════════════════════════════════════════
   Wynter's Wonderland — Chat + UI JavaScript
   ═══════════════════════════════════════════════════════════════ */

const WORKER_URL = 'https://wynters-wonderland-ai.nermeta.workers.dev/chat';

// Fallback badge map — used only when context.json hasn't populated badge_image/badge_shape yet.
// Primary source of truth is card.badge_image + card.badge_shape from the AI response.
// Add new certs here only as a temporary fallback; the editor will write frontmatter which
// flows through build-context.js → context.json → Worker → card data automatically.
const CERT_BADGE_FALLBACKS = {
  'google cloud associate cloud engineer': { src: '/assets/images/badges/gcp-ace.png',             shape: 'round'  },
  'certified ethical hacker':              { src: '/assets/images/badges/ceh.png',                 shape: 'shield' },
  'google cybersecurity certificate':      { src: '/assets/images/badges/google-cybersecurity.png', shape: 'round' },
  'comptia security+':                     { src: '/assets/images/badges/security-plus.png',       shape: 'round'  },
  'aws solutions architect associate':     { src: '/assets/images/badges/aws-saa.png',             shape: 'round'  },
  'comptia linux+':                        { src: '/assets/images/badges/linux-plus.png',          shape: 'round'  },
  'comptia network+':                      { src: '/assets/images/badges/network-plus.png',        shape: 'round'  },
};

function resolveBadge(card) {
  if (card.type === 'certification') {
    if (card.badge_image) return { src: card.badge_image, shape: card.badge_shape || 'round' };
    const key = (card.title || '').toLowerCase().trim();
    return CERT_BADGE_FALLBACKS[key] || null;
  }
  if (card.type === 'book-review' || card.type === 'book') {
    if (card.badge_image) return { src: card.badge_image, shape: 'book' };
  }
  return null;
}

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
    body: JSON.stringify({
      messages: chatHistory,
      currentPage: window.location.pathname,
      currentDomain: window.__skillTreeDomain || null
    })
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
function appendAiResponse(container, data, source) {
  // Drawer + navigate_to: navigate only if the worker gave a real non-root URL
  if (source === 'drawer' && data.action?.type === 'navigate_to') {
    const dest = data.action.params?.url || '';
    const isReal = dest && dest !== '/' && dest !== window.location.pathname;
    if (isReal) {
      window.dispatchEvent(new CustomEvent('site:action', {
        detail: { type: 'navigate_to', params: data.action.params || {}, source }
      }));
      return;
    }
    // Bad/empty URL — fall through and render whatever message the worker sent
  }

  // Silent filter action (e.g. filter_shelf with no message): just fire and return
  if (!data.message?.trim() && data.action?.type) {
    window.dispatchEvent(new CustomEvent('site:action', {
      detail: { type: data.action.type, params: data.action.params || {}, source }
    }));
    return;
  }

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
      const dateHtml = card.date
        ? `<span>${escapeHtml(card.date)}</span>` : '';
      const badge   = resolveBadge(card);
      const imgHtml = badge
        ? `<div class="result-card-badge badge-${escapeHtml(badge.shape)}"><img src="${escapeHtml(badge.src)}" alt="" loading="lazy"></div>` : '';
      cardEl.innerHTML = `
        ${imgHtml}
        <div class="result-card-body">
          <a href="${escapeHtml(card.url || '#')}">${escapeHtml(card.title || 'Untitled')}</a>
          <div class="result-card-meta">${dateHtml}</div>
        </div>`;
      cardsDiv.appendChild(cardEl);
    });
    container.appendChild(cardsDiv);
  }

  scrollToBottom(container);

  // Fire site action event if present
  if (data.action && data.action.type) {
    const { type, params = {} } = data.action;
    window.dispatchEvent(new CustomEvent('site:action', {
      detail: { type, params, source }
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

/** Convert markdown to safe HTML: bold, links, newlines */
function formatMessage(text) {
  // Escape HTML first, then selectively un-escape for markdown patterns
  const escaped = escapeHtml(text);
  return escaped
    // **bold**
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // [link text](url) — only allow relative URLs and https
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)/g, '<a href="$2" class="chat-link">$1</a>')
    // newlines
    .replace(/\n/g, '<br>');
}

/**
 * resolveShortcut — handles simple queries client-side to save AI tokens.
 * Returns a fake response envelope, or null to fall through to the worker.
 */
function resolveShortcut(text) {
  const t = text.toLowerCase().trim();
  const page = window.location.pathname;

  // ── Chronicles / skill tree ──────────────────────────────
  if (page === '/learning-logs/') {
    if (/\b(all|show all|reset|everything)\b/.test(t))
      return { message: '', cards: [], action: { type: 'filter_tree', params: { status: 'all' } } };
    if (/\bcomplete[d]?\b|finished|done/.test(t))
      return { message: '', cards: [], action: { type: 'filter_tree', params: { status: 'completed' } } };
    if (/\bin.?progress|working on|started|current/.test(t))
      return { message: '', cards: [], action: { type: 'filter_tree', params: { status: 'in-progress' } } };
    if (/\bnot.?started|todo|haven.?t/.test(t))
      return { message: '', cards: [], action: { type: 'filter_tree', params: { status: 'not-started' } } };
  }

  // ── Emblems / certifications ─────────────────────────────
  if (page === '/certifications/') {
    if (/\bearned\b|completed\b|have\b/.test(t))
      return { message: '', cards: [], action: { type: 'filter_emblems', params: { status: 'earned' } } };
    if (/\bin.?progress|working on|studying/.test(t))
      return { message: '', cards: [], action: { type: 'filter_emblems', params: { status: 'in-progress' } } };
    if (/\ball\b|show all|reset|everything/.test(t))
      return { message: '', cards: [], action: { type: 'filter_emblems', params: { status: 'all' } } };
    if (/\bcloud\b/.test(t))
      return { message: '', cards: [], action: { type: 'filter_emblems', params: { topic: 'cloud' } } };
    if (/\bsecurity\b|cyber/.test(t))
      return { message: '', cards: [], action: { type: 'filter_emblems', params: { topic: 'security' } } };
    if (/\bnetwork/.test(t))
      return { message: '', cards: [], action: { type: 'filter_emblems', params: { topic: 'networking' } } };
    if (/\bsystems?\b|linux|windows/.test(t))
      return { message: '', cards: [], action: { type: 'filter_emblems', params: { topic: 'systems' } } };
  }

  // ── Library / book reviews ───────────────────────────────
  if (page === '/book-reviews/') {
    if (/\ball\b|show all|reset|everything/.test(t))
      return { message: '', cards: [], action: { type: 'filter_shelf', params: { genres: ['all'] } } };
    if (/\bfiction\b/.test(t))
      return { message: '', cards: [], action: { type: 'filter_shelf', params: { genres: ['fiction'] } } };
    if (/\bnon.?fiction\b/.test(t))
      return { message: '', cards: [], action: { type: 'filter_shelf', params: { genres: ['non-fiction'] } } };
    if (/\btechnical?\b|tech\b/.test(t))
      return { message: '', cards: [], action: { type: 'filter_shelf', params: { genres: ['technical'] } } };
    if (/\b5.?star|best|top rated|favorite/.test(t))
      return { message: '', cards: [], action: { type: 'filter_shelf', params: { rating: '5' } } };
    if (/\b4.?star/.test(t))
      return { message: '', cards: [], action: { type: 'filter_shelf', params: { rating: '4' } } };
  }

  // ── Cross-page nav shortcuts ─────────────────────────────
  const nav = (url) => ({ message: '', cards: [], action: { type: 'navigate_to', params: { url } } });

  if (/\bcerts?\b|certif\w+|emblems?\b/.test(t) && page !== '/certifications/')
    return nav('/certifications/');
  if (/\bbooks?\b|library\b|read\b|reading\b|reviews?\b/.test(t) && page !== '/book-reviews/')
    return nav('/book-reviews/');
  if (/\bwriteups?\b|htb\b|hack.?the.?box|ctf\b|machines?\b|boxes?\b/.test(t) && page !== '/writeups/')
    return nav('/writeups/');
  if (/\bchronicles\b|learning.?logs?\b|skill.?tree\b/.test(t) && page !== '/learning-logs/')
    return nav('/learning-logs/');
  if (/\bdiscoveries\b|deep.?dive\b/.test(t) && page !== '/deep-dives/')
    return nav('/deep-dives/');
  if (/\bexplorations?\b|tutorials?\b|guides?\b|how.?to\b/.test(t) && page !== '/tutorials/')
    return nav('/tutorials/');
  if (/\babout\b|who is wynter|who are you|background|bio\b/.test(t) && page !== '/about/')
    return nav('/about/');
  if (/\bhome\b|main page|go back|start over/.test(t) && page !== '/')
    return nav('/');

  return null; // fall through to worker
}

/**
 * wireChat — attaches send logic to a form + messages container pair
 */
function wireChat(formId, inputId, messagesId, chipsId, source) {
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

    // Client-side shortcuts — handle common queries locally, no AI call needed
    const shortcut = resolveShortcut(text);
    if (shortcut) {
      appendUserBubble(messages, text);
      const typing = appendTyping(messages);
      setTimeout(() => {
        typing.remove();
        appendAiResponse(messages, shortcut, source);
      }, 400 + Math.random() * 300);
      return;
    }

    appendUserBubble(messages, text);
    const typing = appendTyping(messages);

    try {
      const data = await sendMessage(text);
      typing.remove();
      appendAiResponse(messages, data, source);
    } catch (err) {
      typing.remove();
      appendErrorBubble(messages, err);
    }
  });
}

/* ── WIRE HOMEPAGE CHAT ─────────────────────────────────────── */
wireChat('homeChatForm', 'homeChatInput', 'homeChatMessages', 'homeChatChips', 'home');

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
      wireChat('drawerForm', 'drawerInput', 'drawerMessages', 'drawerChips', 'drawer');
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

/* ── SITE ACTION HANDLER ─────────────────────────────────────── */
// Handles navigate_to from the drawer: builds URL with filter params
// and navigates automatically. The home chat ignores navigate_to here
// (it renders cards/links inline instead).
window.addEventListener('site:action', e => {
  const { type, params = {}, source } = e.detail || {};

  if (type === 'navigate_to' && params.url) {
    const url = new URL(params.url, window.location.origin);
    if (params.status && params.status !== 'all') url.searchParams.set('status', params.status);
    if (params.topic  && params.topic  !== 'all') url.searchParams.set('topic',  params.topic);
    if (params.genre  && params.genre  !== 'all') url.searchParams.set('genre',  params.genre);
    if (params.rating && params.rating !== 'all') url.searchParams.set('rating', params.rating);
    window.location.href = url.toString();
  }
});
