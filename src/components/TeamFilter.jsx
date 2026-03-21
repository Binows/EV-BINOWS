/**
 * TeamFilter.jsx
 * Filtro de times NBA com logos oficiais e seleção múltipla.
 * Aparece abaixo do logo EV-BINOWS na topbar no modo Live.
 */

// IDs oficiais dos times na NBA CDN
const NBA_TEAMS = [
  { id: 1610612737, name: 'Atlanta Hawks',          abbr: 'ATL' },
  { id: 1610612738, name: 'Boston Celtics',          abbr: 'BOS' },
  { id: 1610612751, name: 'Brooklyn Nets',           abbr: 'BKN' },
  { id: 1610612766, name: 'Charlotte Hornets',       abbr: 'CHA' },
  { id: 1610612741, name: 'Chicago Bulls',           abbr: 'CHI' },
  { id: 1610612739, name: 'Cleveland Cavaliers',     abbr: 'CLE' },
  { id: 1610612742, name: 'Dallas Mavericks',        abbr: 'DAL' },
  { id: 1610612743, name: 'Denver Nuggets',          abbr: 'DEN' },
  { id: 1610612765, name: 'Detroit Pistons',         abbr: 'DET' },
  { id: 1610612744, name: 'Golden State Warriors',   abbr: 'GSW' },
  { id: 1610612745, name: 'Houston Rockets',         abbr: 'HOU' },
  { id: 1610612754, name: 'Indiana Pacers',          abbr: 'IND' },
  { id: 1610612746, name: 'LA Clippers',             abbr: 'LAC' },
  { id: 1610612747, name: 'Los Angeles Lakers',      abbr: 'LAL' },
  { id: 1610612763, name: 'Memphis Grizzlies',       abbr: 'MEM' },
  { id: 1610612748, name: 'Miami Heat',              abbr: 'MIA' },
  { id: 1610612749, name: 'Milwaukee Bucks',         abbr: 'MIL' },
  { id: 1610612750, name: 'Minnesota Timberwolves',  abbr: 'MIN' },
  { id: 1610612740, name: 'New Orleans Pelicans',    abbr: 'NOP' },
  { id: 1610612752, name: 'New York Knicks',         abbr: 'NYK' },
  { id: 1610612760, name: 'Oklahoma City Thunder',   abbr: 'OKC' },
  { id: 1610612753, name: 'Orlando Magic',           abbr: 'ORL' },
  { id: 1610612755, name: 'Philadelphia 76ers',      abbr: 'PHI' },
  { id: 1610612756, name: 'Phoenix Suns',            abbr: 'PHX' },
  { id: 1610612757, name: 'Portland Trail Blazers',  abbr: 'POR' },
  { id: 1610612758, name: 'Sacramento Kings',        abbr: 'SAC' },
  { id: 1610612759, name: 'San Antonio Spurs',       abbr: 'SAS' },
  { id: 1610612761, name: 'Toronto Raptors',         abbr: 'TOR' },
  { id: 1610612762, name: 'Utah Jazz',               abbr: 'UTA' },
  { id: 1610612764, name: 'Washington Wizards',      abbr: 'WAS' },
]

function logoUrl(teamId) {
  return `https://cdn.nba.com/logos/nba/${teamId}/global/L/logo.svg`
}

export { NBA_TEAMS }

export default function TeamFilter({ activeTeams, onToggleTeam, availableTeams }) {
  if (!availableTeams || availableTeams.length === 0) return null

  // Só mostra times que têm jogos disponíveis hoje
  const teamsToShow = NBA_TEAMS.filter((t) =>
    availableTeams.some((name) =>
      name.toLowerCase().includes(t.name.split(' ').pop().toLowerCase()) ||
      t.name.toLowerCase().includes(name.toLowerCase().split(' ').pop())
    )
  )

  if (teamsToShow.length === 0) return null

  return (
    <div className="team-filter">
      {teamsToShow.map((team) => {
        const isActive = activeTeams.includes(team.abbr)
        return (
          <button
            key={team.abbr}
            type="button"
            className={`team-btn ${isActive ? 'active' : ''}`}
            title={team.name}
            onClick={() => onToggleTeam(team.abbr, team.name)}
          >
            <img
              src={logoUrl(team.id)}
              alt={team.abbr}
              className="team-logo"
              onError={(e) => {
                e.target.style.display = 'none'
                e.target.nextSibling.style.display = 'inline'
              }}
            />
            <span className="team-abbr-fallback" style={{ display: 'none' }}>
              {team.abbr}
            </span>
          </button>
        )
      })}
      {activeTeams.length > 0 && (
        <button
          type="button"
          className="team-btn team-clear"
          onClick={() => onToggleTeam(null)}
          title="Limpar filtro de times"
        >
          ✕
        </button>
      )}
    </div>
  )
}
