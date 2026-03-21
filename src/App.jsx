import { useEffect, useMemo, useState } from 'react'
import LiveBetsPanel from './components/LiveBetsPanel'
import ManualControls from './components/ManualControls'
import MetricsPanel from './components/MetricsPanel'
import PlayerCards from './components/PlayerCards'
import ShareBox from './components/ShareBox'
import TopBar from './components/TopBar'
import TopEvPanel from './components/TopEvPanel'
import { NBA_TEAMS } from './components/TeamFilter'
import {
  buildManualView,
  datasetsToChipData,
  enrichPlayersWithSeasonStats,
  getUniquePlayerMarkets,
  parseJsonFiles,
} from './functions/dataTransforms'
import { fetchLiveBets } from './functions/liveApi'
import { buildShareUrl, loadSession, saveSession } from './services/firebaseService'
import { fetchPlayerGameLogs } from './services/nbaStatsService'

const STORAGE_KEY = 'ev_datasets'
const STATS_BATCH = 5

function getDefaultMetrics() {
  return { cntPos: 0, cntTotal: 0, bestEVText: '—', lastUpdate: '—' }
}

// Extrai lista de nomes de times únicos a partir das apostas
function extractTeamNames(bets) {
  const names = new Set()
  for (const bet of bets) {
    if (!bet.game) continue
    // game = "Away @ Home"
    const parts = bet.game.split(' @ ')
    if (parts[0]) names.add(parts[0].trim())
    if (parts[1]) names.add(parts[1].trim())
  }
  return Array.from(names)
}

// Verifica se uma aposta pertence a algum dos times selecionados
function betMatchesTeams(bet, activeTeams) {
  if (!activeTeams.length) return true
  return activeTeams.some((abbr) => {
    const team = NBA_TEAMS.find((t) => t.abbr === abbr)
    if (!team) return false
    const gameLower = bet.game.toLowerCase()
    const teamWords = team.name.toLowerCase().split(' ')
    const lastName = teamWords[teamWords.length - 1]
    return gameLower.includes(lastName)
  })
}

