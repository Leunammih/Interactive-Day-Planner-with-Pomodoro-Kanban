# Interactive Day Planner with Pomodoro & Kanban

Offline-first daily planner for Mac and iPhone: plan vs. actual day blocks, Pomodoro and break timers, and a backlog kanban. Installable web app, data synced privately.

Live app: https://leunammih.github.io/Interactive-Day-Planner-with-Pomodoro-Kanban/

## How it works

- **Offline:** a service worker keeps the app on the device. After the first visit it opens with no internet and shows the last saved state.
- **Saving:** every change is saved on the device first (localStorage).
- **Sync:** when online, changes are uploaded to a *private* GitHub repo you choose (`data/<doc>.json`: one file per day, plus `backlog.json` and `settings.json`), batched every few seconds. Other devices pull every minute and when the app comes to the front. The newer edit wins, and the older fuller version is kept as a restorable backup. The repo's history is a further backup, and Claude can read and update the data there (for example, to add backlog items).
- **Your data is never in this repo.** The repo only holds the app.

## Set up sync (once per device)

1. Create a **private** repo for the data (for example `day-planner-data`).
2. On github.com: Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Repository access: **Only select repositories** → the data repo. Repository permissions: **Contents: Read and write**.
3. In the app, tap **⚙︎** at the top, enter `owner/day-planner-data` and the token, then **Save and sync**.

## Install

- **Mac (Safari):** open the live app, then File → Add to Dock.
- **iPhone (Safari):** open the live app, Share → Add to Home Screen.

## Code

- `src/planner.html`: the planner page.
- `src/shim.js`: the offline storage and sync layer (replaces the claude.ai runtime).
- `src/sw.js`, `src/manifest.webmanifest`, icons: the installable-app parts.
- `bash src/build.sh` builds the site into `docs/`, which GitHub Pages serves.
