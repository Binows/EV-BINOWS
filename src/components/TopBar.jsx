const FILTERS = [
  { key: 'todos', label: 'Todos' },
  { key: 'pos', label: 'So EV+' },
  { key: 'pts', label: 'Pontos' },
  { key: 'reb', label: 'Rebotes' },
  { key: 'ast', label: 'Assistencias' },
  { key: '3pts', label: '3 Pts' },
]

export default function TopBar({
  mode,
  onModeChange,
  filter,
  onFilterChange,
  threshold,
  onThresholdChange,
  search,
  onSearchChange,
  onRefreshLive,
}) {
  return (
    <header className="topbar">
      <div className="logo">
        <span className="logo-dot" />
        EV-BINOWS
        {mode === 'live' ? <span className="live-badge">AO VIVO</span> : null}
      </div>
      <div className="mode-tabs">
        <button
          type="button"
          className={`mode-tab ${mode === 'manual' ? 'active' : ''}`}
          onClick={() => onModeChange('manual')}
        >
          Manual
        </button>
        <button
          type="button"
          className={`mode-tab ${mode === 'live' ? 'active' : ''}`}
          onClick={() => onModeChange('live')}
        >
          Live
        </button>
        {mode === 'live' && onRefreshLive && (
          <button
            type="button"
            className="mode-tab refresh-topbar"
            onClick={onRefreshLive}
          >
            ↻ Atualizar
          </button>
        )}
      </div>
      <div className="filters">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`filter-btn ${filter === item.key ? 'active' : ''}`}
            onClick={() => onFilterChange(item.key)}
          >
            {item.label}
          </button>
        ))}
        <div className="threshold-control">
          <span className="threshold-label">odd min. {threshold.toFixed(2)}</span>
          <input
            className="threshold-input"
            type="number"
            min="1.01"
            max="20"
            step="0.1"
            value={threshold}
            onChange={(e) => onThresholdChange(e.target.value)}
          />
        </div>
        <div className="search-control">
          <span className="search-icon">Search</span>
          <input
            className="search-input"
            type="text"
            placeholder="Buscar jogador"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>
    </header>
  )
}
