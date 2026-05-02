import { useState, useEffect, useCallback } from 'react'

const PACIFIC = 'America/Los_Angeles'

function pacificLocalToDate(localDatetime) {
  const datePart = localDatetime.slice(0, 10)
  const noonUtc = new Date(datePart + 'T20:00:00Z')
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: PACIFIC,
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(noonUtc).map(({ type, value }) => [type, value])
  )
  const offsetHours = 20 - (parseInt(parts.hour) % 24)
  const [h, m] = localDatetime.slice(11).split(':').map(Number)
  const [y, mo, d] = datePart.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d, h + offsetHours, m))
}

function todayPacific() {
  return new Date().toLocaleDateString('en-CA', { timeZone: PACIFIC })
}

function daysAgoPacific(n) {
  const d = new Date(Date.now() - n * 86_400_000)
  return d.toLocaleDateString('en-CA', { timeZone: PACIFIC })
}

function formatAirdate(isoStr) {
  return new Date(isoStr).toLocaleTimeString('en-US', {
    timeZone: PACIFIC, hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

function proxyUrl(url) {
  return url.replace('https://api.kexp.org', '/api')
}

async function fetchAllPlays({ beginDate, endDate, hostName, programId }, onProgress) {
  // The API ignores time params — we filter client-side and stop once past beginDate.
  const plays = []
  let offset = 0
  let page = 1

  while (true) {
    const params = new URLSearchParams({ play_type: 'trackplay', limit: 100, offset })
    if (hostName) params.set('host_name', hostName)
    if (programId) params.set('program', programId)

    const resp = await fetch(`/api/v2/plays/?${params}`)
    if (!resp.ok) throw new Error(`API error ${resp.status}`)
    const data = await resp.json()

    const results = data.results ?? []
    if (results.length === 0) break

    for (const play of results) {
      const airdate = new Date(play.airdate)
      if ((!endDate || airdate <= endDate) && (!beginDate || airdate >= beginDate)) {
        plays.push(play)
      }
    }

    onProgress(page, plays.length)

    const lastAirdate = new Date(results[results.length - 1].airdate)
    if (!data.next || (beginDate && lastAirdate < beginDate)) break

    offset += 100
    page += 1
  }

  return plays
}

async function fetchCurrentShow() {
  const resp = await fetch('/api/v2/shows/?limit=1&ordering=-start_time')
  if (!resp.ok) return null
  const data = await resp.json()
  return data.results?.[0] ?? null
}

async function loadHosts() {
  const resp = await fetch('/api/v2/hosts/?is_active=true&limit=200&ordering=name')
  if (!resp.ok) throw new Error('Failed to load hosts')
  const data = await resp.json()
  return (data.results ?? []).sort((a, b) => a.name.localeCompare(b.name))
}

async function loadPrograms() {
  let url = '/api/v2/programs/?limit=100&ordering=name&is_active=true'
  const all = []
  while (url) {
    const resp = await fetch(url)
    if (!resp.ok) break
    const data = await resp.json()
    all.push(...(data.results ?? []))
    url = data.next ? proxyUrl(data.next) : null
  }
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

function buildRows(plays) {
  return plays.map((p) => ({
    time: formatAirdate(p.airdate),
    artist: p.artist ?? '',
    song: p.song ?? '',
    album: p.album ?? '',
    label: (p.labels ?? []).join(', '),
    released: p.release_date ?? '',
    local: p.is_local ? '✓' : '',
    live: p.is_live ? '✓' : '',
    request: p.is_request ? '✓' : '',
    rotation:       p.rotation_status ?? '',
    thumbnail:      p.thumbnail_uri ?? '',
    releaseGroupId: p.release_group_id ?? '',
  }))
}

function toCsv(rows) {
  const headers = ['Time (PT)', 'Artist', 'Song', 'Album', 'Label', 'Released', 'Local', 'Live', 'Request', 'Rotation']
  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`
  return [
    headers.join(','),
    ...rows.map((r) =>
      [r.time, r.artist, r.song, r.album, r.label, r.released, r.local, r.live, r.request, r.rotation]
        .map(escape).join(',')
    ),
  ].join('\n')
}

function downloadCsv(rows, filename) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function ArtImage({ thumbnail, releaseGroupId }) {
  const fallback = releaseGroupId
    ? `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`
    : null
  const initial = thumbnail || fallback
  const [src, setSrc] = useState(initial)
  const [gone, setGone] = useState(!initial)

  if (gone) return null
  return (
    <img
      src={src} alt="" width="40" height="40" loading="lazy"
      onError={() => {
        if (src === thumbnail && fallback) setSrc(fallback)
        else setGone(true)
      }}
    />
  )
}

const ROTATION_STYLE = {
  'Heavy':   { bg: '#2a0a0a', color: '#ff7070', border: '#ff707044' },
  'Medium':  { bg: '#2a1800', color: '#ffaa44', border: '#ffaa4444' },
  'Light':   { bg: '#0a1a0a', color: '#6fcf6f', border: '#6fcf6f44' },
  'Library': { bg: '#0a0f2a', color: '#6699ff', border: '#6699ff44' },
  'R/N':     { bg: '#1a0a2a', color: '#cc88ff', border: '#cc88ff44' },
}

const ROTATION_DESC = {
  'Heavy':   'Major new releases, played most frequently',
  'Medium':  'Played regularly as part of active rotation',
  'Light':   'Played occasionally',
  'R/N':     'Record of Note: a highlighted release hand-picked by staff',
  'Library': 'In the archive, not in active rotation. A deliberate DJ pick.',
}

function Stats({ rows, activeRotation, onRotationClick }) {
  const trackRows = rows.filter(r => r.artist)
  const uniqueArtists = new Set(trackRows.map(r => r.artist)).size
  const countMap = trackRows.reduce((acc, r) => { acc[r.artist] = (acc[r.artist] ?? 0) + 1; return acc }, {})
  const maxCount = Math.max(0, ...Object.values(countMap))
  const hasRepeats = maxCount > 1

  // If artists repeat, rank by play count. Otherwise show in recency order (rows are newest-first).
  const topArtists = hasRepeats
    ? Object.entries(countMap).sort((a, b) => b[1] - a[1]).slice(0, 10)
    : [...new Map(trackRows.map(r => [r.artist, 1])).entries()].slice(0, 10)

  const rotationCounts = trackRows.reduce((acc, r) => {
    if (r.rotation) acc[r.rotation] = (acc[r.rotation] ?? 0) + 1
    return acc
  }, {})
  const rotationOrder = ['Heavy', 'Medium', 'Light', 'Library', 'R/N']
  const rotationEntries = rotationOrder.filter(k => rotationCounts[k])

  return (
    <div className="stats">
      <div className="stats-grid">
        <div className="stat"><span className="stat-num">{trackRows.length}</span><span>Total tracks</span></div>
        <div className="stat"><span className="stat-num">{uniqueArtists}</span><span>Unique artists</span></div>
        <div className="stat"><span className="stat-num">{trackRows.filter(r => r.local).length}</span><span>Local artists</span></div>
        <div className="stat"><span className="stat-num">{trackRows.filter(r => r.live).length}</span><span>Live performances</span></div>
        <div className="stat"><span className="stat-num">{trackRows.filter(r => r.request).length}</span><span>Listener requests</span></div>
      </div>

      {rotationEntries.length > 0 && (
        <div className="rotation-pills">
          {rotationEntries.map(k => {
            const s = ROTATION_STYLE[k] ?? { bg: '#1a1a1a', color: '#888', border: '#44444444' }
            const isActive = activeRotation === k
            return (
              <button
                key={k}
                className={`rotation-pill${isActive ? ' rotation-pill-active' : ''}`}
                style={{ background: s.bg, color: s.color, borderColor: isActive ? s.color : s.border }}
                data-tooltip={ROTATION_DESC[k]}
                onClick={() => onRotationClick(isActive ? null : k)}
              >
                {k} <strong>{rotationCounts[k]}</strong>
              </button>
            )
          })}
        </div>
      )}

      {topArtists.length > 0 && (
        <>
          <h3>{hasRepeats ? 'Top 10 Most-Played Artists' : 'Recently Played'}</h3>
          <ol className="top-artists">
            {topArtists.map(([artist, count]) => (
              <li key={artist}>
                <span className="artist-name">{artist}</span>
                {hasRepeats && <span className="play-count">{count}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

function PlayTable({ rows, csvName }) {
  const [filter, setFilter] = useState('')
  const [activeRotation, setActiveRotation] = useState(null)
  const q = filter.toLowerCase()
  const displayed = rows
    .filter(r => !activeRotation || r.rotation === activeRotation)
    .filter(r => !q || [r.artist, r.song, r.album].some(v => v.toLowerCase().includes(q)))

  return (
    <>
      <div className="results-header">
        <h2>
          {displayed.length !== rows.length
            ? <>{displayed.length} <span className="muted">of {rows.length} tracks</span></>
            : <>{rows.length} tracks</>}
        </h2>
        <div className="results-actions">
          <a
            href="https://www.tunemymusic.com/transfer/csv-to-apple-music"
            target="_blank" rel="noreferrer"
            className="apple-link"
          >
            Turn this CSV into a playlist ↗
          </a>
          <button onClick={() => downloadCsv(rows, csvName)} className="download-btn">Download CSV</button>
        </div>
      </div>

      <div className="filter-bar">
        <input
          type="search"
          className="filter-input"
          placeholder="Filter by artist, song, or album…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      <Stats rows={rows} activeRotation={activeRotation} onRotationClick={setActiveRotation} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="art-th"></th>
              <th>Time (PT)</th><th>Artist</th><th>Song</th><th>Album</th>
              <th>Label</th><th>Released</th><th>Local</th><th>Live</th><th>Req</th><th>Rotation</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((r, i) => (
              <tr key={i}>
                <td className="art-cell">
                  <ArtImage thumbnail={r.thumbnail} releaseGroupId={r.releaseGroupId} />
                </td>
                <td className="nowrap">{r.time}</td>
                <td>{r.artist}</td><td>{r.song}</td><td>{r.album}</td>
                <td>{r.label}</td><td className="nowrap">{r.released}</td>
                <td className="center">{r.local}</td><td className="center">{r.live}</td>
                <td className="center">{r.request}</td><td>{r.rotation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function generateCsvName({ mode, begin, end, selectedHost, programs, selectedProgram }) {
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const timeSlug = hhmm => {
    const h = parseInt(hhmm.slice(0, 2))
    const m = parseInt(hhmm.slice(3, 5))
    if (h === 0  && m === 0)  return 'midnight'
    if (h === 12 && m === 0)  return 'noon'
    const ampm = h >= 12 ? 'pm' : 'am'
    const h12 = h % 12 || 12
    return m === 0 ? `${h12}${ampm}` : `${h12}${String(m).padStart(2, '0')}${ampm}`
  }

  if (mode === 'now') return 'kexp_now_playing'

  if (mode === 'dj' && selectedHost) {
    return `kexp_${slug(selectedHost)}_${begin.slice(0, 10)}_to_${end.slice(0, 10)}`
  }

  if (mode === 'program' && selectedProgram) {
    const prog = programs.find(p => String(p.id) === selectedProgram)
    const name = prog ? slug(prog.name) : 'program'
    return `kexp_${name}_${begin.slice(0, 10)}_to_${end.slice(0, 10)}`
  }

  // window mode
  if (begin) {
    const date = begin.slice(0, 10)
    const t1 = timeSlug(begin.slice(11))
    const t2 = end ? timeSlug(end.slice(11)) : ''
    return t2 ? `kexp_${date}_${t1}_to_${t2}` : `kexp_${date}_${t1}`
  }

  return 'kexp_playlist'
}

const TABS = [
  { id: 'window',  label: 'Time Window' },
  { id: 'dj',     label: 'By DJ' },
  { id: 'program', label: 'By Program' },
  { id: 'now',    label: '▶ Now Playing' },
]

export default function App() {
  const today   = todayPacific()
  const weekAgo = daysAgoPacific(7)

  const [mode, setMode] = useState('now')

  const [begin,   setBegin]   = useState(`${today}T00:00`)
  const [end,     setEnd]     = useState(`${today}T23:59`)
  const [hosts,        setHosts]        = useState([])
  const [hostsLoading, setHostsLoading] = useState(false)
  const [selectedHost, setSelectedHost] = useState('')
  const [djBegin, setDjBegin] = useState(`${weekAgo}T00:00`)
  const [djEnd,   setDjEnd]   = useState(`${today}T23:59`)
  const [programs,        setPrograms]        = useState([])
  const [programsLoading, setProgramsLoading] = useState(false)
  const [selectedProgram, setSelectedProgram] = useState('')
  const [progBegin, setProgBegin] = useState(`${weekAgo}T00:00`)
  const [progEnd,   setProgEnd]   = useState(`${today}T23:59`)

  const [currentShow, setCurrentShow] = useState(null)

  const [csvName, setCsvName] = useState('kexp_playlist')
  const [status,  setStatus]  = useState(null)
  const [rows,    setRows]    = useState(null)
  const [error,   setError]   = useState(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async (params) => {
    setLoading(true); setError(null); setRows(null); setStatus('Starting…')
    try {
      const plays = await fetchAllPlays(params, (page, total) => {
        setStatus(`Fetching page ${page} — ${total} tracks so far…`)
      })
      setRows(buildRows(plays))
      setStatus(null)
    } catch (err) {
      setError(err.message); setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (mode === 'dj' && hosts.length === 0 && !hostsLoading) {
      setHostsLoading(true)
      loadHosts().then(h => {
        setHosts(h)
        if (h.length > 0) setSelectedHost(h[0].name)
        setHostsLoading(false)
      }).catch(() => setHostsLoading(false))
    }
    if (mode === 'program' && programs.length === 0 && !programsLoading) {
      setProgramsLoading(true)
      loadPrograms().then(p => {
        setPrograms(p)
        if (p.length > 0) setSelectedProgram(String(p[0].id))
        setProgramsLoading(false)
      }).catch(() => setProgramsLoading(false))
    }
    if (mode === 'now') {
      run({ beginDate: new Date(Date.now() - 3_600_000), endDate: new Date() })
      fetchCurrentShow().then(setCurrentShow)
    }
  }, [mode])

  useEffect(() => {
    const b = mode === 'window' ? begin : mode === 'dj' ? djBegin : progBegin
    const e = mode === 'window' ? end   : mode === 'dj' ? djEnd   : progEnd
    setCsvName(generateCsvName({ mode, begin: b, end: e, selectedHost, programs, selectedProgram }))
  }, [mode, begin, end, djBegin, djEnd, progBegin, progEnd, selectedHost, selectedProgram, programs])

  function switchTab(id) {
    setMode(id); setRows(null); setError(null); setStatus(null)
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (mode === 'window') run({ beginDate: pacificLocalToDate(begin), endDate: pacificLocalToDate(end) })
    if (mode === 'dj')     run({ beginDate: pacificLocalToDate(djBegin), endDate: pacificLocalToDate(djEnd), hostName: selectedHost })
    if (mode === 'program') run({ beginDate: pacificLocalToDate(progBegin), endDate: pacificLocalToDate(progEnd), programId: selectedProgram })
  }

  const curBegin = mode === 'window' ? begin : mode === 'dj' ? djBegin : progBegin
  const curEnd   = mode === 'window' ? end   : mode === 'dj' ? djEnd   : progEnd
  const setcurBegin = mode === 'window' ? setBegin : mode === 'dj' ? setDjBegin : setProgBegin
  const setcurEnd   = mode === 'window' ? setEnd   : mode === 'dj' ? setDjEnd   : setProgEnd

  return (
    <div className="app">
      <header>
        <div className="header-top">
          <div className="header-brand">
            <img
              src="https://www.kexp.org/static/assets/img/logo-header.svg"
              alt="KEXP" className="kexp-logo"
            />
            <div>
              <span className="header-subtitle">Playlist Fetcher</span>
              <p>All times are Pacific (KEXP's timezone)</p>
            </div>
          </div>
          <a href="https://www.kexp.org/donate/" target="_blank" rel="noreferrer" className="donate-link">
            ♥ Donate to KEXP
          </a>
        </div>
      </header>

      <div className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={`tab${mode === t.id ? ' active' : ''}`} onClick={() => switchTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {mode === 'now' ? (
        <div className="now-panel">
          {currentShow && (
            <div className="now-show">
              <span className="now-show-program">{currentShow.program_name}</span>
              {currentShow.host_names?.length > 0 && (
                <span className="now-show-hosts">with {currentShow.host_names.join(' & ')}</span>
              )}
            </div>
          )}
          <div className="now-controls">
            <span className="now-label">Last hour of plays on KEXP</span>
            <div className="field">
              <label>CSV Filename</label>
              <input type="text" value={csvName} onChange={e => setCsvName(e.target.value)} placeholder="kexp_now" />
            </div>
            <button
              onClick={() => {
                run({ beginDate: new Date(Date.now() - 3_600_000), endDate: new Date() })
                fetchCurrentShow().then(setCurrentShow)
              }}
              disabled={loading}
              className="refresh-btn"
            >
              {loading ? 'Fetching…' : '↺ Refresh'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="form">
          {mode === 'dj' && (
            <div className="field">
              <label>DJ / Host</label>
              {hostsLoading
                ? <span className="muted">Loading hosts…</span>
                : <select className="select" value={selectedHost} onChange={e => setSelectedHost(e.target.value)}>
                    {hosts.map(h => <option key={h.id} value={h.name}>{h.name}</option>)}
                  </select>
              }
            </div>
          )}
          {mode === 'program' && (
            <div className="field">
              <label>Program</label>
              {programsLoading
                ? <span className="muted">Loading programs…</span>
                : <select className="select" value={selectedProgram} onChange={e => setSelectedProgram(e.target.value)}>
                    {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
              }
            </div>
          )}
          <div className="field">
            <label>Start</label>
            <input type="datetime-local" value={curBegin} onChange={e => setcurBegin(e.target.value)} required />
          </div>
          <div className="field">
            <label>End</label>
            <input type="datetime-local" value={curEnd} onChange={e => setcurEnd(e.target.value)} required />
          </div>
          <div className="field">
            <label>CSV Filename</label>
            <input type="text" value={csvName} onChange={e => setCsvName(e.target.value)} placeholder="kexp_playlist" required />
          </div>
          <button type="submit" disabled={loading}>{loading ? 'Fetching…' : 'Fetch Playlist'}</button>
        </form>
      )}

      {status && <p className="status">{status}</p>}
      {error  && <p className="error">Error: {error}</p>}
      {rows   && <PlayTable rows={rows} csvName={csvName} />}
    </div>
  )
}
