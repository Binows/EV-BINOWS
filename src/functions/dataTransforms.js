/**
 * dataTransforms.js
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

export function playerSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-')
}

function removeDiacritics(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

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
  for (const player of mapped) {
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
    topEV: topEV,
    topEV_source: mapped,
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

export function enrichPlayersWithSeasonStats(players, seasonLogs) {
  if (!players || !Array.isArray(players)) return []
  if (!seasonLogs || Object.keys(seasonLogs).length === 0) return players

  return players.map((player) => ({
    ...player,
    lines: player.lines.map((line) => {
      const logs = seasonLogs[`${line.player}|${line.market}`]
      if (!logs || !line.lineNumber) return line

      const hr = calcSeasonHitRate(logs, line.market, line.lineNumber)
      if (!hr || hr.games < 5) return line

      // hr.pct vem como inteiro 0-100 de calcSeasonHitRate
      const hrStr = `${hr.hits}/${hr.games} (${hr.pct}%)`
      const refinedKelly =
        hr.games >= 10
          ? calcKellyFromSeason(hr.pct, line.odd, hr)
          : line.kelly
      const qualityScore = calcQualityScore(line.ev, line.odd, hrStr)

      return { ...line, seasonHR: hr, hrStr, kelly: refinedKelly, qualityScore }
    }),
  }))
}
