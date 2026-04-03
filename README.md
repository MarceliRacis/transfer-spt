# SPT Transfer 🎵

Move your Spotify playlists instantly — including Liked Songs ❤️, which Spotify doesn't let you edit directly.

**Stack:** React + Vite · Express.js · Redis · Docker

---

## Quick Start (Docker) ⭐

### 1. Create a Spotify App

1. Go to https://developer.spotify.com/dashboard
2. Click **Create app**
3. Under **Redirect URIs** add: `http://localhost:3000/auth/callback`
4. Copy your **Client ID** and **Client Secret**

### 2. Set up `.env`

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

# Required for Auto-sync (see below)
REDIS_URL=redis://default:password@host:port
```

### 3. Run

**With docker-compose (recommended):**

```bash
# Local Redis (bundled)
docker compose -f docker-compose-with-local-redis.yml up -d

# Cloud Redis (Upstash, Redis Cloud, Railway, etc.)
docker compose -f docker-compose-with-cloud-redis.yml up -d
```

**Using the prebuilt image directly:**

```bash
docker run -d \
  --name spt-transfer \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  registry.racis.dev/marceliracis/transfer-spt:latest
```

**Or build from source:**

```bash
docker build -t spt-transfer .

docker run -d \
  --name spt-transfer \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  spt-transfer
```

### 4. Open

```
http://localhost:3000
```

---

## How It Works

1. **Log in** via Spotify OAuth
2. **Pick a source** — e.g. `❤️ Liked Songs` or any playlist
3. **Pick a destination** — existing playlist or create a new one on the fly
4. Click **Start Transfer** — live progress via SSE stream

- Handles pagination (works with 1000+ tracks)
- Adds tracks in chunks of 100 (Spotify API limit)
- Access token refreshed automatically

---

## Auto-sync

The **Auto-sync** tab lets you create jobs that automatically keep a destination playlist in sync with a source.

### Sync modes

| Mode | Description |
|------|-------------|
| **Schedule** | Runs at fixed intervals (cron) |
| **On change** | Polls the source for changes, syncs only when something is different |
| **Both** | Schedule + on-change combined |

### Sync behaviour

A full mirror sync runs every time:
1. Tracks removed from source → removed from destination
2. Tracks added to source → added to destination
3. Order in destination is updated to match source

### Redis

Auto-sync requires Redis for job persistence. A free-tier instance (e.g. [Redis Cloud](https://redis.io/try-free/) — 30 MB free) is more than enough.

1. Sign up and create a database (Free tier, pick a region close to you)
2. Copy the **Public endpoint** and **password**
3. Add to `.env`:

```env
REDIS_URL=redis://default:PASSWORD@HOST:PORT
```

---

## Creating a New Playlist

When setting the destination to **+ New playlist** you can configure:

| Option | Description |
|--------|-------------|
| **Public** | Visible on your profile and in search |
| **Collaborative** | Others can add tracks (forces private) |

> **Note on privacy:** Due to a [long-standing Spotify API limitation](https://community.spotify.com/t5/Spotify-for-Developers/Api-to-create-a-private-playlist-doesn-t-work/td-p/5407807), setting a playlist to private via the API only hides it from your public profile — it does **not** restrict access by direct URL. To make a playlist truly private, open it in the Spotify desktop app and set it to private there.

---

## Docker Compose Files

| File | Redis |
|------|-------|
| `docker-compose-with-local-redis.yml` | Bundled Redis container, data persisted in a Docker volume |
| `docker-compose-with-cloud-redis.yml` | No Redis container — uses `REDIS_URL` from your `.env` |

Both compose files use the prebuilt image:
```
registry.racis.dev/marceliracis/transfer-spt:latest
```

---

## Useful Docker Commands

```bash
# Pull latest image
docker pull registry.racis.dev/marceliracis/transfer-spt:latest

# Start in background
docker compose -f docker-compose-with-local-redis.yml up -d

# Stop
docker compose down

# View logs
docker compose logs -f

# Push new version after rebuild
docker build -t registry.racis.dev/marceliracis/transfer-spt:latest .
docker push registry.racis.dev/marceliracis/transfer-spt:latest

# Check container status
docker ps | grep spt-transfer

# Open a shell inside the container (debug)
docker exec -it spt-transfer sh
```

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

Dev mode with hot reload (two terminals):

```bash
# Terminal 1 — backend
cd server && npm run dev

# Terminal 2 — frontend (proxies API to :3000)
cd client && npm run dev
```

---

## Production Deployment (VPS)

1. Set `REDIRECT_URI` in `.env` to `https://spt.yourdomain.com/auth/callback`
2. Add the same URI in your Spotify Developer Dashboard
3. Put a reverse proxy (nginx / Caddy) in front of port 3000

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
├── Dockerfile                            # Multi-stage build: React → Express
├── docker-compose-with-local-redis.yml
├── docker-compose-with-cloud-redis.yml
├── .env.example
├── server/
│   ├── index.js                          # Express + Spotify OAuth + REST API
│   ├── sync.js                           # Auto-sync engine (cron + trigger polling)
│   ├── redis.js                          # Redis client
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

| Scope | Why |
|-------|-----|
| `playlist-read-private` | Read your private playlists |
| `playlist-read-collaborative` | Read collaborative playlists |
| `playlist-modify-public` | Write to public playlists |
| `playlist-modify-private` | Write to private playlists / create private |
| `user-library-read` | Read Liked Songs |
| `ugc-image-upload` | Playlist cover image (future use) |

---

## License

MIT