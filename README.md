<p align="center"><img src="assets/ledgerly.png" alt="Ledgerly logo" width="96"></p>

# Ledgerly

A private budget and accounting app in English and Arabic (right-to-left). It is deliberately simple: **one balance,
only income and expenses**. Type what you earned or spent, plan with ready-made budgets worked out from your own
numbers, and see daily, weekly, monthly and yearly statistics. There are no account types, no transfers and no
account to pick; it works the same on a phone, a tablet and a computer.

## Use it online (Cloudflare Workers)

The repository deploys itself to Cloudflare Workers: every push to `main` runs `npx wrangler deploy` (see `wrangler.jsonc`).
The app is served as static files, and `/api/*` runs `server/worker.mjs`, which keeps every account in a Durable Object's
SQLite database. No database to create and no extra setup; it fits the free plan.

* **Sign in** with a username and password on any phone, tablet or computer. *Create an account* makes the account online
  straight away, so the same login works everywhere. Data is encrypted on the device before it is sent.
* **Open on another device:** the QR button (top bar, lock screen, *Settings → Use it on every device*) shows a QR code
  for the site. Scan it with a phone camera.
* **Install it like an app:** Android and desktop Chrome/Edge offer *Install app*; on iPhone use *Share → Add to Home Screen*.
  The installed app opens without a connection (profiles already on the device still unlock offline).

Worker settings (*Workers & Pages → budgetnoor → Settings → Variables and secrets*), all optional:

| Name | Meaning |
| --- | --- |
| `LEDGERLY_SECRET` (secret) | Long random text that keys the stored login hashes. Set it before the first account and never change it. |
| `LEDGERLY_SIGNUP` | `open` (default), `invite` or `closed`. Set `closed` once your own accounts exist so strangers cannot sign up. |
| `LEDGERLY_INVITE` | The code new accounts must type when `LEDGERLY_SIGNUP` is `invite`. |
| `LEDGERLY_MAX_USERS` | Account limit (default 50). |

Try the Cloudflare version locally with `npx wrangler dev`, or without Wrangler: `node tools/cloud-local.mjs`.

## Run it

**Windows, first time:** double-click **`run-setup.bat`**. It checks the files, puts a Ledgerly icon on your
Desktop and in the Start menu, runs a quick self-check, and opens the app in its own window.
After that, open Ledgerly from the icon (right-click it and choose *Pin to taskbar* for one-click access).

* `Ledgerly.bat` opens the app straight away, with no setup.
* `run-setup.bat -NoLaunch` sets up without opening the app.
* `run-setup.bat -Uninstall` removes the icons. Your data is not touched.

Nothing needs installing: the app is plain HTML, CSS and JavaScript. Setup uses Microsoft Edge, Chrome or
Brave for the standalone window and falls back to your default browser. It also works on any system by
opening `index.html` directly.

Developer option: `node tools/serve.js` serves it at http://localhost:5173. Browsers keep data per address,
so data saved there is separate from the app window that the icon opens. Pick one way and stay with it.

Your data is stored in the browser you use, encrypted per profile (see below), and only leaves the device if you
turn on sync. Use **Settings → Download backup** regularly; clearing browser data erases a profile's local copy.

## Profiles, passwords and using Ledgerly from anywhere

**Profiles.** Several people (or several budgets) can share one device. Each profile has its own username,
password and data. A profile's data is encrypted in the browser with AES-256-GCM, and the key is protected by the
password (PBKDF2-SHA256, 600,000 rounds). A locked profile is unreadable ciphertext, even in the browser's developer
tools. Profiles lock themselves after 15 minutes without activity (changeable) and when the window is closed.

**Stay signed in.** When you sign in (or later in *Settings → Profile and security*) you can choose *Stay signed in on this
device*. The app then opens straight to your data with no password. The saved sign-in is sealed with a key the browser
keeps but cannot reveal, so it cannot be copied out of storage. While this is on, idle auto-lock is off. *Sign out* (or
switching the option off) forgets it. Anyone who can open Ledgerly on that device can see the profile, so leave it off on
shared or public computers.

