# Commerce-track

Niche product evaluator for ecommerce sellers. Reads the latest PLAN.md for design.

## Run

```
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
node --test --experimental-strip-types tests/  # unit tests
```

## API

- `POST /api/interpret` — Call 1 LLM: free-text goal → structured constraints (server-validated).
- `POST /api/evaluate` — Real CJ Dropshipping + SerpApi data through a deterministic engine. Returns ranked, needs-more-evidence, and rejected products. Signs a short-lived approval token per ranked product.
- `POST /api/listing` — Call 2 LLM: re-fetches CJ data, verifies the signed token, rejects browser tampering, generates a listing from verified facts only.

## Required env vars (in `.env.local`)

CJ_API_KEY · SERPAPI_KEY · OPENAI_API_KEY · OPENAI_MODEL · APP_SIGNING_SECRET

Use `./scripts/setup-credentials.sh` or `.env.example` as a template.
