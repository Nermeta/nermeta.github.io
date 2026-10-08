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
        if (e.audience?.length) parts.push(`  Audience: ${e.audience.join(', ')}`);
        // Type-specific
        if (e.subject)   parts.push(`  Subject: ${e.subject} (${e.status || 'unknown status'})`);
        if (e.issuer)    parts.push(`  Issuer: ${e.issuer}, earned: ${e.cert_date}`);
        if (e.author)    parts.push(`  Author: ${e.author}, rating: ${e.rating}/5`);
        if (e.platform)  parts.push(`  Platform: ${e.platform}, category: ${e.category}, difficulty: ${e.difficulty}, outcome: ${e.outcome}`);
        if (e.tools?.length) parts.push(`  Tools: ${e.tools.join(', ')}`);
        if (e.tech_stack?.length) parts.push(`  Tech stack: ${e.tech_stack.join(', ')}`);
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

The "cards" array is reserved for future link card rendering — leave as empty array for now.

Action types you can trigger (set "type" to one of these, or null if no UI action needed):
- "highlight_nodes"  — params: { subjects: ["subject name", ...] }         → Skill tree
- "filter_shelf"     — params: { genres: ["genre", ...] }                   → Bookshelf
- "focus_cert"       — params: { title: "cert title" }                      → Display case
- "filter_workbench" — params: { tech_stack: ["tech", ...] }                → Tutorials workbench
- "filter_archive"   — params: { topic: "topic name" }                      → Deep dive archive
- "filter_writeups"  — params: { platform: "HTB", category: "ad", difficulty: "medium" } → Writeups board
- "navigate_to"      — params: { url: "/path/to/page/" }                    → Browser navigation
- "filter_emblems"   — params: { status: "earned"|"in-progress"|"all", topic: "cloud"|"security"|"networking"|"systems"|"cybersecurity"|"all" } → Emblems badge grid filter. Use when the visitor asks to see specific certs by status or topic (e.g. "show earned certs", "show cloud certifications", "what security certs does she have?"). Omit a param to leave that filter unchanged (e.g. only pass status if they only asked about status). Pass "all" to reset a filter.
- null               — no UI action needed

## Privacy
Only discuss content that appears in the Site Content Index below. Do not speculate about Wynter's personal life beyond what she has published. If asked something you don't have data for, say so warmly and suggest what you do have. Do not mention the context index in your reponses.
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

    const { messages } = body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(allowedOrigin) },
      });
    }

    // Build system prompt (fetches context.json)
    const systemPrompt = await buildSystemPrompt(env);

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
      // Model didn't return valid JSON — wrap plain text in the envelope shape
      envelope = {
        message: rawContent || "I couldn't form a response. Please try again.",
        cards: [],
        action: { type: null, params: {} },
      };
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
