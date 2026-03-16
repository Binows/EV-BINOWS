/**
 * evMath.js
 */

// ---------------------------------------------------------------------------
// Poisson distribution
// ---------------------------------------------------------------------------

export function poissonCDF(lambda, k) {
  let prob = 0
  let term = Math.exp(-lambda)
  for (let i = 0; i <= k; i += 1) {
    prob += term
    term *= lambda / (i + 1)
  }
  return Math.max(0, Math.min(1, 1 - prob))
}

function bisectForLambda(targetP, k) {
  let lo = 0.1
  let hi = 60
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2
    if (poissonCDF(mid, k) > targetP) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

export function calibrateLambda(pA, kA, pB, kB) {
  return (bisectForLambda(pA, kA) + bisectForLambda(pB, kB)) / 2
}

export function fairProb(odd, margin = 1.08) {
  return (1 / odd) / margin
}

/**
 * Computes a dynamic bookmaker margin.
 * Ignores odds >= 34 (bet365 teto artificial) no cálculo do spread.
 */
export function calcDynamicMargin(allOdds) {
  // Filtra odds artificiais de teto (bet365 usa 36 como cap)
  const real = allOdds.filter((o) => o < 34)
  const sorted = (real.length >= 2 ? real : allOdds).sort((a, b) => a - b)
  if (sorted.length === 0) return 1.08

  const n = sorted.length
  const spread = sorted[n - 1] / sorted[0]
  let margin = 1.08

  if (n <= 2) margin += 0.12
  else if (n <= 3) margin += 0.06
  else if (n <= 4) margin += 0.03

  margin += Math.min(Math.log(spread) * 0.04, 0.12)
  return Math.min(margin, 1.25)
}

export function calibrateLambdaFromMiddle(sorted, margin) {
  const n = sorted.length
  let points

  if (n >= 5) {
    points = sorted.slice(Math.floor(n * 0.25), Math.ceil(n * 0.75))
  } else if (n >= 3) {
    points = sorted.slice(1, n - 1)
    if (points.length < 2) points = sorted.slice(0, 2)
  } else {
    points = [sorted[0]]
  }

  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return null

  if (first === last || points.length === 1) {
    return bisectForLambda(fairProb(first.odd, margin), first.k)
  }

  return calibrateLambda(
    fairProb(first.odd, margin),
    first.k,
    fairProb(last.odd, margin),
    last.k,
  )
}

// ---------------------------------------------------------------------------
// EV & Kelly
// ---------------------------------------------------------------------------

export function calcEV(prob, odd) {
  return Number(((prob * odd - 1) * 100).toFixed(1))
}

export function calcKelly(prob, odd) {
  if (odd <= 1) return 0
  const value = Math.min(Math.max(0, (prob * odd - 1) / (odd - 1)) * 50, 2.5)
  return Number(value.toFixed(2))
}

// ---------------------------------------------------------------------------
// Live-mode helpers
// ---------------------------------------------------------------------------

export function toDecimal(americanOdd) {
  if (americanOdd > 0) return Number((americanOdd / 100 + 1).toFixed(3))
  return Number((100 / Math.abs(americanOdd) + 1).toFixed(3))
}

export function fairProbFromBooks(decimalOdds) {
  const total = decimalOdds.reduce((sum, odd) => sum + 1 / odd, 0)
  return Number(
    (
      decimalOdds
        .map((odd) => ((1 / odd) / total) * 100)
        .reduce((sum, p) => sum + p, 0) / decimalOdds.length
    ).toFixed(1),
  )
}

export function liveEV(probPercent, odd) {
  return Number((((probPercent / 100) * odd - 1) * 100).toFixed(1))
}

export function liveKelly(probPercent, odd) {
  const value = Math.min(
    Math.max(0, (((probPercent / 100) * odd - 1) / (odd - 1)) * 50),
    2.5,
  )
  return Number(value.toFixed(2))
}

// ---------------------------------------------------------------------------
// Season hit-rate enrichment
// ---------------------------------------------------------------------------

/** @typedef {{ pts: number, reb: number, ast: number, fg3: number }} GameLog */
/** @typedef {{ hits: number, games: number, pct: number }} HitRate */

const MARKET_STAT_KEY = {
  pontos: 'pts',
  rebotes: 'reb',
  assistencias: 'ast',
  '3pts': 'fg3',
}

export function calcSeasonHitRate(logs, market, lineNum) {
  if (!logs || logs.length === 0) return null
  const key = MARKET_STAT_KEY[market]
  if (!key) return null

  const hits = logs.filter((g) => g[key] >= lineNum).length
  return { hits, games: logs.length, pct: Math.round((hits / logs.length) * 100) }
}

export function calcKellyFromSeason(prob, odd, seasonHR) {
  if (odd <= 1) return 0

  let kelly = Math.min(Math.max(0, (prob * odd - 1) / (odd - 1)) * 50, 2.5)

  if (seasonHR) {
    const pct = seasonHR.pct / 100
    if (pct === 0) kelly = 0
    else if (pct < 0.2) kelly = Math.min(kelly * 0.2, 0.25)
    else if (pct < 0.4) kelly = kelly * 0.4
    else if (pct < 0.55) kelly = kelly * 0.6
    else if (pct < 0.7) kelly = kelly * 0.8
  }

  return Number(kelly.toFixed(2))
}

// ---------------------------------------------------------------------------
// Quality score (edge confidence 1–5 stars)
// ---------------------------------------------------------------------------

export function calcQualityScore(ev, odd, hrStr) {
  if (!hrStr) return 0
  const [hitsStr, gamesStr] = hrStr.split('/')
  const hits = Number.parseInt(hitsStr, 10)
  const games = Number.parseInt(gamesStr, 10)
  if (Number.isNaN(hits) || Number.isNaN(games) || games === 0) return 0

  const p = hits / games

  const z = 1.96
  const n = games
  const wilson =
    (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) /
    (1 + (z * z) / n)
  const wilsonLow = Math.max(0, wilson)

  const sampleFactor = Math.min(games / 60, 1.0)

  const hitPenalty =
    p < 0.1 ? 0.2 : p < 0.2 ? 0.4 : p < 0.3 ? 0.65 : p < 0.4 ? 0.85 : 1.0

  const volatilityFactor = Math.max(0.12, 1 / (1 + Math.log(odd) * 0.6))

  const score =
    (wilsonLow * 0.5 + sampleFactor * 0.3 + volatilityFactor * 0.2) * hitPenalty

  if (score >= 0.52) return 5
  if (score >= 0.35) return 4
  if (score >= 0.2) return 3
  if (score >= 0.09) return 2
  return 1
}
