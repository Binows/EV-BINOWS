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

  return (
    <section>
      {bets.map((bet) => {
        const isPositive = bet.ev > 2
        const isNegative = bet.ev < -2
        const signalClass = isPositive ? 'pos' : isNegative ? 'neg' : 'neu'

        return (
          <article
            key={`${bet.player}-${bet.market}-${bet.book}`}
            className="player-card live-row"
            style={{ borderLeftColor: isPositive ? '#4caf50' : isNegative ? '#e53935' : '#666' }}
          >
            <div className="live-main">
              <div className="player-header compact">
                <span className="player-name">{bet.player}</span>
                <span className="market-badge">{bet.market}</span>
              </div>
              <div className="live-game">{bet.game}</div>
              <div className="live-stats">
                <span className="line-stat">prob. fair {bet.prob}%</span>
                <span className="line-stat">casas {bet.n}</span>
                <span className="line-stat">melhor em {bet.book}</span>
                <span className="line-stat">banca {bet.kelly > 0 ? `${bet.kelly}%` : '—'}</span>
              </div>
            </div>
            <div className="live-side">
              <span className={`ev-signal ${signalClass}`}>
                EV {bet.ev > 0 ? '+' : ''}{bet.ev.toFixed(1)}%
              </span>
              <span className="live-odd">odd {bet.odd.toFixed(2)}</span>
            </div>
          </article>
        )
      })}
    </section>
  )
}
