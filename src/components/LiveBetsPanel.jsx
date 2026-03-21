import { useMemo, useState } from 'react'
import { calcQualityScore } from '../functions/evMath'

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

function Stars({ score }) {
  const s = Math.max(1, Math.min(5, Math.round(score || 1)))
  return (
    <span className="quality-stars" title={`Qualidade: ${s}/5`}>
      {'★'.repeat(s)}{'☆'.repeat(5 - s)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// LineCard — idêntico ao Manual
// ---------------------------------------------------------------------------

function LineCard({ line }) {
  const isPositive = line.ev > 3
  const isNegative = line.ev < -3
  const statusClass = isPositive ? 'pos' : isNegative ? 'neg' : 'neu'
  const signalLabel = isPositive ? 'EV+' : isNegative ? 'EV-' : 'neutro'
  const probDisplay = line.prob > 1 ? line.prob : line.prob * 100
  const quality = line.qualityScore ?? calcQualityScore(line.ev, line.odd, line.hrStr || '')

  return (
    <div
      className={`line-card ${isPositive ? 'ev-plus' : ''} ${isNegative ? 'ev-minus' : ''} ${line.isHighValue ? 'high-value' : ''}`}
    >
      <div className="line-label">{line.line}+ {line.market}</div>
      <div className="line-odd">{line.odd.toFixed(2)}</div>
      <div className="line-stats">
        <div className="line-stat">
          <span className="line-stat-label">Prob. fair</span>
          <span className="line-stat-val">{probDisplay.toFixed(1)}%</span>
        </div>
        <div className="line-stat">
          <span className="line-stat-label">EV</span>
          <span className={`line-stat-val ${statusClass}`}>
            {line.ev > 0 ? '+' : ''}{line.ev.toFixed(1)}%
          </span>
        </div>
        <div className="line-stat">
          <span className="line-stat-label">% banca</span>
          <span className={`line-stat-val ${line.kelly > 0 ? 'pos' : ''}`}>
            {line.kelly > 0 ? `${line.kelly.toFixed(2)}%` : '—'}
          </span>
        </div>
        <div className="line-stat">
          <span className="line-stat-label">Temporada</span>
          <span className="line-stat-val season-hr">
            {line.hrStr ?? <span className="loading-dots">...</span>}
          </span>
        </div>
        <div className="line-stat">
          <span className="line-stat-label">Casa</span>
          <span className="line-stat-val">{line.book}</span>
        </div>
      </div>
      <div className="line-footer">
        <Stars score={quality} />
        <span className={`ev-signal ${statusClass}`}>{signalLabel}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Agrupa apostas por jogador+jogo
// ---------------------------------------------------------------------------

function groupByPlayer(bets) {
  const map = new Map()
  for (const bet of bets) {
    const key = `${bet.player}||${bet.game}`
    if (!map.has(key)) {
      map.set(key, {
        player: bet.player,
        game:   bet.game,
        lines:  [],
        hasEV:  false,
      })
    }
    const group = map.get(key)
    group.lines.push(bet)
    if (bet.ev > 3) group.hasEV = true
  }
  return Array.from(map.values())
}

// ---------------------------------------------------------------------------
// PlayerCard agrupado
// ---------------------------------------------------------------------------

function PlayerCard({ group }) {
  return (
    <article className={`player-card ${group.hasEV ? 'has-ev' : ''}`}>
      <div className="player-header">
        <div className="player-name">
          {group.player}
          {group.game ? <span className="game-name">{group.game}</span> : null}
        </div>
        <div className="player-meta">
          <span className="market-badge">{group.lines.length} prop{group.lines.length > 1 ? 's' : ''}</span>
        </div>
      </div>
      <div className="lines">
        {group.lines.map((line) => (
          <LineCard
            key={`${line.player}-${line.lineLabel}-${line.book}`}
            line={line}
          />
        ))}
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Top EV Live
// ---------------------------------------------------------------------------

const SORT_OPTIONS = [
  { value: 'ev',      label: 'Maior EV%' },
  { value: 'odd',     label: 'Maior Odd' },
  { value: 'season',  label: 'Maior % Temporada' },
  { value: 'kelly',   label: 'Maior % Banca' },
  { value: 'quality', label: 'Melhor Qualidade' },
]

function sortItems(items, sortBy) {
  const copy = [...items]
  switch (sortBy) {
    case 'odd':
      return copy.sort((a, b) => b.odd - a.odd)
    case 'season':
      return copy.sort((a, b) => (b.seasonHR?.pct ?? -1) - (a.seasonHR?.pct ?? -1))
    case 'kelly':
      return copy.sort((a, b) => b.kelly - a.kelly)
    case 'quality':
      return copy.sort((a, b) => {
        const qA = a.qualityScore ?? calcQualityScore(a.ev, a.odd, a.hrStr || '')
        const qB = b.qualityScore ?? calcQualityScore(b.ev, b.odd, b.hrStr || '')
        return qB - qA
      })
    default:
      return copy.sort((a, b) => b.ev - a.ev)
  }
}

function TopEvLive({ bets }) {
  const [sortBy, setSortBy] = useState('ev')
  const topItems = bets.filter((b) => b.ev > 3 && b.odd >= 2)
  if (!topItems.length) return null
  const sorted = sortItems(topItems, sortBy)

  return (
    <section className="top-ev">
      <div className="top-ev-header">
        <div className="top-ev-title">Maiores EV+ da rodada</div>
        <div className="top-ev-sort">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`sort-btn ${sortBy === opt.value ? 'active' : ''}`}
              onClick={() => setSortBy(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="top-ev-list">
        {sorted.slice(0, 20).map((item, index) => {
          const quality = item.qualityScore ?? calcQualityScore(item.ev, item.odd, item.hrStr || '')
          return (
            <div
              key={`${item.player}-${item.lineLabel}-${item.book}-${index}`}
              className={`top-ev-item ${item.isHighValue ? 'high-value' : ''}`}
            >
              <span className="top-ev-rank">{index + 1}</span>
              <span className="top-ev-player">{item.player}</span>
              <span className="top-ev-line">{item.line}+ {item.market}</span>
              <span className="top-ev-odd">@ {item.odd.toFixed(2)}</span>
              <span className="top-ev-ev">+{item.ev.toFixed(1)}%</span>
              <Stars score={quality} />
              {item.hrStr && <span className="top-ev-hr">{item.hrStr}</span>}
              <span className="top-ev-banca">
                {item.kelly > 0 ? `${item.kelly.toFixed(2)}% banca` : ''}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function LiveBetsPanel({ bets, loadingText }) {
  if (loadingText) {
    return (
      <div className="loading">
        <span className="spinner" />
        {loadingText}
      </div>
    )
  }

  if (!bets.length) {
    return <div className="empty">Nenhuma aposta encontrada.</div>
  }

  const grouped = useMemo(() => groupByPlayer(bets), [bets])

  return (
    <>
      <TopEvLive bets={bets} />
      <div className="section-title" style={{ marginTop: '1.5rem' }}>todas as props</div>
      <section>
        {grouped.map((group) => (
          <PlayerCard
            key={`${group.player}||${group.game}`}
            group={group}
          />
        ))}
      </section>
    </>
  )
}
