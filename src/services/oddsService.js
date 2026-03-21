/**
 * oddsService.js
 */

const WORKER  = 'https://round-rain-9e80.vinipaio.workers.dev'
const BASE    = `${WORKER}/odds`
const B365    = `${WORKER}/b365`
const SPORT   = 'basketball_nba'
const MARKETS = 'player_points,player_rebounds,player_assists'
const BOOKS   = 'pinnacle,draftkings,fanduel'

const CACHE_TTL_EVENTS = 15 * 60 * 1000
const CACHE_TTL_ODDS   = 10 * 60 * 1000

const cache = {
  nbaEvents:  { data: null, ts: 0 },
  b365Events: { data: null, ts: 0 },
  b365Odds:   {},
  eventOdds:  {},
}

function isFresh(ts, ttl) {
  return ts > 0 && Date.now() - ts < ttl
}

// ---------------------------------------------------------------------------
// The Odds API
// ---------------------------------------------------------------------------

export async function fetchNBAEvents() {
  if (isFresh(cache.nbaEvents.ts, CACHE_TTL_EVENTS) && cache.nbaEvents.data?.length) {
    return cache.nbaEvents.data
  }
  const res = await fetch(`${BASE}/sports/${SPORT}/events`)
  if (!res.ok) throw new Error(`Events API error: ${res.status}`)
  const events = await res.json()
  if (!Array.isArray(events)) return []
  const now = new Date()
  const filtered = events.filter((e) => new Date(e.commence_time) > now).slice(0, 8)
  if (filtered.length) cache.nbaEvents = { data: filtered, ts: Date.now() }
  return filtered
}

export async function fetchEventOdds(eventId) {
  if (isFresh(cache.eventOdds[eventId]?.ts, CACHE_TTL_ODDS)) {
    return cache.eventOdds[eventId].data
  }
  const url =
    `${BASE}/sports/${SPORT}/odds` +
    `?regions=us&markets=${MARKETS}&bookmakers=${BOOKS}&oddsFormat=american&eventIds=${eventId}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Odds API error for event ${eventId}: ${res.status}`)
  const data = await res.json()
  const remainingRequests = res.headers.get('x-requests-remaining') || ''
  const event = Array.isArray(data) ? data.find((e) => e.id === eventId) : data
  const result = { bookmakers: event?.bookmakers || [], remainingRequests }
  cache.eventOdds[eventId] = { data: result, ts: Date.now() }
  return result
}

// ---------------------------------------------------------------------------
// odds-api.io — bet365 props
// ---------------------------------------------------------------------------

const B365_MARKET_MAP = {
  'Points O/U':                     'player_points',
  'Rebounds O/U':                   'player_rebounds',
  'Assists O/U':                    'player_assists',
  'Threes Made O/U':                'player_threes',
  'Steals O/U':                     'player_steals',
  'Blocks O/U':                     'player_blocks',
  'Steals & Blocks O/U':            'player_steals_blocks',
  'Field Goals Made O/U':           'player_field_goals',
  'Points, Assists & Rebounds O/U': 'player_points_rebounds_assists',
  'Points & Rebounds O/U':          'player_points_rebounds',
  'Points & Assists O/U':           'player_points_assists',
  'Assists & Rebounds O/U':         'player_rebounds_assists',
  'Double Double':                  'player_double_double',
  'Triple Double':                  'player_triple_double',
  'Player Points Milestones':       'player_points_milestones',
  'Player Rebounds Milestones':     'player_rebounds_milestones',
  'Player Assists Milestones':      'player_assists_milestones',
  'Player Threes Milestones':       'player_threes_milestones',
}

const OU_MARKETS = new Set([
  'player_points', 'player_rebounds', 'player_assists', 'player_threes',
  'player_steals', 'player_blocks', 'player_steals_blocks', 'player_field_goals',
  'player_points_rebounds_assists', 'player_points_rebounds',
  'player_points_assists', 'player_rebounds_assists',
])

const BINARY_MARKETS = new Set([
  'player_double_double', 'player_triple_double',
])

const MILESTONE_MARKETS = new Set([
  'player_points_milestones', 'player_rebounds_milestones',
  'player_assists_milestones', 'player_threes_milestones',
])

async function fetchBet365NBAEvents() {
  if (isFresh(cache.b365Events.ts, CACHE_TTL_EVENTS) && cache.b365Events.data?.length) {
    return cache.b365Events.data
  }
  const url = `${B365}/events?sport=basketball&league=usa-nba&status=pending&limit=8`
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    const events = Array.isArray(data) ? data : []
    if (events.length) cache.b365Events = { data: events, ts: Date.now() }
    return events
  } catch {
    return []
  }
}

