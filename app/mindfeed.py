"""MindFeed engine: a daily handful of ideas that resonated, rated on a four-step scale.

Not memorisation. A rating says how much a card still resonates and steers what comes back:
  4 On point     -> back in ~4 days; its domain/thinker is surfaced more
  3 Resonant     -> back in ~12 days
  2 Not so much  -> back in ~45 days; its domain surfaced less
  1 Not for me   -> retired (still listed, never shown)

Cards come from three kinds of source, all merged into one pool:
  - own:    cards stored here (added by the owner or by agents through POST /api/cards)
  - folder: a directory of Markdown card files with front matter (e.g. an agent's wiki/mindfeed/)
  - wisdom: highlights from a Wisdom app (GET <url>/api/wisdom)
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import random
import re
import threading
import time
import urllib.request
from pathlib import Path

GOAL = 3
GAP = {4: 4, 3: 12, 2: 45}
WEIGHT = {4: 2.0, 3: 1.0, 2: -1.0, 1: -2.0}
LABELS = {4: "On point", 3: "Resonant", 2: "Not so much", 1: "Not for me"}
LOCK = threading.RLock()


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def slug(s: str, n: int = 48) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:n] or "card"


def parse_card_file(text: str) -> tuple[dict, str]:
    meta: dict = {}
    body = text
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip().lower()] = v.strip().strip('"')
        body = m.group(2)
    return meta, body.strip()


class Feed:
    def __init__(self, data: Path, sources: list[dict]):
        self.data = data
        self.path = data / "state.json"
        self.sources = sources
        self._cache: dict[str, tuple[float, object]] = {}

    # ---------- storage ----------
    def load(self) -> dict:
        try:
            s = json.loads(self.path.read_text())
        except Exception:
            s = {}
        for k in ("cards", "ratings", "days"):
            s.setdefault(k, {})
        return s

    def save(self, s: dict) -> None:
        self.data.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(s, indent=1, ensure_ascii=False, sort_keys=True))
        tmp.replace(self.path)

    # ---------- sources ----------
    def _get_json(self, url: str, ttl: float = 90):
        hit = self._cache.get(url)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        try:
            with urllib.request.urlopen(url, timeout=8) as r:
                v = json.loads(r.read())
        except Exception:
            v = hit[1] if hit else None
        self._cache[url] = (time.time(), v)
        return v

    def wisdom_cards(self, src: dict) -> list[dict]:
        base = src["url"].rstrip("/") + "/"
        w = self._get_json(base + "api/wisdom")
        if not isinstance(w, dict):
            return []
        view = src.get("view", "/wisdom/")
        entries = {e["id"]: e for e in w.get("entries", [])}
        thinkers = {t["id"]: t for t in w.get("thinkers", [])}
        col_of: dict[str, dict] = {}
        for c in w.get("collections", []):
            for i in c.get("entries", []):
                col_of.setdefault(i, c)
        out = []
        for h in w.get("highlights", []):
            text = (h.get("text") or "").strip()
            if len(text) < 12:
                continue
            e = entries.get(h.get("entry_id")) or {}
            c = col_of.get(h.get("entry_id")) or {}
            who = (thinkers.get(e.get("thinker") or "") or {}).get("name") or ""
            out.append({"id": f"w:{h['id']}", "source": "wisdom", "source_label": src.get("label", "Wisdom highlight"),
                        "text": text, "note": h.get("note") or "", "title": "",
                        "attribution": " · ".join(x for x in (who, e.get("title")) if x) or "Wisdom",
                        "domain": who or c.get("title") or "Wisdom", "added_at": h.get("created_at"),
                        "href": f"{view}#/read/{e['id']}/{c.get('id')}" if e and c else None})
        return out

    def folder_cards(self, src: dict) -> list[dict]:
        root = Path(src["path"])
        out = []
        try:
            files = sorted(root.glob("*.md"))
        except OSError:
            return []
        for f in files:
            try:
                meta, body = parse_card_file(f.read_text())
                st = f.stat()
            except OSError:
                continue
            if not body:
                continue
            out.append({"id": f"{src.get('prefix', 'f')}:{f.stem}", "source": src.get("kind", "folder"),
                        "source_label": src.get("label", "Notes"), "text": body, "title": meta.get("title", ""),
                        "attribution": meta.get("attribution", ""), "domain": meta.get("domain") or meta.get("attribution") or src.get("label", ""),
                        "note": meta.get("note", ""), "kind": meta.get("kind", "idea"),
                        "added_at": meta.get("saved") or dt.datetime.fromtimestamp(st.st_mtime, dt.timezone.utc).isoformat(), "href": None})
        return out

    def pool(self, s: dict) -> dict[str, dict]:
        p: dict[str, dict] = {}
        for src in self.sources:
            try:
                items = self.wisdom_cards(src) if src["type"] == "wisdom" else self.folder_cards(src) if src["type"] == "folder" else []
            except Exception:
                items = []
            for it in items:
                p.setdefault(it["id"], it)
        for k, v in s["cards"].items():
            if not v.get("archived"):
                p.setdefault(k, v)
        return p

    # ---------- adding ----------
    def add(self, text: str, title: str = "", attribution: str = "", domain: str = "", kind: str = "idea",
            note: str = "", added_by: str = "owner", source_label: str = "", card_id: str = "") -> dict:
        text = (text or "").strip()
        if len(text) < 3:
            raise ValueError("text is required")
        if len(text) > 4000:
            raise ValueError("text is longer than 4000 characters")
        cid = "c:" + (slug(card_id) if card_id else slug(title or text[:40]) + "-" + hashlib.sha1(text.encode()).hexdigest()[:6])
        with LOCK:
            s = self.load()
            card = {"id": cid, "source": "own", "source_label": source_label or (added_by.strip().capitalize() if added_by != "owner" else "Your notes"),
                    "text": text, "title": title.strip()[:160], "attribution": attribution.strip()[:160],
                    "domain": (domain or attribution).strip()[:80], "kind": kind if kind in ("idea", "quote") else "idea",
                    "note": note.strip()[:600], "added_by": added_by[:40], "added_at": now_iso(), "href": None}
            existed = cid in s["cards"]
            if existed:
                card["added_at"] = s["cards"][cid].get("added_at", card["added_at"])
            s["cards"][cid] = card
            self.save(s)
        return {"card": card, "updated": existed}

    def archive(self, cid: str) -> bool:
        with LOCK:
            s = self.load()
            if cid not in s["cards"]:
                return False
            s["cards"][cid]["archived"] = True
            self.save(s)
        return True

    # ---------- choosing ----------
    @staticmethod
    def last(s: dict, cid: str) -> tuple[int | None, str]:
        r = s["ratings"].get(cid) or []
        return (r[-1]["r"], r[-1]["day"]) if r else (None, "")

    def affinity(self, s: dict, pool: dict) -> dict[str, float]:
        tot: dict[str, list] = {}
        for cid, rs in s["ratings"].items():
            g = (pool.get(cid) or {}).get("domain")
            if g and rs:
                tot.setdefault(g, []).append(WEIGHT[rs[-1]["r"]])
        return {g: sum(v) / (len(v) + 2) for g, v in tot.items()}

    def ranked(self, s: dict, pool: dict, day: str, exclude: set) -> list[str]:
        today = dt.date.fromisoformat(day)
        aff = self.affinity(s, pool)
        rnd = random.Random(day)
        scored = []
        for cid, it in pool.items():
            if cid in exclude:
                continue
            r, rday = self.last(s, cid)
            score = aff.get(it.get("domain"), 0.0) + rnd.random() * 1.2
            if r is None:
                score += 1.0
                try:
                    if (today - dt.date.fromisoformat((it.get("added_at") or "")[:10])).days <= 3:
                        score += 1.0  # freshly saved: surface while it's warm
                except ValueError:
                    pass
            else:
                if r == 1:
                    continue
                overdue = (today - dt.date.fromisoformat(rday)).days - GAP[r]
                if overdue < 0:
                    continue
                score += {4: 1.6, 3: 0.6, 2: -0.8}[r] + min(overdue, 30) * 0.03
            scored.append((score, cid))
        scored.sort(reverse=True)
        # Variety: rotate across sources (Wisdom, Philosopher, your notes...) and, within a source, one card per
        # domain before repeats. The best-scoring card overall still leads.
        queues: dict[str, list[str]] = {}
        for _, cid in scored:
            queues.setdefault(pool[cid].get("source_label") or pool[cid]["source"], []).append(cid)
        for k, q in queues.items():
            first, rest = [], []
            seen = {pool[x].get("domain") for x in exclude if x in pool}
            for cid in q:
                key = pool[cid].get("domain")
                (rest if key in seen else first).append(cid)
                seen.add(key)
            queues[k] = first + rest
        order = list(queues)  # already in order of each source's best score
        start = len(exclude)  # continue the rotation where today's feed left off
        out: list[str] = []
        i = start
        while any(queues.values()):
            q = queues[order[i % len(order)]]
            if q:
                out.append(q.pop(0))
            i += 1
        return out

    def view(self, s: dict, it: dict, day: str) -> dict:
        rs = s["ratings"].get(it["id"]) or []
        today_r = next((x["r"] for x in reversed(rs) if x["day"] == day), None)
        before = [x for x in rs if x["day"] != day]
        keys = ("id", "source", "source_label", "text", "title", "attribution", "domain", "note", "kind", "href")
        return {k: it.get(k) for k in keys} | {"rating": today_r, "last": before[-1]["r"] if before else None, "seen": len(before)}

    def today(self, day: str, more: bool = False) -> dict:
        with LOCK:
            s = self.load()
            pool = self.pool(s)
            ids = [i for i in s["days"].get(day, []) if i in pool]
            want = max(GOAL, len(ids) + (1 if more else 0))
            if len(ids) < want:
                for cid in self.ranked(s, pool, day, set(ids)):
                    ids.append(cid)
                    if len(ids) >= want:
                        break
            if ids != s["days"].get(day):
                s["days"][day] = ids
                for k in sorted(s["days"])[:-500]:
                    s["days"].pop(k, None)
                self.save(s)
            cards = [self.view(s, pool[i], day) for i in ids]
            rated = sum(1 for c in cards if c["rating"])
            left = len(self.ranked(s, pool, day, set(ids)))
            by_src: dict[str, int] = {}
            for it in pool.values():
                by_src[it.get("source_label") or it["source"]] = by_src.get(it.get("source_label") or it["source"], 0) + 1
        return {"day": day, "cards": cards, "rated": rated, "goal": GOAL, "done": rated >= GOAL, "labels": LABELS,
                "more_available": left, "pool": {"total": len(pool), "by_source": by_src,
                                                  "retired": sum(1 for i in pool if self.last(s, i)[0] == 1)}}

    def rate(self, day: str, cid: str, r: int) -> dict:
        if r not in LABELS:
            raise ValueError("rating must be 1-4")
        with LOCK:
            s = self.load()
            if cid not in s["days"].get(day, []):
                raise KeyError("not on today's feed")
            rs = s["ratings"].setdefault(cid, [])
            rs[:] = [x for x in rs if x["day"] != day]
            rs.append({"day": day, "r": r, "at": now_iso()})
            self.save(s)
        return self.today(day)

    def status(self, day: str) -> dict:
        with LOCK:
            s = self.load()
        ids = s["days"].get(day, [])
        rated = sum(1 for i in ids if any(x["day"] == day for x in s["ratings"].get(i) or []))
        return {"day": day, "rated": rated, "goal": GOAL, "done": rated >= GOAL}

    def done_days(self) -> list[str]:
        with LOCK:
            s = self.load()
        return sorted(d for d, ids in s["days"].items()
                      if sum(1 for i in ids if any(x["day"] == d for x in s["ratings"].get(i) or [])) >= GOAL)

    def library(self) -> list[dict]:
        with LOCK:
            s = self.load()
            pool = self.pool(s)
        out = []
        for cid, it in pool.items():
            r, rday = self.last(s, cid)
            out.append({k: it.get(k) for k in ("id", "source_label", "title", "attribution", "domain", "kind")}
                       | {"text": it["text"][:240], "last_rating": r, "last_day": rday or None, "reviews": len(s["ratings"].get(cid) or [])})
        return sorted(out, key=lambda x: (x["source_label"] or "", x["domain"] or ""))
