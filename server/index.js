const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
require('dotenv').config({ path: __dirname + '/.env' });

const { getRedis } = require('./redis');
const { scheduleJob, unscheduleJob, runSync, restoreJobs, initSnapshot } = require('./sync');
const RedisStore = require('connect-redis').default;

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const FRONTEND_DEV_URL = process.env.FRONTEND_DEV_URL || 'http://localhost:5173';

if (IS_PROD && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'spt-transfer-secret-key')) {
  console.error('FATAL: SESSION_SECRET must be set to a unique random string in production!');
  process.exit(1);
}

// ─── IFRAME_URL -> CSP frame-ancestors ────────────────────────────────────────
// IFRAME_URL="*.racis.dev;github.com" -> frame-ancestors https://*.racis.dev https://github.com
// Brak IFRAME_URL -> domyślnie 'self' (tylko własna domena moze osadzic w iframe)
function parseFrameAncestors() {
  const raw = process.env.IFRAME_URL;
  if (!raw) return ["'self'"];

  const validHost = /^(\*\.)?[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/;

  const hosts = raw
    .split(';')
    .map(h => h.trim())
    .filter(h => h && validHost.test(h));

  if (hosts.length === 0) return ["'self'"];

  return hosts.map(host => `https://${host}`);
}

// Security Middleware
app.use(helmet({
  // X-Frame-Options nie wspiera wielu domen/wildcardów - wylaczone,
  // ochrona przed clickjackingiem oparta wylacznie na CSP frame-ancestors
  frameguard: false,
  // Domyślne 'same-origin' COOP zrywa window.opener po przejściu popupu
  // przez accounts.spotify.com (inny origin w trakcie OAuth flow) -> 
  // window.opener.postMessage() w popupie zawodzi po cichu, bez błędu,
  // bez śladu w Network. same-origin-allow-popups pozwala oknu otwierającemu
  // (naszej stronie) zachować relację z popupami które otworzyło,
  // nawet jeśli te popupy nawigowały cross-origin.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "https://i.scdn.co", "https://*.scdn.co", "data:"],
      "connect-src": ["'self'", "https://api.spotify.com", "https://accounts.spotify.com"],
      "frame-ancestors": parseFrameAncestors(),
    },
  },
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Initialize Redis client for session store
let redisClient;
getRedis().then(client => { redisClient = client; }).catch(console.error);

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API = 'https://api.spotify.com/v1';

const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-library-read',
  'ugc-image-upload',
].join(' ');

app.use(express.json());
app.use(session({
  store: new RedisStore({
    client: {
      get: (...args) => redisClient ? redisClient.get(...args) : Promise.resolve(null),
      set: (...args) => redisClient ? redisClient.set(...args) : Promise.resolve(null),
      del: (...args) => redisClient ? redisClient.del(...args) : Promise.resolve(null),
      expire: (...args) => redisClient ? redisClient.expire(...args) : Promise.resolve(null),
    },
    prefix: "spt:session:",
  }),
  secret: process.env.SESSION_SECRET || 'spt-transfer-secret-key',
  resave: false,
  saveUninitialized: false,
  name: '__spt_session',
  cookie: {
    secure: IS_PROD,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

if (IS_PROD) {
  app.set('trust proxy', 1);
}

app.use(express.static(path.join(__dirname, '../client/dist')));

// ─── AUTH ─────────────────────────────────────────────────────────────────────

app.get('/auth/login', (req, res) => {
  const isPopup = req.query.popup === '1';
  // Encode popup flag into state: "<hex>:popup" or "<hex>"
  const stateRandom = crypto.randomBytes(16).toString('hex');
  const state = isPopup ? `${stateRandom}:popup` : stateRandom;
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.REDIRECT_URI,
    scope: SCOPES,
    state: state,
    show_dialog: 'true'
  });
  res.redirect(`${SPOTIFY_AUTH_URL}?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code, error, state } = req.query;
  const frontendBase = IS_PROD ? '' : FRONTEND_DEV_URL;

  const isPopup = state && state.endsWith(':popup');

  if (!state || state !== req.session.oauthState) {
    if (isPopup) {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'");
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Error</title></head>
        <body style="background:#121212;color:#ff5555;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;">
          <h2 style="margin-bottom:8px;">Błąd autoryzacji</h2>
          <p style="color:#b3b3b3;margin:0;">Sesja wygasła (mismatch). Zamykanie...</p>
          <script>
            console.log('[SPT DEBUG] === state_mismatch popup loaded ===');
            console.log('[SPT DEBUG] window.opener:', window.opener);
            console.log('[SPT DEBUG] window.parent === window:', window.parent === window);
            console.log('[SPT DEBUG] window.name:', window.name);
            console.log('[SPT DEBUG] document.referrer:', document.referrer);
            console.log('[SPT DEBUG] location.href:', location.href);

            const target = window.opener && window.opener !== window ? window.opener : null;
            if (target) {
              console.log('[SPT DEBUG] target found, sending postMessage SPOTIFY_AUTH_ERROR (state_mismatch)');
              try {
                target.postMessage({ type: 'SPOTIFY_AUTH_ERROR', error: 'state_mismatch' }, '*');
                console.log('[SPT DEBUG] postMessage call completed without throwing');
              } catch (e) {
                console.error('[SPT DEBUG] postMessage threw:', e);
              }
            } else {
              console.error('[SPT DEBUG] NO target - window.opener is null/self. postMessage NOT sent.');
            }
            console.log('[SPT DEBUG] window will stay open for 10s for inspection. Closing at:', new Date(Date.now() + 10000).toISOString());
            setTimeout(() => { console.log('[SPT DEBUG] closing now'); window.close(); }, 10000);
          </script>
        </body>
        </html>
      `);
    }
    return res.redirect(`${frontendBase}/?error=state_mismatch`);
  }
  delete req.session.oauthState;

  if (error) {
    if (isPopup) {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'");
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Error</title></head>
        <body style="background:#121212;color:#ff5555;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;">
          <h2 style="margin-bottom:8px;">Błąd autoryzacji</h2>
          <p style="color:#b3b3b3;margin:0;">Wystąpił błąd Spotify. Zamykanie za 10s (debug mode)...</p>
          <script>
            console.log('[SPT DEBUG] === oauth error popup loaded ===');
            console.log('[SPT DEBUG] error param:', '${error}');
            console.log('[SPT DEBUG] window.opener:', window.opener);
            console.log('[SPT DEBUG] window.parent === window:', window.parent === window);
            console.log('[SPT DEBUG] window.name:', window.name);
            console.log('[SPT DEBUG] document.referrer:', document.referrer);
            console.log('[SPT DEBUG] location.href:', location.href);

            const target = window.opener && window.opener !== window ? window.opener : null;
            if (target) {
              console.log('[SPT DEBUG] target found, sending postMessage SPOTIFY_AUTH_ERROR');
              try {
                target.postMessage({ type: 'SPOTIFY_AUTH_ERROR', error: '${error}' }, '*');
                console.log('[SPT DEBUG] postMessage call completed without throwing');
              } catch (e) {
                console.error('[SPT DEBUG] postMessage threw:', e);
              }
            } else {
              console.error('[SPT DEBUG] NO target - window.opener is null/self. postMessage NOT sent.');
            }
            console.log('[SPT DEBUG] window will stay open for 10s for inspection. Closing at:', new Date(Date.now() + 10000).toISOString());
            setTimeout(() => { console.log('[SPT DEBUG] closing now'); window.close(); }, 10000);
          </script>
        </body>
        </html>
      `);
    }
    return res.redirect(`${frontendBase}/?error=${error}`);
  }

  try {
    const creds = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString('base64');

    const { data } = await axios.post(SPOTIFY_TOKEN_URL,
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: process.env.REDIRECT_URI }),
      { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    req.session.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000
    };

    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.redirect(`${frontendBase}/?error=session_save_failed`);
      }

      if (isPopup) {
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:");
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Logged In</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600&display=swap" rel="stylesheet">
            <style>
              body {
                background: #080808;
                color: #f0f0f0;
                font-family: 'Outfit', sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
                position: relative;
                overflow: hidden;
              }
              .noise {
                position: absolute;
                inset: 0;
                background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
                pointer-events: none;
                opacity: 0.4;
              }
              .orb {
                position: absolute;
                width: 400px;
                height: 400px;
                border-radius: 50%;
                background: radial-gradient(circle, rgba(29,185,84,0.15) 0%, transparent 70%);
                pointer-events: none;
                z-index: 0;
              }
              .content {
                position: relative;
                z-index: 1;
                text-align: center;
                padding: 2.5rem 2rem;
                background: rgba(17, 17, 17, 0.7);
                border: 1px solid rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(10px);
                border-radius: 16px;
                max-width: 320px;
                width: 100%;
                box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
              }
              .badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: rgba(29,185,84,0.08);
                border: 1px solid rgba(29,185,84,0.2);
                border-radius: 100px;
                padding: 5px 14px;
                font-size: 0.72rem;
                font-weight: 600;
                color: #1DB954;
                letter-spacing: 0.06em;
                text-transform: uppercase;
                margin-bottom: 16px;
              }
              h2 {
                margin: 0 0 8px 0;
                font-weight: 600;
                font-size: 1.5rem;
              }
              p {
                color: #888;
                margin: 0;
                font-size: 0.9rem;
              }
            </style>
          </head>
          <body>
            <div class="noise"></div>
            <div class="orb"></div>
            <div class="content">
              <div class="badge">SPT / Transfer</div>
              <h2>Authenticated!</h2>
              <p>This window will close automatically...</p>
            </div>
            <script>
              console.log('[SPT DEBUG] === SUCCESS popup loaded ===');
              console.log('[SPT DEBUG] window.opener:', window.opener);
              console.log('[SPT DEBUG] window.parent === window:', window.parent === window);
              console.log('[SPT DEBUG] window.name:', window.name);
              console.log('[SPT DEBUG] document.referrer:', document.referrer);
              console.log('[SPT DEBUG] location.href:', location.href);
              console.log('[SPT DEBUG] navigator.userAgent:', navigator.userAgent);

              const target = window.opener && window.opener !== window ? window.opener : null;
              if (target) {
                console.log('[SPT DEBUG] target found, sending postMessage SPOTIFY_AUTH_SUCCESS');
                try {
                  target.postMessage({ type: 'SPOTIFY_AUTH_SUCCESS' }, '*');
                  console.log('[SPT DEBUG] postMessage call completed without throwing');
                } catch (e) {
                  console.error('[SPT DEBUG] postMessage threw:', e);
                }
              } else {
                console.error('[SPT DEBUG] NO target - window.opener is null/self. postMessage NOT sent.');
                console.error('[SPT DEBUG] This means window.opener was severed - check COOP headers on this response, and on the redirect chain through accounts.spotify.com');
              }
              console.log('[SPT DEBUG] window will stay open for 10s for inspection. Closing at:', new Date(Date.now() + 10000).toISOString());
              setTimeout(() => { console.log('[SPT DEBUG] closing now'); window.close(); }, 10000);
            </script>
          </body>
          </html>
        `);
      }

      res.redirect(`${frontendBase}/app`);
    });
  } catch (err) {
    console.error('Auth error:', err.response?.data || err.message);
    if (isPopup) {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:");
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authentication Failed</title>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600&display=swap" rel="stylesheet">
          <style>
            body {
              background: #080808;
              color: #f0f0f0;
              font-family: 'Outfit', sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              position: relative;
              overflow: hidden;
            }
            .noise {
              position: absolute;
              inset: 0;
              background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
              pointer-events: none;
              opacity: 0.4;
            }
            .content {
              position: relative;
              z-index: 1;
              text-align: center;
              padding: 2.5rem 2rem;
              background: rgba(17, 17, 17, 0.7);
              border: 1px solid rgba(255, 85, 85, 0.2);
              backdrop-filter: blur(10px);
              border-radius: 16px;
              max-width: 320px;
              width: 100%;
              box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
            }
            h2 {
              color: #ff5555;
              margin: 0 0 8px 0;
              font-weight: 600;
              font-size: 1.5rem;
            }
            p {
              color: #888;
              margin: 0;
              font-size: 0.9rem;
            }
          </style>
        </head>
        <body>
          <div class="noise"></div>
          <div class="content">
            <h2>Authentication Failed</h2>
            <p>Please try again later...</p>
          </div>
          <script>
            console.log('[SPT DEBUG] === auth_failed popup loaded ===');
            console.log('[SPT DEBUG] window.opener:', window.opener);
            console.log('[SPT DEBUG] window.parent === window:', window.parent === window);
            console.log('[SPT DEBUG] window.name:', window.name);
            console.log('[SPT DEBUG] document.referrer:', document.referrer);
            console.log('[SPT DEBUG] location.href:', location.href);

            const target = window.opener && window.opener !== window ? window.opener : null;
            if (target) {
              console.log('[SPT DEBUG] target found, sending postMessage SPOTIFY_AUTH_ERROR (auth_failed)');
              try {
                target.postMessage({ type: 'SPOTIFY_AUTH_ERROR', error: 'auth_failed' }, '*');
                console.log('[SPT DEBUG] postMessage call completed without throwing');
              } catch (e) {
                console.error('[SPT DEBUG] postMessage threw:', e);
              }
            } else {
              console.error('[SPT DEBUG] NO target - window.opener is null/self. postMessage NOT sent.');
            }
            console.log('[SPT DEBUG] window will stay open for 10s for inspection. Closing at:', new Date(Date.now() + 10000).toISOString());
            setTimeout(() => { console.log('[SPT DEBUG] closing now'); window.close(); }, 10000);
          </script>
        </body>
        </html>
      `);
    }
    res.redirect(`${frontendBase}/?error=auth_failed`);
  }
});

app.get('/auth/logout', (req, res) => {
  const frontendBase = IS_PROD ? '' : FRONTEND_DEV_URL;
  req.session.destroy();
  res.redirect(`${frontendBase}/`);
});

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────

async function requireAuth(req, res, next) {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not logged in' });

  if (Date.now() > req.session.tokens.expires_at - 60000) {
    try {
      const creds = Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64');
      const { data } = await axios.post(SPOTIFY_TOKEN_URL,
        new URLSearchParams({ grant_type: 'refresh_token', refresh_token: req.session.tokens.refresh_token }),
        { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      req.session.tokens.access_token = data.access_token;
      req.session.tokens.expires_at = Date.now() + data.expires_in * 1000;
    } catch (err) {
      return res.status(401).json({ error: 'Token refresh failed' });
    }
  }

  req.token = req.session.tokens.access_token;
  next();
}

function spotifyAPI(token) {
  return axios.create({
    baseURL: SPOTIFY_API,
    headers: { Authorization: `Bearer ${token}` }
  });
}

// ─── SPOTIFY API ROUTES ───────────────────────────────────────────────────────

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const { data } = await spotifyAPI(req.token).get('/me');
    res.json(data);
  } catch (err) {
    console.error('API /me error:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.get('/api/playlists', requireAuth, async (req, res) => {
  try {
    const api = spotifyAPI(req.token);
    let playlists = [];
    let url = '/me/playlists?limit=50';
    while (url) {
      const { data } = await api.get(url);
      playlists.push(...data.items);
      url = data.next ? data.next.replace(SPOTIFY_API, '') : null;
    }
    const liked = { id: 'liked', name: '❤️ Polubione utwory', type: 'liked', images: [] };
    res.json([liked, ...playlists.filter(Boolean)]);
  } catch (err) {
    console.error('API /playlists error:', err.message);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

app.get('/api/tracks/:playlistId', requireAuth, async (req, res) => {
  const { playlistId } = req.params;
  const api = spotifyAPI(req.token);
  try {
    let tracks = [];
    let url = playlistId === 'liked'
      ? '/me/tracks?limit=50'
      : `/playlists/${playlistId}/tracks?limit=50`;
    while (url) {
      const { data } = await api.get(url);
      tracks.push(...data.items.filter(i => i.track && i.track.id));
      url = data.next ? data.next.replace(SPOTIFY_API, '') : null;
    }
    res.json({ total: tracks.length, tracks });
  } catch (err) {
    console.error(`API /tracks/${playlistId} error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch tracks' });
  }
});

