function LineCard({ line }) {
  const statusClass = line.isPositive ? 'pos' : line.isNegative ? 'neg' : 'neu'
  const signalLabel = line.isPositive ? 'EV+' : line.isNegative ? 'EV-' : 'neutro'

  return (
    <div
      className={`line-card ${line.isPositive ? 'ev-plus' : ''} ${line.isNegative ? 'ev-minus' : ''} ${line.isHighValue ? 'high-value' : ''}`}
    >
      <div className="line-label">{line.lineLabel}</div>
      <div className="line-odd">{line.odd.toFixed(2)}</div>
      <div className="line-stats">
        <div className="line-stat">
          <span className="line-stat-label">Prob. fair</span>
          <span className="line-stat-val">{(line.prob * 100).toFixed(1)}%</span>
        </div>
        <div className="line-stat">
          <span className="line-stat-label">EV</span>
          <span className={`line-stat-val ${statusClass}`}>{line.ev > 0 ? '+' : ''}{line.ev}%</span>
        </div>
        {typeof line.oddNao === 'number' ? (
          <div className="line-stat">
            <span className="line-stat-label">Odd nao</span>
            <span className="line-stat-val">{line.oddNao.toFixed(2)}</span>
          </div>
        ) : null}
        <div className="line-stat">
          <span className="line-stat-label">% banca</span>
          <span className={`line-stat-val ${line.kelly > 0 ? 'pos' : ''}`}>
            {line.kelly > 0 ? `${line.kelly}%` : '—'}
          </span>
        </div>
        <div className="line-stat">
          <span className="line-stat-label">Temporada</span>
          <span className="line-stat-val season-hr">
            {line.hrStr ?? <span className="loading-dots">...</span>}
          </span>
        </div>
      </div>
      <span className={`ev-signal ${statusClass}`}>{signalLabel}</span>
    </div>
  )
}

export default function PlayerCards({ players }) {
  if (!players.length) return <div className="empty">Nenhum resultado para este filtro.</div>

  return (
    <section>
      {players.map((player) => (
        <article
          className={`player-card ${player.lines.some((line) => line.isPositive) ? 'has-ev' : ''}`}
          key={`${player.player}-${player.market}-${player.gameName}`}
        >
          <div className="player-header">
            <div className="player-name">
              {player.player}
              {player.gameName ? <span className="game-name">{player.gameName}</span> : null}
            </div>
            <div className="player-meta">
              <span className="market-badge">{player.market}</span>
              {typeof player.lambda === 'number' ? (
                <span className="last5">lambda={player.lambda.toFixed(2)}</span>
              ) : null}
            </div>
          </div>
          <div className="lines">
            {player.lines.map((line) => (
              <LineCard
                key={`${player.player}-${line.market}-${line.rawLabel}-${line.odd}`}
                line={line}
              />
            ))}
          </div>
        </article>
      ))}
    </section>
  )
}