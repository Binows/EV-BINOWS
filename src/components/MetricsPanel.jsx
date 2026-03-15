export default function MetricsPanel({ metrics }) {
  return (
    <section className="metrics">
      <div className="metric">
        <div className="metric-label">EV+ encontrados</div>
        <div className="metric-val green">{metrics.cntPos}</div>
      </div>
      <div className="metric">
        <div className="metric-label">Melhor EV+</div>
        <div className="metric-val green">{metrics.bestEVText}</div>
      </div>
      <div className="metric">
        <div className="metric-label">Props analisados</div>
        <div className="metric-val white">{metrics.cntTotal}</div>
      </div>
      <div className="metric">
        <div className="metric-label">Atualizado</div>
        <div className="metric-val white small">{metrics.lastUpdate}</div>
      </div>
    </section>
  )
}
