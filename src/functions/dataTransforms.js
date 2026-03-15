/**
 * dataTransforms.js
 *
 * Transforms raw JSON datasets (exported by the browser extension) into
 * structured player/line objects ready for the React UI.
 *
 * Pipeline:
 *   1. normalizeDatasetFromFile — parses a raw JSON blob into one or more
 *      normalised dataset objects (handles both numeric and binary markets).
 *   2. parseJsonFiles — reads FileList from the file-picker and accumulates
 *      datasets, deduplicating by _id.
 *   3. buildManualView — computes EV/Kelly for every line, applies filters,
 *      and returns the full view-model consumed by App.jsx.
 *   4. enrichPlayersWithSeasonStats — second-pass enrichment that refines EV
 *      and Kelly using actual season game logs fetched from NBA stats API.
 *   5. getUniquePlayerMarkets — utility to extract the unique player+market
 *      pairs needed to drive the season-stats fetch loop.
 */

import {
  calcDynamicMargin,
  calcEV,
  calcKelly,
  calcKellyFromSeason,
  calcQualityScore,
  calcSeasonHitRate,
  calibrateLambdaFromMiddle,
  fairProb,
  poissonCDF,
} from './evMath'

export const MARKET_NAMES = {
  rebotes: 'Reb',
  pontos: 'Pts',
  assistencias: 'Ast',
  '3pts': '3Pts',
  'duplo-duplo': 'DD',
  'triplo-duplo': 'TD',
  desconhecido: '?',
}

const MARKET_FILTER_MAP = {
  pts: 'pontos',
  reb: 'rebotes',
  ast: 'assistencias',
  '3pts': '3pts',
}

/**
 * Creates a URL-safe slug from a player's full name.
 * Used as a stable identifier when matching lines to season-stats updates.
 *
 * @param {string} name - Player display name
 * @returns {string} e.g. "lebron-james"
 */
export function playerSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-')
}

function removeDiacritics(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Normalises a market name string: lowercases, strips diacritics.
 * The special case 'assistencias' is preserved (not aliased).
 *
 * @param {string} name - Raw market key from the JSON export
 * @returns {string} Normalised market key
 */
export function normalizeMarketName(name = '') {
  const plain = removeDiacritics(String(name).toLowerCase().trim())
  if (plain === 'assistencias') return 'assistencias'
  return plain
}

function detectMarketByContent(players) {
  if (!players || players.length === 0) return 'desconhecido'
  let max = 0

  for (const player of players) {
    for (const label of Object.keys(player.lines || {})) {
      const n = Number.parseInt(label, 10)
      if (!Number.isNaN(n) && n > max) max = n
    }
  }

  if (max <= 8) return '3pts'
  if (max <= 15) return 'assistencias'
  if (max <= 25) return 'rebotes'
  return 'pontos'
}

function guessMarketFromFilename(fileName) {
  const name = removeDiacritics(fileName.toLowerCase())
  if (name.includes('3pt') || name.includes('cesta')) return '3pts'
  if (name.includes('assistencia') || name.includes('ast')) return 'assistencias'
  if (name.includes('rebote') || name.includes('reb')) return 'rebotes'
  if (name.includes('ponto') || name.includes('pts')) return 'pontos'
  return null
}

function createBinaryDataset(baseData, id, fileName, market, players) {
  return {
    _id: id,
    _filename: fileName,
    market,
    scrapedAt: baseData.scrapedAt,
    gameName: baseData.gameName,
    url: baseData.url,
    players: players.map((p) => ({
      player: p.player,
      last5: p.last5,
      lines: { Sim: p.oddSim },
      oddNao: p.oddNao,
      binary: true,
    })),
  }
}

export function normalizeDatasetFromFile(fileName, data) {
  const parsed = []
  const isBinaryDataset =
    (data.market === 'duplo-duplo' || data.market === 'triplo-duplo') &&
    Array.isArray(data.binaryPlayers) &&
    data.binaryPlayers.length > 0

  if (!isBinaryDataset && (!Array.isArray(data.players) || data.players.length === 0)) {
    return parsed
  }

  const baseId = `${fileName}_${data.scrapedAt || ''}`
  const normalizedMain = {
    ...data,
    _id: baseId,
    _filename: fileName,
  }

  if (!normalizedMain.market || normalizeMarketName(normalizedMain.market) === 'desconhecido') {
    normalizedMain.market =
      guessMarketFromFilename(fileName) || detectMarketByContent(normalizedMain.players)
  }
  normalizedMain.market = normalizeMarketName(normalizedMain.market)

  if (isBinaryDataset) {
    normalizedMain.players = data.binaryPlayers.map((p) => ({
      player: p.player,
      last5: p.last5,
      lines: { Sim: p.oddSim },
      oddNao: p.oddNao,
      binary: true,
    }))
  }

  parsed.push(normalizedMain)

  if (!isBinaryDataset && Array.isArray(data.binaryPlayers) && data.binaryPlayers.length > 0) {
    const ddPlayers = data.binaryPlayers.filter((p) => p.market === 'duplo-duplo')
    const tdPlayers = data.binaryPlayers.filter((p) => p.market === 'triplo-duplo')

    if (ddPlayers.length > 0) {
      parsed.push(createBinaryDataset(data, `${baseId}_dd`, fileName, 'duplo-duplo', ddPlayers))
    }
    if (tdPlayers.length > 0) {
      parsed.push(createBinaryDataset(data, `${baseId}_td`, fileName, 'triplo-duplo', tdPlayers))
    }
  }

  return parsed
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.readAsText(file)
  })
}

