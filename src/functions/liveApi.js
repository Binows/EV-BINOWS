/**
 * liveApi.js
 *
 * Pipeline Live: odds-api.io (bet365) + NBA Stats para EV real por temporada.
 */
import {
  calcEV,
  calcKellyFromSeason,
  calcQualityScore,
  calcSeasonHitRate,
  fairProbFromBooks,
  liveEV,
  liveKelly,
  toDecimal,
} from './evMath'
import { fetchEventOdds, fetchNBAEvents, fetchBet365Props } from '../services/oddsService'
import { fetchPlayerGameLogs } from '../services/nbaStatsService'

// ---------------------------------------------------------------------------
// Mapeamento de mercados
// ---------------------------------------------------------------------------

const MARKET_LABEL = {
  player_points:                   'pontos',
  player_rebounds:                 'rebotes',
  player_assists:                  'assistencias',
  player_threes:                   '3pts',
  player_steals:                   'roubos',
  player_blocks:                   'tocos',
  player_steals_blocks:            'roubos+tocos',
  player_field_goals:              'cestas',
  player_points_rebounds_assists:  'pts+reb+ast',
  player_points_rebounds:          'pts+reb',
  player_points_assists:           'pts+ast',
  player_rebounds_assists:         'reb+ast',
  player_double_double:            'duplo-duplo',
  player_triple_double:            'triplo-duplo',
  player_points_milestones:        'pts (milestone)',
  player_rebounds_milestones:      'reb (milestone)',
  player_assists_milestones:       'ast (milestone)',
  player_threes_milestones:        '3pts (milestone)',
}

const MARKET_TYPE = {
  player_points:                   'pts',
  player_rebounds:                 'reb',
  player_assists:                  'ast',
  player_threes:                   '3pt',
  player_steals:                   'stl',
  player_blocks:                   'blk',
  player_steals_blocks:            'stl+blk',
  player_field_goals:              'fgm',
  player_points_rebounds_assists:  'pra',
  player_points_rebounds:          'pr',
  player_points_assists:           'pa',
  player_rebounds_assists:         'ra',
  player_double_double:            'dd',
  player_triple_double:            'td',
  player_points_milestones:        'pts',
  player_rebounds_milestones:      'reb',
  player_assists_milestones:       'ast',
  player_threes_milestones:        '3pt',
}

