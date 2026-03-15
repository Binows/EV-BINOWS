/**
 * oddsService.js
 *
 * Low-level HTTP client for The Odds API, proxied through the Cloudflare Worker.
 * Responsible only for fetching raw data — no EV/Kelly math happens here.
 *
 * Exports:
 *   - fetchNBAEvents()        → upcoming NBA games (next 4)
 *   - fetchEventOdds(id)      → Over lines for a single game across bookmakers
 */

const WORKER = 'https://round-rain-9e80.vinipaio.workers.dev'
const BASE = `${WORKER}/odds`
const SPORT = 'basketball_nba'
const MARKETS = 'player_points,player_rebounds,player_assists'
const BOOKS = 'pinnacle,draftkings,fanduel'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches all upcoming NBA events from The Odds API.
 * Returns events that have not started yet, limited to the next 4 games.
 *
 * @returns {Promise<Array>} List of NBA event objects `{ id, away_team, home_team, commence_time }`
 */
export async function fetchNBAEvents() {
  const res = await fetch(`${BASE}/sports/${SPORT}/events`)
  if (!res.ok) throw new Error(`Events API error: ${res.status}`)

  const events = await res.json()
  if (!Array.isArray(events)) return []

  const now = new Date()
  return events.filter((event) => new Date(event.commence_time) > now).slice(0, 4)
}

/**
 * Fetches Over player prop lines for a single game across the configured bookmakers.
 *
 * @param {string} eventId - NBA.com / Odds API event ID
 * @returns {Promise<{ bookmakers: Array, remainingRequests: string }>}
 *   `bookmakers` matches the shape returned by The Odds API.
 *   `remainingRequests` is the x-requests-remaining header value (or empty string).
 */
export async function fetchEventOdds(eventId) {
  const url =
    `${BASE}/sports/${SPORT}/events/${eventId}/odds` +
    `?regions=us&markets=${MARKETS}&bookmakers=${BOOKS}&oddsFormat=american`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Odds API error for event ${eventId}: ${res.status}`)

  const data = await res.json()
  const remainingRequests = res.headers.get('x-requests-remaining') || ''

  return {
    bookmakers: data.bookmakers || [],
    remainingRequests,
  }
}
