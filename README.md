<div align="center">

# SPT Transfer

**Move and sync your Spotify playlists instantly — including Liked Songs ❤️**

[![License](https://img.shields.io/badge/License-MIT-1DB954?style=for-the-badge)](LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/MarceliRacis/transfer-spt?style=for-the-badge&color=1DB954&logo=git&logoColor=white)](https://github.com/MarceliRacis/transfer-spt/commits/main)
[![Docker](https://img.shields.io/badge/Docker-multi--arch-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com)
[![Redis](https://img.shields.io/badge/Redis-auto--sync-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io)

[![Node.js](https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-Vite-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Spotify](https://img.shields.io/badge/Spotify-API-1DB954?style=for-the-badge&logo=spotify&logoColor=white)](https://developer.spotify.com)

[![GitLab](https://img.shields.io/badge/GitLab-Original%20Repo-609926?style=for-the-badge&logo=gitlab&logoColor=white)](https://git.racis.dev/marceliracis/transfer-spt)
[![GitHub Mirror](https://img.shields.io/badge/GitHub-Mirror-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/MarceliRacis/transfer-spt)

Spotify doesn't let you move **Liked Songs** to another account or playlist — SPT Transfer does.
Full mirror sync with live progress, auto-sync jobs, and a one-command Docker setup.

[**GitLab (source)**](https://git.racis.dev/marceliracis/transfer-spt) · [**GitHub (mirror)**](https://github.com/MarceliRacis/transfer-spt)

</div>

---

## Screenshots

### Home

![Home screen](https://api.racis.dev/api/upload/file/bb97a986-4cdd-4186-b99b-69aaf18a46c7.png)

### One-time Transfer

![One-time transfer](https://api.racis.dev/api/upload/file/545a5483-f5f0-4a45-8e47-2bf5e4abff0d.png)

### Auto-sync

![Auto-sync screen](https://api.racis.dev/api/upload/file/ab488ce1-9a2e-4720-9f04-54192d9cc2ec.png)

---

## Features

- **Transfer any playlist** — including the Liked Songs library Spotify locks you out of
- **Live progress** via Server-Sent Events (SSE) — watch tracks move in real time
- **Auto-sync jobs** — keep a destination playlist automatically mirrored to a source
- **Full mirror sync** — additions, removals, and track order all kept in sync
- **Handles large libraries** — pagination support, batched in chunks of 100 (Spotify API limit)
- **Automatic token refresh** — long transfers never break due to expired credentials
- **Multi-arch Docker image** — runs on both `amd64` and `arm64`

---

## Quick Start (Docker) ⭐

### 1. Create a Spotify App

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Click **Create app**
3. Under **Redirect URIs** add: `http://localhost:3000/auth/callback`
4. Copy your **Client ID** and **Client Secret**

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
REDIRECT_URI=http://localhost:3000/auth/callback
SESSION_SECRET=some-long-random-string
PORT=3000

# Required for Auto-sync and persistent sessions
REDIS_URL=redis://default:password@host:port

# IMPORTANT: Always set to production in K8s/Production environments
# to avoid redirection to localhost:5173
NODE_ENV=production
```

### 3. Run

**With Docker Compose (Production):**

```bash
# Local Redis (bundled)
docker compose -f docker_compose/production-local-redis.yaml up -d

# Cloud Redis (Upstash, Redis Cloud, Railway, etc.)
docker compose -f docker_compose/production-cloud-redis.yaml up -d
```

---

## Kubernetes Deployment (K8s) ☸️

The application is fully scalable on K8s thanks to Redis-backed sessions and job persistence.

### 1. Configure the manifest

Open `k8s/production-full-stack.yaml` and:
- Update `REDIRECT_URI` in the ConfigMap
- Update `host` in the Ingress
- Encode your secrets in Base64 and add them to the `Secret` object

### 2. Apply

```bash
kubectl apply -f k8s/production-full-stack.yaml
```

---

## How It Works

1. **Log in** via Spotify OAuth
2. **Pick a source** — `❤️ Liked Songs` or any playlist
3. **Pick a destination** — an existing playlist or create a new one on the fly
4. Click **Start Transfer** — live progress streamed via SSE

---

## Auto-sync

The **Auto-sync** tab lets you create background jobs that keep a destination playlist continuously mirrored to a source.

### Sync modes

| Mode | Description |
|------|-------------|
| **Schedule** | Runs at fixed intervals (cron) |
| **On change** | Polls the source; syncs only when something differs |
| **Both** | Schedule + on-change combined |

### What gets synced

Every sync run is a full mirror:

1. Tracks removed from source → removed from destination
2. Tracks added to source → added to destination
3. Track order in destination updated to match source

### Redis setup

Auto-sync requires Redis for job persistence. A free-tier instance is more than sufficient (e.g. [Redis Cloud](https://redis.io/try-free/) — 30 MB free).

1. Sign up and create a database (Free tier, pick a nearby region)
2. Copy the **Public endpoint** and **password**
3. Add to `.env`:

```env
REDIS_URL=redis://default:PASSWORD@HOST:PORT
```

---

## Creating a New Playlist

When setting the destination to **+ New playlist**, you can configure:

| Option | Description |
|--------|-------------|
| **Public** | Visible on your profile and in search |
| **Collaborative** | Others can add tracks (forces private) |

> **Note on privacy:** Due to a [long-standing Spotify API limitation](https://community.spotify.com/t5/Spotify-for-Developers/Api-to-create-a-private-playlist-doesn-t-work/td-p/5407807), setting a playlist to private via the API only hides it from your public profile — it does **not** restrict access by direct URL. To make a playlist truly private, open it in the Spotify desktop app and toggle it there.

---

## Docker Compose Files

Both compose files use the prebuilt image from `registry.racis.dev/marceliracis/transfer-spt:latest`.

| File | Redis |
|------|-------|
| `production-local-redis.yaml` | Bundled Redis container, data persisted in a Docker volume |
| `production-cloud-redis.yaml` | No local Redis — uses `REDIS_URL` from `.env` |

---

## Running Locally Without Docker

```bash
# Install dependencies
cd server && npm install
cd ../client && npm install

# Copy env
cp .env.example server/.env

# Build frontend
cd client && npm run build

# Start server
cd ../server && node index.js
```

**Dev mode with hot reload** (two terminals):

```bash
# Terminal 1 — backend
cd server && npm run dev

# Terminal 2 — frontend (proxies API to :3000)
cd client && npm run dev
```

---

## Production Deployment (VPS)

1. Set `REDIRECT_URI` in `.env` to `https://spt.yourdomain.com/auth/callback`
2. Add the same URI in your [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
3. Place a reverse proxy (nginx or Caddy) in front of port 3000

**nginx config:**

```nginx
server {
    server_name spt.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # Required for SSE (live transfer progress)
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```

---

## Project Structure

```
spt-transfer/
├── Dockerfile                        # Multi-stage build: React → Express
├── docker_compose/
│   ├── production-local-redis.yaml
│   └── production-cloud-redis.yaml
├── k8s/
│   └── production-full-stack.yaml
├── .env.example
├── server/
│   ├── index.js                      # Express + Spotify OAuth + REST API
│   ├── sync.js                       # Auto-sync engine (cron + polling)
│   ├── redis.js                      # Redis client
│   └── package.json
└── client/
    ├── index.html
    ├── vite.config.js
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        └── pages/
            ├── LoginPage.jsx
            ├── LoginPage.module.css
            ├── AppPage.jsx
            └── AppPage.module.css
```

---

## Required Spotify Scopes

| Scope | Purpose |
|-------|---------|
| `playlist-read-private` | Read private playlists |
| `playlist-read-collaborative` | Read collaborative playlists |
| `playlist-modify-public` | Write to public playlists |
| `playlist-modify-private` | Write to private playlists / create private |
| `user-library-read` | Read Liked Songs |
| `ugc-image-upload` | Playlist cover image (future use) |

---

## License

[MIT](LICENSE) © [Marceli Racis](https://racis.dev)