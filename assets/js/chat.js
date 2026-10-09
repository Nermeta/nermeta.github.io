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
  // Generic fallback — section nav cards have badge_image but no type
  if (card.badge_image) return { src: card.badge_image, shape: card.badge_shape || 'round' };
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

const TYPING_PHRASES = [
  'curling through the corridors…',
  'consulting the looking-glass…',
  'rifling through the archives…',
  'following the white rabbit…',
  'tracing the path through the woods…',
  'untangling the red thread…',
  'peering behind the curtain…',
  'searching the rabbit hole…',
  'listening to the tea leaves…',
  'shuffling through the cards…',
];

/**
 * appendTyping — adds an animated "typing" indicator with a rotating phrase
 */
function appendTyping(container) {
  const phrase = TYPING_PHRASES[Math.floor(Math.random() * TYPING_PHRASES.length)];
  const div = document.createElement('div');
  div.className = 'msg-ai msg-typing';
  div.innerHTML = `
    <div class="msg-ai-avatar" aria-hidden="true">🐱</div>
    <div class="msg-bubble"><span class="typing-text">${phrase}</span></div>`;
  container.appendChild(div);
  scrollToBottom(container);
  return div;
}

/**
 * appendAiResponse — adds the AI message + optional result cards
 */
function appendAiResponse(container, data, source) {
  // Worker flagged the message as off-topic — treat same as client guard
  if (data.off_topic) {
    appendOffTopicResponse(container, source);
    return;
  }

  // navigate_to: drawer navigates, home chat never does (shows cards inline instead)
  if (data.action?.type === 'navigate_to') {
    if (source === 'drawer') {
      const dest = data.action.params?.url || '';
      const isReal = dest && dest !== '/' && dest !== window.location.pathname;
      if (isReal) {
        window.dispatchEvent(new CustomEvent('site:action', {
          detail: { type: 'navigate_to', params: data.action.params || {}, source }
        }));
        return;
      }
    }
    // Home source, or bad/empty URL — strip the action so it doesn't fire below
    data = { ...data, action: null };
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

      const badge   = resolveBadge(card);
      const imgHtml = badge
        ? `<div class="result-card-badge badge-${escapeHtml(badge.shape)}"><img src="${escapeHtml(badge.src)}" alt="" loading="lazy"></div>` : '';

      // Build meta line — varies by card type
      const metaParts = [];
      if (card.type === 'tutorial' || card.type === 'deep-dive') {
        const SUIT = { novice: '♦', apprentice: '♣', journeyman: '♠', expert: '♥' };
        const diff = (card.difficulty || '').toLowerCase();
        if (diff && SUIT[diff]) {
          metaParts.push(`<span class="rc-difficulty rc-diff-${escapeHtml(diff)}">${SUIT[diff]} ${escapeHtml(card.difficulty)}</span>`);
        }
        if (card.estimated_read) metaParts.push(`<span>${escapeHtml(String(card.estimated_read))} min</span>`);
      } else {
        if (card.date) metaParts.push(`<span>${escapeHtml(card.date)}</span>`);
      }
      const metaHtml = metaParts.length ? metaParts.join('') : '';

      cardEl.innerHTML = `
        ${imgHtml}
        <div class="result-card-body">
          <a href="${escapeHtml(card.url || '#')}">${escapeHtml(card.title || 'Untitled')}</a>
          <div class="result-card-meta">${metaHtml}</div>
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
 * Shortcuts registry — loaded once from shortcuts.json + section-images.json.
 */
let _shortcuts = null;
let _shortcutsPromise = null;

function loadShortcuts() {
  if (_shortcuts !== null) return Promise.resolve(_shortcuts);
  if (_shortcutsPromise) return _shortcutsPromise;
  _shortcutsPromise = Promise.all([
    fetch('/assets/data/shortcuts.json').then(r => r.json()).catch(() => []),
    fetch('/assets/data/section-images.json').then(r => r.json()).catch(() => ({}))
  ]).then(([shortcuts, sectionImages]) => {
    _shortcuts = shortcuts.map(s => {
      const sectionUrl = s.image_from_section || s.action?.params?.url;
      const section = sectionUrl ? sectionImages[sectionUrl] : null;
      if (!section) return s;
      return {
        ...s,
        image:       section.src   || s.image       || null,
        image_shape: section.shape || s.image_shape || 'round',
      };
    });
    return _shortcuts;
  });
  return _shortcutsPromise;
}

loadShortcuts();

/**
 * Collection cache — slim card data from assets/data/<name>.json, fetched on demand.
 */
const _collectionCache = {};

function loadCollection(name) {
  if (_collectionCache[name]) return Promise.resolve(_collectionCache[name]);
  return fetch(`/assets/data/${name}.json`)
    .then(r => r.json())
    .then(data => { _collectionCache[name] = data; return data; })
    .catch(() => []);
}

/**
 * filterCollection — applies a collection_filter object to an array of cards.
 */
function filterCollection(cards, filter) {
  if (!filter) return cards;
  return cards.filter(c => {
    if (filter.status && c.status !== filter.status) return false;
    if (filter.topic  && c.topic  !== filter.topic)  return false;
    if (filter.min_rating != null && (c.rating || 0) < filter.min_rating) return false;
    return true;
  });
}

/**
 * sanitizeInput — strips HTML tags and control characters from user input.
 * Defense against injected markup before it ever reaches the DOM or the worker.
 */
function sanitizeInput(str) {
  return str
    // Strip all HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove null bytes and control chars (except normal whitespace)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    // Collapse to reasonable length (worker has its own limit, but clip here too)
    .slice(0, 2000)
    .trim();
}

/**
 * isOffTopic — returns true when a message is clearly unrelated to the site.
 * Catches weather, sports, recipes, math homework, celebrity gossip, etc.
 * NOT exhaustive — the worker's system prompt adds a second layer.
 */
const OFF_TOPIC_PATTERNS = [
  // Weather
  /\bweather\b/i, /\bforecast\b/i, /\btemperature\b/i, /\b(?:rain|snow|sunny|cloudy|humidity)\b/i,
  // Sports
  /\b(?:nfl|nba|mlb|nhl|fifa|soccer|football|basketball|baseball|hockey|tennis|golf|olympics)\b/i,
  /\bscore(?:s|board)?\b.*\b(?:game|match|today)\b/i,
  // Food / recipes
  /\b(?:recipe|ingredient|bake|baking|cook(?:ing)?|cuisine|restaurant|meal)\b/i,
  // Movies / TV / music / celebrity
  /\b(?:movie|film|actor|actress|celebrity|pop star|singer|album|concert|netflix|disney|hulu)\b/i,
  // Math homework
  /\bsolve\s+(?:for\s+)?[0-9x]/i,
  /\b(?:calculus|algebra|geometry|equation|derivative|integral|quadratic)\b/i,
  /\bwhat\s+is\s+\d+\s*[+\-*/^]\s*\d+/i,
  // General trivia / general knowledge off-site
  /\bwho\s+(?:invented|discovered|wrote|created)\b(?!.{0,60}wynter)/i,
  /\bwhat\s+is\s+the\s+capital\s+of\b/i,
  /\btranslate\s+(?:this|to|from)\b/i,
  // Politics
  /\b(?:president|congress|senate|democrat|republican|politics|election|vote|ballot)\b/i,
  // Medical / legal advice
  /\b(?:diagnose|diagnosis|prescription|lawsuit|attorney|legal advice)\b/i,
  // Cryptocurrency off-topic speculation
  /\b(?:buy|sell|invest|price|crypto|bitcoin|ethereum|nft)\b.*\b(?:worth|value|moon|crash)\b/i,
];

function isOffTopic(text) {
  const t = text.trim();
  // Very short inputs pass through (could be a typo or a partial question)
  if (t.length < 6) return false;
  return OFF_TOPIC_PATTERNS.some(p => p.test(t));
}

/**
 * appendOffTopicResponse — Cheshire says "not my domain" + surfaces page chips
 */
const CHESHIRE_REDIRECTS = [
  'Curiouser and curiouser — but that's a bit outside my looking-glass. I'm just a guide to this corner of the web. Maybe one of these will help:',
  'Oh my, that rabbit hole leads somewhere else entirely. I'm only a guide to Wynter's Wonderland. Try one of these instead:',
  'That question wandered off the map! I know this site very well, but not much beyond it. Here's what I *can* help with:',
  'We've gone a bit through the wrong door. I can only guide you around here — give one of these a try:',
];

function appendOffTopicResponse(container, source) {
  const msg = CHESHIRE_REDIRECTS[Math.floor(Math.random() * CHESHIRE_REDIRECTS.length)];
  const page = window.location.pathname;

  // Gather chips for this page
  const chipData = _shortcuts
    ? _shortcuts.filter(s => {
        const pages    = s.pages || ['*'];
        const excluded = s.excludePages || [];
        return s.chip &&
          (pages.includes('*') || pages.includes(page)) &&
          !excluded.includes(page);
      }).map(s => s.chip).slice(0, 6)
    : [];

  const chipsHtml = chipData.length
    ? `<div class="msg-chips">${chipData.map(c => `<button class="chip">${escapeHtml(c)}</button>`).join('')}</div>`
    : '';

  const div = document.createElement('div');
  div.className = 'msg-ai';
  div.innerHTML = `
    <div class="msg-ai-avatar" aria-hidden="true">🐱</div>
    <div class="msg-bubble">${escapeHtml(msg)}${chipsHtml}</div>`;

  // Wire chip clicks — insert text into whichever input is in use
  const inputId = source === 'home' ? 'homeChatInput' : 'drawerInput';
  div.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const inp = document.getElementById(inputId);
      if (inp) {
        inp.value = chip.textContent.trim();
        inp.dispatchEvent(new Event('input'));
        inp.focus();
      }
    });
  });

  container.appendChild(div);
  scrollToBottom(container);
}

/**
 * resolveShortcut — async, returns response envelope or null (fall through to worker).
 * For nav shortcuts on home: fetches collection data and returns real result cards.
 */
async function resolveShortcut(text) {
  await loadShortcuts();
  if (!_shortcuts || !_shortcuts.length) return null;
  const t    = text.toLowerCase().trim();
  const page = window.location.pathname;

  for (const s of _shortcuts) {
    const pages = s.pages || ['*'];
    const onCorrectPage = pages.includes('*') || pages.includes(page);
    if (!onCorrectPage) continue;

    const excluded = s.excludePages || [];
    if (excluded.includes(page)) continue;

    const patterns = s.patterns || [];
    const matched  = patterns.some(p => new RegExp(p).test(t));
    if (!matched) continue;

    // Home chat never navigates — load collection cards + return home_message
    if (page === '/' && s.action?.type === 'navigate_to') {
      if (!s.home_message) return null;
      let cards = [];
      if (s.collection) {
        const all     = await loadCollection(s.collection);
        const filtered = filterCollection(all, s.collection_filter || null);
        const limit   = s.collection_limit || filtered.length;
        cards = filtered.slice(0, limit);
      }
      return { message: s.home_message, cards, action: null };
    }

    return { message: '', cards: [], action: s.action };
  }

  return null;
}

/**
 * getChipsForPage — returns chip labels from shortcuts.json for a given page path.
 */
function getChipsForPage(page) {
  if (!_shortcuts) return [];
  return _shortcuts
    .filter(s => {
      const pages    = s.pages || ['*'];
      const excluded = s.excludePages || [];
      return s.chip &&
        (pages.includes('*') || pages.includes(page)) &&
        !excluded.includes(page);
    })
    .map(s => ({ label: s.chip }));
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

  // Wire chip clicks (shared helper, called after chip HTML is set)
  function wireChips() {
    if (!chips) return;
    chips.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        input.value = chip.textContent.trim();
        input.dispatchEvent(new Event('input'));
        input.focus();
      });
    });
  }

  // Populate chips from shortcuts.json for this page, then wire them
  if (chips) {
    loadShortcuts().then(() => {
      const chipData = getChipsForPage(window.location.pathname);
      if (chipData.length) {
        chips.innerHTML = chipData
          .map(c => `<button class="chip">${escapeHtml(c.label)}</button>`)
          .join('');
      }
      wireChips();
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
    const raw  = input.value.trim();
    const text = sanitizeInput(raw);
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';

    // Client-side off-topic guard — catch obvious nonsense before burning tokens
    appendUserBubble(messages, text);
    if (isOffTopic(text)) {
      const typing = appendTyping(messages);
      setTimeout(() => {
        typing.remove();
        appendOffTopicResponse(messages, source);
      }, 700 + Math.random() * 400);
      return;
    }

    // Client-side shortcuts — handle common queries locally, no AI call needed
    const shortcut = await resolveShortcut(text);
    if (shortcut) {
      const typing = appendTyping(messages);
      setTimeout(() => {
        typing.remove();
        appendAiResponse(messages, shortcut, source);
      }, 900 + Math.random() * 600);
      return;
    }
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