// Mapeia type interno → chave que calcSeasonHitRate espera
const TYPE_TO_SEASON_MARKET = {
  pts:  'pontos',
  reb:  'rebotes',
  ast:  'assistencias',
  '3pt': '3pts',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeTeam(s) {
  return s.toLowerCase().replace(/[^a-z]/g, '')
}

function aggregateBookmakers(bookmakers, playerMap, gameLabel) {
  for (const book of bookmakers) {
    for (const market of book.markets || []) {
      if (!MARKET_LABEL[market.key]) continue
      for (const outcome of market.outcomes || []) {
        if (outcome.name !== 'Over') continue
        const key = `${outcome.description}||${market.key}||${outcome.point}`
        if (!playerMap[key]) {
          playerMap[key] = {
            player: outcome.description,
            market: MARKET_LABEL[market.key],
            type:   MARKET_TYPE[market.key],
            line:   outcome.point,
            game:   gameLabel,
            odds:   [],
            books:  [],
          }
        }
        const odd = book.isDecimal
          ? parseFloat(outcome.price)
          : toDecimal(outcome.price)
        playerMap[key].odds.push(odd)
        playerMap[key].books.push(book.key)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Enrichment com stats da temporada NBA
// ---------------------------------------------------------------------------

async function enrichWithSeasonStats(bets) {
  const uniquePlayers = [...new Set(bets.map((b) => b.player))]
  const logsMap = {}

  await Promise.all(
    uniquePlayers.map(async (player) => {
      try {
        const logs = await fetchPlayerGameLogs(player)
        if (logs) logsMap[player] = logs
      } catch {
        // silencia erros individuais
      }
    })
  )

  return bets.map((bet) => {
    const logs = logsMap[bet.player]
    const seasonMarket = TYPE_TO_SEASON_MARKET[bet.type]

    // Só enriquece mercados com dados de temporada disponíveis
    if (!logs || !seasonMarket) return bet

    const hr = calcSeasonHitRate(logs, seasonMarket, bet.line)
    if (!hr || hr.games < 5) return bet

    const hrStr = `${hr.hits}/${hr.games} (${hr.pct}%)`
    const qualityScore = calcQualityScore(bet.ev, bet.odd, hrStr)

    // Com >= 10 jogos: usa prob da temporada como referência principal
    if (hr.games >= 10) {
      const seasonProb  = hr.pct / 100
      const seasonEV    = calcEV(seasonProb, bet.odd)
      const seasonKelly = calcKellyFromSeason(seasonProb, bet.odd, hr)

      return {
        ...bet,
        prob:         Math.round(seasonProb * 1000) / 10,
        ev:           seasonEV,
        kelly:        seasonKelly,
        hrStr,
        seasonHR:     hr,
        qualityScore,
        isHighValue:  seasonEV > 3 && bet.odd >= 2,
        isPositive:   seasonEV > 3,
        isNegative:   seasonEV < -3,
      }
    }

    // Com 5-9 jogos: mantém EV original, refina Kelly
    const refinedKelly = calcKellyFromSeason(bet.prob / 100, bet.odd, hr)
    return {
      ...bet,
      kelly:        refinedKelly,
      hrStr,
      seasonHR:     hr,
      qualityScore,
    }
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function fetchLiveBets(onProgress) {
  const [games, bet365Events] = await Promise.all([
    fetchNBAEvents(),
    fetchBet365Props().catch(() => []),
  ])

  if (games.length === 0) return { bets: [], remainingRequests: '' }

  const bets = []
  let remainingRequests = ''

  for (const event of games) {
    if (onProgress) onProgress(`${event.away_team} @ ${event.home_team}...`)

    const gameLabel = `${event.away_team} @ ${event.home_team}`
    const playerMap = {}

    // 1. The Odds API (Pinnacle / DraftKings / FanDuel) — quando disponível
    try {
      const oddsResult = await fetchEventOdds(event.id)
      if (oddsResult.remainingRequests) remainingRequests = oddsResult.remainingRequests
      if (oddsResult.bookmakers.length) {
        aggregateBookmakers(oddsResult.bookmakers, playerMap, gameLabel)
      }
    } catch {
      // segue sem The Odds API
    }

    // 2. bet365 via odds-api.io
    const homeNorm = normalizeTeam(event.home_team)
    const awayNorm = normalizeTeam(event.away_team)
    const homeWord = normalizeTeam(event.home_team.split(' ').pop())
    const awayWord = normalizeTeam(event.away_team.split(' ').pop())

    const b365Event = bet365Events.find((ev) => {
      const h     = normalizeTeam(ev.homeTeam)
      const a     = normalizeTeam(ev.awayTeam)
      const hWord = normalizeTeam(ev.homeTeam.split(' ').pop())
      const aWord = normalizeTeam(ev.awayTeam.split(' ').pop())

      const homeMatch =
        homeNorm.includes(h) || h.includes(homeNorm) ||
        homeNorm.includes(hWord) || hWord.includes(homeWord)
      const awayMatch =
        awayNorm.includes(a) || a.includes(awayNorm) ||
        awayNorm.includes(aWord) || aWord.includes(awayWord)

      return homeMatch && awayMatch
    })

    if (b365Event?.bookmakers?.length) {
      aggregateBookmakers(b365Event.bookmakers, playerMap, gameLabel)
    }

    // 3. Monta apostas brutas
    for (const entry of Object.values(playerMap)) {
      if (entry.odds.length < 1) continue

      const bestOdd  = Math.max(...entry.odds)
      const bestBook = entry.books[entry.odds.indexOf(bestOdd)]

      const prob = entry.odds.length >= 2
        ? fairProbFromBooks(entry.odds)
        : Number(((1 / entry.odds[0]) * 100).toFixed(1))

      bets.push({
        player:       entry.player,
        market:       entry.market,
        type:         entry.type,
        line:         entry.line,
        lineLabel:    `${entry.line}+ ${entry.market}`,
        game:         entry.game,
        prob,
        odd:          bestOdd,
        book:         bestBook,
        n:            entry.odds.length,
        ev:           liveEV(prob, bestOdd),
        kelly:        liveKelly(prob, bestOdd),
        hrStr:        null,
        seasonHR:     null,
        qualityScore: 0,
        isHighValue:  false,
        isPositive:   false,
        isNegative:   false,
      })
    }
  }

  // 4. Enriquece com stats da temporada
  if (onProgress) onProgress('stats da temporada...')
  const enriched = await enrichWithSeasonStats(bets)

  enriched.sort((a, b) => b.ev - a.ev)
  return { bets: enriched, remainingRequests }
}
