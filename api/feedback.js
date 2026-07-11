// api/feedback.js — anonymous product feedback counters (thumbs + fix results).
// Uses the same KV store as share links; returns 501 (silently ignored by the
// frontend) until the store is connected.
// GET (no params) returns the aggregate counters — check your numbers with:
//   curl https://fixel-ai.vercel.app/api/feedback

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
async function kv(command) {
  const r = await fetch(KV_URL, { method:"POST", headers:{ Authorization:`Bearer ${KV_TOKEN}`, "Content-Type":"application/json" }, body: JSON.stringify(command) });
  if (!r.ok) throw new Error("kv " + r.status);
  return (await r.json()).result;
}
const VALID = /^[a-z_]{1,20}$/;

export default async function handler(req, res) {
  if (!KV_URL || !KV_TOKEN) { res.status(501).json({ error: "kv_not_configured" }); return; }

  if (req.method === "GET") {
    try {
      const keys = await kv(["KEYS", "fb:*"]);
      const out = {};
      for (const k of keys || []) out[k] = Number(await kv(["GET", k]));
      res.status(200).json(out);
    } catch { res.status(502).json({ error: "kv error" }); }
    return;
  }

  if (req.method === "POST") {
    const { type, vote, worked, verdict, category, region } = req.body || {};
    try {
      if (type === "card" && (vote === "up" || vote === "down") && VALID.test(verdict || "")) {
        await kv(["INCR", `fb:card:${vote}:${verdict}`]);
        if (VALID.test(category || "")) await kv(["INCR", `fb:cat:${vote}:${category}`]);
      } else if (type === "fix_result" && typeof worked === "boolean") {
        await kv(["INCR", `fb:fix:${worked ? "worked" : "failed"}`]);
      } else { res.status(400).json({ error: "bad payload" }); return; }
      if (/^[A-Z]{2,4}$/.test(region || "")) await kv(["INCR", `fb:region:${region}`]);
      res.status(200).json({ ok: true });
    } catch { res.status(502).json({ error: "kv error" }); }
    return;
  }
  res.status(405).json({ error: "GET or POST only" });
}