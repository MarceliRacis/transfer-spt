# SPT Transfer 🎵

**SPT Transfer** is a technical solution to a long-standing Spotify API limitation: the inability to easily move or share your "Liked Songs" library. This tool allows for instant migration and automated synchronization between playlists.

![SPT Transfer](https://api.racis.dev/api/upload/file/bb97a986-4cdd-4186-b99b-69aaf18a46c7.png)

---

### 🚀 Key Features

- **Liked Songs Migration** — the only way to bypass Spotify's UI restrictions and move your Liked library to a shareable playlist
- **Auto-sync Engine** — keep playlists in sync automatically using cron jobs or change-detection polling, powered by Redis
- **Live Progress** — watch the transfer in real-time via Server-Sent Events (SSE)
- **Massive Library Support** — handles 1000+ tracks with automatic pagination and API chunking (100 tracks/request)
- **Full Mirror Sync** — additions, removals, and track order all kept in sync

---

### 🛠 Tech Stack

- **Frontend:** React + Vite
- **Backend:** Node.js (Express.js)
- **Persistence:** Redis
- **Infrastructure:** Docker & Docker Compose (multi-arch: `amd64` + `arm64`)
- **Auth:** Spotify OAuth 2.0 with automatic token refresh

---

### 📸 Screenshots

**Transfer panel** — pick source and destination, watch progress live

![Transfer](https://api.racis.dev/api/upload/file/545a5483-f5f0-4a45-8e47-2bf5e4abff0d.png)

**Auto-sync** — background jobs that keep playlists mirrored automatically

![Auto-sync](https://api.racis.dev/api/upload/file/ab488ce1-9a2e-4720-9f04-54192d9cc2ec.png)

**Sync logs** — full history of every sync run with track counts

![Logs](https://api.racis.dev/api/upload/file/3ba0abc7-3cfa-4dda-9e1b-e4144e4c8417.png)

---

### ⚠️ Demo Access

Due to **Spotify's Developer Policy**, applications in "Development Mode" are restricted to a manual whitelist of users. Moving to "Production Status" requires 250,000 users — not feasible for a hobbyist project.

**To test the application, run a local instance via Docker using the instructions in the repository.**

---

### 🔗 Links

- [GitLab (source)](https://git.racis.dev/marceliracis/transfer-spt)
- [GitHub (mirror)](https://github.com/MarceliRacis/transfer-spt)

---

*License: MIT*