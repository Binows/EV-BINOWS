import { useState } from 'react'
import { calcQualityScore } from '../functions/evMath'

function Stars({ score }) {
  const s = Math.max(1, Math.min(5, Math.round(score || 1)))
  return (
    <span className="quality-stars" title={`Qualidade: ${s}/5`}>
      {'★'.repeat(s)}{'☆'.repeat(5 - s)}
    </span>
  )
}

const SORT_OPTIONS = [
  { value: 'ev',       label: 'Maior EV%' },
  { value: 'odd',      label: 'Maior Odd' },
  { value: 'season',   label: 'Maior % Temporada' },
  { value: 'kelly',    label: 'Maior % Banca' },
  { value: 'quality',  label: 'Melhor Qualidade' },
]

function sortItems(items, sortBy) {
  const copy = [...items]
  switch (sortBy) {
    case 'odd':
      return copy.sort((a, b) => b.odd - a.odd)
    case 'season':
      return copy.sort((a, b) => {
        const pctA = a.seasonHR?.pct ?? -1
        const pctB = b.seasonHR?.pct ?? -1
        return pctB - pctA
      })
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

export default function TopEvPanel({ items }) {
  const [sortBy, setSortBy] = useState('ev')

  const filtered = items.filter((item) => item.odd >= 2.0)
  if (!filtered.length) return null

  const sorted = sortItems(filtered, sortBy)

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
