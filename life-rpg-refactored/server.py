"""Life RPG local web server and SQLite API.

Uses only Python's standard library, so no pip installs are required.
Run with: python server.py
The first launch creates data/life_rpg.sqlite3 and imports data/questions.csv.
"""
from __future__ import annotations

import csv
import json
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "life_rpg.sqlite3"
CSV_PATH = DATA_DIR / "questions.csv"
SCHEMA_PATH = ROOT / "database" / "schema.sql"
HOST, PORT = "127.0.0.1", 8000


@contextmanager
def connect_db():
    """Open a database connection and always close it after the transaction."""
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def import_questions_csv(csv_path: Path, replace: bool = False) -> int:
    """Import spreadsheet-friendly CSV rows into questions and answers tables."""
    with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
        rows = list(csv.DictReader(file))

    required = {"category", "question", "option_a", "option_b", "option_c",
                "option_d", "correct_option", "explanation"}
    if not rows:
        raise ValueError("The CSV contains no question rows.")
    if not required.issubset(rows[0].keys()):
        missing = sorted(required - set(rows[0].keys()))
        raise ValueError("CSV is missing required columns: " + ", ".join(missing))

    cleaned = []
    for line_number, row in enumerate(rows, start=2):
        category = (row.get("category") or "").strip().lower()
        question = (row.get("question") or "").strip()
        options = [(row.get(f"option_{letter}") or "").strip() for letter in "abcd"]
        try:
            correct = int(row.get("correct_option", ""))
        except ValueError as exc:
            raise ValueError(f"Row {line_number}: correct_option must be 0, 1, 2, or 3.") from exc
        if category not in {"code", "re"}:
            raise ValueError(f"Row {line_number}: category must be 'code' or 're'.")
        if not question or any(not option for option in options):
            raise ValueError(f"Row {line_number}: question and all four options are required.")
        if correct not in range(4):
            raise ValueError(f"Row {line_number}: correct_option must be 0, 1, 2, or 3.")
        cleaned.append((category, question, options, correct,
                        (row.get("explanation") or "").strip()))

    with connect_db() as db:
        if replace:
            db.execute("DELETE FROM answers")
            db.execute("DELETE FROM questions")
        for category, question, options, correct, explanation in cleaned:
            cursor = db.execute(
                "INSERT INTO questions (category, question, explanation) VALUES (?, ?, ?)",
                (category, question, explanation),
            )
            question_id = cursor.lastrowid
            db.executemany(
                "INSERT INTO answers (question_id, answer_text, answer_order, is_correct) VALUES (?, ?, ?, ?)",
                [(question_id, option, index, int(index == correct))
                 for index, option in enumerate(options)],
            )
    return len(cleaned)


# Editable default content. After first seed, catalog rows are read from SQLite.
DEFAULT_QUESTS = {
 'code': [('Code on a project for 1 hour',30),('Fix a bug',25),('Build a small feature',40),('Study a tutorial for 30 min',25),('Push a commit to GitHub',15),('Refactor a messy file',25),('Write tests for your code',30),('Add a project to your portfolio',45)],
 're': [('Review 3 listings',25),('Study a market report 20 min',20),('Analyze a deal (cap rate, cash flow)',40),('Watch a real estate lesson',20),('Research a neighborhood',25),('Message an agent or investor',30),('Study for a license exam 30 min',30)],
 'fit': [('Take a 20 min walk',20),('Stretch for 10 min',15),('Drink 2L of water',10),('Prep a healthy meal',20),('Do a 10 min mobility routine',15)],
 'fin': [('Apply to 5 jobs',40),('Pitch 3 freelance clients',45),('Post a gig on Upwork or Fiverr',35),('Sell an unused item online',30),('Update resume and LinkedIn',30),('Message 5 contacts about work',30),('Build a sample project to sell as a service',45),('Research a side hustle idea',20),('Do a paid micro-task or gig',30),('Follow up on pending applications',25)],
 'read': [('Read 20 pages',10),('Read for 30 min',12),('Read a chapter',12),('Read a book on investing or coding',15)],
 'game': [('Play a game for 30 min',10),('Play a story game for 1 hour',15),('Play online with a friend',15),('Try a new game',12)],
 'chr': [('Dishes',5),('Laundry',8),('Tidy living space',8),('Take out trash',5),('Vacuum',8),('Wipe counters',5)]
}
DEFAULT_EXERCISES = [
 ('Squat','Legs','Stand with feet about shoulder-width apart; sit hips back and keep the movement controlled.'),
 ('Push-up','Chest / triceps','Keep your body in a straight line; lower under control and press up.'),
 ('Crunch','Abs','Curl shoulders gently off the floor without pulling on your neck.'),
 ('Leg raise','Abs / hip flexors','Keep the lower back controlled as you raise and lower your legs.'),
 ('Plank (sec)','Core','Keep shoulders, hips, and ankles aligned; stop when form breaks.'),
 ('Sit-up','Abs','Use a controlled range of motion and avoid jerking the neck.'),
 ('Lunge','Legs / glutes','Take a stable step and lower under control; keep the front knee tracking over the foot.'),
 ('Bench press','Chest / triceps','Use a stable setup and a spotter when lifting heavy.'),
 ('Deadlift','Posterior chain','Brace your trunk and keep the load close; prioritize technique.'),
 ('Overhead press','Shoulders / triceps','Brace your core and press without excessive lower-back arch.'),
 ('Barbell row','Back / biceps','Hinge at the hips and pull toward the lower ribs without swinging.'),
 ('Bicep curl','Biceps','Keep elbows close to your sides and avoid swinging.')
]
DEFAULT_RESOURCES = [
 ('code','MDN JavaScript Guide','documentation','https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide','Reference for JavaScript fundamentals'),
 ('code','GitHub Skills','course','https://skills.github.com/','Interactive practice for GitHub workflows'),
 ('re','Virginia Real Estate Board','official resource','https://www.dpor.virginia.gov/Boards/Real-Estate','Virginia licensing and regulatory information'),
 ('fin','Investor.gov','official resource','https://www.investor.gov/','Plain-language investing education')
]