app.post('/api/playlists', requireAuth, async (req, res) => {
  const { name, description, isPublic, collaborative } = req.body;
  if (name && typeof name !== 'string') return res.status(400).json({ error: 'Invalid name' });

  try {
    const api = spotifyAPI(req.token);
    const { data: me } = await api.get('/me');
    const isCollab = collaborative === true;
    const isPublicFinal = isCollab ? false : (isPublic === true);

    const { data } = await api.post(`/users/${me.id}/playlists`, {
      name: name || 'Transferred Playlist',
      description: description || 'Transferred via SPT Transfer',
      public: isPublicFinal,
      collaborative: isCollab,
    });

    await api.put(`/playlists/${data.id}`, {
      public: isPublicFinal,
      collaborative: isCollab,
    });
    data.public = isPublicFinal;

    res.json(data);
  } catch (err) {
    console.error('API create playlist error:', err.message);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

app.post('/api/transfer', requireAuth, async (req, res) => {
  const { sourceId, destId } = req.body;
  if (!sourceId || !destId) return res.status(400).json({ error: 'sourceId and destId required' });

  const api = spotifyAPI(req.token);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    send({ type: 'status', message: 'Fetching tracks from source...', progress: 0 });
    let tracks = [];
    let url = sourceId === 'liked'
      ? '/me/tracks?limit=50'
      : `/playlists/${sourceId}/tracks?limit=50`;
    while (url) {
      const { data } = await api.get(url);
      tracks.push(...data.items.filter(i => i.track && i.track.id));
      url = data.next ? data.next.replace(SPOTIFY_API, '') : null;
      send({ type: 'status', message: `Fetched ${tracks.length} tracks...`, progress: 5 });
    }
    send({ type: 'status', message: `Got ${tracks.length} tracks. Copying...`, progress: 10 });
    const uris = tracks.map(t => t.track.uri);
    const chunks = [];
    for (let i = 0; i < uris.length; i += 100) chunks.push(uris.slice(i, i + 100));
    for (let i = 0; i < chunks.length; i++) {
      await api.post(`/playlists/${destId}/tracks`, { uris: chunks[i] });
      const progress = 10 + Math.round((i + 1) / chunks.length * 90);
      send({ type: 'progress', message: `Added ${Math.min((i + 1) * 100, uris.length)} / ${uris.length} tracks`, progress, added: Math.min((i + 1) * 100, uris.length), total: uris.length });
    }
    send({ type: 'done', message: `Transfer complete! Moved ${uris.length} tracks.`, progress: 100, total: uris.length });
  } catch (err) {
    console.error('API transfer error:', err.message);
    send({ type: 'error', message: 'Transfer failed' });
  } finally {
    res.end();
  }
});

// ─── SYNC JOBS API ────────────────────────────────────────────────────────────

app.get('/api/sync/jobs', requireAuth, async (req, res) => {
  try {
    const redis = await getRedis();
    const { data: me } = await spotifyAPI(req.token).get('/me');
    const all = await redis.hGetAll('spt:jobs');
    const jobs = Object.values(all)
      .map(j => JSON.parse(j))
      .filter(j => j.userId === me.id)
      .map(({ access_token, refresh_token, ...safe }) => safe);
    res.json(jobs);
  } catch (err) {
    console.error('API get jobs error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sync jobs' });
  }
});

app.post('/api/sync/jobs', requireAuth, async (req, res) => {
  const { sourceId, destId, type, cronInterval, triggerIntervalMinutes, label } = req.body;
  if (!sourceId || !destId || !type) return res.status(400).json({ error: 'sourceId, destId, type required' });
  
  const validTypes = ['cron', 'trigger', 'both'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid job type' });

  try {
    const redis = await getRedis();
    const { data: me } = await spotifyAPI(req.token).get('/me');

    const job = {
      id: uuidv4(),
      userId: me.id,
      label: (typeof label === 'string' ? label.substring(0, 100) : null) || `Auto-sync`,
      sourceId,
      destId,
      type,
      cronInterval: cronInterval || 'every_1h',
      triggerIntervalMinutes: Math.max(1, parseInt(triggerIntervalMinutes) || 5),
      enabled: true,
      createdAt: Date.now(),
      lastRun: null,
      lastResult: null,
      lastCount: null,
      status: 'idle',
      access_token: req.session.tokens.access_token,
      refresh_token: req.session.tokens.refresh_token,
      expires_at: req.session.tokens.expires_at,
    };

    await redis.hSet('spt:jobs', job.id, JSON.stringify(job));
    if (type === 'trigger' || type === 'both') {
      await initSnapshot(job);
    }
    await scheduleJob(job);

    const { access_token, refresh_token, ...safeJob } = job;
    res.json(safeJob);
  } catch (err) {
    console.error('API create job error:', err.message);
    res.status(500).json({ error: 'Failed to create sync job' });
  }
});

app.patch('/api/sync/jobs/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });

  try {
    const redis = await getRedis();
    const raw = await redis.hGet('spt:jobs', id);
    if (!raw) return res.status(404).json({ error: 'Job not found' });
    const job = JSON.parse(raw);

    const { data: me } = await spotifyAPI(req.token).get('/me');
    if (job.userId !== me.id) return res.status(403).json({ error: 'Forbidden' });

    job.enabled = enabled;
    await redis.hSet('spt:jobs', id, JSON.stringify(job));
    if (enabled) {
      if (job.type === 'trigger' || job.type === 'both') await initSnapshot(job);
      await scheduleJob(job);
    } else {
      unscheduleJob(id);
    }
    const { access_token, refresh_token, ...safe } = job;
    res.json(safe);
  } catch (err) {
    console.error(`API patch job ${id} error:`, err.message);
    res.status(500).json({ error: 'Failed to update job' });
  }
});

app.delete('/api/sync/jobs/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const redis = await getRedis();
    const raw = await redis.hGet('spt:jobs', id);
    if (!raw) return res.status(404).json({ error: 'Job not found' });
    const job = JSON.parse(raw);

    const { data: me } = await spotifyAPI(req.token).get('/me');
    if (job.userId !== me.id) return res.status(403).json({ error: 'Forbidden' });

    unscheduleJob(id);
    await redis.hDel('spt:jobs', id);
    await redis.del(`spt:logs:${id}`);
    await redis.del(`spt:snapshot:${id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`API delete job ${id} error:`, err.message);
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

app.post('/api/sync/jobs/:id/run', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const redis = await getRedis();
    const raw = await redis.hGet('spt:jobs', id);
    if (!raw) return res.status(404).json({ error: 'Job not found' });
    const job = JSON.parse(raw);

    const { data: me } = await spotifyAPI(req.token).get('/me');
    if (job.userId !== me.id) return res.status(403).json({ error: 'Forbidden' });

    runSync(job).catch(console.error);
    res.json({ ok: true, message: 'Sync started' });
  } catch (err) {
    console.error(`API run job ${id} error:`, err.message);
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

app.get('/api/sync/jobs/:id/logs', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const redis = await getRedis();
    const rawJob = await redis.hGet('spt:jobs', id);
    if (!rawJob) return res.status(404).json({ error: 'Job not found' });
    const job = JSON.parse(rawJob);

    const { data: me } = await spotifyAPI(req.token).get('/me');
    if (job.userId !== me.id) return res.status(403).json({ error: 'Forbidden' });

    const rawLogs = await redis.lRange(`spt:logs:${id}`, 0, 49);
    res.json(rawLogs.map(r => JSON.parse(r)));
  } catch (err) {
    console.error(`API get logs for job ${id} error:`, err.message);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// ─── SPA FALLBACK ────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🎵 SPT Transfer running on http://localhost:${PORT}`);
  console.log(`   Mode: ${IS_PROD ? 'production' : 'development'}`);
  if (!IS_PROD) console.log(`   Frontend dev: ${FRONTEND_DEV_URL}\n`);
  await restoreJobs();
});