/**
 * Reads multiple JSON files from a FileList, parses them into normalised
 * datasets, and merges them into `currentDatasets` without duplicates.
 * Files that fail to parse are silently ignored.
 *
 * @param {FileList|File[]} files           - Files selected by the user
 * @param {Array}           currentDatasets - Existing datasets in state
 * @returns {Promise<Array>} Merged array of all datasets
 */
export async function parseJsonFiles(files, currentDatasets) {
  if (!files || files.length === 0) return currentDatasets

  const next = [...currentDatasets]

  for (const file of files) {
    try {
      const text = await readFileAsText(file)
      const data = JSON.parse(text)
      const normalized = normalizeDatasetFromFile(file.name, data)
      for (const dataset of normalized) {
        if (!next.some((item) => item._id === dataset._id)) next.push(dataset)
      }
    } catch {
      // Ignore invalid files to keep multi-upload resilient.
    }
  }

  return next
}

function evaluateNormalPlayer(player, market, oddThreshold) {
  const linesEntries = Object.entries(player.lines || {})
  if (linesEntries.length < 2) return null

  const sorted = linesEntries
    .map(([label, odd]) => ({
      label,
      odd,
      k: Number.parseInt(label, 10) - 1,
    }))
    .filter((item) => !Number.isNaN(item.k) && item.odd >= 1.01 && item.odd < 36)
    .sort((a, b) => a.k - b.k)

  if (sorted.length < 2) return null

  const marketLabel = MARKET_NAMES[market] || market
  const margin = calcDynamicMargin(sorted.map((item) => item.odd))

  let lambda = null
  try {
    lambda = calibrateLambdaFromMiddle(sorted, margin)
  } catch {
    lambda = null
  }

  const lineItems = sorted.map(({ label, odd, k }) => {
    const lineNumber = Number.parseInt(label, 10)
    const prob = lambda === null ? fairProb(odd, margin) : poissonCDF(lambda, k)
    const ev = calcEV(prob, odd)
    const kelly = calcKelly(prob, odd)

    return {
      player: player.player,
      slug: playerSlug(player.player),
      market,
      marketLabel,
      lineLabel: `${label} ${marketLabel.toLowerCase()}`,
      rawLabel: label,
      lineNumber,
      odd,
      prob,
      ev,
      kelly,
      isPositive: ev > 3,
      isNegative: ev < -3,
      isHighValue: ev > 3 && odd >= oddThreshold,
    }
  })

  return {
    player: player.player,
    gameName: player.gameName || '',
    market,
    marketLabel,
    lambda,
    lines: lineItems,
  }
}

function evaluateBinaryPlayer(player, market, oddThreshold) {
  const oddSim = player.lines?.Sim
  if (!oddSim) return null

  const oddNao = player.oddNao
  const margin = oddNao ? 1 / (1 / oddSim + 1 / oddNao) : 1.08
  const prob = (1 / oddSim) / (oddNao ? 1 / oddSim + 1 / oddNao : 1.08)
  const ev = calcEV(prob, oddSim)
  const kelly = calcKelly(prob, oddSim)
  const marketLabel = MARKET_NAMES[market] || market

  return {
    player: player.player,
    gameName: player.gameName || '',
    market,
    marketLabel,
    lambda: null,
    lines: [
      {
        player: player.player,
        slug: playerSlug(player.player),
        market,
        marketLabel,
        lineLabel: `Sim ${marketLabel}`,
        rawLabel: 'Sim',
        lineNumber: 0,
        odd: oddSim,
        prob,
        ev,
        kelly,
        oddNao,
        isPositive: ev > 3,
        isNegative: ev < -3,
        isHighValue: ev > 3 && oddSim >= oddThreshold,
      },
    ],
  }
}

function playerHasEVPlus(player) {
  return player.lines.some((line) => line.isPositive)
}

function filterPlayers(players, filterValue) {
  if (filterValue === 'todos') return players
  if (filterValue === 'pos') return players.filter(playerHasEVPlus)

  const market = MARKET_FILTER_MAP[filterValue]
  if (!market) return players
  return players.filter((item) => item.market === market)
}

/**
 * Builds the complete view-model for the Manual mode.
 *
 * Processes all loaded datasets into per-player card data with computed
 * EV, Kelly, and signal flags. Applies market filter, player search, and
 * computes aggregate metrics for the dashboard header.
 *
 * @param {Array}  datasets              - Array of normalised dataset objects
 * @param {object} opts
 * @param {string} opts.filter           - Active filter: 'todos'|'pos'|'pts'|'reb'|'ast'|'3pts'
 * @param {number} opts.oddThreshold     - Minimum odd for 'high-value' highlight
 * @param {string} opts.playerSearch     - Player name search string
 * @returns {{ players: Array, topEV: Array, metrics: object }}
 */