**Recovery key.** Creating a profile shows a recovery key once. If you forget the password, the key lets you set a new
one without losing anything. If you lose both, the data cannot be recovered by anyone, including the server. Keep the
key somewhere safe and download backups now and then (backups are plain files, so keep them private).

**Access from any device.** Run the server (below), then in *Settings → Sync across devices* turn sync on. On any other
device open the app, choose *Sign in from another device*, and enter the server address, username and password. Changes
sync automatically. If two devices change the same profile at the same moment, you choose what to keep (merging both is
recommended; a merge only adds, so something deleted on one side comes back).

**What the server can and cannot see.** It stores one encrypted blob per account plus a version number. Your password and
keys never leave your device. The server keeps a scrypt hash of a separate login secret derived from your password, so
it can check who you are but cannot decrypt anything.

### Run the server

```
start-server.bat                        (Windows: double-click)
node server/server.js                   (any system, Node 18 or newer)
```

It serves the app and the sync service at http://localhost:8787 and keeps its data in `data/` (git-ignored).

| Option | Meaning |
| --- | --- |
| `--port 8787` | Port to listen on |
| `--host 0.0.0.0` | Let other devices on your network connect (default is this computer only) |
| `--data ./data` | Where accounts are stored |
| `--signup open\|invite\|closed` | Who may create accounts (default `open`) |
| `--invite SECRETWORD` | The code required when `--signup invite` |
| `--cert file --key file` | Serve HTTPS directly |

### Reaching it from your phone or another PC

Browsers only turn on encryption for **HTTPS** pages (and `localhost`), so other devices need an `https://` address:

* **Quick, from your own PC:** a tunnel such as `cloudflared tunnel --url http://localhost:8787` or Tailscale Funnel gives
  you an https address. The PC must stay on and the server running.
* **Always on:** deploy the included `Dockerfile` to any host that gives you HTTPS and a persistent disk (Render, Railway,
  Fly.io, or a small VPS behind Caddy). Mount the disk at `/data`. On a public server use
  `LEDGERLY_SIGNUP=invite` and `LEDGERLY_INVITE=choose-a-secret` so strangers cannot create accounts.
* The desktop icon opens the app from a file, so there you type the server's https address once under *Sync across devices*.

Back up the `data/` folder if the server holds the only copy of someone's data. Never publish it: it contains every
account's encrypted data and the server secret.

## What it does

| Area | Highlights |
| --- | --- |
| Home | Balance, income, expenses, net saved; today / this week / this month totals; cash flow by Day / Week / Month / Year; spending donut; recent activity. Balance, budget, insights, health score, upcoming bills and averages are one tap away under *More* |
| Transactions | Income and expense ledger grouped **daily, weekly or monthly** with income / expenses / net per group, sorted newest, oldest or largest first; categories are **typed freely** (existing ones are suggested, new names become categories); a four-level importance and a free-text purpose on every income and expense; search; period and filters; payee autofill; repeat as scheduled; on a phone the list comes first and the extra filters sit behind one button |
| Print statement (PDF) | A tidy, black-on-white **statement of income and expenses** for a **day, week, month, year or any dates you choose**: your name, the period, a statement number, and every transaction with what it was for, plus the income and expense totals at the end of the list. Preview it, pick A4 or Letter, then *Print or save as PDF*. Works in English and Arabic (right-to-left). Open it from **Statistics → Print statement** or from **Import & Export** |
| Import & Export | One page for everything: transactions as Excel-friendly CSV (with week and month columns), totals per day / week / month, the printable statement, full JSON backup; import CSV from Ledgerly, Excel or a bank (English or Arabic headers, new categories and accounts created, duplicates skipped) and restore backups |
| Budget | Zero-based plan ("left to budget" must reach zero), Needs / Wants / Savings split, inline editing, carry-forward plans per month |
| Plans | Smart plan built from your habits plus 50/30/20, 60/20/20, 60/30/10, 50/20/30, 45/15/40, all converted into amounts from your income, with preview before applying |
| Statistics | Day, week, month, year or custom range; comparison with the previous period; drill-down chart; income statement; category and source breakdown; spending and income by importance; highlights |
| Scheduled | Salary, rent, subscriptions; auto-post or confirm each time; 30-day outlook |
| Settings | Language, light / dark / auto theme, 36 currencies, number format, week start, savings target, categories, backup and restore |

