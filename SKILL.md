---
name: mindfeed
description: "Spaced repetition review system for resurfacing ideas at optimal intervals. Use when: (1) user wants to create review cards from conversations or notes, (2) user asks to add something to their review deck, (3) managing the review server, (4) generating cards from content. NOT for: traditional flashcard memorization — this is for idea integration and pattern-matching."
metadata:
  openclaw:
    emoji: "🧠"
    requires:
      anyBins: ["python3"]
---

# MindFeed — Spaced Repetition for Ideas

A self-hosted spaced repetition app that resurfaces ideas at increasing intervals. Unlike traditional Anki, this is designed for **idea integration** — revisiting concepts so they connect with new experiences over time.

## Quick Start

### Start the server

```bash
python3 <skill_dir>/scripts/server.py --port 8787
```

The app is available at `http://localhost:8787`. On first run, it creates `cards.json` from example cards and an empty `review-state.json`.

### Custom data directory

```bash
python3 <skill_dir>/scripts/server.py --port 8787 --dir /path/to/my/cards
```

## Card Format

Cards live in `cards.json` — an array of objects:

```json
[
  {
    "id": "unique-slug",
    "domain": "Category Name",
    "title": "Card Title",
    "content": "Markdown content with **bold**, *italic*, lists, etc.",
    "releaseDate": "2026-01-15"
  }
]
```

- `id`: Unique identifier (kebab-case slug)
- `domain`: Category for grouping (e.g., "Philosophy", "AI", "Business")
- `title`: Display title
- `content`: Markdown-formatted content (rendered in the app)
- `releaseDate`: When the card becomes available for review

## Agent Workflows

### Adding cards from conversation

When the user says something like "add this to my review deck" or "I want to remember this":

1. Read the current `cards.json`
2. Generate a card with a unique `id`, appropriate `domain`, clear `title`, and markdown `content` that captures the key insight
3. Append to the array and write back
4. Confirm: "Added card '{title}' to your review deck in {domain}"

### Generating cards from content

When given an article, transcript, or notes to turn into cards:

1. Identify 3-7 key insights worth revisiting
2. Each card should capture ONE idea clearly
3. Write content that's useful on re-read — not just a fact, but context for why it matters
4. Set `releaseDate` to today for immediate availability

### Card quality guidelines

**Good cards:**
- Capture an insight you'd want to revisit in 2 weeks
- Include enough context to be useful standalone
- Provoke thought, not just recall
- ~50-200 words of content

**Bad cards:**
- Raw facts without context
- Too long (>300 words) — split into multiple cards
- Too vague to be actionable on re-read

## Review State

`review-state.json` tracks per-card review history:

```json
{
  "card-id": {
    "interval": 1440,
    "ease": 2.5,
    "reps": 3,
    "due": 1709251200000,
    "lastReview": 1709164800000
  }
}
```

The app handles all scheduling logic. Don't modify review-state.json directly unless resetting a card.

## Rating System

Users rate cards 0-3:
- **Again (0):** Show again soon — didn't connect
- **Hard (1):** Recognized but needs more review
- **Good (2):** Connected, schedule normally
- **Easy (3):** Deeply integrated, push out further

## PWA Setup

For mobile home screen access:
1. Open `http://localhost:8787` (or Tailscale URL) in mobile browser
2. "Add to Home Screen" — creates an app icon
3. Opens as a standalone app without browser chrome

## Tips

- The server auto-creates `cards.json` from example cards on first run
- Cards support full markdown including lists, bold, italic, and links
- Review state persists via PUT to the server — survives page refreshes
- The app works offline after initial load (state syncs on next connection)
