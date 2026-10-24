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
