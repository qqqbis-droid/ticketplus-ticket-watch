# Cloudflare scheduled Ticket Plus monitor (prepared, NOT enabled)

**Cloudflare Workers only** fetches Ticket Plus. GitHub only holds source/builds. GitHub Actions cannot reach the Cloudflare `workers.dev` bridge reliably (HTTP 403, see failed one-shot run), so the scheduler must run in Cloudflare.

Public API verified on 2026-10-20: Ticket Plus `config/api/v1/get?eventId=e000001534&sessionId=s000002288,s000002289,s000002290,s000002291,s000002292,s000002293` responds HTTP 200, application errCode=0, six matching sessions currently soldout. This indicates the **official sale state**, not verified zone-level remaining tickets. `onsale` should trigger a **possible reopening** alert only; no claim of live tickets.

## Before enabling automated monitoring
1. Cloudflare Dashboard > Storage & databases > KV: create a free namespace named `ticketplus-monitor-state`.
2. Worker `ticketplus-check` > Settings > Bindings: bind this namespace as exactly `TICKET_STATE` (Workers KV namespace).
3. Worker Settings > Variables and Secrets: add encrypted secrets exactly `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (already used in GitHub Actions, but values never transferred automatically; user must enter values privately in Cloudflare UI).
4. Keep `MONITOR_ENABLED` unset until the dry-run endpoint `/monitor-preview` reads all six correctly and the Telegram token has been tested. Do not put secrets in a repo, screenshots or chat.
5. Only after verification: set text environment variable `MONITOR_ENABLED=true`, and add `[triggers]\ncrons = ["*/5 * * * *"]` to `wrangler.toml`. Verify Worker deployment and Telegram delivery. Cloudflare Cron uses UTC; a 5-minute cycle is timezone-independent. Monitoring ends after 2026-12-20 Asia/Taipei.

`/monitor-preview` is **read-only**, never sends notifications, never changes stored state. The scheduled handler refuses to run if missing enable flag, KV, or Telegram secrets, and refuses to notify on invalid, inaccessible, partial or unknown official status. Six statuses are validated before any alerts.

KV stores one object keyed `ticketplus:state:v1` with statuses and whether an `onsale` alert was sent. If send fails, next run retries; `soldout`, `pending` or `unavailable` re-arms a previously alerted session. KV reads/writes are subject to free quotas and eventual consistency; transient duplicates are possible. Scheduled Workers are not truly instantaneous and may be delayed.

**Important:** the six URLs on Ticket Plus /order/ require normal member access; the automation does not open/order tickets and cannot promise remaining inventory. User must open direct link manually after a potential status change.