async function fetchBet365Odds(eventId) {
  if (isFresh(cache.b365Odds[eventId]?.ts, CACHE_TTL_ODDS) && cache.b365Odds[eventId]?.data) {
    return cache.b365Odds[eventId].data
  }
  const url = `${B365}/odds?eventId=${eventId}&bookmakers=Bet365`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    if (data) cache.b365Odds[eventId] = { data, ts: Date.now() }
    return data
  } catch {
    return null
  }
}

function normalizeOU(market, key) {
  const outcomes = []
  for (const prop of market.odds || []) {
    if (!prop.label || prop.hdp == null) continue
    const playerName = prop.label.replace(/\s*\(\d+\)\s*\([\d.]+\)\s*$/, '').trim()
    if (prop.over)  outcomes.push({ description: playerName, name: 'Over',  point: prop.hdp, price: parseFloat(prop.over) })
    if (prop.under) outcomes.push({ description: playerName, name: 'Under', point: prop.hdp, price: parseFloat(prop.under) })
  }
  return outcomes.length ? { key, outcomes } : null
}

/**
 * Normaliza mercados binários DD/TD da bet365.
 *
 * Formato real observado:
 * {"label":"Jalen Duren (Yes) (1)","under":"1.34"}
 * {"label":"Jalen Duren (No) (1)","over":"5.00"}
 *
 * - label com "(Yes)" → é o Over (Sim)
 * - label com "(No)"  → é o Under (Não)
 * - o campo da odd é invertido: Yes usa "under", No usa "over"
 */
function normalizeBinary(market, key) {
  const playerOdds = {}

  for (const prop of market.odds || []) {
    if (!prop.label) continue

    // Extrai nome limpo e tipo (Yes/No)
    const isYes = prop.label.includes('(Yes)')
    const isNo  = prop.label.includes('(No)')
    if (!isYes && !isNo) continue

    // Remove sufixos: "(Yes) (1)", "(No) (1)", etc.
    const playerName = prop.label
      .replace(/\s*\((Yes|No)\)\s*/gi, '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .trim()

    if (!playerOdds[playerName]) playerOdds[playerName] = {}

    if (isYes) {
      // Yes usa campo "under" na API (invertido)
      const odd = prop.under || prop.over || prop.odds
      if (odd) playerOdds[playerName].yes = parseFloat(odd)
    } else {
      // No usa campo "over" na API (invertido)
      const odd = prop.over || prop.under || prop.odds
      if (odd) playerOdds[playerName].no = parseFloat(odd)
    }
  }

  const outcomes = []
  for (const [playerName, odds] of Object.entries(playerOdds)) {
    if (odds.yes) outcomes.push({ description: playerName, name: 'Over',  point: 0.5, price: odds.yes })
    if (odds.no)  outcomes.push({ description: playerName, name: 'Under', point: 0.5, price: odds.no })
  }

  return outcomes.length ? { key, outcomes } : null
}

function normalizeMilestone(market, key) {
  const outcomes = []
  for (const prop of market.odds || []) {
    if (!prop.label) continue
    const point = prop.hdp ?? prop.line ?? null
    if (point == null) continue
    const playerName = prop.label.replace(/\s*\(\d+\)\s*\([\d.]+\)\s*$/, '').trim()
    if (prop.over)  outcomes.push({ description: playerName, name: 'Over',  point, price: parseFloat(prop.over) })
    if (prop.under) outcomes.push({ description: playerName, name: 'Under', point, price: parseFloat(prop.under) })
  }
  return outcomes.length ? { key, outcomes } : null
}

function normalizeBet365(raw, homeTeam, awayTeam) {
  if (!raw?.bookmakers?.['Bet365']) return null
  const bet365 = raw.bookmakers['Bet365']
  const markets = []
  for (const market of bet365) {
    const key = B365_MARKET_MAP[market.name]
    if (!key) continue
    let normalized = null
    if (OU_MARKETS.has(key))             normalized = normalizeOU(market, key)
    else if (BINARY_MARKETS.has(key))    normalized = normalizeBinary(market, key)
    else if (MILESTONE_MARKETS.has(key)) normalized = normalizeMilestone(market, key)
    if (normalized) markets.push(normalized)
  }
  if (!markets.length) return null
  return {
    homeTeam,
    awayTeam,
    bookmakers: [{ key: 'bet365', isDecimal: true, markets }],
  }
}

export async function fetchBet365Props() {
  const events = await fetchBet365NBAEvents()
  if (!events.length) return []
  const results = []
  for (const event of events) {
    const raw = await fetchBet365Odds(event.id)
    if (!raw) continue
    const normalized = normalizeBet365(raw, event.home, event.away)
    if (normalized) results.push(normalized)
  }
  return results
}
