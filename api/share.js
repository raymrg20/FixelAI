// api/share.js — short shareable diagnosis links.
// POST { card }            → { id }        (stores the card for 90 days)
// GET  ?id=abc12345        → { card }
//
// Storage: any Upstash-style Redis REST endpoint. On Vercel:
//   Dashboard → Storage (Marketplace) → Upstash for Redis → connect to this project.
// That auto-adds the env vars this function looks for. Until then, the function
// returns 501 and the frontend falls back to long #d= encoded links — so sharing
// works either way; the KV store just makes the links short and pretty.

const REST_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL || "";
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN || "";

const TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days
const MAX_CARD_BYTES = 32_000;

// light per-IP rate limit (in-memory; MVP-grade)
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), rec = hits.get(ip);
  if (!rec || now > rec.reset) { hits.set(ip, { n: 1, reset: now + 60 * 60 * 1000 }); return false; }
  return ++rec.n > 30;
}

async function redis(command) {
  const r = await fetch(REST_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error("kv " + r.status);
  const d = await r.json();
  return d.result;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const newId = () => Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

export default async function handler(req, res) {
  if (!REST_URL || !REST_TOKEN) {
    res.status(501).json({ error: "kv_not_configured" });
    return;
  }

  if (req.method === "GET") {
    const id = String(req.query?.id || "");
    if (!/^[A-Za-z0-9]{8}$/.test(id)) { res.status(400).json({ error: "bad id" }); return; }
    try {
      const raw = await redis(["GET", `share:${id}`]);
      if (!raw) { res.status(404).json({ error: "not found" }); return; }
      res.status(200).json({ card: JSON.parse(raw) });
    } catch {
      res.status(502).json({ error: "kv error" });
    }
    return;
  }

  if (req.method === "POST") {
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    if (rateLimited(ip)) { res.status(429).json({ error: "rate limited" }); return; }

    const card = req.body?.card;
    if (!card || typeof card !== "object") { res.status(400).json({ error: "missing card" }); return; }
    // never store images or oversized payloads — cards are text-only
    delete card.image;
    const json = JSON.stringify(card);
    if (json.length > MAX_CARD_BYTES) { res.status(413).json({ error: "card too large" }); return; }

    try {
      const id = newId();
      await redis(["SET", `share:${id}`, json, "EX", String(TTL_SECONDS)]);
      res.status(200).json({ id });
    } catch {
      res.status(502).json({ error: "kv error" });
    }
    return;
  }

  res.status(405).json({ error: "GET or POST only" });
}