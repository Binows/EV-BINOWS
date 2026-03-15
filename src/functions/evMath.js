/**
 * evMath.js
 *
 * Pure mathematical functions for Expected Value (EV), Kelly Criterion, and
 * Poisson distribution calculations used throughout the EV-BINOWS scanner.
 *
 * No side-effects. No I/O. All functions are unit-testable in isolation.
 */

// ---------------------------------------------------------------------------
// Poisson distribution
// ---------------------------------------------------------------------------

/**
 * Computes the complementary CDF of a Poisson distribution:
 * P(X >= k) = 1 - P(X < k).
 *
 * Used to estimate the true probability that a player exceeds a given stat
 * line (e.g., "scores more than 24.5 points") given a fitted lambda.
 *
 * @param {number} lambda - Poisson rate parameter (estimated player average)
 * @param {number} k      - The line value minus 1 (e.g., for "25+" pass k=24)
 * @returns {number} Probability in [0, 1]
 */
export function poissonCDF(lambda, k) {
  let prob = 0
  let term = Math.exp(-lambda)
  for (let i = 0; i <= k; i += 1) {
    prob += term
    term *= lambda / (i + 1)
  }
  return Math.max(0, Math.min(1, 1 - prob))
}

/**
 * Binary-search for the lambda value that makes poissonCDF(lambda, k) == targetP.
 * Converges in 80 iterations (precision < 1e-10).
 *
 * @param {number} targetP - Target probability in (0, 1)
 * @param {number} k       - Integer threshold
 * @returns {number} Lambda estimate
 */
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

/**
 * Calibrates a Poisson lambda from two (probability, threshold) anchor points.
 * Averages two independent bisection results for a more stable estimate.
 *
 * @param {number} pA - Fair probability at line anchor A
 * @param {number} kA - Threshold k for anchor A
 * @param {number} pB - Fair probability at line anchor B
 * @param {number} kB - Threshold k for anchor B
 * @returns {number} Calibrated lambda
 */
export function calibrateLambda(pA, kA, pB, kB) {
  return (bisectForLambda(pA, kA) + bisectForLambda(pB, kB)) / 2
}

/**
 * Removes bookmaker margin from a single decimal odd to get the fair probability.
 *
 * @param {number} odd    - Decimal odd (e.g. 2.50)
 * @param {number} margin - Estimated total overround to divide out (default 1.08 = 8%)
 * @returns {number} Fair probability in (0, 1)
 */
export function fairProb(odd, margin = 1.08) {
  return (1 / odd) / margin
}

/**
 * Computes a dynamic bookmaker margin based on the number of lines and the
 * spread between min/max odds.
 *
 * More lines → more confident margin estimate → lower correction.
 * Wider spread → higher volatility → larger margin applied.
 *
 * @param {number[]} allOdds - Array of decimal odds for all lines in the market
 * @returns {number} Margin multiplier in [1.08, 1.40]
 */
export function calcDynamicMargin(allOdds) {
  const sorted = [...allOdds].sort((a, b) => a - b)
  if (sorted.length === 0) return 1.08

  const n = sorted.length
  const spread = sorted[n - 1] / sorted[0]
  let margin = 1.08

  if (n <= 2) margin += 0.12
  else if (n <= 3) margin += 0.06
  else if (n <= 4) margin += 0.03

  margin += Math.min(Math.log(spread) * 0.04, 0.2)
  return Math.min(margin, 1.4)
}

/**
 * Calibrates lambda using the middle portion of the sorted lines to reduce
 * noise from extreme (low-liquidity) ends of the market.
 *
 * With ≥5 lines → uses IQR (25%–75%)
 * With 3–4 lines → drops min and max
 * With ≤2 lines  → uses a single bisection from the first anchor
 *
 * @param {Array<{odd: number, k: number}>} sorted - Lines sorted ascending by k
 * @param {number} margin - Dynamic margin value from calcDynamicMargin
 * @returns {number|null} Calibrated lambda, or null on error
 */
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

/**
 * Calculates Expected Value as a percentage return per unit staked.
 * Formula: EV% = (prob × odd − 1) × 100
 *
 * Positive value → bet has edge. Negative → house has edge.
 *
 * @param {number} prob - True (de-juiced) probability of the outcome
 * @param {number} odd  - Decimal odd offered by the bookmaker
 * @returns {number} EV percentage, e.g. +8.5 or −4.2
 */
export function calcEV(prob, odd) {
  return Number(((prob * odd - 1) * 100).toFixed(1))
}

/**
 * Half-Kelly fraction of bankroll to stake, capped at 2.5%.
 * Uses the full Kelly formula divided by 2 as a conservative sizing.
 * Returns 0 for odds ≤ 1 (invalid) or negative-edge bets.
 *
 * @param {number} prob - True probability of winning
 * @param {number} odd  - Decimal odd
 * @returns {number} Bankroll percentage in [0, 2.5]
 */
export function calcKelly(prob, odd) {
  if (odd <= 1) return 0
  const value = Math.min(Math.max(0, (prob * odd - 1) / (odd - 1)) * 50, 2.5)
  return Number(value.toFixed(2))
}

// ---------------------------------------------------------------------------
// Live-mode helpers (American odds + multi-book fair probability)
// ---------------------------------------------------------------------------

/**
 * Converts an American moneyline odd to decimal format.
 * e.g. +150 → 2.500, −110 → 1.909
 *
 * @param {number} americanOdd
 * @returns {number} Decimal odd rounded to 3 decimal places
 */
export function toDecimal(americanOdd) {
  if (americanOdd > 0) return Number((americanOdd / 100 + 1).toFixed(3))
  return Number((100 / Math.abs(americanOdd) + 1).toFixed(3))
}

