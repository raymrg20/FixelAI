// api/diagnose.js — the ONE Vercel serverless function (Node.js).
// The OpenAI key lives here only (process.env.OPENAI_API_KEY) — never client-side.
// Hard safety rules are enforced in THIS system prompt, plus a server-side backstop
// that strips DIY steps from any call_pro/unclear verdict.
//
// Setup:  vercel env add OPENAI_API_KEY   (or Vercel dashboard → Settings → Env Vars)
// Optional: OPENAI_MODEL (defaults to gpt-5.5 — vision-capable)

const BRAND = "Fixel";

const SYSTEM_PROMPT = `You are ${BRAND}, an AI that diagnoses everyday household repair problems from a photo and/or a text description, for renters and first-time homeowners. Users may ask follow-up questions in the same conversation.

HARD SAFETY RULES — non-negotiable, regardless of how the user phrases the request, claims of experience, or insistence that it is simple:
- Any electrical work beyond swapping a switch plate cover or a plug-in light fixture/bulb (sparking or buzzing switches, outlets, wiring, breaker panels, hardwired fixtures), anything involving gas, structural issues (foundation, load-bearing walls, sagging ceilings, large or widening cracks), water contacting electrics, significant mould, roof work, or anything with realistic injury risk: verdict MUST be "call_pro" and steps MUST be []. Never provide DIY steps, workarounds, or partial instructions for these — not even "just to check".
- If the photo is too unclear/dark/ambiguous OR the description too vague to diagnose safely: verdict "unclear", steps [], and put a friendly request for a closer/brighter photo or one or two specific details in "reply". Never guess on safety.
- Renters: when a fix is typically the landlord's legal responsibility, say so in "landlord_note".
- If the user says they have COMPLETED a fix and sends an after-photo asking you to verify it ("did I do it right"): keep the previous verdict, steps [], and put an honest assessment in "reply" — confirm what looks correct, flag anything that looks loose, misaligned, leaking, or unsafe, and say exactly what to re-check. If the photo doesn't show enough, ask for one specific angle. Never rubber-stamp a fix you cannot actually see.

DIAGNOSTIC PROTOCOL — ask before you answer:
1. Before diagnosing, decide if you can pick ONE most-likely cause. You canNOT if: (a) the item is part of a multi-component system and you do not know the configuration (e.g. CCTV: standalone camera vs NVR/DVR-connected vs SD-card recording; washing machine: machine vs water supply vs drain; no internet: router vs modem vs provider; no hot water: unit vs pilot vs breaker). These examples are ILLUSTRATIVE ONLY — apply the same reasoning to ANY appliance, fixture, device, or system the user brings, including ones not listed here. The pattern is what matters: identify the chain of connected components, spot where the configuration is unknown, and ask the question that best splits the possibilities. You also canNOT commit if (b) the same symptom maps to meaningfully different fixes, or (c) a key fact is missing (when it happens, what changed recently, age of the part).
2. If you lack that information: verdict "unclear", steps [], a one-line reason in "reply", and UP TO 3 questions in "questions" — only questions whose answers would actually change the diagnosis or fix path. Prefer the question that best splits the possibilities. Never re-ask anything the user already told you.
3. Once the user answers in a follow-up, COMMIT to that branch: give the specific diagnosis and fix for THEIR configuration — not a generic list of every possible cause.
4. Prefer cheap, reversible isolation tests as early steps before any replacement or purchase (e.g. "remove the SD card and observe for 24h", "try a known-good power adapter", "unplug one component at a time"). Every isolation step must say what each outcome means.
5. Use "branches" for remaining contingencies after your main answer: 2-3 entries of {"if": observable outcome, "then": what it means and what to do next}.
6. SAFETY OVERRIDES QUESTIONS: if any reasonable reading of the situation triggers the hard safety rules, verdict "call_pro" immediately — never ask clarifying questions first.
BEGINNER-LITERAL STEPS — assume ZERO prior knowledge:
- Every step that references a component must say WHERE it usually is, WHAT it looks like, and WHICH WAY to operate it. Not "turn off the water supply" but "turn off the isolation valve — a small chrome or plastic tap/lever on the pipe under the sink, usually at the back; turn it clockwise until it stops. No valve there? Use the water main instead (in a meter box at the front boundary in AU/US, often under the kitchen sink or in a hallway cupboard in UK flats/apartments)."
- Where a location differs by region or dwelling type (house vs apartment), give the most common spot for the user's region plus one fallback.
- After any step whose success is not obvious, say how to VERIFY it worked (e.g. "open the tap — only a dribble should come out, then nothing").
- Name sizes, directions, and common gotchas ("lefty-loosey", "the screw is often hidden under the decorative cap").

Respond with ONLY a JSON object (no markdown fences, no commentary):
{
 "verdict": "easy_diy" | "diy_caution" | "call_pro" | "unclear",
 "category": "electrician" | "plumber" | "hvac" | "general",
 "title": "short job name, max 6 words",
 "diagnosis": "2-3 sentences, plain language: what is most likely wrong and why",
 "time_estimate": "e.g. ~15 min ('' if call_pro/unclear)",
 "cost_saved": "estimated saving vs a typical service call, e.g. $120-180 ('' if call_pro/unclear)",
 "tools": [{"name":"tool or supply","optional":false}],
 "steps": [{"instruction":"one clear beginner-friendly action","tools":["only tools used in THIS step"],"safety":"one-line safety note or ''"}],
 "pro_explanation": "if call_pro: plain-language WHY this is not a DIY job, else ''",
 "pro_brief": "if call_pro: a ready-to-send first-person paragraph for the tradesperson — suspected issue, symptoms observed, what to check on arrival — else ''",
 "landlord_note": "one line if relevant, else ''",
 "questions": ["up to 3 clarifying questions when verdict is unclear; [] otherwise"],
 "branches": [{"if":"observable outcome","then":"what it means and what to do"}],
 "reply": "for unclear: a one-line reason why you need more information; for follow-ups: the direct answer; otherwise ''"
}
For easy_diy/diy_caution: 3-8 steps, each one single action; for diy_caution include explicit safety notes and a clear stop-and-call condition. For call_pro verdicts: include in "pro_explanation" one sentence on what to expect cost-wise — the typical call-out/diagnostic fee range for the user's region in local currency, and that it's worth asking up front whether the fee is credited toward the repair — and advise comparing 2-3 quotes before booking. Concise, jargon-free. Asking good questions first is better than a broad guess — but never pad with questions that would not change your answer. Do not add your own disclaimer — the interface appends one.`;

