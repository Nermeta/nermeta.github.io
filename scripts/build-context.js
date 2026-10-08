#!/usr/bin/env node
/**
 * build-context.js
 *
 * Reads all Jekyll collection files, extracts frontmatter, and outputs
 * context.json — the knowledge base injected into the AI system prompt.
 *
 * Run:  node scripts/build-context.js
 * Output: context.json (at repo root, excluded from Jekyll build)
 *
 * Rules:
 *   - Files with `public: false` in frontmatter are excluded
 *   - Reads: _learning-logs, _certifications, _book-reviews,
 *            _deep-dives, _tutorials, _writeups, _posts
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Tiny frontmatter parser (no dependencies)
// ---------------------------------------------------------------------------
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { meta: {}, content: raw };

  const yamlBlock = match[1];
  const content   = raw.slice(match[0].length).trim();
  const meta      = {};

  // Line-by-line YAML parse (handles strings, booleans, nulls, arrays, dates)
  const lines = yamlBlock.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (!keyMatch) { i++; continue; }

    const key   = keyMatch[1];
    let   value = keyMatch[2].trim();

    // Inline array  key: [a, b, c]
    if (value.startsWith('[')) {
      const inner = value.replace(/^\[|\]$/g, '');
      meta[key] = inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      i++;
      continue;
    }

    // Block sequence  key:\n  - item
    if (value === '' && lines[i + 1] && lines[i + 1].trim().startsWith('-')) {
      const arr = [];
      i++;
      while (i < lines.length && lines[i].trim().startsWith('-')) {
        arr.push(lines[i].trim().replace(/^-\s*/, '').replace(/^["']|["']$/g, ''));
        i++;
      }
      meta[key] = arr;
      continue;
    }

    // Primitives
    if (value === 'true')  { meta[key] = true;  i++; continue; }
    if (value === 'false') { meta[key] = false; i++; continue; }
    if (value === 'null' || value === '~' || value === '') { meta[key] = null; i++; continue; }

    // Number
    if (/^\d+$/.test(value)) { meta[key] = parseInt(value, 10); i++; continue; }
    if (/^\d+\.\d+$/.test(value)) { meta[key] = parseFloat(value); i++; continue; }

    // Quoted string
    value = value.replace(/^["']|["']$/g, '');
    meta[key] = value;
    i++;
  }

  return { meta, content };
}

// ---------------------------------------------------------------------------
// Collection definitions
// ---------------------------------------------------------------------------
const COLLECTIONS = [
  { dir: '_learning-logs',  type: 'learning-log'  },
  { dir: '_certifications', type: 'certification'  },
  { dir: '_book-reviews',   type: 'book-review'    },
  { dir: '_deep-dives',     type: 'deep-dive'      },
  { dir: '_tutorials',      type: 'tutorial'       },
  { dir: '_writeups',       type: 'writeup'        },
  { dir: '_posts',          type: 'post'           },
];

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Build a permalink from filename + collection dir
// ---------------------------------------------------------------------------
function makeUrl(collectionDir, filename) {
  const slug    = filename.replace(/\.\w+$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
  const dirName = collectionDir.replace(/^_/, '');
  return `/${dirName}/${slug}/`;
}

// ---------------------------------------------------------------------------
// Extract a short excerpt from markdown body (first non-heading paragraph)
// ---------------------------------------------------------------------------
function excerpt(content, maxLen = 200) {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (!line.startsWith('#') && !line.startsWith('```') && line.length > 20) {
      return line.length > maxLen ? line.slice(0, maxLen) + '…' : line;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const index = { generated_at: new Date().toISOString(), entries: [] };

for (const { dir, type } of COLLECTIONS) {
  const collDir = path.join(ROOT, dir);
  if (!fs.existsSync(collDir)) continue;

  const files = fs.readdirSync(collDir).filter(f => /\.(md|markdown)$/i.test(f));

  for (const filename of files) {
    const raw             = fs.readFileSync(path.join(collDir, filename), 'utf8');
    const { meta, content } = parseFrontmatter(raw);

    // Respect public: false
    if (meta.public === false) continue;

    // Build the entry — only fields the AI needs
    const entry = {
      type:       meta.type       || type,
      title:      meta.title      || filename,
      url:        makeUrl(dir, filename),
      date:       meta.date       || null,
      topic:      meta.topic      || null,
      tags:       meta.tags       || [],
      audience:   meta.audience   || [],
      summary:    meta.summary    || excerpt(content),
    };

    // Type-specific fields
    if (type === 'learning-log') {
      entry.subject = meta.subject || null;
      entry.status  = meta.status  || null;
    }

    if (type === 'certification') {
      entry.issuer         = meta.issuer         || null;
      entry.cert_date      = meta.cert_date      || null;
      entry.credential_url = meta.credential_url || null;
      entry.expiry         = meta.expiry         || null;
      entry.badge_image    = meta.badge_image    || null;
      entry.badge_shape    = meta.shape          || 'round';
      entry.status         = meta.status         || 'earned';
    }

    if (type === 'book-review') {
      entry.author        = meta.author        || null;
      entry.isbn          = meta.isbn          || null;
      entry.genre         = meta.genre         || [];
      entry.rating        = meta.rating        || null;
      entry.finished_date = meta.finished_date || null;
    }

    if (type === 'deep-dive' || type === 'tutorial') {
      entry.difficulty     = meta.difficulty     || null;
      entry.tech_stack     = meta.tech_stack     || [];
      entry.estimated_read = meta.estimated_read || null;
    }

    if (type === 'writeup') {
      entry.platform   = meta.platform   || null;
      entry.category   = meta.category   || null;
      entry.difficulty = meta.difficulty || null;
      entry.tools      = meta.tools      || [];
      entry.outcome    = meta.outcome    || null;
    }

    index.entries.push(entry);
  }
}

// Sort newest-first
index.entries.sort((a, b) => {
  const da = a.date ? new Date(a.date) : new Date(0);
  const db = b.date ? new Date(b.date) : new Date(0);
  return db - da;
});

const outputPath = path.join(ROOT, 'context.json');
fs.writeFileSync(outputPath, JSON.stringify(index, null, 2));

console.log(`✓ context.json written — ${index.entries.length} public entries`);