def seed_catalogs(db):
    # Populate default quest/exercise/resource catalogs only when each is empty.
    if db.execute('SELECT COUNT(*) FROM quest_templates').fetchone()[0] == 0:
        db.executemany('INSERT INTO quest_templates(category,title,xp,active) VALUES(?,?,?,1)',
            [(category,title,xp) for category,items in DEFAULT_QUESTS.items() for title,xp in items])
    if db.execute('SELECT COUNT(*) FROM exercise_templates').fetchone()[0] == 0:
        db.executemany('INSERT INTO exercise_templates(name,muscle_group,instructions,active) VALUES(?,?,?,1)', DEFAULT_EXERCISES)
    if db.execute('SELECT COUNT(*) FROM learning_resources').fetchone()[0] == 0:
        db.executemany('INSERT INTO learning_resources(category,title,resource_type,url,notes,completed) VALUES(?,?,?,?,?,0)', DEFAULT_RESOURCES)

def read_catalogs():
    # Read editable quest templates, exercise suggestions, and learning resources.
    quests = {}
    with connect_db() as db:
        for row in db.execute('SELECT category,title,xp FROM quest_templates WHERE active=1 ORDER BY id'):
            quests.setdefault(row['category'], []).append([row['title'], row['xp']])
        exercises = [row['name'] for row in db.execute('SELECT name FROM exercise_templates WHERE active=1 ORDER BY name')]
        resources = [dict(row) for row in db.execute('SELECT id,category,title,resource_type,url,notes,completed FROM learning_resources ORDER BY completed,category,title')]
    return {'quests': quests, 'exercises': exercises, 'resources': resources}

def read_saved_state():
    with connect_db() as db:
        row = db.execute("SELECT state_json FROM app_state WHERE state_key='default'").fetchone()
    return json.loads(row['state_json']) if row else None

def write_saved_state(state):
    if not isinstance(state, dict) or not isinstance(state.get('xp'), dict):
        raise ValueError('State must be a game-save object containing an xp object.')
    serialized = json.dumps(state, ensure_ascii=False, separators=(',', ':'))
    with connect_db() as db:
        db.execute("INSERT INTO app_state(state_key,state_json,updated_at) VALUES('default',?,CURRENT_TIMESTAMP) ON CONFLICT(state_key) DO UPDATE SET state_json=excluded.state_json, updated_at=CURRENT_TIMESTAMP", (serialized,))

