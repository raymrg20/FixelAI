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
 "reply": "for unclear: the specific question; for follow-ups: the direct answer; otherwise ''"
}
For easy_diy/diy_caution: 3-8 steps, each one single action; for diy_caution include explicit safety notes and a clear stop-and-call condition. Concise, jargon-free. Do not add your own disclaimer — the interface appends one.`;

// -- basic in-memory rate limit (per IP, resets hourly; instances are ephemeral
//    so this is a soft cap for MVP cost control, not real abuse protection) --
const hits = new Map();
const LIMIT = 20, WINDOW = 60 * 60 * 1000;
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.reset) { hits.set(ip, { n: 1, reset: now + WINDOW }); return false; }
  rec.n += 1;
  return rec.n > LIMIT;
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(500).json({ error: "OPENAI_API_KEY is not configured" }); return; }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) { res.status(429).json({ error: "rate limited" }); return; }

  const { history } = req.body || {};
  if (!Array.isArray(history) || history.length === 0 || history.length > 20) {
    res.status(400).json({ error: "invalid history" }); return;
  }
  if (JSON.stringify(history).length > 12_000_000) { res.status(413).json({ error: "payload too large" }); return; }

  // history items: { role:"user"|"assistant", text, image?:{media,b64} }
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const m of history) {
    if (m.role === "assistant") { messages.push({ role: "assistant", content: String(m.text || "") }); continue; }
    const parts = [];
    if (m.image && m.image.b64 && /^image\/(jpeg|png|webp)$/.test(m.image.media || "")) {
      parts.push({ type: "image_url", image_url: { url: `data:${m.image.media};base64,${m.image.b64}` } });
    }
    parts.push({ type: "text", text: String(m.text || "") });
    messages.push({ role: "user", content: parts });
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

    res.status(200).json({ card });
  } catch {
    res.status(502).json({ error: "failed to reach OpenAI" });
  }
}