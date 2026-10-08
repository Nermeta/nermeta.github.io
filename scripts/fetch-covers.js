#!/usr/bin/env node
/**
 * fetch-covers.js
 *
 * For every book review with an ISBN:
 *   1. Fetch the cover from Open Library if not already cached locally
 *   2. Compute the dominant spine color from the cover image
 *   3. Write spine_color back into the review's frontmatter (if not already set)
 *
 * Run: node scripts/fetch-covers.js
 * Called automatically by the GitHub Actions deploy workflow.
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Config ──────────────────────────────────────────────────────────────────
const REVIEWS_DIR = path.join(__dirname, '..', '_book-reviews');
const COVERS_DIR  = path.join(__dirname, '..', 'assets', 'images', 'covers');
const COVER_BASE  = 'https://covers.openlibrary.org/b/isbn/';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch a URL, following redirects, return Buffer */
function fetchBuffer(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects === 0) return reject(new Error('Too many redirects'));
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchBuffer(res.headers.location, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Compute dominant spine color from a JPEG buffer.
 * Pure Node — zero dependencies. Walks JPEG segments to find the scan data,
 * samples bytes as interleaved Y/Cb/Cr, converts to RGB, averages and darkens.
 * Also tries jimp first if it happens to be installed.
 */
async function dominantColorFromJpeg(buf) {
  // Try jimp if available
  try {
    const Jimp = require('jimp');
    const img  = await Jimp.read(buf);
    img.resize(16, 48);
    let r = 0, g = 0, b = 0, n = 0;
    img.scan(0, 0, 16, 48, (x, y, idx) => {
      const R = img.bitmap.data[idx];
      const G = img.bitmap.data[idx + 1];
      const B = img.bitmap.data[idx + 2];
      const br = (R + G + B) / 3;
      if (br > 230 || br < 20) return;
      r += R; g += G; b += B; n++;
    });
    if (n > 0) {
      const f = 0.72;
      return `rgb(${Math.round(r/n*f)},${Math.round(g/n*f)},${Math.round(b/n*f)})`;
    }
  } catch {}

  // Pure-Node fallback: walk JPEG segments to SOS marker, sample scan bytes
  try {
    let pos = 0;
    while (pos < buf.length - 1) {
      if (buf[pos] !== 0xFF) { pos++; continue; }
      const marker = buf[pos + 1];
      if (marker === 0xDA) { pos += 2; break; } // SOS — scan data starts here
      if (marker === 0xD8 || marker === 0xD9) { pos += 2; continue; }
      if (pos + 3 >= buf.length) break;
      const segLen = (buf[pos + 2] << 8) | buf[pos + 3];
      pos += 2 + segLen;
    }

    // Collect scan bytes (skip 0xFF escape sequences)
    const samples = [];
    while (pos < buf.length - 1 && samples.length < 4800) {
      const b0 = buf[pos];
      if (b0 === 0xFF) {
        pos += 2; // skip marker or stuffed byte
        if (buf[pos - 1] === 0x00) samples.push(0xFF);
        continue;
      }
      samples.push(b0);
      pos++;
    }

    if (samples.length < 9) return null;

    // Treat as interleaved Y/Cb/Cr triplets → approximate RGB
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i + 2 < samples.length; i += 3) {
      const Y  = samples[i];
      const Cb = samples[i + 1] - 128;
      const Cr = samples[i + 2] - 128;
      const R = Math.max(0, Math.min(255, Math.round(Y + 1.402 * Cr)));
      const G = Math.max(0, Math.min(255, Math.round(Y - 0.344 * Cb - 0.714 * Cr)));
      const B = Math.max(0, Math.min(255, Math.round(Y + 1.772 * Cb)));
      const br = (R + G + B) / 3;
      if (br > 230 || br < 20) continue;
      r += R; g += G; b += B; n++;
    }
    if (n === 0) return null;
    const f = 0.72;
    return `rgb(${Math.round(r/n*f)},${Math.round(g/n*f)},${Math.round(b/n*f)})`;
  } catch {}

  return null;
}

/** Parse YAML frontmatter from a markdown file, return { data, body, raw } */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content, raw: '' };
  return { raw: match[1], body: match[2] };
}

/** Read a single YAML key value from raw frontmatter string */
function getFmKey(raw, key) {
  const m = raw.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].replace(/^["']|["']$/g, '').trim() : null;
}

/** Set or replace a YAML key in raw frontmatter string */
function setFmKey(raw, key, value) {
  const line = `${key}: "${value}"`;
  if (new RegExp(`^${key}:`, 'm').test(raw)) {
    return raw.replace(new RegExp(`^${key}:.*$`, 'm'), line);
  }
  // Insert after spine_color or before the last field
  return raw + `\n${line}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(COVERS_DIR, { recursive: true });

  const files = fs.readdirSync(REVIEWS_DIR).filter(f => f.endsWith('.md'));
  let fetched = 0;
  let colored = 0;

  for (const file of files) {
    const filePath = path.join(REVIEWS_DIR, file);
    const content  = fs.readFileSync(filePath, 'utf8');
    const { raw, body } = parseFrontmatter(content);

    const isbn = getFmKey(raw, 'isbn');
    if (!isbn) continue;

    const coverPath = path.join(COVERS_DIR, `${isbn}.jpg`);
    const coverUrl  = `${COVER_BASE}${isbn}-L.jpg`;

    let buf = null;

    // 1. Fetch cover if not cached
    if (!fs.existsSync(coverPath)) {
      try {
        buf = await fetchBuffer(coverUrl);
        // Open Library returns a 1×1 GIF when no cover exists — skip those
        if (buf.length < 2000) {
          console.log(`  [skip] ${file} — no cover found on Open Library`);
          buf = null;
        } else {
          fs.writeFileSync(coverPath, buf);
          console.log(`  [fetch] ${file} → covers/${isbn}.jpg (${buf.length} bytes)`);
          fetched++;
        }
      } catch (err) {
        console.warn(`  [warn] ${file} — fetch failed: ${err.message}`);
      }
    } else {
      buf = fs.readFileSync(coverPath);
    }

    // 2. Compute and write spine_color if missing
    const existingColor = getFmKey(raw, 'spine_color');
    if (!existingColor && buf) {
      const color = await dominantColorFromJpeg(buf);
      if (color) {
        const newRaw     = setFmKey(raw, 'spine_color', color);
        const newContent = `---\n${newRaw}\n---\n${body}`;
        fs.writeFileSync(filePath, newContent);
        console.log(`  [color] ${file} → spine_color: ${color}`);
        colored++;
      } else {
        console.warn(`  [warn] ${file} — could not compute spine color from cover`);
      }
    }
  }

  console.log(`\nDone. Fetched ${fetched} cover(s), computed ${colored} spine color(s).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
