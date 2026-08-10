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
  from.setHours(from.getHours() - 8)
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

function RampIllustration({ band }) {
  return (
    <div className={`ramp-scene ${band.key}`} aria-label={`Ramp illustration: ${band.short}`}>
      <div className="moon" />
      <div className="cloud cloud-one" /><div className="cloud cloud-two" />
      <div className="dock"><span /><span /><span /><span /></div>
      <div className="ramp"><i /><i /><i /><i /><i /><i /></div>
      <div className="water"><div /><div /><div /></div>
      <div className="boat"><span className="mast" /><span className="sail" /><span className="hull">MANANA</span></div>
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
            <RampIllustration band={currentBand} />
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
          <div className="tide-events">
            {selected.map((point, index) => {
              const isHigh = index === 0 ? point.height > (selected[1]?.height ?? point.height) : point.height > selected[index - 1].height
              const band = bandFor(point.height)
              return <article key={point.date.toISOString()}><div className={`event-icon ${band.key}`}>{isHigh ? '↟' : '↡'}</div><div><span>{isHigh ? 'High tide' : 'Low tide'}</span><strong>{timeLabel(point.date)}</strong></div><b>{point.height.toFixed(1)} <small>m</small></b><em className={band.key}>{band.short}</em></article>
            })}
            {!selected.length && !loading && <p className="empty">No tide events returned for this day.</p>}
          </div>
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