/**
 * Computes the fair probability from an array of decimal odds across multiple
 * bookmakers by equalizing each book's implied probability share.
 *
 * Each book contributes its proportion of the total overround; the average
 * across books gives a de-juiced consensus probability (as a percentage).
 *
 * @param {number[]} decimalOdds - One decimal odd per bookmaker for the same outcome
 * @returns {number} Fair probability as a percentage (e.g. 52.3)
 */
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

/**
 * EV for live mode where probability is already a percentage (0–100).
 *
 * @param {number} probPercent - Fair probability as a percentage
 * @param {number} odd         - Decimal odd
 * @returns {number} EV percentage
 */
export function liveEV(probPercent, odd) {
  return Number((((probPercent / 100) * odd - 1) * 100).toFixed(1))
}

/**
 * Half-Kelly stake for live mode (probability as percentage).
 *
 * @param {number} probPercent - Fair probability as a percentage
 * @param {number} odd         - Decimal odd
 * @returns {number} Bankroll percentage in [0, 2.5]
 */
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

/**
 * Calculates how often a player hit or exceeded a given stat line this season.
 *
 * @param {GameLog[]} logs     - Array of per-game stat objects
 * @param {string}    market   - Market key: 'pontos' | 'rebotes' | 'assistencias' | '3pts'
 * @param {number}    lineNum  - The stat line to test against (e.g. 25)
 * @returns {HitRate|null} Hit frequency, or null if market/data is invalid
 */
export function calcSeasonHitRate(logs, market, lineNum) {
  if (!logs || logs.length === 0) return null
  const key = MARKET_STAT_KEY[market]
  if (!key) return null

  const hits = logs.filter((g) => g[key] >= lineNum).length
  return { hits, games: logs.length, pct: Math.round((hits / logs.length) * 100) }
}

/**
 * Refines the Kelly stake using the seasonal hit-rate as a confidence weight.
 *
 * The intuition: a line that has been hit only 13% of the time this season
 * (e.g. Zubac 17+ points at 14.00) should get a much smaller stake than the
 * raw Kelly suggests, regardless of the model's EV estimate.
 *
 * Scaling tiers (based on season hit%):
 *   0%       → 0 (never bet a 0% hit rate line)
 *   <20%     → ×0.2 (very low confidence, cap 0.25%)
 *   20–40%   → ×0.4
 *   40–55%   → ×0.6
 *   55–70%   → ×0.8
 *   ≥70%     → ×1.0 (full Kelly, high-confidence line)
 *
 * @param {number}       prob      - True probability from Poisson model
 * @param {number}       odd       - Decimal odd
 * @param {HitRate|null} seasonHR  - Hit rate object from calcSeasonHitRate
 * @returns {number} Adjusted Kelly stake percentage in [0, 2.5]
 */
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
    // else: full kelly
  }

  return Number(kelly.toFixed(2))
}

// ---------------------------------------------------------------------------
// Quality score (edge confidence 1–5 stars)
// ---------------------------------------------------------------------------

/**
 * Scores the statistical confidence in an EV edge from 1 to 5.
 *
 * This measures CONFIDENCE, not the size of the edge. A large EV on a rarely-hit
 * line with few samples gets a low score; a moderate EV on a frequently-hit line
 * with 60+ games gets a high score.
 *
 * Components:
 *   - Wilson score lower bound (IC 95%) — statistical reliability of the hit rate
 *   - Sample factor (games / 60, capped at 1) — penalty for small sample
 *   - Volatility factor (1 / (1 + ln(odd) × 0.6)) — penalty for high odds (wide swings)
 *   - Hit-rate penalty — hard penalty for lines with very low absolute hit rate
 *
 * Example calibrations:
 *   Zubac  6/45 @ 14.00 → score ≈ 0.048 → 1★ (13% HR, high volatility)
 *   Bridges 35/68 @ 3.25 → score ≈ 0.625 → 5★ (51% HR, moderate odd)
 *
 * @param {number} ev    - Expected value percentage (not used in score — intentionally)
 * @param {number} odd   - Decimal odd
 * @param {string} hrStr - Hit rate string in "hits/games" format, e.g. "35/68"
 * @returns {number} Star rating from 1 to 5 (0 if data unavailable)
 */
export function calcQualityScore(ev, odd, hrStr) {
  if (!hrStr) return 0
  const [hitsStr, gamesStr] = hrStr.split('/')
  const hits = Number.parseInt(hitsStr, 10)
  const games = Number.parseInt(gamesStr, 10)
  if (Number.isNaN(hits) || Number.isNaN(games) || games === 0) return 0

  const p = hits / games

  // Wilson score lower bound (95% CI)
  const z = 1.96
  const n = games
  const wilson =
    (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) /
    (1 + (z * z) / n)
  const wilsonLow = Math.max(0, wilson)

  // Sample size factor: 60+ games = full confidence
  const sampleFactor = Math.min(games / 60, 1.0)

  // Hit-rate penalty: lines that rarely hit are inherently risky
  const hitPenalty =
    p < 0.1 ? 0.2 : p < 0.2 ? 0.4 : p < 0.3 ? 0.65 : p < 0.4 ? 0.85 : 1.0

  // Volatility penalty: high odds → large variance → harder to profit long-term
  const volatilityFactor = Math.max(0.12, 1 / (1 + Math.log(odd) * 0.6))

  const score =
    (wilsonLow * 0.5 + sampleFactor * 0.3 + volatilityFactor * 0.2) * hitPenalty

  if (score >= 0.52) return 5
  if (score >= 0.35) return 4
  if (score >= 0.2) return 3
  if (score >= 0.09) return 2
  return 1
}