## Accounting rules

* Money is stored as integer minor units (cents), never floats.
* There is one account. Balance = starting balance + income − expenses (entries dated today or earlier).
* Older data is folded into this shape the first time it opens: several accounts become one (their starting balances add up,
  so the balance does not change), transfers and savings goals are taken out, and what was taken out is kept under `meta.legacy`
  in your data so nothing is lost. Old CSV files with transfer rows import their income and expenses and skip the transfers.
* Budgets are per month. A month without its own plan inherits the most recent earlier one, so history is never rewritten.
* A month in progress is compared with the same point in the previous month, not with a finished month.
* Changing the currency changes display only. Amounts are not converted.

## Project layout

```
run-setup.bat         first-time setup: icon on Desktop and Start menu, self-check, launch
Ledgerly.bat          opens the app in its own window, no setup needed
scripts/              setup.ps1, launch.ps1, common.ps1 (the logic behind the two .bat files)
assets/               ledgerly.ico and ledgerly.png (drawn by tools/make-icon.js)
index.html            page shell and icon sprite
server/server.js      the optional Node server: serves the app and stores each account's encrypted data
server/worker.mjs     the same API on Cloudflare Workers (Durable Object + SQLite); cloud-api.mjs, sql-adapter.mjs
wrangler.jsonc        Cloudflare deployment; .assetsignore keeps everything but the app private; _headers sets security headers
manifest.webmanifest, sw.js   installable web app and offline support
start-server.bat      starts the server on Windows
Dockerfile            hosting the server in a container
css/styles.css        design tokens (light/dark), layout, components, responsive rules
js/util.js            money, dates, escaping html`` template
js/i18n.js            t() translation layer and Arabic plural rules
js/lang-ar.js         Arabic dictionary (English text is the key)
js/vault.js           password-based encryption (WebCrypto): data key, password wrap, recovery key
js/auth.js            profiles, lock screen, encrypted storage, idle lock
js/sync.js            talks to the server: push, pull, conflicts, sign-in from another device
js/merge.js           merging two copies of a profile
js/store.js           state, persistence, settings
js/engine.js          read-only accounting selectors (balance, budgets, statistics, statements, plans, insights)
js/actions.js         validated mutations (return undo data), recurring posting, CSV import
js/seed.js            default categories and the sample-data year
js/charts.js, ui.js   charts and shared UI kit
js/pwa.js, qrcode.js  install prompt, QR code (qrcode-generator by Kazuhiko Arase, MIT)
js/views/*.js         one file per page, plus the transaction dialog (data.js is Import & Export, statement.js the printable statement)
js/app.js             router, global events, boot
tools/                engine-test.js, check-i18n.js, serve.js
```

## Checks

```
node tools/engine-test.js     # money, dates, accounting identities, plans, statistics, Arabic plurals
node tools/check-i18n.js      # every string the app can show has an Arabic translation
node tools/auth-test.js       # encryption, recovery, merging and the whole server API on both servers (Node and Cloudflare)
```

## Adding a language

Copy `js/lang-ar.js` to `js/lang-xx.js`, translate the values, load it in `index.html`, and add the
language to the switcher in `js/views/settings.js` and `js/store.js`. `check-i18n.js` lists anything missing.

## License

MIT. See [LICENSE](LICENSE).
