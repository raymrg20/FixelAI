# Fixel — AI household-repair diagnosis + Guided Fix Mode

> **Snap it. Fix it. Skip the 40-minute YouTube tutorial.**

Fixel diagnoses everyday household repair problems from a **photo and/or a text
description**, then either walks the user through the fix **one step at a time**
(Guided Fix Mode) or — when the job is genuinely dangerous — gives an honest
"call a pro" verdict with a **ready-to-send tradesperson script** and referral links.

`Fixel` is a working name — change `CONFIG.BRAND` at the top of the `<script>`
in `index.html` (plus the `<title>`/meta tags) and it updates everywhere.

**No build step. No React. No database. Nothing to install on your computer.**

---

## 📁 Project structure

```
.
├── index.html          # The entire frontend — all CSS and JS inline, self-contained
├── api/
│   └── diagnose.js     # The one serverless function (OpenAI + safety rules + rate limit)
├── .env.example        # Names of the environment variables (values go in Vercel, not here)
└── README.md
```

That's the whole project. `index.html` deliberately has **zero external css/js
files**, so nothing can 404 and break the page.

---

## 🚀 Deploy — no local setup needed

You do **not** need Node, npm, or the Vercel CLI. Everything runs in the cloud.

**1. Put the project on GitHub**
   - Create a new repository at [github.com/new](https://github.com/new)
     (private is fine).
   - Upload the files keeping the structure above — the easiest way with no
     tools installed: on the empty repo page click **"uploading an existing
     file"**, drag in `index.html`, `.env.example` and `README.md`, and commit.
   - `diagnose.js` must live **inside a folder called `api`**. GitHub's web
     uploader can't create folders directly, so: **Add file → Create new file**,
     type `api/diagnose.js` as the filename (the `/` creates the folder), paste
     the file's contents, and commit.

**2. Import it into Vercel**
   - Sign in at [vercel.com](https://vercel.com) (you can sign in *with* GitHub —
     easiest).
   - **Add New… → Project → Import** your repo.
   - Framework preset: **Other**. Leave build settings empty — it's a static
     site plus an `/api` function; Vercel detects both automatically.

**3. Add your API key (before hitting Deploy)**
   - On the import screen expand **Environment Variables** and add:
     - **Key:** `OPENAI_API_KEY` — **Value:** your OpenAI key (`sk-…`)
     - *(optional)* **Key:** `OPENAI_MODEL` — **Value:** a vision-capable model
       to pin, if you don't want the default.
   - The key lives **only** on Vercel's servers. It is never referenced in any
     client file — do not paste it into `index.html` or commit it to GitHub.

**4. Deploy**
   - Click **Deploy**. In under a minute you get a live
     `https://your-project.vercel.app` URL where the page is served statically
     and `api/diagnose.js` runs as a serverless function.

**Updating later:** edit a file on GitHub (the ✏️ pencil icon works fine) and
commit — Vercel redeploys automatically on every push. No terminal involved.

> Forgot the key, or need to change it? **Project → Settings → Environment
> Variables** on Vercel, then **Deployments → ⋯ → Redeploy** so it's picked up.

---

## ✅ Check it worked

- Open your `…vercel.app` URL — the landing page, 3D hero, and pricing toggle
  should all work immediately (they're pure frontend).
- In the **Repair Assistant**, try a chip like *"Dripping tap"* — you should
  get a diagnosis card with an **EASY DIY** or **DIY WITH CAUTION** verdict and
  a working **Guided Fix Mode**.
- Try *"Sparking light switch"* — you should get **CALL A PRO** with no DIY
  steps, a copyable tradesperson script, and the Find-a-Pro links. If you do,
  the safety rails are live.
- If diagnosis fails with a "couldn't reach the diagnosis engine" notice, the
  usual causes are: `diagnose.js` not inside the `api/` folder, or the
  `OPENAI_API_KEY` variable missing/added after the last deploy.

---

## ⚙️ Configuration (one place, no tooling)

Open `index.html` and find the `CONFIG` object at the top of the `<script>`:

- **`BRAND` / `TAGLINE`** — rename the product; every `data-brand` span updates.
- **`PRO_LINKS`** — the "Find a local pro" buttons, grouped by trade
  (electrician / plumber / hvac / general). Swap in real referral or affiliate
  URLs (Thumbtack, Angi, hipages, local directories) when partnerships land.
- **`FREE_CHECKS`** — client-side soft cap per session (default 3).

The **real** cost control is the per-IP rate limiter inside `api/diagnose.js`
(`LIMIT` / `WINDOW`). It's a simple in-memory guard for the MVP — for
production traffic, swap it for a durable store (e.g. Upstash Redis).

---

## 🧠 How the API works

`POST /api/diagnose`

```jsonc
// request — the whole conversation, so follow-up questions work
{
  "history": [
    { "role": "user", "text": "my kitchen tap drips when closed",
      "image": { "media": "image/jpeg", "b64": "…" } }   // image is optional
  ]
}

// response (200)
{ "card": {
  "verdict": "easy_diy | diy_caution | call_pro | unclear",
  "category": "electrician | plumber | hvac | general",
  "title": "…", "diagnosis": "…",
  "time_estimate": "~15 min", "cost_saved": "$120-180",
  "tools": [ { "name": "…", "optional": false } ],
  "steps": [ { "instruction": "…", "tools": ["…"], "safety": "…" } ],
  "pro_explanation": "…", "pro_brief": "…",
  "landlord_note": "…", "reply": "…"
} }
```

### Safety — enforced, not hoped-for
- The hard rules live in the **server-side system prompt**: electrical beyond a
  switch plate, gas, structural, injury risk → always `call_pro`, never steps,
  no matter how the request is phrased.
- A **server-side backstop** re-checks every response and strips any steps the
  model might have added to a `call_pro`/`unclear` verdict.
- Ambiguous photos/descriptions return a friendly **"need more info"** state —
  never a guessed diagnosis.
- The interface appends a one-line disclaimer to every card.

---

## 🖥️ Optional: run it locally (only if you want to)

Not required for anything above. If you later want a local dev loop:

1. Install **Node.js LTS** — `winget install OpenJS.NodeJS.LTS` in PowerShell,
   or the installer from [nodejs.org](https://nodejs.org). Then **open a new
   PowerShell window** and confirm with `node -v`.
2. `npm i -g vercel` (if PowerShell blocks it with a "running scripts is
   disabled" error: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`,
   answer `Y`, retry — or call `vercel.cmd`).
3. In the project folder: copy `.env.example` to `.env`, paste your real key,
   then run `vercel dev`. It serves the site *and* the `/api` function locally.

---

## 🧾 Notes

- **No secrets client-side** — `OPENAI_API_KEY` is read only in `api/diagnose.js`.
- **Pricing buttons are placeholders** — no payment integration in the MVP.
- **Metrics & testimonials are illustrative placeholders**, structured so real
  data drops straight in.
- **`APIFY_TOKEN`** appears in `.env.example` but is intentionally unused —
  reserved for future parts-price and tutorial-scraping features.

---

*Guidance only — Fixel is not a substitute for a professional inspection.
Renters: some repairs are legally your landlord's responsibility.*