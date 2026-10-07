# Twitch Stream Death Alarm (EventSub WebSocket & GitHub Pages)

A lightweight, real-time Twitch stream monitor built to run 100% in your browser window with zero backend server required. Perfect for hosting directly on GitHub Pages.

Unlike standard periodic API polling, this application uses Twitch EventSub WebSockets (`wss://eventsub.wss.twitch.tv/ws`) to establish a direct, real-time push connection with Twitch. When your stream goes offline, Twitch immediately pushes a `stream.offline` notification over the WebSocket connection, triggering a loud alarm with zero latency.

---

## Key Features

- **EventSub WebSocket Real-Time Engine**: Connects directly to `wss://eventsub.wss.twitch.tv/ws` to receive instant `stream.offline` and `stream.online` event pushes.
- **100% Client-Side Context (`window`)**: Runs completely inside your browser. No middleman servers or backend databases required.
- **Twitch OAuth 2.0 Implicit Grant**: Connect your Twitch account with one click to get the required OAuth token.
- **Web Audio API Alarm Synthesizer**: Built-in sound generator with customizable sound patterns (Emergency Siren, Red Alert Klaxon, High-Pitch Beeps, Strobe Frequency).
- **Multiple Detection Engines**:
  - **Twitch EventSub WebSocket** (Real-Time Push)
  - **REST API Polling** (Periodic Backup)
  - **Hybrid Mode** (EventSub + REST Backup)
- **Master Arm/Disarm Toggle**: Turn ON when going live to subscribe to real-time events.
- **Instant Silence Button**: Big, bold red button to stop the alarm noise immediately when triggered.

---

## How to Host on GitHub Pages

1. **Push this repository to GitHub**:
   ```bash
   git add .
   git commit -m "Configure EventSub WebSocket and environment secret deployment"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git push -u origin main
   ```
2. **Enable GitHub Pages**:
   - Go to your GitHub Repository -> **Settings** -> **Pages**.
   - Select `Deploy from a branch`, choose `main` branch and `/ (root)` folder, then click **Save**.
   - Your site will be live at `https://<YOUR_USERNAME>.github.io/<YOUR_REPO_NAME>/`!

---

## Twitch Client ID & OAuth Setup

1. Log into the [Twitch Developer Console](https://dev.twitch.tv/console/apps).
2. Click **+ Register Your Application**.
3. Set your **OAuth Redirect URL** to your GitHub Pages address (e.g. `https://<YOUR_USERNAME>.github.io/<YOUR_REPO_NAME>/` or `http://localhost/` for local testing).
4. Save your **Client ID** into your local `.env` file (`TWITCH_CLIENT_ID=...`) or add it to **GitHub Repository Secrets**.
5. Click **Connect Twitch** to authorize and begin monitoring via real-time EventSub WebSockets!
