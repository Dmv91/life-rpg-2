# Life RPG — Refactored + SQLite question bank

Life RPG is a local browser app. The front end is HTML/CSS/JavaScript; a small Python server serves it and reads quiz questions from a local SQLite database. It uses only Python's standard library—no database server or `pip install` is required.

## Project map

- `index.html` — structure for the five pages and their controls.
- `styles.css` — colors, layout, responsive behavior, and animations.
- `js/app.js` — app behavior, saved browser state, timers, rendering, and event handlers. The file now has section comments and a map at the top.
- `js/config.js` — game rules, default quest pools, exercises, and fallback quiz questions.
- `server.py` — local web server and API that reads quiz questions from SQLite.
- `database/schema.sql` — table definitions for quiz content, catalogs, learning resources, and the saved player state.
- `data/questions.csv` — spreadsheet-friendly starting question bank (Excel/LibreOffice can open it).
- `data/life_rpg.sqlite3` — live SQLite database for questions, quest templates, exercise suggestions, learning resources, and player progress.
- `manage_questions.py` — imports/exports quiz questions between SQLite and CSV.
- `backup-original/Life RPG-original.html` — untouched copy of the original single-file app.
- `run-windows.bat` / `run-linux-mac.sh` — launch scripts.

## Run on Windows

1. Extract the ZIP into a normal folder.
2. Install Python 3 if needed: <https://www.python.org/downloads/windows/>. Enable **Add Python to PATH** during setup.
3. Double-click `run-windows.bat`.
4. Open <http://localhost:8000> if the browser does not open automatically.
5. Keep the command window open while using the app. Press `Ctrl+C` to stop the server.

The first run creates `data/life_rpg.sqlite3` and seeds it with the questions in `data/questions.csv`.

## Run and edit in Visual Studio Code

1. In VS Code choose **File → Open Folder…** and open the extracted `life-rpg-refactored` folder.
2. Choose **Terminal → New Terminal**.
3. Run `py -3 server.py` on Windows, or `python3 server.py` on Linux/macOS.
4. Visit <http://localhost:8000>.

Do **not** use only `python -m http.server` for normal use now: that serves the static files but does not provide the SQLite question API.

## Edit quiz questions in a spreadsheet

The question bank lives in SQLite tables `questions` and `answers`. CSV is the bridge between SQL and a spreadsheet: Excel and LibreOffice Calc can open and save CSV files.

1. Stop the server with `Ctrl+C`.
2. Open `data/questions.csv` in Excel/LibreOffice, or export the latest database first:

   ```powershell
   py -3 manage_questions.py export data/questions.csv
   ```

3. Edit the rows. Keep the column headers exactly as they are:

   - `category`: `code` or `re` (the two quiz categories currently supported)
   - `question`: question text
   - `option_a` through `option_d`: the four answer choices
   - `correct_option`: **zero-based** answer index: `0` = A, `1` = B, `2` = C, `3` = D
   - `explanation`: text shown after answering
4. Save as CSV, keeping the same headers and UTF-8 encoding.
5. Import the edited file into the database:

   ```powershell
   py -3 manage_questions.py import data/questions.csv --replace
   ```

6. Start the server again with `py -3 server.py` and refresh the app.

`--replace` replaces the quiz bank so importing an edited export does not create duplicate questions. Keep a backup of the CSV and database before bulk changes. The server also offers a live CSV download at <http://localhost:8000/api/questions.csv> and a status check at <http://localhost:8000/api/health>.

## Where to read the code

- Start with the overview comments at the top of `js/app.js`, then search for headings such as `SAVED GAME STATE`, `QUEST GENERATION`, `DAILY OBJECTIVE`, `DAILY / WEEKLY PLANNER`, `CONSISTENCY REWARDS`, and `DATABASE CONNECTION`.
- `js/config.js` contains editable defaults and fallback content.
- `server.py` contains the API route `/api/questions` and database setup.
- `database/schema.sql` documents the tables and their relationships.

## What is stored where right now?

- **SQLite database (canonical):** quiz questions and answers; quest templates and XP; exercise suggestions; learning resources and completion status; and the complete player save (XP, active quests, streaks, workouts, planner, income, timers, and other progress) in the `app_state` table.
- **Browser localStorage (backup):** a mirror/fallback copy of the player save. When the local server is available, changes sync into SQLite automatically.
- Default quest templates, exercises, and learning resources are seeded only when their tables are empty. After that, SQLite is the source for these catalogs.

### SQL tables now in use

- `questions` + `answers`: editable quiz bank.
- `quest_templates`: active quest catalog and XP rewards.
- `exercise_templates`: exercise names, muscle groups, and instructions.
- `learning_resources`: saved links/notes and completion status.
- `app_state`: the full current player save as JSON inside SQLite. This preserves the existing game-state structure while moving persistence into the database.

## Good next database upgrades

- Normalize player progress into separate XP-event, workout-log, time-log, planner-task, and income-entry records for detailed SQL reporting. The current complete save is already stored in SQLite as one JSON snapshot, which keeps migration safe and preserves all existing fields.
- Add an admin page or CSV import/export for quest templates and exercise templates so those catalogs can be edited without opening a database tool.
- Add user accounts and cloud sync only if the app becomes multi-user; that requires authentication and stronger security.

SQL is a good fit for structured, related data and reporting. A CSV spreadsheet is convenient for bulk editing, while SQLite is the app's reliable local database. Quiz content, catalogs, learning resources, and the canonical player save are now read from or written to SQLite. Browser storage remains as a local backup.

## Saved progress and safety

