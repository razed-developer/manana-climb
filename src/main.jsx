import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Anchor, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, RefreshCw, TriangleAlert } from 'lucide-react'
import './styles.css'

const STATION_CODE = '07460'
const API_BASES = ['https://api-sine.dfo-mpo.gc.ca', 'https://api-iwls.dfo-mpo.gc.ca']
const TZ = 'America/Vancouver'

const bandFor = (height) => {
  if (height >= 3) return { key: 'fair', label: 'Fair winds', short: 'Good angle', note: 'A gentler climb for most visitors.' }
  if (height > 1.8) return { key: 'care', label: 'Mind yer step', short: 'Getting steep', note: 'Usable, but the ramp is increasingly steep.' }
  return { key: 'steep', label: 'Abandon climb', short: 'Very steep', note: 'The ramp is at its steepest. Wait for more water if you can.' }
}

const dtf = (options) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, ...options })
const localDayKey = (date) => dtf({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
const dayLabel = (date) => dtf({ weekday: 'long', month: 'short', day: 'numeric' }).format(date)
const timeLabel = (date) => dtf({ hour: 'numeric', minute: '2-digit' }).format(date)
const minuteOfDay = (date) => {
  const parts = dtf({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0) % 24
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

async function apiGet(path) {
  let lastError
  for (const base of API_BASES) {
    try {
      const response = await fetch(`${base}${path}`)
      if (!response.ok) throw new Error(`Tide service returned ${response.status}`)
      return await response.json()
    } catch (error) { lastError = error }
  }
  throw lastError
}

function unwrap(payload) {
  if (Array.isArray(payload)) return payload
  return payload?.data ?? payload?.items ?? payload?.stations ?? []
}

async function getTides() {
  const stationPayload = await apiGet(`/api/v1/stations?code=${STATION_CODE}`)
  const station = unwrap(stationPayload)[0]
  if (!station?.id) throw new Error('Ladysmith tide station was not found')

  const from = new Date()
  from.setHours(from.getHours() - 14)
  const to = new Date(from)
  to.setDate(to.getDate() + 15)
  const params = new URLSearchParams({
    'time-series-code': 'wlp-hilo',
    from: from.toISOString(),
    to: to.toISOString()
  })
  const payload = await apiGet(`/api/v1/stations/${station.id}/data?${params}`)
  return unwrap(payload)
    .map((point) => ({ date: new Date(point.eventDate ?? point.date), height: Number(point.value) }))
    .filter((point) => Number.isFinite(point.height) && !Number.isNaN(point.date.valueOf()))
    .sort((a, b) => a.date - b.date)
}

function interpolateHeight(points, now) {
  const nextIndex = points.findIndex((p) => p.date >= now)
  if (nextIndex < 1) return points[Math.max(0, nextIndex)]?.height
  const prev = points[nextIndex - 1]
  const next = points[nextIndex]
  const progress = (now - prev.date) / (next.date - prev.date)
  const eased = (1 - Math.cos(Math.PI * progress)) / 2
  return prev.height + (next.height - prev.height) * eased
}

function AccessibilityTimeline({ points, now }) {
  const timeline = useMemo(() => {
    if (!points.length) return []
    const start = new Date(now.getTime() - 12 * 60 * 60 * 1000)
    start.setMinutes(0, 0, 0)
    return Array.from({ length: 72 }, (_, index) => {
      const date = new Date(start.getTime() + index * 30 * 60 * 1000)
      const height = interpolateHeight(points, date)
      return { date, height, band: bandFor(height ?? 0) }
    })
  }, [points, now])

  const labels = timeline.filter((_, index) => index % 12 === 0)

  return (
    <div className="accessibility-timeline">
      <div className="timeline-heading">
        <div><span className="status-kicker">36-hour gangway outlook</span><h3>When is the ramp most accessible?</h3></div>
        <span className="timeline-range">Past 12 hours <ArrowRight size={14} /> Next 24 hours</span>
      </div>
      <div className="timeline-wrap">
        <div className="timeline-now" aria-hidden="true"><span>Now</span></div>
        <div className="timeline-bands" role="img" aria-label="Ramp accessibility by half hour for the previous 12 hours and next 24 hours">
          {timeline.map(({ date, height, band }) => <i key={date.toISOString()} className={band.key} title={`${dayLabel(date)}, ${timeLabel(date)}: ${height?.toFixed(1) ?? '—'} m — ${band.short}`} />)}
        </div>
        <div className="timeline-labels">{labels.map(({ date }) => <span key={date.toISOString()}>{timeLabel(date)}</span>)}</div>
      </div>
      <div className="timeline-legend"><span><i className="fair" /> Most accessible</span><span><i className="care" /> Steep</span><span><i className="steep" /> Very steep</span></div>
    </div>
  )
}

function TideGraph({ day, points, now }) {
  const chart = useMemo(() => {
    if (!day.length || !points.length) return null
    const key = localDayKey(day[0].date)
    const anchor = day[0].date
    const start = new Date(anchor.getTime() - minuteOfDay(anchor) * 60 * 1000)
    const samples = Array.from({ length: 97 }, (_, index) => {
      const minutes = index * 15
      const date = new Date(start.getTime() + minutes * 60 * 1000)
      return { minutes, date, height: interpolateHeight(points, date) ?? 0 }
    })
    const maxHeight = Math.max(4, ...samples.map((sample) => sample.height))
    const x = (minutes) => 54 + (minutes / 1440) * 892
    const y = (height) => 282 - (height / maxHeight) * 232
    const path = samples.map((sample, index) => `${index ? 'L' : 'M'} ${x(sample.minutes).toFixed(1)} ${y(sample.height).toFixed(1)}`).join(' ')
    const area = `${path} L 946 282 L 54 282 Z`
    const events = day.map((point, index) => ({
      ...point,
      minutes: minuteOfDay(point.date),
      isHigh: point.height > (day[index - 1]?.height ?? day[index + 1]?.height ?? point.height)
    }))
    const nowMinutes = localDayKey(now) === key ? minuteOfDay(now) : null
    return { path, area, events, x, y, maxHeight, nowMinutes }
  }, [day, points, now])

  if (!chart) return <p className="empty">No tide events returned for this day.</p>

  const yThree = chart.y(3)
  const yCare = chart.y(1.8)

  return (
    <div className="tide-graph-wrap">
      <svg className="tide-graph" viewBox="0 0 1000 360" role="img" aria-label="Tide height curve with marked high and low tides across the selected day">
        <defs>
          <linearGradient id="tide-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#168e88" stopOpacity=".34" /><stop offset="1" stopColor="#168e88" stopOpacity=".04" /></linearGradient>
          <filter id="marker-shadow"><feDropShadow dx="0" dy="3" stdDeviation="3" floodOpacity=".18" /></filter>
        </defs>
        <rect x="54" y="50" width="892" height={Math.max(0, yThree - 50)} className="graph-zone fair" />
        <rect x="54" y={yThree} width="892" height={Math.max(0, yCare - yThree)} className="graph-zone care" />
        <rect x="54" y={yCare} width="892" height={282 - yCare} className="graph-zone steep" />
        {[0, 1.8, 3].map((height) => <g key={height}><line x1="54" x2="946" y1={chart.y(height)} y2={chart.y(height)} className="graph-grid" /><text x="44" y={chart.y(height) + 4} textAnchor="end" className="graph-y-label">{height}m</text></g>)}
        {[0, 240, 480, 720, 960, 1200, 1440].map((minutes) => <g key={minutes}><line x1={chart.x(minutes)} x2={chart.x(minutes)} y1="50" y2="282" className="graph-grid vertical" /><text x={chart.x(minutes)} y="315" textAnchor="middle" className="graph-time">{minutes === 1440 ? '12 AM' : timeLabel(new Date(day[0].date.getTime() + (minutes - minuteOfDay(day[0].date)) * 60000))}</text></g>)}
        <path d={chart.area} fill="url(#tide-water)" />
        <path d={chart.path} className="tide-curve" />
        {chart.nowMinutes !== null && <g><line x1={chart.x(chart.nowMinutes)} x2={chart.x(chart.nowMinutes)} y1="43" y2="288" className="graph-now" /><text x={chart.x(chart.nowMinutes)} y="36" textAnchor="middle" className="graph-now-label">NOW</text></g>}
        {chart.events.map((event) => {
          const cx = chart.x(event.minutes); const cy = chart.y(event.height)
          return <g key={event.date.toISOString()} className="tide-marker" filter="url(#marker-shadow)"><line x1={cx} x2={cx} y1={cy} y2={event.isHigh ? cy - 27 : cy + 27} /><circle cx={cx} cy={cy} r="7" /><rect x={cx - 43} y={event.isHigh ? cy - 67 : cy + 27} width="86" height="38" rx="9" /><text x={cx} y={event.isHigh ? cy - 51 : cy + 43} textAnchor="middle">{event.isHigh ? 'HIGH' : 'LOW'} · {event.height.toFixed(1)}m</text><text x={cx} y={event.isHigh ? cy - 39 : cy + 55} textAnchor="middle" className="marker-time">{timeLabel(event.date)}</text></g>
        })}
      </svg>
      <div className="graph-key"><span><i className="fair" /> Good angle</span><span><i className="care" /> Getting steep</span><span><i className="steep" /> Very steep</span></div>
    </div>
  )
}

function App() {
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDay, setSelectedDay] = useState(0)
  const [now, setNow] = useState(new Date())

  const load = async () => {
    setLoading(true); setError('')
    try { setPoints(await getTides()) }
    catch (err) { setError(err.message || 'The tide messenger got lost at sea.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer) }, [])

  const currentHeight = interpolateHeight(points, now)
  const currentBand = bandFor(currentHeight ?? 2.4)
  const future = points.filter((point) => point.date >= now)
  const nextTurn = future[0]
  const nextGood = future.find((point) => point.height >= 3)

  const days = useMemo(() => {
    const map = new Map()
    points.forEach((point) => {
      const key = localDayKey(point.date)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(point)
    })
    return [...map.values()].filter((day) => day.some((p) => p.date >= now)).slice(0, 14)
  }, [points, now])

  const selected = days[selectedDay] ?? []
  const selectedDate = selected[0]?.date

  return (
    <main>
      <header className="nav-shell">
        <a className="brand" href="#top"><span><Anchor size={23} strokeWidth={2.4} /></span><b>Manana Climb</b></a>
        <a className="about-link" href="#how">How it works</a>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span /> Manana Resort & Marina · Ladysmith, BC</div>
        <h1>Will ye conquer<br />the <em>gangway?</em></h1>
        <p className="lede">The tide decides the climb. Check the marina ramp before you make the trek ashore.</p>

        {error ? (
          <div className="error-card"><TriangleAlert /><div><b>Tide signal lost</b><p>{error}. Try again in a moment.</p></div><button onClick={load}><RefreshCw size={16} /> Retry</button></div>
        ) : (
          <div className={`status-card ${currentBand.key}`}>
            <div className="status-copy">
              <span className="status-kicker">Right now</span>
              <h2>{loading ? 'Reading the tides…' : currentBand.label}</h2>
              <p>{loading ? 'A message is coming in from Ladysmith Harbour.' : currentBand.note}</p>
              <div className="status-meta">
                <span><b>{currentHeight?.toFixed(1) ?? '—'} m</b> estimated tide height</span>
                {nextTurn && <span><Clock3 size={15} /> {nextTurn.height > (currentHeight ?? 0) ? 'High' : 'Low'} {timeLabel(nextTurn.date)} · {nextTurn.height.toFixed(1)} m</span>}
              </div>
              {nextGood && currentBand.key !== 'fair' && <div className="next-good"><span>Next fair passage</span><b>{dayLabel(nextGood.date)} at {timeLabel(nextGood.date)}</b><ArrowRight size={18} /></div>}
            </div>
            {!loading && <AccessibilityTimeline points={points} now={now} />}
          </div>
        )}
      </section>

      <section className="forecast-shell">
        <div className="section-heading"><div><span className="eyebrow"><span /> Captain’s forecast</span><h2>Plan yer crossing</h2><p>Choose a day to see the high and low tides.</p></div><CalendarDays size={34} /></div>

        <div className="day-strip">
          <button className="strip-arrow" onClick={() => setSelectedDay(Math.max(0, selectedDay - 1))} disabled={!selectedDay} aria-label="Previous day"><ChevronLeft /></button>
          <div className="day-buttons">
            {days.slice(Math.max(0, selectedDay - 2), Math.max(0, selectedDay - 2) + 5).map((day) => {
              const index = days.indexOf(day)
              const best = Math.max(...day.map((p) => p.height))
              const band = bandFor(best)
              return <button key={localDayKey(day[0].date)} className={index === selectedDay ? 'active' : ''} onClick={() => setSelectedDay(index)}><span>{index === 0 ? 'Today' : dtf({ weekday: 'short' }).format(day[0].date)}</span><b>{dtf({ month: 'short', day: 'numeric' }).format(day[0].date)}</b><i className={band.key}>{band.key === 'fair' ? 'Fair window' : band.key === 'care' ? 'Use care' : 'Very steep'}</i></button>
            })}
          </div>
          <button className="strip-arrow" onClick={() => setSelectedDay(Math.min(days.length - 1, selectedDay + 1))} disabled={selectedDay >= days.length - 1} aria-label="Next day"><ChevronRight /></button>
        </div>

        <div className="tide-card">
          <div className="tide-title"><div><span>{selectedDate ? dayLabel(selectedDate) : 'Loading forecast…'}</span>{selectedDay >= 7 && <small>Long-range prediction</small>}</div><span className="legend"><i className="fair" /> Good <i className="care" /> Steep <i className="steep" /> Very steep</span></div>
          <TideGraph day={selected} points={points} now={now} />
        </div>
      </section>

      <section className="how" id="how">
        <div><span className="eyebrow"><span /> Read the colours</span><h2>How steep is steep?</h2><p>The water level changes the angle of the marina’s long ramp. More water means a gentler walk.</p></div>
        <div className="bands">
          <article className="fair"><b>3.0 m +</b><h3>Fair winds</h3><p>Favourable angle</p></article>
          <article className="care"><b>Over 1.8–under 3.0 m</b><h3>Mind yer step</h3><p>Increasingly steep</p></article>
          <article className="steep"><b>1.8 m or less</b><h3>Abandon climb</h3><p>Steepest angle</p></article>
        </div>
      </section>

      <footer><Anchor size={18} /><p>Predictions from the Canadian Hydrographic Service, Ladysmith station 07460. Conditions and accessibility can vary—use your own judgement at the ramp.</p></footer>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
