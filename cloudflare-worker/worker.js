/**
 * Wynter's Wonderland — Cloudflare Worker
 *
 * Acts as a secure proxy between the site's chat UI and the Anthropic API.
 *
 * Responsibilities:
 *   1. Hold the Anthropic API key securely (never exposed to the browser)
 *   2. Inject site context (context.json) into every system prompt
 *   3. Enforce the JSON envelope response format
 *   4. Rate-limit per IP to prevent abuse
 *   5. Stream responses back to the chat UI
 *
 * Deploy:
 *   wrangler deploy
 *
 * Required secrets (set via Wrangler or Cloudflare dashboard):
 *   wrangler secret put ANTHROPIC_API_KEY
 *
 * Required vars in wrangler.toml:
 *   SITE_CONTEXT_URL = "https://nermeta.github.io/context.json"
 *   ALLOWED_ORIGIN   = "https://nermeta.github.io"
 */

// ---------------------------------------------------------------------------
// Off-topic pre-flight — mirrors the client guard as a second layer.
// If triggered, returns immediately without touching the AI.
// ---------------------------------------------------------------------------
// Fuzzy off-topic scorer — mirrors the client-side logic.
// Buckets + weights; site anchors subtract. Blocks at threshold.
const OFF_TOPIC_BUCKETS = [
  { signals: [
    { re: /\b(?:weather forecast|what.s the weather|will it rain|chance of (?:rain|snow))\b/i, w: 10 },
    { re: /\b(?:is it (?:sunny|raining|snowing|cold|hot) (?:today|outside|right now))\b/i,    w: 10 },
    { re: /\b(?:weather|forecast|humidity|wind chill|dew point)\b/i,                          w:  3 },
  ]},
  { signals: [
    { re: /\b(?:nfl|nba|mlb|nhl|fifa|super bowl|world series|stanley cup|march madness)\b/i,  w: 10 },
    { re: /\b(?:who (?:won|is winning|did win) (?:the )?(?:game|match|series))\b/i,           w: 10 },
    { re: /\b(?:soccer|basketball|baseball|american football|nascar race)\b/i,                w:  5 },
    { re: /\b(?:game score|sports score|final score)\b/i,                                     w:  8 },
  ]},
  { signals: [
    { re: /\b(?:what.s a good recipe|give me a recipe|how (?:do i |to )?(?:bake|cook) \w+ (?:cake|bread|soup|pasta|sauce|pie))\b/i, w: 10 },
    { re: /\b(?:best restaurants? (?:in|near)|where (?:should|can) i eat)\b/i,                w: 10 },
    { re: /\b(?:calories in|nutrition facts for|how many carbs)\b/i,                          w:  8 },
    { re: /\b(?:recipe|ingredient list|tablespoon|teaspoon|preheat oven)\b/i,                 w:  4 },
  ]},
  { signals: [
    { re: /\b(?:best (?:movies?|shows?|series) to watch|what (?:should|can) i watch|netflix|hulu|disney\+)\b/i, w: 10 },
    { re: /\b(?:who (?:sings?|sang|wrote|plays? in)|what (?:band|singer|artist))\b/i,        w:  8 },
    { re: /\b(?:taylor swift|beyoncé?|kanye|drake|ariana grande|billie eilish)\b/i,          w: 10 },
    { re: /\b(?:music album|new song|chart topping|box office)\b/i,                           w:  6 },
  ]},
  { signals: [
    { re: /\bwhat(?:'s| is)\s+\d[\d\s]*[+\-×÷*\/]\s*[\d\s]+\b/i,                            w: 10 },
    { re: /\bsolve (?:for )?[a-z]?\s*(?:=|:)\s*\d/i,                                        w: 10 },
    { re: /\b(?:what is the capital of|who invented|who discovered)\b/i,                     w:  8 },
    { re: /\b(?:essay (?:about|on)|write me a (?:poem|essay|story) about)\b/i,               w:  6 },
  ]},
  { signals: [
    { re: /\b(?:what (?:medication|drug|medicine) should i|can i take \w+ with|drug interaction)\b/i, w: 10 },
    { re: /\b(?:diagnose me|do i have|symptoms of (?:cancer|diabetes|flu|covid))\b/i,        w: 10 },
    { re: /\b(?:is \w+ safe to take|dosage for|prescription for)\b/i,                        w:  7 },
  ]},
  { signals: [
    { re: /\b(?:should i (?:buy|sell|invest in)|stock (?:price|tip|pick))\b/i,               w: 10 },
    { re: /\b(?:bitcoin|ethereum|crypto|nft)\s+(?:price|worth|invest|buy|sell)\b/i,         w: 10 },
    { re: /\b(?:will the market|best (?:stocks?|etf|fund) to buy)\b/i,                       w:  8 },
  ]},
];

const SITE_ANCHORS = [
  { re: /\bwynter\b/i,                                                                          w: 12 },
  { re: /\b(?:homelab|home lab|proxmox|truenas|pfsense|pihole)\b/i,                            w: 10 },
  { re: /\b(?:active directory|kerberos|ldap|powershell|group policy)\b/i,                    w: 10 },
  { re: /\b(?:ctf|hack ?the ?box|htb|tryhackme|writeup)\b/i,                                  w: 10 },
  { re: /\b(?:certification|comptia|security\+|network\+|aws|gcp|azure)\b/i,                  w:  8 },
  { re: /\b(?:tutorial|guide|walkthrough|deep.?dive|learning log|chronicle)\b/i,              w:  6 },
  { re: /\b(?:python|bash|linux|windows server|docker|kubernetes|ansible)\b/i,                w:  5 },
  { re: /\b(?:sysadmin|cybersecurity|pentest|red team|blue team|infosec|nmap)\b/i,            w:  8 },
  { re: /\b(?:this site|your site|her site|the site|your blog|her blog)\b/i,                  w:  8 },
  { re: /\b(?:book|review|read|library|recommend)\b/i,                                         w:  3 },
];

const OFF_TOPIC_THRESHOLD = 8;

const CHESHIRE_MSGS = [
  "Curiouser and curiouser — but that's a bit outside my looking-glass. I'm only a guide to Wynter's Wonderland.",
  "Oh my, that rabbit hole leads somewhere else entirely. I'm just a guide to this corner of the web.",
  "That question wandered off the map! I know this site very well, but not much beyond it.",
  "We've gone through the wrong door! I can only guide you around Wynter's Wonderland.",
];

function workerIsOffTopic(text) {
  const t = (text || '').trim();
  if (t.length < 8) return false;
  let score = 0;
  for (const bucket of OFF_TOPIC_BUCKETS) {
    for (const { re, w } of bucket.signals) {
      if (re.test(t)) score += w;
    }
  }
  for (const { re, w } of SITE_ANCHORS) {
    if (re.test(t)) score -= w;
  }
  return score >= OFF_TOPIC_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Rate limiting — per IP, stored in Cloudflare's built-in Workers KV or
// simple in-memory map (resets per isolate — fine for basic abuse prevention)
// ---------------------------------------------------------------------------
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS  = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQ    = 20;     // requests per window per IP

function checkRateLimit(ip) {
  const now    = Date.now();
  const record = rateLimitStore.get(ip) || { count: 0, windowStart: now };

  if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    // New window
    record.count       = 1;
    record.windowStart = now;
  } else {
    record.count++;
  }

  rateLimitStore.set(ip, record);
  return record.count <= RATE_LIMIT_MAX_REQ;
}

// ---------------------------------------------------------------------------
// CORS helper
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  'https://nermeta.github.io',
  'https://www.nermeta.github.io',
  'http://localhost:4000',
  'http://127.0.0.1:4000',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ---------------------------------------------------------------------------
// System prompt builder
// Fetches context.json from the live site and formats it for Claude.
// ---------------------------------------------------------------------------
async function buildSystemPrompt(env) {
  let contextBlock = '';

  try {
    const contextUrl = env.SITE_CONTEXT_URL || 'https://nermeta.github.io/context.json';
    const res        = await fetch(contextUrl, { cf: { cacheTtl: 300 } }); // 5-min edge cache
    if (res.ok) {
      const data    = await res.json();
      const entries = (data.entries || []).map(e => {
        const parts = [`[${e.type}] ${e.title} — ${e.url}`];
        if (e.summary)  parts.push(`  Summary: ${e.summary}`);
        if (e.topic)    parts.push(`  Topic: ${e.topic}`);
        if (e.tags?.length) parts.push(`  Tags: ${e.tags.join(', ')}`);
        // Type-specific — only include fields relevant to type to save tokens
        if (e.type === 'certification') {
          if (e.subject) parts.push(`  Subject: ${e.subject} (${e.status || 'unknown'})`);
          if (e.issuer)  parts.push(`  Issuer: ${e.issuer}, earned: ${e.cert_date}`);
        }
        if (e.type === 'book-review') {
          if (e.author) parts.push(`  Author: ${e.author}, rating: ${e.rating}/5`);
          if (e.badge_image && e.badge_shape === 'book') parts.push(`  Cover: ${e.badge_image}`);
        }
        if (e.type === 'writeup') {
          if (e.platform) parts.push(`  Platform: ${e.platform}, category: ${e.category}, difficulty: ${e.difficulty}`);
        }
        if (e.type === 'tutorial' || e.type === 'deep-dive') {
          if (e.tech_stack?.length) parts.push(`  Tech: ${e.tech_stack.join(', ')}`);
        }
        if (e.type === 'learning-log') {
          if (e.domain)  parts.push(`  Domain: ${e.domain}, status: ${e.status}`);
        }
        return parts.join('\n');
      });
      contextBlock = entries.length
        ? `\n\n## Site Content Index\n\n${entries.join('\n\n')}`
        : '\n\n## Site Content Index\n\n(No published content yet)';
    }
  } catch (err) {
    contextBlock = '\n\n## Site Content Index\n\n(Could not load at this time)';
  }

  return `You are the AI guide for Wynter's Wonderland — Wynter's personal portfolio and second-brain site.

Your primary role is NAVIGATION: when a visitor asks about Wynter's background, skills, projects, or interests, surface relevant content from the site index below and guide them to specific pages. Be a knowledgeable, enthusiastic curator.

Your secondary role is REPRESENTATION: speak warmly and accurately about Wynter. You have access to everything she has chosen to publish.

## Tone
Professional but warm — like a polished portfolio with personality. Not stiff, not overly casual. Match the visitor's register. If they seem technical, go technical. If not, stay accessible.

## Audience inference
Infer whether the visitor is technical or non-technical from how they phrase questions. Tech visitors often ask about tools, certs, platforms, code. General visitors often ask about books, learning journey, interests. Serve both — don't assume everyone wants the technical content.

## Response format (CRITICAL)
You MUST return ONLY raw JSON. No markdown. No code blocks. No backticks. No explanation before or after.
Your entire response must be parseable by JSON.parse() with nothing else around it.
Every response MUST be in this exact envelope:
{
  "message": "Your conversational reply here. Use markdown for formatting when helpful.",
  "cards": [],
  "action": {
    "type": "action_type_or_null",
    "params": {}
  }
}

The "cards" array renders clickable result cards below your message. Populate it when returning specific content items (certs, posts, books, etc.) so the visitor can click through. Each card:
{ "title": "Item title", "url": "/page/url/", "type": "certification|post|book-review|writeup|etc", "date": "optional date string", "badge_image": "/path/to/badge.png or null" }
For cert questions: populate cards with the relevant certifications from the index (url = /certifications/, type = "certification"). Always use /certifications/ as the url for certs — never individual cert slugs. Include the badge_image field from the index entry when available.
For book questions: populate cards with type "book-review". Always include the "badge_image" field from the index entry when available — it is used to display the cover art. Do not include an "isbn" field.

Action types you can trigger (set "type" to one of these, or null if no UI action needed):
- "filter_tree"      — params: { status: "completed"|"in-progress"|"not-started"|"all", domain?: "domain name" } → Chronicles skill tree filter. Use ONLY when visitor is already on /learning-logs/. Optionally pass the domain name (e.g. "scripting") to switch to that canvas.
- "filter_shelf"     — params: { genres: ["genre", ...] }                   → Bookshelf
- "focus_cert"       — params: { title: "cert title" }                      → Display case
- "filter_workbench" — params: { tech_stack: ["tech", ...] }                → Tutorials workbench
- "filter_archive"   — params: { topic: "topic name" }                      → Deep dive archive
- "filter_writeups"  — params: { platform: "HTB", category: "ad", difficulty: "medium" } → Writeups board
- "navigate_to"      — params: { url: "/path/to/page/" }                    → Browser navigation
- "filter_emblems"   — params: { status: "earned"|"in-progress"|"all", topic: "cloud"|"security"|"networking"|"systems"|"cybersecurity"|"all" } → Emblems badge grid filter. Use ONLY when you know the visitor is already on the Emblems page.
- "navigate_to"      — params: { url: string, status?: string, topic?: string, genre?: string, rating?: string } → Navigate to a page, optionally with filter params. For cert questions use url "/certifications/" with status/topic. For book questions use url "/book-reviews/" with genre/rating.
- null               — no UI action needed

## Cert reply rules
- NEVER link to individual certification URLs (e.g. /certifications/gcp-ace/). They don't exist as pages.
- For ANY cert question, ALWAYS populate the "cards" array with the matching certifications from the index. Never list cert names in the message text — put them in cards instead.
- Keep cert replies SHORT and quippy (1-2 sentences max). Let the cards do the work.
- Always include action "navigate_to" with url "/certifications/" plus any relevant status/topic filter params.

## Library reply rules
- If the visitor is on /book-reviews/ and asks to filter by genre or rating: use "filter_shelf" with NO message (set "message" to "") and NO cards — just trigger the action silently. The shelf updates itself.
- If the visitor is on /book-reviews/ and asks a general question about the books (not a filter request): reply normally with a short message and cards, no action.
- If the visitor is NOT on /book-reviews/ and asks about books: use "navigate_to" with url "/book-reviews/" and include genre/rating params if relevant (e.g. "fiction books" → { url: "/book-reviews/", genre: "fiction" }, "5-star books" → { url: "/book-reviews/", rating: "5" }). Populate cards with matching books.
- "filter_emblems" is ONLY for /certifications/. Never use it for book questions.

## Chronicles reply rules
- If the visitor is on /learning-logs/ and asks to filter by status (completed, in progress, not started, all): use "filter_tree" with the matching status and the domain that has the most matching logs if you can infer it, NO message (set "message" to ""), NO cards — just trigger the action silently. The tree updates itself.
- If the visitor is on /learning-logs/ and asks what's completed, in progress, or not started: use "filter_tree" with the matching status and domain if inferable, NO message, NO cards.
- If the visitor is NOT on /learning-logs/ and asks about learning logs or Chronicles: use "navigate_to" with url "/learning-logs/".
- Never use "navigate_to" with url "/learning-logs/" if the visitor is already there — use "filter_tree" instead.
- Never return cards for Chronicles filter requests — the tree IS the interface.

## Privacy
Only discuss content that appears in the Site Content Index below. Do not speculate about Wynter's personal life beyond what she has published. If asked something you don't have data for, say so warmly and suggest what you do have. Do not mention the context index in your reponses.

## Off-topic questions
If a visitor asks something that has absolutely nothing to do with Wynter, her site, her work, or the topics she covers (sysadmin, security, homelab, development, learning, books), set "off_topic": true in your JSON response alongside a brief, friendly Cheshire-style redirect. Example: a question about the weather, sports scores, recipes, math homework, celebrity gossip, or political news.
When you set off_topic: true, keep message short (1 sentence), cards empty, action null.
## Section name mapping
The site uses these display names in navigation — use them when talking to visitors:
- "Chronicles" = learning-log entries (study logs, ongoing learning)
- "Library" = book-review entries (books Wynter has read and reviewed)
- "Discoveries" = deep-dive entries (in-depth technical breakdowns)
- "Explorations" = tutorial entries (step-by-step guides)
- "Emblems" = certification entries (certs earned or in progress)
- "Field Notes" = writeup entries (CTF and HTB walkthroughs)

When a visitor asks about any of these by display name, look up the matching type in the Site Content Index below.

${contextBlock}`;
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    const allowedOrigin = request.headers.get('Origin') || env.ALLOWED_ORIGIN || 'https://nermeta.github.io';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin),
      });
    }

    // Only accept POST to /chat
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/chat') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(allowedOrigin) },
      });
    }

    // Rate limiting
    const clientIP = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    if (!checkRateLimit(clientIP)) {
      return new Response(
        JSON.stringify({
          message: "You've sent a lot of messages! Please wait a minute before asking again.",
          cards: [],
          action: { type: null, params: {} },
        }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(allowedOrigin) },
        }
      );
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(allowedOrigin) },
      });
    }

    const { messages, currentPage, currentDomain } = body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(allowedOrigin) },
      });
    }

    // Off-topic pre-flight — check the last user message before calling AI
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    if (workerIsOffTopic(lastUserMsg)) {
      const msg = CHESHIRE_MSGS[Math.floor(Math.random() * CHESHIRE_MSGS.length)];
      return new Response(
        JSON.stringify({
          message: msg,
          cards: [],
          action: { type: null, params: {} },
          off_topic: true,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(allowedOrigin) },
        }
      );
    }

    // Build system prompt (fetches context.json)
    let systemPrompt = await buildSystemPrompt(env);

    // Inject current page/domain context so the model knows where the visitor is
    if (currentPage) {
      systemPrompt += `\n\n## Current visitor location\nThe visitor is currently on: ${currentPage}`;
      if (currentDomain) systemPrompt += `\nCurrently viewing domain: "${currentDomain}"`;
    }

       // Call Cloudflare Workers AI
    const cfPayload = {
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      max_tokens: 1024,
    };

    let cfRes;
    try {
      cfRes = await fetch(
        `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/wynters-wonderland/workers-ai/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.CF_API_TOKEN}`,
            'cf-aig-authorization': `Bearer ${env.CF_API_TOKEN}`,
          },
          body: JSON.stringify(cfPayload),
        }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          message: "I'm having trouble connecting right now. Please try again in a moment.",
          cards: [],
          action: { type: null, params: {} },
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(allowedOrigin) },
        }
      );
    }

    if (!cfRes.ok) {
      const errText = await cfRes.text();
      console.error('CF AI error:', cfRes.status, errText);
      return new Response(
        JSON.stringify({
          message: "Something went wrong on my end. Please try again.",
          cards: [],
          action: { type: null, params: {} },
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(allowedOrigin) },
        }
      );
    }

    // Parse response — Cloudflare AI uses OpenAI-compatible format
  
    const data = await cfRes.json();
    let rawContent = data.choices?.[0]?.message?.content || '';

    // Parse the JSON envelope the model should have returned
    let envelope;
    try {
      // Strip markdown code fences if the model wrapped its response
      const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      envelope = JSON.parse(cleaned);
    } catch {
      // Model didn't return valid JSON — try to salvage it.
      // Pattern: model outputs plain text followed by a JSON block.
      // Find the first { that starts a top-level JSON object.
      const jsonStart = rawContent.indexOf('\n{');
      if (jsonStart !== -1) {
        const textPart = rawContent.slice(0, jsonStart).trim();
        const jsonPart = rawContent.slice(jsonStart).trim();
        try {
          const inner = JSON.parse(jsonPart);
          // Use the text before the JSON as the message if inner.message is empty/missing
          envelope = inner;
          if (!envelope.message && textPart) envelope.message = textPart;
        } catch {
          envelope = {
            message: textPart || rawContent || "I couldn't form a response. Please try again.",
            cards: [],
            action: { type: null, params: {} },
          };
        }
      } else {
        envelope = {
          message: rawContent || "I couldn't form a response. Please try again.",
          cards: [],
          action: { type: null, params: {} },
        };
      }
    }

    // Guard: if message itself contains a JSON envelope, strip it out
    if (typeof envelope.message === 'string') {
      const msgJsonStart = envelope.message.indexOf('\n{');
      if (msgJsonStart !== -1) {
        const textBefore = envelope.message.slice(0, msgJsonStart).trim();
        const jsonPart   = envelope.message.slice(msgJsonStart).trim();
        try {
          const inner = JSON.parse(jsonPart);
          // Merge: keep the text as message, pull cards/action from inner if present
          if (!envelope.cards?.length && inner.cards?.length) envelope.cards = inner.cards;
          if (!envelope.action?.type && inner.action?.type)   envelope.action = inner.action;
          envelope.message = textBefore || inner.message || envelope.message;
        } catch {
          // Not valid JSON — just strip it to show clean text
          envelope.message = textBefore || envelope.message;
        }
      }
    }

    // Ensure envelope always has the required shape
    if (typeof envelope.message !== 'string') envelope.message = String(envelope.message || '');
    if (!Array.isArray(envelope.cards))        envelope.cards   = [];
    if (typeof envelope.action !== 'object' || !envelope.action) {
      envelope.action = { type: null, params: {} };
    }
    if (envelope.action.type === undefined)   envelope.action.type   = null;
    if (typeof envelope.action.params !== 'object') envelope.action.params = {};

    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(allowedOrigin),
      },
    });
  },
};
