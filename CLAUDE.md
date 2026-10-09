# Wonderland — Claude session notes

## Session start

Run this at the start of every session to keep remote-tracking refs fresh
(prevents the stop hook from falsely reporting "no remote branch"):

```bash
git fetch --prune
```

## Standing rules

- Always create a feature branch before making changes, or ask whether
  changes should go to main or a branch.
- Git commit messages: short and sweet — one sentence at most.
- `pages` field is frontend-only — must NOT be added to `build-context.js`
  or sent to the AI via `context.json`.

## Active branch

`feature/tutorial-workbench` — all current work lives here.

## Architecture notes

- `site:action` CustomEvent pattern — chat dispatches, page layouts listen.
- `filter_cards` — action type used by the tutorials page layout.
- Worker response envelope: `{ message, cards, action, off_topic? }`.
- Fuzzy off-topic scoring in both `assets/js/chat.js` and
  `cloudflare-worker/worker.js` — threshold = 8, with site anchors that
  subtract score for on-topic signals.
- `node --check assets/js/chat.js` to validate JS syntax before committing.