export default function App() {
  // --- UI state ---
  const [mode, setMode] = useState('manual')
  const [filter, setFilter] = useState('todos')
  const [oddThreshold, setOddThreshold] = useState(2)
  const [playerSearch, setPlayerSearch] = useState('')
  const [activeTeams, setActiveTeams] = useState([])  // filtro de times

  // --- Data state ---
  const [datasets, setDatasets] = useState([])
  const [liveBets, setLiveBets] = useState([])
  const [loadingLive, setLoadingLive] = useState('')
  const [remainingRequests, setRemainingRequests] = useState('')

  // --- Season stats state ---
  const [seasonLogs, setSeasonLogs] = useState({})
  const [statsStatus, setStatsStatus] = useState('')

  // --- Share state ---
  const [shareUrl, setShareUrl] = useState('')
  const [shareStatus, setShareStatus] = useState('')

  // --- Persist/restore datasets ---
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) setDatasets(parsed)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets))
  }, [datasets])

  // --- Extension sync ---
  useEffect(() => {
    let isMounted = true
    async function syncFromExtension() {
      try {
        if (typeof globalThis.browser === 'undefined') return
        if (!globalThis.browser?.storage?.local?.get) return
        const data = await globalThis.browser.storage.local.get('ev_datasets')
        if (!data?.ev_datasets) return
        const parsed = JSON.parse(data.ev_datasets)
        if (!Array.isArray(parsed) || parsed.length === 0) return
        const latestExt = Math.max(...parsed.map((d) => new Date(d.scrapedAt || 0).getTime()))
        const latestLocal = datasets.length
          ? Math.max(...datasets.map((d) => new Date(d.scrapedAt || 0).getTime()))
          : 0
        if (latestExt <= latestLocal || !isMounted) return
        setDatasets(parsed)
        setShareStatus('Dados atualizados automaticamente pela extensao.')
        setTimeout(() => { if (isMounted) setShareStatus('') }, 3000)
      } catch { /* silent */ }
    }
    syncFromExtension()
    const timer = setInterval(syncFromExtension, 30000)
    return () => { isMounted = false; clearInterval(timer) }
  }, [datasets])

  // --- Load shared session ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('s')
    if (!sessionId) return
    setShareStatus('Carregando sessao compartilhada...')
    loadSession(sessionId)
      .then((saved) => {
        setDatasets(saved)
        setShareStatus('')
        const url = new URL(window.location.href)
        url.searchParams.delete('s')
        window.history.replaceState({}, '', url.toString())
      })
      .catch((err) => setShareStatus(`Erro ao carregar sessao: ${err.message}`))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auto-load live ---
  useEffect(() => {
    if (mode === 'live' && liveBets.length === 0 && !loadingLive) {
      loadLiveData()
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- NBA season stats enrichment ---
  useEffect(() => {
    if (!datasets.length) {
      setSeasonLogs({})
      setStatsStatus('')
      return
    }
    let cancelled = false
    async function run() {
      const pairs = getUniquePlayerMarkets(datasets)
      if (!pairs.length) return
      setStatsStatus(`Buscando stats: 0/${pairs.length}`)
      for (let i = 0; i < pairs.length; i += STATS_BATCH) {
        if (cancelled) return
        const batch = pairs.slice(i, i + STATS_BATCH)
        const results = await Promise.all(
          batch.map(async ({ player, market }) => {
            try {
              const logs = await fetchPlayerGameLogs(player)
              return { player, market, logs }
            } catch {
              return { player, market, logs: null }
            }
          }),
        )
        if (!cancelled) {
          setSeasonLogs((prev) => {
            const next = { ...prev }
            for (const { player, market, logs } of results) {
              if (logs) next[`${player}|${market}`] = logs
            }
            return next
          })
          setStatsStatus(`Buscando stats: ${Math.min(i + STATS_BATCH, pairs.length)}/${pairs.length}`)
        }
        if (i + STATS_BATCH < pairs.length) await new Promise((r) => setTimeout(r, 250))
      }
      if (!cancelled) setStatsStatus('')
    }
    run()
    return () => { cancelled = true }
  }, [datasets])

  // --- Manual view ---
  const manualView = useMemo(
    () => buildManualView(datasets, { filter, oddThreshold, playerSearch }),
    [datasets, filter, oddThreshold, playerSearch],
  )

  const enrichedPlayers = useMemo(
    () => enrichPlayersWithSeasonStats(manualView.players, seasonLogs),
    [manualView.players, seasonLogs],
  )

  const enrichedAllPlayers = useMemo(
    () => enrichPlayersWithSeasonStats(manualView.topEV_source, seasonLogs),
    [manualView.topEV_source, seasonLogs],
  )

  const enrichedTopEV = useMemo(() => {
    const topEV = []
    for (const player of enrichedAllPlayers) {
      for (const line of player.lines) {
        if (line.ev > 3) topEV.push(line)
      }
    }
    return topEV.sort((a, b) => b.ev - a.ev)
  }, [enrichedAllPlayers])

  // --- Live view ---
  const availableTeams = useMemo(() => extractTeamNames(liveBets), [liveBets])

  const liveFiltered = useMemo(() => {
    let data = [...liveBets]

    // Filtro de mercado
    if (filter === 'pos') data = data.filter((item) => item.ev > 3)
    if (filter === 'pts') data = data.filter((item) => item.type === 'pts')
    if (filter === 'reb') data = data.filter((item) => item.type === 'reb')
    if (filter === 'ast') data = data.filter((item) => item.type === 'ast')
    if (filter === '3pts' || filter === '3pt') data = data.filter((item) => item.type === '3pt')

    // Filtro de odd mínima
    data = data.filter((item) => item.odd >= oddThreshold)

    // Filtro de times (seleção múltipla)
    if (activeTeams.length > 0) {
      data = data.filter((item) => betMatchesTeams(item, activeTeams))
    }

    // Busca por jogador ou time
    if (playerSearch.trim()) {
      const q = playerSearch.toLowerCase().trim()
      data = data.filter((item) =>
        item.player.toLowerCase().includes(q) ||
        item.game.toLowerCase().includes(q)
      )
    }

    return data
  }, [filter, liveBets, playerSearch, oddThreshold, activeTeams])

  const liveMetrics = useMemo(() => {
    const positives = liveBets.filter((bet) => bet.ev > 3)
    const best = positives.length ? Math.max(...positives.map((bet) => bet.ev)) : null
    return {
      cntPos: positives.length,
      cntTotal: liveBets.length,
      bestEVText: best !== null ? `+${best.toFixed(1)}%` : '—',
      lastUpdate: liveBets.length
        ? new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : '—',
    }
  }, [liveBets])

  const metrics = mode === 'manual' ? manualView.metrics : liveMetrics
  const chips = datasetsToChipData(datasets)

  // --- Handlers ---
  const handleThresholdChange = (value) => {
    const parsed = Number.parseFloat(value)
    if (Number.isNaN(parsed) || parsed < 1.01) return
    setOddThreshold(parsed)
  }

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList)
    const next = await parseJsonFiles(files, datasets)
    setDatasets(next)
    if (filter !== 'todos' && filter !== 'pos') setFilter('todos')
  }

  const handleRemoveDataset = (index) => {
    setDatasets((prev) => prev.filter((_, i) => i !== index))
  }

  const clearData = () => {
    setDatasets([])
    setShareUrl('')
    setShareStatus('')
  }

  const loadLiveData = async () => {
    setLoadingLive('Buscando jogos...')
    try {
      const result = await fetchLiveBets((message) => {
        setLoadingLive(`Buscando ${message}`)
      })
      setLiveBets(result.bets)
      setRemainingRequests(result.remainingRequests)
    } catch (error) {
      setLiveBets([])
      setLoadingLive(`Erro: ${error.message}`)
      return
    }
    setLoadingLive('')
  }

  // Toggle time: null = limpar tudo, abbr = toggle individual
  const handleToggleTeam = (abbr, _name) => {
    if (abbr === null) {
      setActiveTeams([])
      return
    }
    setActiveTeams((prev) =>
      prev.includes(abbr) ? prev.filter((a) => a !== abbr) : [...prev, abbr]
    )
  }

  const handleShare = async () => {
    if (!datasets.length) return
    setShareStatus('Salvando...')
    setShareUrl('')
    try {
      const sessionId = await saveSession(datasets)
      const url = buildShareUrl(sessionId)
      setShareUrl(url)
      setShareStatus('')
    } catch (err) {
      setShareStatus(`Erro: ${err.message}`)
    }
  }

  const handleCopyLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareStatus('Link copiado!')
      setTimeout(() => setShareStatus(''), 3000)
    } catch {
      setShareStatus('Erro ao copiar')
    }
  }

  return (
    <>
      <TopBar
        mode={mode}
        onModeChange={setMode}
        filter={filter}
        onFilterChange={setFilter}
        threshold={oddThreshold}
        onThresholdChange={handleThresholdChange}
        search={playerSearch}
        onSearchChange={setPlayerSearch}
        onRefreshLive={mode === 'live' ? loadLiveData : undefined}
        activeTeams={activeTeams}
        onToggleTeam={handleToggleTeam}
        availableTeams={availableTeams}
      />

      <main className="container">
        <MetricsPanel metrics={metrics || getDefaultMetrics()} />

        {mode === 'manual' ? (
          <>
            <ManualControls
              chips={chips}
              onFiles={handleFiles}
              onRemoveChip={handleRemoveDataset}
              onClear={clearData}
              onShare={handleShare}
            />
            <ShareBox url={shareUrl} status={shareStatus} onCopy={handleCopyLink} />
            {statsStatus && <div className="stats-status">{statsStatus}</div>}
            <TopEvPanel items={enrichedTopEV} />
            <div className="section-title">player props</div>
            <PlayerCards players={enrichedPlayers} />
          </>
        ) : (
          <>
            <LiveBetsPanel bets={liveFiltered} loadingText={loadingLive} />
            <div className="footer">
              <span className="footer-txt">
                bet365 via odds-api.io + NBA Stats - by Binows
              </span>
              {remainingRequests ? (
                <span className="req-info">{remainingRequests} req restantes</span>
              ) : null}
            </div>
          </>
        )}
      </main>
    </>
  )
}
