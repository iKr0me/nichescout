# Deploying NicheScout

Two parts: put the code on GitHub, then host it somewhere public.

---

## ⚠️ Read this first — API cost exposure

NicheScout has **no login and no rate limiting**. Every visit to `/api/interpret`,
`/api/evaluate`, or `/api/listing` spends **your** API credits:

| Endpoint | Spends |
|---|---|
| `POST /api/interpret` | 1 OpenAI call |
| `POST /api/evaluate` | 3–9 CJ calls + 4–7 SerpApi searches |
| `POST /api/listing` | 2 CJ calls + 1 OpenAI call |

If the URL spreads, anyone can burn your quota — and there is nothing
stopping a script from hitting it in a loop. SerpApi's free tier is 250
searches/month; a handful of visitors exhausts it.

**Before sharing widely, do at least one of:**

1. **Set hard spend caps** in your OpenAI, SerpApi, and CJ dashboards. This is
   the most important step and takes two minutes.
2. **Add an access gate** — a shared passphrase checked by middleware. Ask and
   it can be added.
3. **Keep the link private** — treat the URL like a password.

---

## Part 1 — Put the code on GitHub

The repo is already initialised and committed locally. You need to create the
GitHub repo and push.

### Option A — GitHub CLI (recommended, handles auth for you)

```bash
# Install gh (no Homebrew needed)
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
```

Easier still — download the macOS installer from <https://cli.github.com>,
then:

```bash
gh auth login          # choose GitHub.com → HTTPS → login via browser
cd /Users/sebastian/commerce-track
gh repo create nichescout --private --source=. --push
```

Use `--public` instead of `--private` if you want the code visible. Either way
your API keys are **not** included — `.gitignore` excludes `.env.local`.

### Option B — GitHub website + git push

1. Go to <https://github.com/new>
2. Name it `nichescout`, choose Private or Public, **do not** add a README
3. Copy the two commands GitHub shows, adapted:

```bash
cd /Users/sebastian/commerce-track
git remote add origin https://github.com/YOUR_USERNAME/nichescout.git
git push -u origin main
```

You'll be prompted for credentials. If GitHub asks for a password, create a
**Personal Access Token** (Settings → Developer settings → Tokens) and paste
that instead.

---

## Part 2 — Host it (Vercel)

Vercel is the natural host for Next.js — free tier, automatic HTTPS, deploys
on every push.

### Deploy

```bash
cd /Users/sebastian/commerce-track
npx vercel login       # opens browser
npx vercel             # first deploy (preview)
npx vercel --prod      # promote to production
```

Answer the prompts:
- Set up and deploy? **yes**
- Which scope? your account
- Link to existing project? **no**
- Project name? `nichescout`
- Directory? `./` (press Enter)
- Override settings? **no**

### Add your environment variables

This is the step people forget — without it the deployed site returns errors.
In the Vercel dashboard: **Project → Settings → Environment Variables**, add
each of these for **Production, Preview, and Development**:

| Name | Value |
|---|---|
| `CJ_API_KEY` | from cjdropshipping.com developer settings |
| `SERPAPI_KEY` | from serpapi.com dashboard |
| `OPENAI_API_KEY` | from platform.openai.com |
| `OPENAI_MODEL` | `gpt-5-mini` |
| `APP_SIGNING_SECRET` | a random 64-character hex string |

Generate the signing secret with:

```bash
openssl rand -hex 32
```

Never paste these into a chat, issue, or commit. Copy them from your local
`.env.local`:

```bash
cd /Users/sebastian/commerce-track
grep -E '^(CJ_API_KEY|SERPAPI_KEY|OPENAI_API_KEY|OPENAI_MODEL|APP_SIGNING_SECRET)=' .env.local
```

After adding variables, **redeploy** so they take effect:

```bash
npx vercel --prod
```

### Your URL

Vercel prints something like `https://nichescout-yourname.vercel.app`. That's
the link to share. Every `git push` after this redeploys automatically.

---

## Alternative hosts

- **Netlify** — works, but needs the Next.js runtime plugin
- **Cloudflare Pages** — needs `@cloudflare/next-on-pages` adapter
- **Railway / Render** — run `npm run build && npm start`, set the same env vars

Vercel is by far the least friction for this stack.

---

## Troubleshooting

**Site loads but every action errors** → environment variables aren't set, or
you added them without redeploying.

**"APP_SIGNING_SECRET missing or too short"** → the secret must be ≥32 chars;
use the `openssl rand -hex 32` output.

**Actions are slow or time out** → CJ rate-limits to ~1 request/second and the
evaluation makes 3–9 sequential CJ calls. Ten seconds is normal. Vercel's
default function timeout is fine, but on the Hobby plan long evaluations can
hit limits under load.

**Everything says "needs more evidence"** → that's the gate working. It means
the market data lacked a verifiable currency code for that search phrase. Try
a different niche description.
