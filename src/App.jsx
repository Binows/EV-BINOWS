import { useEffect, useMemo, useState } from 'react'
import LiveBetsPanel from './components/LiveBetsPanel'
import ManualControls from './components/ManualControls'
import MetricsPanel from './components/MetricsPanel'
import PlayerCards from './components/PlayerCards'
import ShareBox from './components/ShareBox'
import TopBar from './components/TopBar'
import TopEvPanel from './components/TopEvPanel'
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

export default function App() {
  // --- UI state ---
  const [mode, setMode] = useState('manual')
  const [filter, setFilter] = useState('todos')
  const [oddThreshold, setOddThreshold] = useState(2)
  const [playerSearch, setPlayerSearch] = useState('')

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

  // --- Persist/restore datasets from localStorage ---
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) setDatasets(parsed)
    } catch {
      // Ignore corrupted local storage.
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets))
  }, [datasets])

  // --- Optional extension sync (legacy parity): poll browser.storage every 30s ---
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

        const latestExt = Math.max(
          ...parsed.map((d) => new Date(d.scrapedAt || 0).getTime()),
        )
        const latestLocal = datasets.length
          ? Math.max(...datasets.map((d) => new Date(d.scrapedAt || 0).getTime()))
          : 0

        if (latestExt <= latestLocal || !isMounted) return

        setDatasets(parsed)
        setShareStatus('Dados atualizados automaticamente pela extensao.')
        setTimeout(() => {
          if (isMounted) setShareStatus('')
        }, 3000)
      } catch {
        // Silent fail: extension API may not be available in normal browsers.
      }
    }

    syncFromExtension()
    const timer = setInterval(syncFromExtension, 30000)

    return () => {
      isMounted = false
      clearInterval(timer)
    }
  }, [datasets])

  // --- Load shared session from URL ?s= param ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('s')
    if (!sessionId) return

    setShareStatus('Carregando sessao compartilhada...')
    loadSession(sessionId)
      .then((saved) => {
        setDatasets(saved)
        setShareStatus('')
        // Remove the param without causing a reload
        const url = new URL(window.location.href)
        url.searchParams.delete('s')
        window.history.replaceState({}, '', url.toString())
      })
      .catch((err) => {
        setShareStatus(`Erro ao carregar sessao: ${err.message}`)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // --- NBA season stats enrichment (fires whenever datasets change) ---
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

        if (i + STATS_BATCH < pairs.length) {
          await new Promise((r) => setTimeout(r, 250))
        }
      }

      if (!cancelled) setStatsStatus('')
    }

    run()
    return () => {
      cancelled = true
    }
  }, [datasets])

  // --- Manual view model (memoised) ---
  const manualView = useMemo(
    () => buildManualView(datasets, { filter, oddThreshold, playerSearch }),
    [datasets, filter, oddThreshold, playerSearch],
  )

  // Second-pass enrichment with season logs
  const enrichedPlayers = useMemo(
    () => enrichPlayersWithSeasonStats(manualView.players, seasonLogs),
    [manualView.players, seasonLogs],
  )

  const enrichedTopEV = useMemo(() => {
    const topEV = []
    for (const player of enrichedPlayers) {
      for (const line of player.lines) {
        if (line.isPositive) topEV.push(line)
      }
    }
    return topEV.sort((a, b) => b.ev - a.ev)
  }, [enrichedPlayers])

  // --- Live view model ---
  const liveFiltered = useMemo(() => {
    let data = [...liveBets]
    if (filter === 'pos') data = data.filter((item) => item.ev > 2)
    if (filter === 'pts') data = data.filter((item) => item.type === 'pts')
    if (filter === 'reb') data = data.filter((item) => item.type === 'reb')
    if (filter === 'ast') data = data.filter((item) => item.type === 'ast')
    if (playerSearch.trim()) {
      const q = playerSearch.toLowerCase().trim()
      data = data.filter((item) => item.player.toLowerCase().includes(q))
    }
    return data
  }, [filter, liveBets, playerSearch])

  const liveMetrics = useMemo(() => {
    const positives = liveBets.filter((bet) => bet.ev > 2)
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
            {statsStatus && (
              <div className="stats-status">{statsStatus}</div>
            )}
            <TopEvPanel items={enrichedTopEV} />
            <div className="section-title">player props</div>
            <PlayerCards players={enrichedPlayers} />
          </>
        ) : (
          <>
            <div className="section-title">player props de hoje - NBA</div>
            <LiveBetsPanel bets={liveFiltered} loadingText={loadingLive} />
            <div className="footer">
              <span className="footer-txt">
                The Odds API - Pinnacle + DraftKings + FanDuel - by Binows
              </span>
              <span className="req-info">
                {remainingRequests ? `${remainingRequests} req restantes` : ''}
              </span>
              <button type="button" className="refresh-btn" onClick={loadLiveData}>
                Atualizar
              </button>
            </div>
          </>
        )}
      </main>
    </>
  )
}