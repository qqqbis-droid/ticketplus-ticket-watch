# Cloudflare Worker — Ticket Plus one-shot diagnostics

This folder is a standalone **read-only** Cloudflare Worker project. GitHub is only the source code host; any /check request executes from the Cloudflare Worker runtime, not GitHub Actions.

- No account login, CAPTCHA, ticket purchase, automatic schedule, Telegram token, proxy, or identity disguise.
- Open /check only once manually after deployment; HTTP 200 still requires checking actual event data before asserting ticket monitoring can work.
- On HTTP 403/blocked, **stop** this path and do not attempt to bypass access controls.
- This Worker is for an access feasibility test only, **not an operational ticket notifier**.

Use an existing Cloudflare Worker named `ticketplus-check`, dashboard **Settings > Builds > Connect**, connect the repository `qqqbis-droid/ticketplus-ticket-watch`. Set **Root directory** to `cloudflare-probe`, production branch `main`, build command empty/default, deploy command `npx wrangler deploy`. The `wrangler.toml` name must match the existing Worker.

Then open `https://ticketplus-check.qqqbis.workers.dev/check`. Do not turn on triggers or scheduling.
