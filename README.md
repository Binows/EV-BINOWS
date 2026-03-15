# EV-BINOWS

EV-BINOWS is a web application that analyzes NBA player props and estimates:
- Fair probability
- Expected Value (EV)
- Suggested stake size using Kelly Criterion

It has two modes:
- Manual mode: load exported JSON files and analyze opportunities
- Live mode: fetch and analyze same-day NBA props from supported sportsbooks

This README is written for beginners, so you can set up and run the project even if you have never programmed before.

---

## What This Project Does (Quick Summary)

EV-BINOWS helps you evaluate betting lines using math/statistics instead of guesswork.

In simple terms, it:
- Reads player props odds
- Removes bookmaker margin to estimate fair chance
- Computes EV to detect positive-edge opportunities
- Suggests bankroll allocation with a conservative Kelly approach
- Adds season-based confidence using NBA game logs
- Ranks stronger opportunities with a quality score (stars)

---

## Before You Start (Required Programs)

You need these tools installed first:

1. Node.js (required)
- Node.js runs JavaScript tools on your computer.
- npm is installed automatically with Node.js.

2. npm (comes with Node.js)
- npm installs project dependencies.

3. Vite (used by this project)
- You do not need to install Vite globally.
- Vite is installed automatically when you run npm install in this project.

Optional but recommended:
- Git (to clone/download code and update later)
- VS Code (to edit and run the project more easily)

---

## Install Node.js and npm (Step by Step)

1. Open the official Node.js website:
- https://nodejs.org/en

2. Download the LTS version (recommended for stability).

3. Run the installer and keep default options.

4. After installation, close and reopen your terminal.

5. Verify installation:

```powershell
node --version
npm --version
```

Expected result:
- You should see version numbers (for example, v24.x.x and 11.x.x).

If npm is not recognized on Windows:

```powershell
$env:Path = "C:\Program Files\nodejs;$env:Path"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
npm.cmd --version
```

---

## Get the Project on Your Machine

If you already have the project folder, skip this section.

Option A: Clone with Git

```powershell
git clone <repository-url>
cd <project-folder>
```

Option B: Download ZIP
- Download ZIP from repository page
- Extract ZIP
- Open terminal inside extracted project folder

---

## Install Project Dependencies

In the project root folder, run:

```powershell
npm install
```

What this does:
- Downloads React, Vite, and all required packages
- Creates node_modules folder

Important:
- Keep terminal open until command finishes successfully.

---

## Windows Workspace Setup (Node/npm + Permissions)

This repository includes helper scripts for Windows environments.

From inside the project folder, you can run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Enable-ProjectNodeEnv.ps1
```

What it does:
- Ensures node/npm are available in current terminal session
- Sets execution policy for current session only

Optional: persist Node path to your user PATH permanently:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Enable-ProjectNodeEnv.ps1 -PersistUserPath
```

Optional (admin/UAC): grant your Windows user full control recursively on your Projects root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Grant-ProjectsAdminAccess.ps1
```

If your terminal is opened in the parent Projects folder and not inside this repository:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Grant-ProjectsAdminAccess.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\Enable-ProjectNodeEnv.ps1
```

---

## Run in Development Mode

Start the app:

```powershell
npm run dev
```

Then open the URL shown in terminal (usually):
- http://localhost:5173

This mode is for development:
- Changes in code auto-reload in the browser

---

## Build for Production

Create optimized production files:

```powershell
npm run build
```

Output is generated in:
- dist/

To preview the production build locally:

```powershell
npm run preview
```

---

## Project Structure

