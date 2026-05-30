import { useState, useEffect } from 'react'
import styles from './AppPage.module.css'

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Icon = ({ d, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d={d} />
  </svg>
)

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = ['Transfer', 'Auto-sync']

export default function AppPage() {
  const [tab, setTab] = useState('Transfer')
  const [me, setMe] = useState(null)
  const [playlists, setPlaylists] = useState([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    init()
  }, [])

  async function init() {
    try {
      const [meRes, plRes] = await Promise.all([
        fetch('/api/me').then(r => { if (r.status === 401) { window.location = '/'; throw new Error('unauth') } return r.json() }),
        fetch('/api/playlists').then(r => { if (!r.ok) throw new Error(`Playlists error: ${r.status}`); return r.json() })
      ])
      setMe(meRes)
      setPlaylists(Array.isArray(plRes) ? plRes : [])
    } catch (err) {
      if (err.message !== 'unauth') console.error('Init error:', err)
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.noise} />
      <div className={styles.orb} />

      <nav className={styles.nav}>
        <div className={styles.navLogo}>
          <span className={styles.navLogoSpt}>SPT</span>
          <span className={styles.navLogoSlash}>/</span>
          <span className={styles.navLogoTransfer}>Transfer</span>
        </div>
        {me && (
          <div className={styles.navUser}>
            {me.images?.[0]?.url
              ? <img className={styles.avatar} src={me.images[0].url} alt={me.display_name} />
              : <div className={styles.avatarFallback}>{(me.display_name || me.id || '?')[0].toUpperCase()}</div>
            }
            <span className={styles.navName}>{me.display_name || me.id}</span>
            <a href="/auth/logout" className={styles.btnLogout}>Sign out</a>
          </div>
        )}
      </nav>

      <main className={`${styles.main} ${mounted ? styles.visible : ''}`}>
        {/* PAGE TABS */}
        <div className={styles.pageTabs}>
          {TABS.map(t => (
            <button
              key={t}
              className={`${styles.pageTab} ${tab === t ? styles.pageTabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'Transfer' ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                  <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              )}
              {t}
            </button>
          ))}
        </div>

        {tab === 'Transfer'
          ? <TransferPanel playlists={playlists} />
          : <SyncPanel playlists={playlists} />
        }
      </main>
    </div>
  )
}

// ─── TRANSFER PANEL ───────────────────────────────────────────────────────────

function TransferPanel({ playlists }) {
  const [sourceId, setSourceId] = useState('')
  const [destId, setDestId] = useState('')
  const [destMode, setDestMode] = useState('existing')
  const [newName, setNewName] = useState('Liked Songs Export')
  const [newDesc, setNewDesc] = useState('')
  const [newPublic, setNewPublic] = useState(false)
  const [newCollaborative, setNewCollaborative] = useState(false)
  const [sourceCount, setSourceCount] = useState(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [transferState, setTransferState] = useState(null)
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [progressDetail, setProgressDetail] = useState('')
  const [error, setError] = useState(null)

  async function onSourceChange(id) {
    setSourceId(id)
    setSourceCount(null)
    if (!id) return
    setSourceLoading(true)
    try {
      const res = await fetch(`/api/tracks/${id}`)
      const data = await res.json()
      setSourceCount(data.total)
    } catch {}
    setSourceLoading(false)
  }

  const canTransfer = (() => {
    if (!sourceId) return false
    if (destMode === 'existing') return destId && destId !== sourceId
    return newName.trim().length > 0
  })()

  async function startTransfer() {
    let finalDestId = destId

    if (destMode === 'new') {
      setTransferState('running')
      setProgress(0)
      setProgressMsg('Creating playlist...')
      try {
        const res = await fetch('/api/playlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newName.trim(),
            description: newDesc.trim(),
            isPublic: newPublic,
            collaborative: newCollaborative
          })
        })
        const pl = await res.json()
        if (!pl.id) throw new Error(pl.error || 'Failed to create playlist')
        finalDestId = pl.id
      } catch (err) {
        setTransferState('error')
        setError(err.message)
        return
      }
    }

    setTransferState('running')
    setProgress(0)
    setProgressMsg('Starting transfer...')
    setProgressDetail('')

    const response = await fetch('/api/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, destId: finalDestId })
    })

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const evt = JSON.parse(line.slice(6))
            setProgress(evt.progress || 0)
            setProgressMsg(evt.message || '')
            if (evt.added && evt.total) setProgressDetail(`${evt.added} / ${evt.total} tracks`)
            if (evt.type === 'done') setTransferState('done')
            if (evt.type === 'error') { setTransferState('error'); setError(evt.message) }
          } catch {}
        }
      }
    }
  }

  function reset() {
    setTransferState(null)
    setProgress(0)
    setProgressMsg('')
    setProgressDetail('')
    setError(null)
  }

  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.h1}>Transfer a playlist</h1>
        <p className={styles.subtitle}>Copy tracks between playlists or export your Liked Songs</p>
      </div>

      <div className={styles.card}>
        {/* SOURCE */}
        <div className={styles.section}>
          <label className={styles.label}>Source</label>
          <div className={styles.selectWrap}>
            <select className={styles.select} value={sourceId} onChange={e => onSourceChange(e.target.value)}>
              <option value="">Select source playlist...</option>
              {playlists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
            </select>
            <div className={styles.selectArrow}>▾</div>
          </div>
          {sourceId && (
            <div className={`${styles.trackBadge} ${sourceCount !== null ? styles.trackBadgeLoaded : ''}`}>
              {sourceLoading
                ? <><span className={styles.spin}>⟳</span> Counting tracks...</>
                : sourceCount !== null
                  ? <><span className={styles.dot} />{sourceCount.toLocaleString()} tracks ready</>
                  : null}
            </div>
          )}
        </div>

        {/* ARROW */}
        <div className={styles.arrowRow}>
          <div className={styles.arrowLine} />
          <div className={styles.arrowCircle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
            </svg>
          </div>
          <div className={styles.arrowLine} />
        </div>

        {/* DESTINATION */}
        <div className={styles.section}>
          <label className={styles.label}>Destination</label>
          <div className={styles.tabs}>
            <button className={`${styles.tab} ${destMode === 'existing' ? styles.tabActive : ''}`} onClick={() => setDestMode('existing')}>Existing</button>
            <button className={`${styles.tab} ${destMode === 'new' ? styles.tabActive : ''}`} onClick={() => setDestMode('new')}>+ New playlist</button>
          </div>

          {destMode === 'existing' ? (
            <div className={styles.selectWrap}>
              <select className={styles.select} value={destId} onChange={e => setDestId(e.target.value)}>
                <option value="">Select destination...</option>
                {playlists.filter(p => p.id !== 'liked' && p.id !== sourceId).map(pl => (
                  <option key={pl.id} value={pl.id}>{pl.name}</option>
                ))}
              </select>
              <div className={styles.selectArrow}>▾</div>
            </div>
          ) : (
            <div className={styles.newFields}>
              <input className={styles.input} type="text" placeholder="Playlist name" value={newName} onChange={e => setNewName(e.target.value)} />
              <input className={styles.input} type="text" placeholder="Description (optional)" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
              <div className={styles.toggleRow}>
                <label className={styles.toggleLabel}>
                  <div className={`${styles.toggle} ${newPublic ? styles.toggleOn : ''}`} onClick={() => { setNewPublic(!newPublic); if (!newPublic) setNewCollaborative(false) }}>
                    <div className={styles.toggleThumb} />
                  </div>
                  <span>Public</span>
                </label>
                <label className={styles.toggleLabel}>
                  <div className={`${styles.toggle} ${newCollaborative ? styles.toggleOn : ''}`} onClick={() => { setNewCollaborative(!newCollaborative); if (!newCollaborative) setNewPublic(false) }}>
                    <div className={styles.toggleThumb} />
                  </div>
                  <span>Collaborative</span>
                  <span className={styles.hint}>requires private</span>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <button
            className={`${styles.btnTransfer} ${!canTransfer || transferState === 'running' ? styles.btnDisabled : ''}`}
            onClick={startTransfer}
            disabled={!canTransfer || transferState === 'running'}
          >
            {transferState === 'running'
              ? <><span className={styles.spinWhite}>⟳</span> Transferring...</>
              : <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  Start Transfer
                </>
            }
          </button>
          {canTransfer && sourceCount !== null && transferState !== 'running' && (
            <span className={styles.readyHint}>{sourceCount.toLocaleString()} tracks</span>
          )}
        </div>
      </div>

      {/* PROGRESS */}
      {transferState && (
        <div className={styles.progressCard}>
          {transferState === 'done' ? (
            <div className={styles.doneState}>
              <div className={styles.doneIcon}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div>
                <div className={styles.doneTitle}>Transfer complete!</div>
                <div className={styles.doneSubtitle}>{progressMsg}</div>
              </div>
              <button className={styles.btnReset} onClick={reset}>New transfer</button>
            </div>
          ) : transferState === 'error' ? (
            <div className={styles.errorState}>
              <div className={styles.errorIcon}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <div>
                <div className={styles.errorTitle}>Transfer failed</div>
                <div className={styles.errorMsg}>{error}</div>
              </div>
              <button className={styles.btnReset} onClick={reset}>Try again</button>
            </div>
          ) : (
            <>
              <div className={styles.progressHeader}>
                <div className={styles.progressMsgText}>{progressMsg}</div>
                <div className={styles.progressPct}>{progress}%</div>
              </div>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              </div>
              {progressDetail && <div className={styles.progressDetail}>{progressDetail}</div>}
            </>
          )}
        </div>
      )}
    </>
  )
}

// ─── SYNC PANEL ───────────────────────────────────────────────────────────────

const CRON_OPTIONS = [
  { value: 'every_15m', label: 'Every 15 min' },
  { value: 'every_30m', label: 'Every 30 min' },
  { value: 'every_1h',  label: 'Every hour' },
  { value: 'every_6h',  label: 'Every 6 hours' },
  { value: 'every_12h', label: 'Every 12 hours' },
  { value: 'every_24h', label: 'Every 24 hours' },
]

const TYPE_OPTIONS = [
  { value: 'cron',    label: 'Schedule', desc: 'Runs at fixed intervals' },
  { value: 'trigger', label: 'On change', desc: 'Polls for new tracks' },
  { value: 'both',    label: 'Both', desc: 'Schedule + on change' },
]

function SyncPanel({ playlists }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [expandedLog, setExpandedLog] = useState(null)
  const [logs, setLogs] = useState({})

  // form
  const [sourceId, setSourceId] = useState('')
  const [destId, setDestId] = useState('')
  const [destMode, setDestMode] = useState('existing')
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newPublic, setNewPublic] = useState(false)
  const [newCollaborative, setNewCollaborative] = useState(false)
  const [syncType, setSyncType] = useState('trigger')
  const [cronInterval, setCronInterval] = useState('every_1h')
  const [triggerMin, setTriggerMin] = useState(5)
  const [label, setLabel] = useState('')

  useEffect(() => { fetchJobs() }, [])

  async function fetchJobs() {
    setLoading(true)
    try {
      const data = await fetch('/api/sync/jobs').then(r => r.json())
      setJobs(Array.isArray(data) ? data : [])
    } catch {}
    setLoading(false)
  }

  async function createJob() {
    if (!sourceId) return
    if (destMode === 'existing' && !destId) return
    if (destMode === 'new' && !newName.trim()) return
    setCreating(true)
    try {
      let finalDestId = destId

      if (destMode === 'new') {
        const isCollab = newCollaborative === true
        const isPublicFinal = isCollab ? false : (newPublic === true)
        const res = await fetch('/api/playlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newName.trim(),
            description: newDesc.trim(),
            isPublic: isPublicFinal,
            collaborative: isCollab
          })
        })
        const pl = await res.json()
        if (!pl.id) throw new Error(pl.error || 'Failed to create playlist')
        finalDestId = pl.id
      }

      const srcPl = playlists.find(p => p.id === sourceId)
      const dstName = destMode === 'new' ? newName.trim() : playlists.find(p => p.id === finalDestId)?.name || finalDestId
      const autoLabel = label.trim() || `${srcPl?.name || sourceId} → ${dstName}`
      await fetch('/api/sync/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, destId: finalDestId, type: syncType, cronInterval, triggerIntervalMinutes: triggerMin, label: autoLabel })
      })
      setSourceId(''); setDestId(''); setNewName(''); setNewDesc(''); setLabel(''); setDestMode('existing')
      await fetchJobs()
    } catch {}
    setCreating(false)
  }

  async function toggleJob(id, enabled) {
    await fetch(`/api/sync/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    })
    setJobs(j => j.map(job => job.id === id ? { ...job, enabled } : job))
  }

  async function deleteJob(id) {
    await fetch(`/api/sync/jobs/${id}`, { method: 'DELETE' })
    setJobs(j => j.filter(job => job.id !== id))
    if (expandedLog === id) setExpandedLog(null)
  }

  async function runNow(id) {
    await fetch(`/api/sync/jobs/${id}/run`, { method: 'POST' })
    setJobs(j => j.map(job => job.id === id ? { ...job, status: 'running' } : job))
    setTimeout(fetchJobs, 2000)
  }

  async function fetchLogs(id) {
    if (expandedLog === id) { setExpandedLog(null); return }
    const data = await fetch(`/api/sync/jobs/${id}/logs`).then(r => r.json())
    setLogs(l => ({ ...l, [id]: data }))
    setExpandedLog(id)
  }

  const canCreate = (() => {
    if (!sourceId) return false
    if (destMode === 'existing') return destId && destId !== sourceId
    return newName.trim().length > 0
  })()

  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.h1}>Auto-sync</h1>
        <p className={styles.subtitle}>Keep playlists in sync automatically</p>
      </div>

      {/* CREATE JOB */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>New sync job</div>

        <div className={styles.syncGrid}>
          <div className={styles.section}>
            <label className={styles.label}>Source</label>
            <div className={styles.selectWrap}>
              <select className={styles.select} value={sourceId} onChange={e => setSourceId(e.target.value)}>
                <option value="">Select source...</option>
                {playlists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
              </select>
              <div className={styles.selectArrow}>▾</div>
            </div>
          </div>

          <div className={styles.syncArrow}>→</div>

          <div className={styles.section}>
            <label className={styles.label}>Destination</label>
            <div className={styles.tabs}>
              <button className={`${styles.tab} ${destMode === 'existing' ? styles.tabActive : ''}`} onClick={() => setDestMode('existing')}>Existing</button>
              <button className={`${styles.tab} ${destMode === 'new' ? styles.tabActive : ''}`} onClick={() => setDestMode('new')}>+ New playlist</button>
            </div>

            {destMode === 'existing' ? (
              <div className={styles.selectWrap}>
                <select className={styles.select} value={destId} onChange={e => setDestId(e.target.value)}>
                  <option value="">Select destination...</option>
                  {playlists.filter(p => p.id !== 'liked' && p.id !== sourceId).map(pl => (
                    <option key={pl.id} value={pl.id}>{pl.name}</option>
                  ))}
                </select>
                <div className={styles.selectArrow}>▾</div>
              </div>
            ) : (
              <div className={styles.newFields}>
                <input className={styles.input} type="text" placeholder="Playlist name" value={newName} onChange={e => setNewName(e.target.value)} />
                <input className={styles.input} type="text" placeholder="Description (optional)" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
                <div className={styles.toggleRow}>
                  <label className={styles.toggleLabel}>
                    <div className={`${styles.toggle} ${newPublic ? styles.toggleOn : ''}`} onClick={() => { setNewPublic(p => !p); if (!newPublic) setNewCollaborative(false) }}>
                      <div className={styles.toggleThumb} />
                    </div>
                    <span>Public</span>
                  </label>
                  <label className={styles.toggleLabel}>
                    <div className={`${styles.toggle} ${newCollaborative ? styles.toggleOn : ''}`} onClick={() => { setNewCollaborative(c => !c); if (!newCollaborative) setNewPublic(false) }}>
                      <div className={styles.toggleThumb} />
                    </div>
                    <span>Collaborative</span>
                    <span className={styles.hint}>requires private</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* TYPE */}
        <div className={styles.section} style={{ marginTop: '1rem' }}>
          <label className={styles.label}>Sync type</label>
          <div className={styles.typeOptions}>
            {TYPE_OPTIONS.map(o => (
              <button
                key={o.value}
                className={`${styles.typeOption} ${syncType === o.value ? styles.typeOptionActive : ''}`}
                onClick={() => setSyncType(o.value)}
              >
                <span className={styles.typeOptionLabel}>{o.label}</span>
                <span className={styles.typeOptionDesc}>{o.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* CRON settings */}
        {(syncType === 'cron' || syncType === 'both') && (
          <div className={styles.section} style={{ marginTop: '1rem' }}>
            <label className={styles.label}>Schedule interval</label>
            <div className={styles.selectWrap}>
              <select className={styles.select} value={cronInterval} onChange={e => setCronInterval(e.target.value)}>
                {CRON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className={styles.selectArrow}>▾</div>
            </div>
          </div>
        )}

        {/* Trigger settings */}
        {(syncType === 'trigger' || syncType === 'both') && (
          <div className={styles.section} style={{ marginTop: '1rem' }}>
            <label className={styles.label}>Poll interval (minutes)</label>
            <input
              className={styles.input}
              type="number"
              min="1"
              max="60"
              value={triggerMin}
              onChange={e => setTriggerMin(Number(e.target.value))}
            />
            <p className={styles.fieldHint}>Checks for new tracks every {triggerMin} min — syncs only if something changed</p>
          </div>
        )}

        {/* Label */}
        <div className={styles.section} style={{ marginTop: '1rem' }}>
          <label className={styles.label}>Label (optional)</label>
          <input className={styles.input} type="text" placeholder="e.g. Liked → My Collection" value={label} onChange={e => setLabel(e.target.value)} />
        </div>

        <div className={styles.actions}>
          <button
            className={`${styles.btnTransfer} ${!canCreate || creating ? styles.btnDisabled : ''}`}
            onClick={createJob}
            disabled={!canCreate || creating}
          >
            {creating
              ? <><span className={styles.spinWhite}>⟳</span> Creating...</>
              : <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Create sync job
                </>
            }
          </button>
        </div>
      </div>

      {/* JOB LIST */}
      {loading ? (
        <div className={styles.loadingHint}><span className={styles.spin}>⟳</span> Loading jobs...</div>
      ) : jobs.length === 0 ? (
        <div className={styles.emptyState}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <p>No sync jobs yet</p>
        </div>
      ) : (
        <div className={styles.jobList}>
          {jobs.map(job => (
            <div key={job.id} className={`${styles.jobCard} ${!job.enabled ? styles.jobDisabled : ''}`}>
              <div className={styles.jobHeader}>
                <div className={styles.jobInfo}>
                  <div className={styles.jobLabel}>{job.label}</div>
                  <div className={styles.jobMeta}>
                    <span className={styles.jobBadge}>{job.type}</span>
                    {job.type !== 'trigger' && <span className={styles.jobBadge}>{CRON_OPTIONS.find(o => o.value === job.cronInterval)?.label}</span>}
                    {job.type !== 'cron' && <span className={styles.jobBadge}>poll {job.triggerIntervalMinutes}min</span>}
                    <span className={`${styles.jobStatus} ${job.status === 'running' ? styles.jobStatusRunning : job.status === 'error' ? styles.jobStatusError : ''}`}>
                      {job.status === 'running' ? <><span className={styles.spin}>⟳</span> running</> : job.status}
                    </span>
                  </div>
                  {job.lastRun && (
                    <div className={styles.jobLastRun}>
                      Last: {new Date(job.lastRun).toLocaleString()} 
                      {job.lastCount != null && ` · +${job.lastCount} tracks`}
                    </div>
                  )}
                </div>
                <div className={styles.jobActions}>
                  <button className={styles.jobBtn} onClick={() => runNow(job.id)} title="Run now">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  </button>
                  <button className={styles.jobBtn} onClick={() => fetchLogs(job.id)} title="Logs">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                  </button>
                  <div
                    className={`${styles.toggle} ${job.enabled ? styles.toggleOn : ''}`}
                    onClick={() => toggleJob(job.id, !job.enabled)}
                    title={job.enabled ? 'Pause' : 'Resume'}
                  >
                    <div className={styles.toggleThumb} />
                  </div>
                  <button className={`${styles.jobBtn} ${styles.jobBtnDanger}`} onClick={() => deleteJob(job.id)} title="Delete">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                  </button>
                </div>
              </div>

              {/* LOGS */}
              {expandedLog === job.id && (
                <div className={styles.logsBox}>
                  {(logs[job.id] || []).length === 0
                    ? <div className={styles.logsEmpty}>No logs yet</div>
                    : (logs[job.id] || []).map((l, i) => (
                      <div key={i} className={`${styles.logLine} ${l.type === 'error' ? styles.logError : l.type === 'success' ? styles.logSuccess : ''}`}>
                        <span className={styles.logTime}>{new Date(l.ts).toLocaleTimeString()}</span>
                        <span>{l.msg}</span>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}