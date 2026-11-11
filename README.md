# Interactive Day Planner with Pomodoro & Kanban

Offline-first daily planner for Mac and iPhone: plan vs. actual day blocks, Pomodoro and break timers, and a backlog kanban. Installable web app, data synced privately.

Live app: https://leunammih.github.io/Interactive-Day-Planner-with-Pomodoro-Kanban/

## How it works

- **Offline:** a service worker keeps the app on the device. After the first visit it opens with no internet and shows the last saved state.
- **Saving:** every change is saved on the device first (localStorage).
- **Sync:** when online, changes are uploaded to a *private* GitHub Gist in your account (one `ds-*.json` file per day, plus backlog and settings), at most every few seconds. Other devices pull it every minute and when the app comes to the front. The newer edit of a day wins, and the older fuller version is kept as a restorable backup. The Gist's revision history is a further backup.
- **Your data is never in this repo.** The repo only holds the app.

## Set up sync (once per device)

1. On github.com: Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Under **Account permissions**, set **Gists** to **Read and write**. No repository access is needed.
2. In the app, tap the status pill at the top ("Saved on this device") and paste the token. The first device creates the private Gist; the others find it automatically.

## Install

- **Mac (Safari):** open the live app, then File → Add to Dock.
- **iPhone (Safari):** open the live app, Share → Add to Home Screen.

## Code

- `src/planner.html`: the planner page.
- `src/shim.js`: the offline storage and sync layer (replaces the claude.ai runtime).
- `src/sw.js`, `src/manifest.webmanifest`, icons: the installable-app parts.
- `bash src/build.sh` builds the site into `docs/`, which GitHub Pages serves.
