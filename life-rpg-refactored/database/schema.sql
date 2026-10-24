-- Life RPG SQLite schema.
-- SQLite is the canonical local store for quiz content, editable catalogs, and player progress.
-- Browser localStorage remains a safety mirror/fallback for the player's save.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL CHECK (category IN ('code', 're')),
    question TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    answer_text TEXT NOT NULL,
    answer_order INTEGER NOT NULL CHECK (answer_order BETWEEN 0 AND 3),
    is_correct INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
    UNIQUE (question_id, answer_order)
);

CREATE INDEX IF NOT EXISTS idx_questions_category_active
    ON questions(category, active);

-- Future-ready tables: these are not yet wired into the browser app.
CREATE TABLE IF NOT EXISTS quest_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 10,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS exercise_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    muscle_group TEXT,
    instructions TEXT,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS learning_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    resource_type TEXT,
    url TEXT,
    notes TEXT,
    completed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_objectives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    objective_date TEXT NOT NULL UNIQUE,
    objective_text TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS planner_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    cadence TEXT NOT NULL DEFAULT 'daily',
    due_date TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS progress_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    event_type TEXT NOT NULL,
    category TEXT,
    xp_delta INTEGER NOT NULL DEFAULT 0,
    details TEXT
);

CREATE TABLE IF NOT EXISTS workout_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_date TEXT NOT NULL,
    exercise_name TEXT NOT NULL,
    sets INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    weight REAL NOT NULL DEFAULT 0,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS income_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date TEXT NOT NULL,
    amount REAL NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    notes TEXT
);

CREATE TABLE IF NOT EXISTS time_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_date TEXT NOT NULL,
    category TEXT NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0
);


-- One local player profile for this single-user desktop/home-server edition.
-- JSON keeps the evolving game state backward-compatible while it lives inside SQLite.
CREATE TABLE IF NOT EXISTS app_state (
    state_key TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quest_templates_active ON quest_templates(category, active);
CREATE INDEX IF NOT EXISTS idx_learning_resources_category ON learning_resources(category, completed);
