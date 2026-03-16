import { calcQualityScore } from '../functions/evMath'

/**
 * Renders a 1-5 star rating as filled/empty star glyphs.
 * @param {number} score - Integer 1-5
 */
function Stars({ score }) {
  const s = Math.max(1, Math.min(5, Math.round(score || 1)))
  return (
    <span className="quality-stars" title={`Qualidade: ${s}/5`}>
      {'★'.repeat(s)}{'☆'.repeat(5 - s)}
    </span>
  )
}

export default function TopEvPanel({ items }) {
  const filtered = items.filter((item) => item.odd >= 2.0)
  if (!filtered.length) return null

  return (
    <section className="top-ev">
      <div className="top-ev-title">Maiores EV+ da rodada</div>
      <div className="top-ev-list">
        {filtered.slice(0, 20).map((item, index) => {
          const quality = item.qualityScore ?? calcQualityScore(item.ev, item.odd, item.hrStr || '')
          return (
            <div
              className={`top-ev-item ${item.isHighValue ? 'high-value' : ''}`}
              key={`${item.slug}-${item.market}-${item.rawLabel}`}
            >
              <span className="top-ev-rank">{index + 1}</span>
              <span className="top-ev-player">{item.player}</span>
              <span className="top-ev-line">
                {item.rawLabel} {item.marketLabel}
              </span>
              <span className="top-ev-odd">@ {item.odd.toFixed(2)}</span>
              <span className="top-ev-ev">+{item.ev.toFixed(1)}%</span>
              <Stars score={quality} />
              {item.hrStr && (
                <span className="top-ev-hr">{item.hrStr}</span>
              )}
              <span className="top-ev-banca">
                {item.kelly > 0 ? `${item.kelly.toFixed(1)}% banca` : ''}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
