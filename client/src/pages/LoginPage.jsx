import { useEffect, useState } from 'react'
import styles from './LoginPage.module.css'

export default function LoginPage() {
  const [error, setError] = useState(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const p = new URLSearchParams(window.location.search)
    if (p.get('error')) setError(p.get('error'))
  }, [])

  return (
    <div className={styles.root}>
      {/* Noise texture overlay */}
      <div className={styles.noise} />

      {/* Ambient orbs */}
      <div className={styles.orb1} />
      <div className={styles.orb2} />
      <div className={styles.orb3} />

      {/* Grid lines */}
      <div className={styles.grid} />

      <div className={`${styles.hero} ${mounted ? styles.visible : ''}`}>
        {/* Badge */}
        <div className={styles.badge}>
          <span className={styles.badgeDot} />
          Spotify Playlist Tool
        </div>

        {/* Logo */}
        <div className={styles.logo}>
          <span className={styles.logoSpt}>SPT</span>
          <span className={styles.logoSep}>/</span>
          <span className={styles.logoTransfer}>Transfer</span>
        </div>

        <p className={styles.tagline}>
          Move your playlists anywhere.<br />
          <span>Liked Songs included.</span>
        </p>

        {/* Feature pills */}
        <div className={styles.features}>
          <div className={styles.feat}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            Liked → Playlist
          </div>
          <div className={styles.feat}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
            Playlist → Playlist
          </div>
          <div className={styles.feat}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Create new on the fly
          </div>
          <div className={styles.feat}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            Live progress
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={() => {
            const width = 600;
            const height = 800;
            const left = window.screen.width / 2 - width / 2;
            const top = window.screen.height / 2 - height / 2;
            
            const popup = window.open(
              '/auth/login?popup=1',
              'Spotify Login',
              `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes,status=yes`
            );

            const handleMessage = (event) => {
              if (event.data?.type === 'SPOTIFY_AUTH_SUCCESS') {
                window.removeEventListener('message', handleMessage);
                window.location.href = '/app';
              } else if (event.data?.type === 'SPOTIFY_AUTH_ERROR') {
                window.removeEventListener('message', handleMessage);
                setError(event.data.error || 'Authentication failed');
              }
            };

            window.addEventListener('message', handleMessage);
          }}
          className={styles.btnLogin}
          style={{ border: 'none', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          Connect with Spotify
        </button>

        {error && (
          <div className={styles.error}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            Auth error: {error}
          </div>
        )}

        <p className={styles.footer}>
          Your data stays local · No tracking · Open source
        </p>
      </div>
    </div>
  )
}