EV-BINOWS/
  index.html              # Vite entry (React app)
  vite.config.js
  package.json
  src/
    main.jsx              # React bootstrap
    App.jsx               # Root component — all state management
    styles.css            # Imports base.css + app.css
    components/
      TopBar.jsx          # Mode toggle, filter chips, search, threshold input
      MetricsPanel.jsx    # Positive EV count, total, best EV, last update
      ManualControls.jsx  # File drop zone, chip list, share button
      ShareBox.jsx        # Share URL input + copy button
      TopEvPanel.jsx      # Top-15 EV+ ranking with quality stars
      PlayerCards.jsx     # Per-player prop cards with per-line stats
      LiveBetsPanel.jsx   # Live odds mode bet list
    functions/
      evMath.js           # Pure math: Poisson, EV, Kelly, quality score
      dataTransforms.js   # Dataset parsing, normalisation, enrichment
      liveApi.js          # Live-odds orchestration pipeline
    services/
      firebaseService.js  # Firebase Realtime DB: save/load shared sessions
      nbaStatsService.js  # NBA stats API: player game logs (via Worker proxy)
      oddsService.js      # The Odds API: events + odds (via Worker proxy)
    styles/
      base.css            # Reset, variables, typography
      app.css             # Component-level styles

---

## How the Algorithms Work

### 1. Fair probability and dynamic margin

Each bookmaker odd includes margin (overround). The app removes this to estimate fair probability.

Formula used:

```
margin = (1/oddSim - 1/oddNao - 1) / (1/oddSim + 1/oddNao)
fairProb = (1/odd) / (1 + margin)
```

For numeric markets where one side may be missing, the app infers missing side behavior using Poisson modeling.

### 2. Poisson calibration

For points, rebounds, assists, and 3-pointers, EV-BINOWS calibrates lambda with bisection:

```
lambda = arg min |poissonCDF(lambda, floor(line)) - fairProb|
```

Then it evaluates hit probabilities around the target line.

### 3. Expected Value

```
EV% = (fairProb * displayOdd - 1) * 100
```

EV > 0 means positive expected value.

### 4. Kelly Criterion (Half-Kelly)

```
kelly_full = (fairProb * (odd - 1) - (1 - fairProb)) / (odd - 1)
kelly      = kelly_full / 2
kelly      = min(kelly, 2.5%)
```

Half-Kelly and cap are used for risk control.

### 5. Season hit-rate adjusted Kelly

After fetching NBA game logs, hit-rate is computed as:

```
hitRate = games where stat >= line / total games
```

Kelly is adjusted by confidence tiers:
- <20%: 0.2x
- 20-39%: 0.4x
- 40-54%: 0.6x
- 55-69%: 0.8x
- >=70%: 1.0x

If sample is small (<10 games), baseline Half-Kelly is kept.

### 6. Quality score (1 to 5 stars)

Quality score combines:
- Wilson lower bound from season hit-rate
- EV contribution
- Volatility penalty for long odds
- Hit-rate safety cap for weak historical performance

### 7. Live odds pipeline

1. oddsService.fetchNBAEvents gets NBA events from worker proxy
2. oddsService.fetchEventOdds gets player props from books
3. liveApi.fetchLiveBets runs probability/EV/Kelly calculations and returns ranked opportunities

---

## Sharing Sessions

In Manual mode, click Compartilhar after loading data.

What happens:
- Current datasets are saved in Firebase Realtime Database
- A share URL is generated with a session id

Example format:

```
https://your-host/?s=<sessionId>
```

When someone opens this URL, the session data is loaded automatically.

Note:
- Firebase SDK is loaded via CDN in index.html.

---

## Data Source

Manual mode consumes JSON files exported by a companion browser extension.

Each file usually represents:
- One game
- One market type
- Multiple player lines with odds

---

## Troubleshooting (Beginner Friendly)

1. npm is not recognized
- Reopen terminal after installing Node.js
- Run the helper script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Enable-ProjectNodeEnv.ps1
```

2. Script execution policy error on Windows

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
```

3. Port 5173 already in use
- Close old dev server terminals
- Or run on another port:

```powershell
npm run dev -- --port 5174
```

4. Clean reinstall dependencies

```powershell
Remove-Item -Recurse -Force .\node_modules
Remove-Item -Force .\package-lock.json
npm install
```

---

## Quick Start (Copy/Paste)

```powershell
cd <project-folder>
npm install
npm run dev
```

Open the local URL shown in terminal.
