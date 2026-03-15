/**
 * nbaStatsService.js
 *
 * Handles all HTTP communication with the NBA stats proxy worker.
 * Results are cached in memory to avoid redundant network requests:
 *   - Player ID list is fetched once per page load
 *   - Game logs are cached per player name for 1 hour
 *
 * Exports:
 *   - fetchPlayerGameLogs(playerName) → game log rows for a single player
 */

const WORKER = 'https://round-rain-9e80.vinipaio.workers.dev'
const SEASON = '2025-26'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Alias table: maps common name variations to the canonical NBA.com display name.
 * Used for fuzzy matching when the exact name doesn't appear in the API roster.
 */
const PLAYER_ALIASES = {
  'pj washington': 'p.j. washington',
  'p.j. washington': 'p.j. washington',
  'ron holland ii': 'ronald holland ii',
  'ron holland': 'ronald holland ii',
  'og anunoby': 'o.g. anunoby',
  'bones hyland': 'bones hyland',
  'nic claxton': 'nicolas claxton',
  'nicolas claxton': 'nicolas claxton',
  'gary trent jr': 'gary trent jr.',
  'gary trent jr.': 'gary trent jr.',
  'wendell carter jr': 'wendell carter jr.',
  'jabari smith jr': 'jabari smith jr.',
  'jabari smith jr.': 'jabari smith jr.',
  'kenyon martin jr': 'kenyon martin jr.',
  'larry nance jr': 'larry nance jr.',
  'kelly oubre jr': 'kelly oubre jr.',
  'aj griffin': 'a.j. griffin',
  'rj barrett': 'r.j. barrett',
  'tj mcconnell': 't.j. mcconnell',
  'cj mccollum': 'c.j. mccollum',
}

// --- In-memory caches (module-level singletons) ---

/** @type {object|null} Full NBA player list, fetched once */
let allPlayersCache = null

/** @type {Record<string, number>} playerName → PERSON_ID */
const playerIdCache = {}

/**
 * @type {Record<string, { logs: Array, ts: number }>}
 * playerName → { logs, timestamp }
 */
const gameLogCache = {}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fetches the full NBA player list from the proxy and caches it.
 * Subsequent calls return the cached value immediately.
 *
 * @returns {Promise<object>} Raw NBA commonallplayers response
 */
async function fetchAllPlayers() {
  if (allPlayersCache) return allPlayersCache
  const res = await fetch(
    `${WORKER}/nba/commonallplayers?LeagueID=00&Season=${SEASON}&IsOnlyCurrentSeason=0`,
  )
  if (!res.ok) throw new Error(`NBA players list error: ${res.status}`)
  allPlayersCache = await res.json()
  return allPlayersCache
}

/**
 * Resolves a player display name to their NBA PERSON_ID.
 * First checks the alias table, then does exact match, then word-by-word fuzzy
 * match against the full roster.
 *
 * @param {string} name - Player display name as seen in the JSON exports (e.g. "LeBron James")
 * @returns {Promise<number|null>} PERSON_ID, or null if no match found
 */
async function fetchNBAPlayerID(name) {
  const normalizedInput = name.toLowerCase().trim()
  const lookupName = PLAYER_ALIASES[normalizedInput] || normalizedInput

  if (playerIdCache[lookupName] !== undefined) return playerIdCache[lookupName]

  try {
    const data = await fetchAllPlayers()
    const headers = data.resultSets[0].headers
    const rows = data.resultSets[0].rowSet
    const idIdx = headers.indexOf('PERSON_ID')
    const nameIdx = headers.indexOf('DISPLAY_FIRST_LAST')

    // 1. Exact match
    let match = rows.find((row) => row[nameIdx].toLowerCase() === lookupName)

    // 2. Word-by-word partial match (handles initials like "P.J." vs "PJ")
    if (!match) {
      const parts = lookupName.split(' ')
      match = rows.find((row) => {
        const rowName = row[nameIdx].toLowerCase()
        return parts.every((part) => rowName.includes(part))
      })
    }

    if (!match) {
      console.warn(`[nbaStatsService] Player not found: "${name}"`)
      playerIdCache[lookupName] = null
      return null
    }

    playerIdCache[lookupName] = match[idIdx]
    return match[idIdx]
  } catch (error) {
    console.error('[nbaStatsService] fetchNBAPlayerID error:', error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches the current season game log for a player, normalised to the shape:
 * `{ pts, reb, ast, fg3 }` per game.
 *
 * Results are cached for CACHE_TTL_MS (1 hour). Returns null on any error
 * so callers can gracefully skip enrichment.
 *
 * @param {string} playerName - Human-readable player name
 * @returns {Promise<Array<{pts:number, reb:number, ast:number, fg3:number}>|null>}
 */
export async function fetchPlayerGameLogs(playerName) {
  const cached = gameLogCache[playerName]
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.logs

  try {
    const playerId = await fetchNBAPlayerID(playerName)
    if (!playerId) return null

    const res = await fetch(
      `${WORKER}/nba/playergamelog?PlayerID=${playerId}&Season=${SEASON}` +
        `&SeasonType=Regular%20Season&PerMode=PerGame`,
    )
    if (!res.ok) throw new Error(`Game log error: ${res.status}`)

    const data = await res.json()
    const headers = data.resultSets[0].headers
    const rows = data.resultSets[0].rowSet

    const idx = {
      pts: headers.indexOf('PTS'),
      reb: headers.indexOf('REB'),
      ast: headers.indexOf('AST'),
      fg3:
        headers.indexOf('FG3M') !== -1 ? headers.indexOf('FG3M') : headers.indexOf('FG3_M'),
    }

    const logs = rows.map((row) => ({
      pts: row[idx.pts] ?? 0,
      reb: row[idx.reb] ?? 0,
      ast: row[idx.ast] ?? 0,
      fg3: idx.fg3 !== -1 ? (row[idx.fg3] ?? 0) : 0,
    }))

    gameLogCache[playerName] = { logs, ts: Date.now() }
    return logs
  } catch (error) {
    console.error('[nbaStatsService] fetchPlayerGameLogs error:', playerName, error)
    return null
  }
}
