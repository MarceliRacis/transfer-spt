const cron = require('node-cron');
const axios = require('axios');
const { getRedis } = require('./redis');

const SPOTIFY_API = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

const activeCrons = new Map();
const activeTriggers = new Map();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function spotifyAPI(token) {
  return axios.create({
    baseURL: SPOTIFY_API,
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function refreshToken(job) {
  const creds = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');
  try {
    const { data } = await axios.post(SPOTIFY_TOKEN_URL,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: job.refresh_token }),
      { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return { access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
  } catch (err) {
    console.error(`[refreshToken:${job.id}] Spotify error:`, err.response?.data || err.message);
    throw err;
  }
}

async function getValidToken(job) {
  if (Date.now() > job.expires_at - 60000) {
    const refreshed = await refreshToken(job);
    const redis = await getRedis();
    const raw = await redis.hGet('spt:jobs', job.id);
    const existing = raw ? JSON.parse(raw) : job;
    await redis.hSet('spt:jobs', job.id, JSON.stringify({ ...existing, ...refreshed }));
    return refreshed.access_token;
  }
  return job.access_token;
}

async function fetchAllTracks(api, sourceId) {
  let tracks = [];
  let url = sourceId === 'liked'
    ? '/me/tracks?limit=50'
    : `/playlists/${sourceId}/tracks?limit=50`;
  while (url) {
    const { data } = await api.get(url);
    tracks.push(...data.items.filter(i => i.track && i.track.id));
    url = data.next ? data.next.replace(SPOTIFY_API, '') : null;
  }
  return tracks;
}

async function getDestTrackUris(api, destId) {
  let uris = new Set();
  let url = `/playlists/${destId}/tracks?limit=50&fields=next,items(track(uri))`;
  while (url) {
    const { data } = await api.get(url);
    data.items.forEach(i => i.track && uris.add(i.track.uri));
    url = data.next ? data.next.replace(SPOTIFY_API, '') : null;
  }
  return uris;
}

// Gets the current snapshot ID for a playlist (used by trigger polling)
async function getSnapshotId(api, sourceId) {
  if (sourceId === 'liked') {
    const { data } = await api.get('/me/tracks?limit=1');
    return String(data.total);
  } else {
    const { data } = await api.get(`/playlists/${sourceId}?fields=snapshot_id`);
    return data.snapshot_id;
  }
}

// ─── CORE SYNC ────────────────────────────────────────────────────────────────
// Full mirror sync:
//   1. Add tracks that are in source but not in dest
//   2. Remove tracks that are in dest but no longer in source
//   3. Reorder dest to exactly match source order

async function fetchDestTracksOrdered(api, destId) {
  let items = [];
  let url = `/playlists/${destId}/tracks?limit=50&fields=next,items(track(uri,id))`;
  while (url) {
    const { data } = await api.get(url);
    items.push(...data.items.filter(i => i.track && i.track.id).map(i => i.track.uri));
    url = data.next ? data.next.replace(SPOTIFY_API, '') : null;
  }
  return items; // ordered array of uris
}

async function runSync(job) {
  const redis = await getRedis();
  const logKey = `spt:logs:${job.id}`;

  const log = async (msg, type = 'info') => {
    const entry = JSON.stringify({ ts: Date.now(), msg, type });
    await redis.lPush(logKey, entry);
    await redis.lTrim(logKey, 0, 99);
    await redis.expire(logKey, 60 * 60 * 24 * 7);
    console.log(`[sync:${job.id}] ${msg}`);
  };

  try {
    await log('Starting sync...');
    await redis.hSet('spt:jobs', job.id, JSON.stringify({ ...job, lastRun: Date.now(), status: 'running' }));

    const token = await getValidToken(job);
    const api = spotifyAPI(token);

    // Fetch source (ordered, index 0 = newest/top)
    const sourceTracks = await fetchAllTracks(api, job.sourceId);
    const sourceUris = sourceTracks.map(t => t.track.uri);
    await log(`Source has ${sourceUris.length} tracks`);

    // Fetch dest (ordered)
    const destUris = await fetchDestTracksOrdered(api, job.destId);
    await log(`Dest has ${destUris.length} tracks`);

    const sourceSet = new Set(sourceUris);
    const destSet = new Set(destUris);

    // ── Step 1: Remove tracks in dest not in source ──────────────────────────
    const toRemove = destUris.filter(uri => !sourceSet.has(uri));
    if (toRemove.length > 0) {
      await log(`Removing ${toRemove.length} tracks no longer in source...`);
      const removePayload = toRemove.map(uri => ({ uri }));
      for (let i = 0; i < removePayload.length; i += 100) {
        await api.delete(`/playlists/${job.destId}/tracks`, {
          data: { tracks: removePayload.slice(i, i + 100) }
        });
      }
      await log(`Removed ${toRemove.length} tracks`);
    }

    // ── Step 2: Add tracks in source not in dest ─────────────────────────────
    const toAdd = sourceUris.filter(uri => !destSet.has(uri));
    if (toAdd.length > 0) {
      await log(`Adding ${toAdd.length} new tracks...`);
      // Add in reverse so newest ends at position 0
      const reversed = [...toAdd].reverse();
      for (let i = 0; i < reversed.length; i += 100) {
        await api.post(`/playlists/${job.destId}/tracks`, {
          uris: reversed.slice(i, i + 100),
          position: 0
        });
      }
      await log(`Added ${toAdd.length} tracks`);
    }

    // ── Step 3: Reorder dest to match source ─────────────────────────────────
    // After add/remove, fetch current dest order and compare with source
    const destAfter = await fetchDestTracksOrdered(api, job.destId);

    // Build target order: only uris that exist in both (source order is canonical)
    const targetOrder = sourceUris.filter(uri => {
      // after our changes, dest should have exactly sourceSet tracks
      return sourceSet.has(uri);
    });

    // Check if reorder is needed
    let needsReorder = false;
    if (destAfter.length === targetOrder.length) {
      for (let i = 0; i < targetOrder.length; i++) {
        if (destAfter[i] !== targetOrder[i]) { needsReorder = true; break; }
      }
    } else {
      needsReorder = true;
    }

    if (needsReorder && targetOrder.length > 0) {
      await log(`Reordering ${targetOrder.length} tracks to match source...`);

      // Fastest approach: replace entire playlist with PUT (up to 100) + POST chunks
      // This sets exact order in one shot
      const firstChunk = targetOrder.slice(0, 100);
      await api.put(`/playlists/${job.destId}/tracks`, { uris: firstChunk });

      for (let i = 100; i < targetOrder.length; i += 100) {
        await api.post(`/playlists/${job.destId}/tracks`, {
          uris: targetOrder.slice(i, i + 100)
        });
      }
      await log(`Reorder complete`);
    }

    const totalChanged = toAdd.length + toRemove.length + (needsReorder ? 1 : 0);

    if (totalChanged === 0) {
      await log('Nothing to sync — already up to date ✓', 'success');
    } else {
      await log(`✅ Sync complete: +${toAdd.length} added, -${toRemove.length} removed${needsReorder ? ', order fixed' : ''}`, 'success');
    }

    // Update snapshot
    const snapshotId = await getSnapshotId(api, job.sourceId).catch(() => null);
    if (snapshotId) await redis.set(`spt:snapshot:${job.id}`, snapshotId);

    const raw = await redis.hGet('spt:jobs', job.id);
    const parsed = raw ? JSON.parse(raw) : job;
    await redis.hSet('spt:jobs', job.id, JSON.stringify({
      ...parsed,
      lastRun: Date.now(),
      lastResult: totalChanged === 0 ? 'up-to-date' : 'synced',
      lastCount: toAdd.length,
      lastRemoved: toRemove.length,
      status: 'idle'
    }));

  } catch (err) {
    console.error(`[sync:${job.id}] Error:`, err.message);
    const errEntry = JSON.stringify({ ts: Date.now(), msg: `Error: ${err.message}`, type: 'error' });
    await redis.lPush(logKey, errEntry);
    await redis.lTrim(logKey, 0, 99);
    const raw = await redis.hGet('spt:jobs', job.id);
    const parsed = raw ? JSON.parse(raw) : job;
    await redis.hSet('spt:jobs', job.id, JSON.stringify({
      ...parsed, status: 'error', lastError: err.message, lastRun: Date.now()
    }));
  }
}

// ─── TRIGGER POLLING ─────────────────────────────────────────────────────────

async function startTriggerPolling(job) {
  if (activeTriggers.has(job.id)) return;

  const intervalMs = (job.triggerIntervalMinutes || 5) * 60 * 1000;

  const checkAndSync = async () => {
    try {
      const redis = await getRedis();
      const raw = await redis.hGet('spt:jobs', job.id);
      if (!raw) { stopTrigger(job.id); return; }
      const currentJob = JSON.parse(raw);
      if (!currentJob.enabled) return;

      const token = await getValidToken(currentJob);
      const api = spotifyAPI(token);
      const snapshotId = await getSnapshotId(api, currentJob.sourceId);
      const lastSnapshot = await redis.get(`spt:snapshot:${job.id}`);

      if (snapshotId !== lastSnapshot) {
        console.log(`[trigger:${job.id}] Change detected (${lastSnapshot} → ${snapshotId}), running sync`);
        // Update snapshot BEFORE sync so concurrent polls don't double-trigger
        await redis.set(`spt:snapshot:${job.id}`, snapshotId);
        await runSync(currentJob);
      }
    } catch (err) {
      console.error(`[trigger:${job.id}] Poll error:`, err.message);
      if (err.response?.status === 401 || err.response?.status === 403) {
        console.error(`[trigger:${job.id}] Token invalid — disabling job`);
        try {
          const redis = await getRedis();
          const raw = await redis.hGet('spt:jobs', job.id);
          const j = raw ? JSON.parse(raw) : {};
          await redis.hSet('spt:jobs', job.id, JSON.stringify({
            ...j, enabled: false, status: 'error', lastError: 'Token wygasł — zaloguj się ponownie i odtwórz job'
          }));
        } catch {}
        stopTrigger(job.id);
      }
    }
  };

  const intervalId = setInterval(checkAndSync, intervalMs);
  activeTriggers.set(job.id, intervalId);
  console.log(`▶ Trigger polling started for job ${job.id} every ${job.triggerIntervalMinutes || 5}min`);
}

function stopTrigger(jobId) {
  if (activeTriggers.has(jobId)) {
    clearInterval(activeTriggers.get(jobId));
    activeTriggers.delete(jobId);
    console.log(`⏹ Trigger polling stopped for job ${jobId}`);
  }
}

// ─── CRON SCHEDULING ─────────────────────────────────────────────────────────

function cronExpressionFromJob(job) {
  const map = {
    every_15m: '*/15 * * * *',
    every_30m: '*/30 * * * *',
    every_1h:  '0 * * * *',
    every_6h:  '0 */6 * * *',
    every_12h: '0 */12 * * *',
    every_24h: '0 0 * * *',
  };
  return map[job.cronInterval] || '0 * * * *';
}

function startCron(job) {
  if (activeCrons.has(job.id)) activeCrons.get(job.id).stop();
  const expr = cronExpressionFromJob(job);
  const task = cron.schedule(expr, async () => {
    const redis = await getRedis();
    const raw = await redis.hGet('spt:jobs', job.id);
    if (!raw) { task.stop(); activeCrons.delete(job.id); return; }
    const currentJob = JSON.parse(raw);
    if (!currentJob.enabled) return;
    await runSync(currentJob);
  });
  activeCrons.set(job.id, task);
  console.log(`▶ Cron started for job ${job.id}: ${expr}`);
}

function stopCron(jobId) {
  if (activeCrons.has(jobId)) {
    activeCrons.get(jobId).stop();
    activeCrons.delete(jobId);
    console.log(`⏹ Cron stopped for job ${jobId}`);
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

async function scheduleJob(job) {
  if (!job.enabled) return;
  if (job.type === 'cron' || job.type === 'both') startCron(job);
  if (job.type === 'trigger' || job.type === 'both') await startTriggerPolling(job);
}

function unscheduleJob(jobId) {
  stopCron(jobId);
  stopTrigger(jobId);
}

// Called right after creating a new job — captures initial snapshot so
// the NEXT change (not the current state) triggers sync
async function initSnapshot(job) {
  try {
    const token = await getValidToken(job);
    const api = spotifyAPI(token);
    const snapshotId = await getSnapshotId(api, job.sourceId);
    const redis = await getRedis();
    await redis.set(`spt:snapshot:${job.id}`, snapshotId);
    console.log(`📸 Snapshot initialized for job ${job.id}: ${snapshotId}`);
  } catch (err) {
    console.error(`[initSnapshot:${job.id}] Failed:`, err.message);
  }
}

async function restoreJobs() {
  try {
    const redis = await getRedis();
    const all = await redis.hGetAll('spt:jobs');
    let count = 0;
    for (const raw of Object.values(all)) {
      const job = JSON.parse(raw);
      if (job.enabled) {
        await scheduleJob(job);
        count++;
      }
    }
    if (count > 0) console.log(`♻️  Restored ${count} active sync jobs from Redis`);
  } catch (err) {
    console.error('Failed to restore jobs:', err.message);
  }
}

module.exports = { scheduleJob, unscheduleJob, runSync, restoreJobs, initSnapshot };