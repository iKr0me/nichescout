# Commerce-track — provider feasibility report

Generated: 2026-09-19T15:33:15.234Z
Test keyword: `phone stand`  |  destination: `US`  |  origin: `CN`

Secrets are never included in this report. All values below are field names, counts and samples of non-secret data.

Calls made — CJ: 0, SerpApi: 0, OpenAI: 2

| Provider | Check | Result | Detail |
|---|---|---|---|
| OpenAI | API key authenticates | PASS | GET /v1/models succeeded |
| OpenAI | economical candidate models visible to this key | PASS | gpt-4o-mini-2024-07-18, gpt-4o-mini, o3-mini, o3-mini-2025-01-31, o4-mini-2025-04-16, o4-mini, gpt-4.1-mini-2025-04-14, gpt-4.1-mini |
| OpenAI | structured JSON via gpt-5-mini | PASS | parsed and matched strict schema |
| OpenAI | usage object present for token accounting | PASS | keys: prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details, completion_tokens_details |
| OpenAI | OPENAI_MODEL selection | PASS | recommend "gpt-5-mini" — set it in .env.local to pin the runtime model |

**No blocking failures.**

**No warnings.**
