# MindFeed (Wizard app)

A few ideas that resonated, every day. Do at least three cards; keep going if you like. Each card gets one of four ratings, and the ratings steer what comes back:

| Rating | Effect |
|---|---|
| On point | back in ~4 days; that domain shows up more |
| Resonant | back in ~12 days |
| Not so much | back in ~45 days; that domain shows up less |
| Not for me | retired |

No memorisation, no Anki grind. The feed rotates across sources and domains so a day never becomes one thinker.

## Run

```
APP_PORT=9447 APP_BASE_PATH=/mindfeed MINDFEED_DATA=./data python3 app/server.py
```

Stdlib only (Python 3.10+). Colours follow Wizard Appearance v1 (`--wz-*` tokens) with a dark standalone fallback.

## Sources (`MINDFEED_SOURCES`, JSON list)

- `{"type":"wisdom","url":"http://127.0.0.1:9230/","view":"/wisdom/"}`: highlights from a Wisdom app.
- `{"type":"folder","path":"/path/to/cards","label":"Philosopher","prefix":"p"}`: a folder of Markdown card files. An agent with file access adds a card by writing one file:

```
---
title: Emptiness wrongly grasped
attribution: Nāgārjuna · MMK 24.11
domain: Buddhism / Madhyamaka
kind: quote
---
Emptiness wrongly grasped is like a snake wrongly held.
```

- Cards stored in MindFeed itself (added through the API below).

## API (under the base path)

- `GET api/today` · today's cards, progress, pool counts
- `GET api/status` · `{day, rated, goal, done}` (used by Morning to tick its step)
- `GET api/days` · days with the goal met
- `GET api/cards` · the whole library
- `POST api/rate {id, r}` · r = 1..4
- `POST api/more` · one more card today
- `POST api/cards {text, title?, attribution?, domain?, kind?: idea|quote, note?, added_by?, id?}` · add or update a card (same `id` updates)
- `POST api/cards/archive {id}`

Browser POSTs must be same-origin or listed in `MINDFEED_ORIGINS`; local callers without an Origin header (agents, scripts) are allowed. Put the app behind your private gateway.

The day boundary follows Wizard's `settings.json` clock (`timezone`, `day_starts_at`), else `MINDFEED_TZ` at 06:00.

`legacy/` holds the original Anki-style MindFeed for reference.