export function buildManualView(datasets, { filter, oddThreshold, playerSearch }) {
  const safeSearch = playerSearch.trim().toLowerCase()
  const allPlayers = []
  let latestScrapedAt = null

  for (const ds of datasets) {
    const market = normalizeMarketName(ds.market || 'desconhecido')
    for (const p of ds.players || []) {
      allPlayers.push({ ...p, market, gameName: ds.gameName || '' })
    }
    if (!latestScrapedAt || ds.scrapedAt > latestScrapedAt) latestScrapedAt = ds.scrapedAt
  }

  const mapped = allPlayers
    .map((p) =>
      p.binary
        ? evaluateBinaryPlayer(p, p.market, oddThreshold)
        : evaluateNormalPlayer(p, p.market, oddThreshold),
    )
    .filter(Boolean)

  const byFilter = filterPlayers(mapped, filter)
  const bySearch = safeSearch
    ? byFilter.filter((item) => item.player.toLowerCase().includes(safeSearch))
    : byFilter

  const metrics = {
    cntPos: 0,
    cntTotal: 0,
    bestEV: -Infinity,
    lastUpdate: latestScrapedAt
      ? new Date(latestScrapedAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—',
  }

  const topEV = []
  for (const player of bySearch) {
    for (const line of player.lines) {
      metrics.cntTotal += 1
      if (line.ev > metrics.bestEV) metrics.bestEV = line.ev
      if (line.isPositive) {
        metrics.cntPos += 1
        topEV.push(line)
      }
    }
  }

  topEV.sort((a, b) => b.ev - a.ev)

  return {
    players: bySearch,
    topEV,
    metrics: {
      ...metrics,
      bestEVText: metrics.bestEV > 0 ? `+${metrics.bestEV.toFixed(1)}%` : '—',
    },
  }
}

export function datasetsToChipData(datasets) {
  return datasets.map((dataset, index) => {
    const market = MARKET_NAMES[normalizeMarketName(dataset.market)] || '?'
    const game = dataset.gameName || ''
    const gameShort = game
      ? game
          .split(' x ')
          .map((part) => part.split(' ').slice(-1)[0])
          .join(' x ')
      : ''

    return {
      index,
      market,
      title: game,
      text: `${market} ${dataset.players?.length || 0}j${gameShort ? ` · ${gameShort}` : ''}`,
    }
  })
}


/**
 * Returns the unique player+market combinations present across all datasets.
 * Used by App.jsx to drive the async NBA season-stats prefetch loop.
 *
 * @param {Array} datasets - Normalised datasets
 * @returns {Array<{player:string, market:string}>} Deduplicated list
 */
export function getUniquePlayerMarkets(datasets) {
  const seen = new Set()
  const result = []
  for (const ds of datasets) {
    const market = normalizeMarketName(ds.market || 'desconhecido')
    for (const p of ds.players || []) {
      const key = `${p.player}|${market}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push({ player: p.player, market })
      }
    }
  }
  return result
}

/**
 * Second-pass enrichment that refines Kelly recommendations using real
 * season game-log data fetched from the NBA stats API.
 *
 * For each player line that has season logs available the function:
 *   - Calculates the empirical hit-rate for the exact line number.
 *   - Re-computes Kelly using calcKellyFromSeason (a conservative
 *     season-confidence-tiered fraction of Half-Kelly).
 *   - Attaches seasonHR and hrStr for display in PlayerCards.
 *   - Attaches qualityScore using calcQualityScore.
 *
 * Lines that have fewer than 5 season games, or for which no logs were
 * found, are returned unmodified.
 *
 * @param {Array}  players     - players array from buildManualView
 * @param {object} seasonLogs  - Map keyed "${player}|${market}" -> Array<{pts,reb,ast,fg3}>
 * @returns {Array} Enriched players array (new references, original not mutated)
 */
export function enrichPlayersWithSeasonStats(players, seasonLogs) {
  if (!seasonLogs || Object.keys(seasonLogs).length === 0) return players

  return players.map((player) => ({
    ...player,
    lines: player.lines.map((line) => {
      const logs = seasonLogs[`${line.player}|${line.market}`]
      if (!logs || !line.lineNumber) return line

      const hr = calcSeasonHitRate(logs, line.market, line.lineNumber)
      if (!hr || hr.games < 5) return line

      const hrStr = `${hr.hits}/${hr.games} (${(hr.pct * 100).toFixed(0)}%)`
      const refinedKelly =
        hr.games >= 10
          ? calcKellyFromSeason(hr.pct, line.odd, hr)
          : line.kelly
      const qualityScore = calcQualityScore(line.ev, line.odd, hrStr)

      return { ...line, seasonHR: hr, hrStr, kelly: refinedKelly, qualityScore }
    }),
  }))
}
