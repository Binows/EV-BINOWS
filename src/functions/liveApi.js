/**
 * liveApi.js
 *
 * Orchestrates the live-odds pipeline:
 *   1. Fetches upcoming NBA events via oddsService
 *   2. Fetches Over lines per event via oddsService
 *   3. Applies fair-probability and EV/Kelly math from evMath
 *
 * HTTP details are fully delegated to src/services/oddsService.js.
 * Math functions are imported from src/functions/evMath.js.
 */

import { fairProbFromBooks, liveEV, liveKelly, toDecimal } from './evMath'
import { fetchEventOdds, fetchNBAEvents } from '../services/oddsService'

const MARKET_LABEL = {
  player_points: 'pontos',
  player_rebounds: 'rebotes',
  player_assists: 'assistencias',
}

const MARKET_TYPE = {
  player_points: 'pts',
  player_rebounds: 'reb',
  player_assists: 'ast',
}

/**
 * Main entry point for the Live mode. Fetches upcoming NBA games, pulls Over
 * lines from multiple bookmakers, de-juices the market to find a fair
 * probability, and computes EV + Kelly for each line.
 *
 * @param {(message: string) => void} [onProgress] - Optional callback called
 *   before each game is fetched, useful for showing a loading status.
 * @returns {Promise<{ bets: Array, remainingRequests: string }>}
 *   `bets` is sorted by EV descending.
 *   `remainingRequests` is the remaining API quota string from the last request.
 */
export async function fetchLiveBets(onProgress) {
  const games = await fetchNBAEvents()
  if (games.length === 0) return { bets: [], remainingRequests: '' }

  const bets = []
  let remainingRequests = ''

  for (const event of games) {
    if (onProgress) onProgress(`${event.away_team} @ ${event.home_team}...`)

    let oddsResult
    try {
      oddsResult = await fetchEventOdds(event.id)
    } catch {
      continue
    }

    if (oddsResult.remainingRequests) remainingRequests = oddsResult.remainingRequests
    if (!oddsResult.bookmakers.length) continue

    const gameLabel = `${event.away_team} @ ${event.home_team}`

    // Aggregate Over lines per player+market+line across bookmakers
    const playerMap = {}
    for (const book of oddsResult.bookmakers) {
      for (const market of book.markets || []) {
        if (!MARKET_LABEL[market.key]) continue
        for (const outcome of market.outcomes || []) {
          if (outcome.name !== 'Over') continue

          const key = `${outcome.description}||${market.key}||${outcome.point}`
          if (!playerMap[key]) {
            playerMap[key] = {
              player: outcome.description,
              market: MARKET_LABEL[market.key],
              type: MARKET_TYPE[market.key],
              line: outcome.point,
              game: gameLabel,
              odds: [],
              books: [],
            }
          }
          playerMap[key].odds.push(toDecimal(outcome.price))
          playerMap[key].books.push(book.key)
        }
      }
    }

    // Need at least 2 books for fair probability de-juicing
    for (const entry of Object.values(playerMap)) {
      if (entry.odds.length < 2) continue

      const bestOdd = Math.max(...entry.odds)
      const bestBook = entry.books[entry.odds.indexOf(bestOdd)]
      const prob = fairProbFromBooks(entry.odds)

      bets.push({
        player: entry.player,
        market: `${entry.line}+ ${entry.market}`,
        type: entry.type,
        game: entry.game,
        prob,
        odd: bestOdd,
        book: bestBook,
        n: entry.odds.length,
        ev: liveEV(prob, bestOdd),
        kelly: liveKelly(prob, bestOdd),
      })
    }
  }

  bets.sort((a, b) => b.ev - a.ev)
  return { bets, remainingRequests }
}
