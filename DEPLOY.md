# Deploying NicheScout

Put the code on GitHub, then host it on Vercel.

---

## ⚠️ Read this first — API cost exposure

NicheScout has **no login and no rate limiting**. Every visit to `/api/interpret`,
`/api/evaluate`, or `/api/listing` spends **your** API credits:

| Endpoint | Spends |
|---|---|
| `POST /api/interpret` | 1 OpenAI call |
| `POST /api/evaluate` | 3–9 CJ calls + 4–7 SerpApi searches |
| `POST /api/listing` | 2 CJ calls + 1 OpenAI call |

If the URL spreads, anyone can burn your quota — nothing stops a script hitting
it in a loop. SerpApi's free tier is 250 searches/month; a handful of visitors
exhausts it.

**Before sharing widely:**

1. **Set hard spend caps** in your OpenAI, SerpApi, and CJ dashboards — most
   important, takes two minutes.
2. **Add an access gate** — a shared passphrase via middleware. Not built yet;
   ask and it can be added.
3. **Keep the link private** — treat the URL like a password.

---

## Quick path

Both CLIs are already installed in this project. Open **one** Terminal window:

```bash
cd /Users/sebastian/commerce-track

# 1. Log in to GitHub (opens your browser)
~/.local/bin/gh auth login
#    Choose: GitHub.com → HTTPS → Login with a web browser

# 2. Log in to Vercel (opens your browser)
./node_modules/.bin/vercel login
#    Choose: Continue with GitHub
```

Then run the status script — it detects you're logged in, creates the repo,
pushes, and deploys. **It is fully non-interactive** and never waits for input:

```bash
./scripts/deploy.sh
```

Re-run it any time to see what's done and what's next.

---

## Manual path

### 1. Create the GitHub repo and push

```bash
cd /Users/sebastian/commerce-track
gh repo create nichescout --private --source=. --push
```

Use `--public` for a public repo. Your API keys are **not** included —
`.gitignore` excludes `.env.local`, and the repo's git history has been verified
to contain no secret files.

If the name is taken:

```bash
gh repo create nichescout-yourname --private --source=. --push
```

### 2. Deploy to Vercel

```bash
cd /Users/sebastian/commerce-track
npx vercel --prod
```

Accept the defaults:
- Set up and deploy? **yes**
- Link to existing project? **no**
- Project name: `nichescout`
- Directory: `./`
- Override settings? **no**

### 3. Add environment variables (required)

Without these the site loads but every action fails. In the Vercel dashboard:
**Project → Settings → Environment Variables**. Add all five, enabled for
**Production, Preview, and Development**:

| Name | Value |
|---|---|
| `CJ_API_KEY` | from cjdropshipping.com developer settings |
| `SERPAPI_KEY` | from serpapi.com dashboard |
| `OPENAI_API_KEY` | from platform.openai.com |
| `OPENAI_MODEL` | `gpt-5-mini` |
| `APP_SIGNING_SECRET` | `openssl rand -hex 32` |

Print your local values (never paste them into a chat, issue, or commit):

```bash
cd /Users/sebastian/commerce-track
grep -E '^(CJ_API_KEY|SERPAPI_KEY|OPENAI_API_KEY|OPENAI_MODEL|APP_SIGNING_SECRET)=' .env.local
```

Then redeploy so the variables take effect:

```bash
npx vercel --prod
```

### 4. Your URL

Vercel prints something like `https://nichescout-yourname.vercel.app`. Every
`git push` after this redeploys automatically.

---

## Alternative hosts

- **Netlify** — works, needs the Next.js runtime plugin
- **Cloudflare Pages** — needs the `@cloudflare/next-on-pages` adapter
- **Railway / Render** — `npm run build && npm start`, same env vars

Vercel has the least friction for this stack.

---

## Troubleshooting

**Site loads but every action errors** → environment variables aren't set, or
you added them without redeploying.

**"APP_SIGNING_SECRET missing or too short"** → must be ≥32 chars. Use
`openssl rand -hex 32`.

**Actions are slow** → CJ rate-limits to ~1 request/second and evaluation makes
3–9 sequential CJ calls. Ten to twenty seconds is normal.

**Everything says "needs more evidence"** → that's the evidence gate working.
The most common cause is a search phrase too specific for Google Shopping.
Try a more generic product phrase ("desk organizer" rather than "lightweight
desk organizers") — the app now broadens phrases automatically, but simpler
input still helps.

**Build fails on Vercel but works locally** → check `AJV` / Node version. The
project requires Node ≥20; set it in Vercel's project settings if needed.
