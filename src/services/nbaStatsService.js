/**
 * nbaStatsService.js
 */

const WORKER = 'https://round-rain-9e80.vinipaio.workers.dev'
const SEASON = '2025-26'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
const FETCH_TIMEOUT = 5000 // 5 segundos — evita travar quando NBA Stats estiver fora

const PLAYER_ALIASES = {
  // Iniciais
  'pj washington':      'p.j. washington',
  'p.j. washington':    'p.j. washington',
  'og anunoby':         'o.g. anunoby',
  'aj griffin':         'a.j. griffin',
  'rj barrett':         'r.j. barrett',
  'tj mcconnell':       't.j. mcconnell',
  'cj mccollum':        'c.j. mccollum',

  // Sufixos Jr/II/III
  'ron holland':        'ronald holland ii',
  'ron holland ii':     'ronald holland ii',
  'jabari smith jr':    'jabari smith jr.',
  'jabari smith jr.':   'jabari smith jr.',
  'gary trent jr':      'gary trent jr.',
  'gary trent jr.':     'gary trent jr.',
  'wendell carter jr':  'wendell carter jr.',
  'kenyon martin jr':   'kenyon martin jr.',
  'larry nance jr':     'larry nance jr.',
  'kelly oubre jr':     'kelly oubre jr.',
  'jaime jaquez jr':    'jaime jaquez jr.',
  'jaime jaquez jr.':   'jaime jaquez jr.',
  'kevin porter jr':    'kevin porter jr.',
  'kevin porter jr.':   'kevin porter jr.',
  'derrick jones jr':   'derrick jones jr.',
  'derrick jones jr.':  'derrick jones jr.',

  // Nomes com caracteres especiais
  'luka doncic':        'luka dončić',
  'luka dončić':        'luka dončić',
  'dennis schroder':    'dennis schröder',
  'dennis schröder':    'dennis schröder',
  'bojan bogdanovic':   'bojan bogdanović',
  'nikola jokic':       'nikola jokić',
  'nikola vucevic':     'nikola vučević',
  'kristaps porzingis': 'kristaps porziņģis',
  'dario saric':        'dario šarić',
  'moussa diabate':     'moussa diabaté',
  'moussa diabaté':     'moussa diabaté',
  'tidjane salaun':     'tidjane salaün',
  'tidjane salaün':     'tidjane salaün',

  // Nomes alternativos / apelidos
  'nic claxton':        'nicolas claxton',
  'nicolas claxton':    'nicolas claxton',
  'bones hyland':       'bones hyland',
  'de\'aaron fox':      'de\'aaron fox',
  'deaaron fox':        'de\'aaron fox',

  // Rookies com nomes diferentes na NBA Stats API
  'alexandre sarr':     'alex sarr',
  'alex sarr':          'alex sarr',
  'carlton carrington': 'bub carrington',
  'bub carrington':     'bub carrington',
  'kasparas jakucionis': 'kasparas jakučionis',
  'kasparas jakučionis': 'kasparas jakučionis',
  'matas buzelis':      'matas buzelis',
  'oso ighodaro':       'oso ighodaro',
  'dylan harper':       'dylan harper',
  'kon knueppel':       'kon knueppel',
  'stephon castle':     'stephon castle',
  'zaccharie risacher': 'zaccharie risacher',
  'donovan clingan':    'donovan clingan',
  'derik queen':        'derik queen',
  'will riley':         'will riley',
  'maxime raynaud':     'maxime raynaud',
  'yves missi':         'yves missi',
  'collin gillespie':   'collin gillespie',
}

let allPlayersCache = null
const playerIdCache = {}
const gameLogCache = {}

// Helper para fetch com timeout
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(timeout)
    return res
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

async function fetchAllPlayers() {
  if (allPlayersCache) return allPlayersCache
  const res = await fetchWithTimeout(
    `${WORKER}/nba/commonallplayers?LeagueID=00&Season=${SEASON}&IsOnlyCurrentSeason=0`,
  )
  if (!res.ok) throw new Error(`NBA players list error: ${res.status}`)
  allPlayersCache = await res.json()
  return allPlayersCache
}

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

    // 2. Word-by-word partial match
    if (!match) {
      const parts = lookupName.split(' ').filter(p => p.length > 1)
      match = rows.find((row) => {
        const rowName = row[nameIdx].toLowerCase()
        return parts.every((part) => rowName.includes(part))
      })
    }

    // 3. Last name only match (fallback para nomes com caracteres especiais)
    if (!match) {
      const lastName = lookupName.split(' ').pop()
      if (lastName && lastName.length > 3) {
        const candidates = rows.filter((row) =>
          row[nameIdx].toLowerCase().includes(lastName)
        )
        if (candidates.length === 1) match = candidates[0]
      }
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

export async function fetchPlayerGameLogs(playerName) {
  const cached = gameLogCache[playerName]
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.logs

  try {
    const playerId = await fetchNBAPlayerID(playerName)
    if (!playerId) return null

    const res = await fetchWithTimeout(
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
      fg3: headers.indexOf('FG3M') !== -1 ? headers.indexOf('FG3M') : headers.indexOf('FG3_M'),
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