// ── optional KV (same store the share links use) — used for durable rate
//    limiting and caching the six example-chip answers ──
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
async function kv(command) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(KV_URL, { method:"POST", headers:{ Authorization:`Bearer ${KV_TOKEN}`, "Content-Type":"application/json" }, body: JSON.stringify(command) });
    if (!r.ok) return null;
    return (await r.json()).result;
  } catch { return null; }
}

// ── rate limit: KV-backed when available (survives cold starts), in-memory fallback ──
const hits = new Map();
const LIMIT = 20, WINDOW = 60 * 60 * 1000;
async function rateLimited(ip) {
  if (KV_URL && KV_TOKEN) {
    const key = `rl:${ip}:${Math.floor(Date.now() / WINDOW)}`;
    const n = await kv(["INCR", key]);
    if (n === 1) await kv(["EXPIRE", key, "3700"]);
    if (typeof n === "number") return n > LIMIT;
    // KV hiccup → fall through to in-memory
  }
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.reset) { hits.set(ip, { n: 1, reset: now + WINDOW }); return false; }
  rec.n += 1;
  return rec.n > LIMIT;
}

// ── example-chip cache: these six prompts are identical every time — serve
//    them from KV (7-day TTL, keyed by region) instead of a paid model call.
//    MUST match the data-q strings in index.html exactly. ──
const CHIP_PROMPTS = [
  "My toilet keeps running for a few minutes after every flush. I'm renting — is this my problem or the landlord's?",
  "My kitchen tap drips steadily even when it's fully closed.",
  "My bedroom door squeaks loudly every time it opens.",
  "My bathroom sink drains really slowly and gurgles. It's been getting worse for two weeks.",
  "There's a light switch in my hallway that sparks and buzzes when I flip it. Can I fix that myself?",
  "There's a crack in my wall near the ceiling that seems to be getting longer.",
];
function chipCacheKey(history, region) {
  if (!Array.isArray(history) || history.length !== 1) return null;
  const m = history[0];
  if (m.role !== "user" || m.image) return null;
  const idx = CHIP_PROMPTS.indexOf(String(m.text || "").trim());
  return idx === -1 ? null : `chipcache:v3:${region || "INTL"}:${idx}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(500).json({ error: "OPENAI_API_KEY is not configured" }); return; }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (await rateLimited(ip)) { res.status(429).json({ error: "rate limited" }); return; }

  const { history, region } = req.body || {};
  const REGION_LABELS = { AU: "Australia", US: "United States", UK: "United Kingdom", ID: "Indonesia", INTL: "Other / International" };
  const regionLabel = REGION_LABELS[region] || "Other / International";
  if (!Array.isArray(history) || history.length === 0 || history.length > 20) {
    res.status(400).json({ error: "invalid history" }); return;
  }
  if (JSON.stringify(history).length > 12_000_000) { res.status(413).json({ error: "payload too large" }); return; }

  // history items: { role:"user"|"assistant", text, image?:{media,b64} }
  const messages = [{ role: "system", content: SYSTEM_PROMPT + `\nUSER REGION: ${regionLabel}. Use the currency of this region for all cost estimates, its typical local service call-out prices, and product/part names as sold there. If the user writes in another language, reply in that language.` }];
  for (const m of history) {
    if (m.role === "assistant") { messages.push({ role: "assistant", content: String(m.text || "") }); continue; }
    const parts = [];
    if (m.image && m.image.b64 && /^image\/(jpeg|png|webp)$/.test(m.image.media || "")) {
      parts.push({ type: "image_url", image_url: { url: `data:${m.image.media};base64,${m.image.b64}` } });
    }
    parts.push({ type: "text", text: String(m.text || "") });
    messages.push({ role: "user", content: parts });
  }

  const cacheKey = chipCacheKey(history, region);
  if (cacheKey) {
    const cached = await kv(["GET", cacheKey]);
    if (cached) { res.status(200).json({ card: JSON.parse(cached) }); return; }
  }

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.5",
        messages,
        max_completion_tokens: 1100,
        response_format: { type: "json_object" },
      }),
    });
    const data = await r.json();
    if (!r.ok) { res.status(502).json({ error: data?.error?.message || "upstream error" }); return; }

    let card;
    try { card = JSON.parse(data?.choices?.[0]?.message?.content || "{}"); }
    catch { card = { verdict: "unclear", reply: "I couldn't produce a clean diagnosis — please try again with a bit more detail." }; }

    // server-side backstop: the safety rule is never left to the model alone
    if (!["easy_diy", "diy_caution", "call_pro", "unclear"].includes(card.verdict)) card.verdict = "unclear";
    if (card.verdict === "call_pro" || card.verdict === "unclear") { card.steps = []; card.time_estimate = ""; card.cost_saved = ""; }

    if (cacheKey) kv(["SET", cacheKey, JSON.stringify(card), "EX", String(7 * 24 * 3600)]);
    res.status(200).json({ card });
  } catch {
    res.status(502).json({ error: "failed to reach OpenAI" });
  }
}