On first launch with the server, if SQLite does not yet have a save, the app copies the existing `liferpg2` browser save into SQLite. After that, SQLite is the canonical save and localStorage is a safety mirror. Keep a copy of `data/life_rpg.sqlite3` before replacing project files or making bulk edits. The app keeps using the existing `liferpg2` localStorage key and the old `liferpg1` migration path. Browser storage belongs to a browser profile/site origin, so progress from the original `file://` version may not automatically appear at `http://localhost:8000`. Keep the original file and backup until you verify your progress.

## Adaptive daily quest planner

The Dashboard includes an adaptive planner. Choose available time, energy, and focus, then generate suggestions. The planner reads its suggestions from SQLite's `adaptive_quest_templates` table (`/api/adaptive-quests`). Selecting **Add selected quests** creates normal active quests in the existing player save. Completing them through the normal Quests page uses the existing timer, category XP, and main-quest streak logic.

The planner never clears or replaces current quests or saved progress. Existing database files gain the new table through the schema's `CREATE TABLE IF NOT EXISTS` migration, and starter templates are inserted only when that table is empty. To change planner content, edit the `ADAPTIVE_QUESTS` seed list in `server.py` before the table is first populated, or edit `adaptive_quest_templates` directly in SQLite.

### Updating from the previous SQL-backed version without losing progress

Before starting this release, copy `data/life_rpg.sqlite3` from your old Life RPG project into the new project's `data` folder, replacing the bundled database. This carries forward the SQL save and existing database records. The server adds the new planner table automatically without deleting existing tables or rows. Keep the old project folder until you confirm the app opens and your progress is present. If your save only exists in browser storage, open the app at the same `http://localhost:8000` origin and the first-launch migration will copy it into SQLite when no SQL save exists.

## RPG progression update: attributes, campaigns, achievements, and headquarters

The Dashboard now includes five connected progression systems:

- **Character attributes and skill tree:** Strength, Intelligence, Discipline, Wealth, and Social growth are derived from real activity/XP. Skill points are earned per 100 total XP and spent on skill nodes. Unlocking skills never deducts existing XP. Each node adds a 5% XP bonus to its attribute category (Discipline applies to all categories). Nodes can require relevant attribute XP or completed quests.
- **Quest campaigns:** Multi-step campaigns for fitness, financial foundations, career growth, and Linux/coding. Tier 2 campaigns unlock after two Tier 1 campaigns are completed. Campaign definitions and rewards are seeded in SQLite; step completion is stored in the player save.
- **Achievements and titles:** Milestones for quest completions, XP, streaks, workouts, learning resources, finance progress, and campaigns. Each achievement grants its coin reward once. The most recently unlocked achievement title appears beside the app name.
- **Progress analytics:** XP earned during the last seven days, completed main quests, workout count, learning time, quiz accuracy, daily goal progress, and an XP trend. XP history starts with this release; historical totals from older saves remain intact but are not retroactively assigned to dates. A manual savings target/balance is also included in Finance and summarized here (no bank connection).
- **Personal headquarters and cosmetics:** Earn coins through quest completion and achievements. Spend coins on decorations, interface themes, and avatar icons. Cosmetics and equipped choices are saved in the existing SQLite-backed player save.

### Additional SQLite tables

`skill_nodes`, `campaign_templates`, `achievement_templates`, and `cosmetic_templates` store the editable feature catalogs. Player-specific progress (unlocked skills, campaign checklists, earned achievements, coins, inventory, cosmetics, XP history, and quiz statistics) is stored in `app_state.state_json`, alongside the previous save fields. Existing databases gain the new tables automatically when `server.py` starts. Catalog seeds are inserted only if the corresponding table is empty.

The app still keeps a browser localStorage mirror. Keep a copy of `data/life_rpg.sqlite3` before updating the project, and verify the save after the first launch.



## Matrix background (current version)

The separate Art Studio and animated skull have been removed to keep the app focused. The Matrix background is now denser, with more narrow streams of green code characters drifting down the screen. The random word effect has been removed. Use the footer toggle to turn the effect on or off. It uses the browser's Canvas API, has no external dependencies, and pauses while the browser tab is hidden. The effect is disabled when the operating system requests reduced motion.


## Finance market dashboard

The Finance page includes the S&P 500 (`^GSPC`) latest available daily value, a 1D/1W/1M/3M/6M/1Y chart, a refresh button, and daily changes for ten large S&P 500 constituents. Each refresh saves daily S&P 500 OHLC/close history and a timestamped index/top-stock quote snapshot into SQLite (`market_history`, `market_snapshots`, and `market_stock_quotes`). The 1D and 1W views use five-minute intraday observations; the 1M/3M/6M/1Y views use locally stored daily closes. Refresh fills gaps and updates recent values. Intraday observations are also saved in `market_intraday_history`. The list of ten companies is maintained in `TOP_CONSTITUENTS` inside `server.py`, so it is not a live ranking feed and should be reviewed periodically.

### Market dashboard data source

The Finance page requests daily S&P 500 (^GSPC) and stock prices from Yahoo Finance's chart JSON endpoint when you press **Refresh market data**. The request is made by the local Python server. Daily history and the latest five days of five-minute intraday observations are saved in SQLite for the chart. The 1D and 1W views need intraday data from Yahoo, which may be unavailable outside market hours or when Yahoo limits requests. No third-party Python package or API key is required.

This is an unofficial endpoint, not a supported public API. Yahoo can change or rate-limit it, and data may be delayed. The top-10 company list is maintained in `server.py` and is not automatically re-ranked by index weight. For a more stable, documented provider, consider Twelve Data; it requires a free API key and you would need to configure the app to use it. See the provider's current terms and market-data entitlements before using the data beyond personal experimentation.

Run the app through `server.py` (not by opening `index.html` directly). Market data requires an internet connection. The rest of Life RPG works if the provider is unavailable; the Finance page should display an error message when refresh fails.