def initialize_database() -> None:
    """Create tables and seed questions on first run only."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with connect_db() as db:
        db.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        count = db.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
        seed_catalogs(db)
    if count == 0 and CSV_PATH.exists():
        imported = import_questions_csv(CSV_PATH)
        print(f"Seeded SQLite with {imported} quiz questions from {CSV_PATH.name}.")


def read_question_bank() -> dict:
    """Return questions in the same array format used by the JavaScript quiz."""
    bank = {"code": [], "re": []}
    with connect_db() as db:
        questions = db.execute(
            "SELECT id, category, question, explanation FROM questions WHERE active = 1 ORDER BY id"
        ).fetchall()
        for question in questions:
            answers = db.execute(
                "SELECT answer_text, is_correct FROM answers WHERE question_id = ? ORDER BY answer_order",
                (question["id"],),
            ).fetchall()
            if len(answers) != 4:
                continue  # Ignore incomplete question records instead of breaking a quiz.
            correct_index = next((i for i, answer in enumerate(answers) if answer["is_correct"]), -1)
            if correct_index < 0:
                continue
            bank[question["category"]].append([
                question["question"], [answer["answer_text"] for answer in answers],
                correct_index, question["explanation"]
            ])
    return bank


class LifeRPGHandler(SimpleHTTPRequestHandler):
    """Serve the front end and a local SQLite API for questions, catalogs, and progress."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "database": "SQLite", "database_file": "data/life_rpg.sqlite3"})
            return
        if path == "/api/questions":
            self.send_json(read_question_bank())
            return
        if path == "/api/questions.csv":
            self.send_csv_export()
            return
        if path == "/api/state":
            state = read_saved_state()
            self.send_json({'state': state})
            return
        if path == "/api/catalog":
            self.send_json(read_catalogs())
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length > 2_000_000:
                self.send_json({'error': 'Request body is too large.'}, status=413); return
            payload = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
            if path == '/api/state':
                write_saved_state(payload.get('state'))
                self.send_json({'ok': True})
                return
            if path == '/api/resources':
                action = payload.get('action')
                with connect_db() as db:
                    if action == 'add':
                        title = str(payload.get('title','')).strip()
                        category = str(payload.get('category','general')).strip()
                        if not title: raise ValueError('A resource title is required.')
                        if category not in {'code','re','fit','fin','general'}: raise ValueError('Invalid category.')
                        url = str(payload.get('url','')).strip()
                        if url and not url.startswith(('https://','http://')): raise ValueError('Resource URLs must start with http:// or https://.')
                        db.execute('INSERT INTO learning_resources(category,title,resource_type,url,notes,completed) VALUES(?,?,?,?,?,0)', (category,title,'link' if url else 'note',url,str(payload.get('notes','')).strip()))
                    elif action == 'toggle':
                        db.execute('UPDATE learning_resources SET completed=? WHERE id=?', (int(bool(payload.get('completed'))), int(payload['id'])))
                    elif action == 'delete':
                        db.execute('DELETE FROM learning_resources WHERE id=?', (int(payload['id']),))
                    else: raise ValueError('Unknown resource action.')
                self.send_json(read_catalogs()['resources'])
                return
            self.send_json({'error': 'Unknown API endpoint.'}, status=404)
        except (ValueError, KeyError, json.JSONDecodeError) as error:
            self.send_json({'error': str(error)}, status=400)
        except Exception as error:
            self.send_json({'error': 'Server error: ' + str(error)}, status=500)

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_csv_export(self):
        """Export the live database to CSV so Excel/LibreOffice can open it."""
        import io
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow(["category", "question", "option_a", "option_b", "option_c",
                         "option_d", "correct_option", "explanation"])
        with connect_db() as db:
            questions = db.execute(
                "SELECT id, category, question, explanation FROM questions ORDER BY id"
            ).fetchall()
            for q in questions:
                answers = db.execute(
                    "SELECT answer_text, is_correct FROM answers WHERE question_id = ? ORDER BY answer_order",
                    (q["id"],),
                ).fetchall()
                if len(answers) != 4:
                    continue
                correct = next((i for i, a in enumerate(answers) if a["is_correct"]), -1)
                writer.writerow([q["category"], q["question"], *[a["answer_text"] for a in answers], correct, q["explanation"]])
        body = ("\ufeff" + output.getvalue()).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", 'attachment; filename="questions.csv"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        # Keep normal request logs, but make them slightly easier to spot.
        print(f"[Life RPG] {self.address_string()} - {format_string % args}")


if __name__ == "__main__":
    initialize_database()
    server = ThreadingHTTPServer((HOST, PORT), LifeRPGHandler)
    print(f"Life RPG is running at http://localhost:{PORT}")
    print("Quiz questions, catalogs, learning resources, and player progress are stored in SQLite.")
    print("Press Ctrl+C to stop the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Life RPG server...")
    finally:
        server.server_close()
