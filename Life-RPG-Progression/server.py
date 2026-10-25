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
from datetime import datetime, timezone, date
from contextlib import contextmanager
from urllib.request import Request, urlopen
from urllib.parse import quote
from concurrent.futures import ThreadPoolExecutor, as_completed

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



# Top constituents by S&P 500 index weight, refreshed manually in code when the ranking changes.
# This is not an automatic constituent/weight feed; prices are fetched on each refresh.
TOP_CONSTITUENTS = [
    ("NVDA", "NVIDIA Corporation"),
    ("AAPL", "Apple Inc."),
    ("MSFT", "Microsoft Corporation"),
    ("AMZN", "Amazon.com, Inc."),
    ("GOOGL", "Alphabet Inc. Class A"),
    ("AVGO", "Broadcom Inc."),
    ("GOOG", "Alphabet Inc. Class C"),
    ("META", "Meta Platforms, Inc."),
    ("TSLA", "Tesla, Inc."),
    ("LLY", "Eli Lilly and Company"),
]
MARKET_SYMBOL = "^GSPC"


def _number(value):
    """Convert pandas/numpy values into JSON-safe floats; missing values become None."""
    try:
        result = float(value)
        return result if result == result and abs(result) != float("inf") else None
    except (TypeError, ValueError):
        return None


def _date_string(value):
    if hasattr(value, "date"):
        value = value.date()
    return value.isoformat() if hasattr(value, "isoformat") else str(value)[:10]


def _fetch_yahoo_chart(symbol):
    """Fetch one daily history series from Yahoo's chart JSON endpoint."""
    encoded = quote(symbol, safe="")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?range=1y&interval=1d&events=history"
    request = Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
    })
    with urlopen(request, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8"))
    chart = payload.get("chart", {})
    if chart.get("error"):
        err = chart["error"]
        raise RuntimeError(f"Yahoo Finance: {err.get('description') or err.get('code') or 'request failed'}")
    results = chart.get("result") or []
    if not results:
        raise RuntimeError(f"Yahoo Finance returned no results for {symbol}.")
    result = results[0]
    timestamps = result.get("timestamp") or []
    quote_rows = (result.get("indicators", {}).get("quote") or [{}])[0]
    rows = []
    for i, stamp in enumerate(timestamps):
        close = _number((quote_rows.get("close") or [])[i] if i < len(quote_rows.get("close") or []) else None)
        if close is None:
            continue
        rows.append({
            "date": datetime.fromtimestamp(stamp, timezone.utc).date().isoformat(),
            "open": _number((quote_rows.get("open") or [])[i] if i < len(quote_rows.get("open") or []) else None),
            "high": _number((quote_rows.get("high") or [])[i] if i < len(quote_rows.get("high") or []) else None),
            "low": _number((quote_rows.get("low") or [])[i] if i < len(quote_rows.get("low") or []) else None),
            "close": close,
            "volume": int(quote_rows["volume"][i]) if i < len(quote_rows.get("volume") or []) and _number(quote_rows["volume"][i]) is not None else None,
        })
    if not rows:
        raise RuntimeError(f"Yahoo Finance returned no usable daily prices for {symbol}.")
    return result, rows


def _fetch_yahoo_intraday(symbol=MARKET_SYMBOL):
    """Fetch five-minute observations for the most recent five trading days."""
    encoded = quote(symbol, safe="")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?range=5d&interval=5m&events=history"
    request = Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
    })
    with urlopen(request, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8"))
    chart = payload.get("chart", {})
    if chart.get("error"):
        err = chart["error"]
        raise RuntimeError(f"Yahoo Finance intraday: {err.get('description') or err.get('code') or 'request failed'}")
    results = chart.get("result") or []
    if not results:
        raise RuntimeError(f"Yahoo Finance returned no intraday results for {symbol}.")
    result = results[0]
    timestamps = result.get("timestamp") or []
    quote_rows = (result.get("indicators", {}).get("quote") or [{}])[0]
    closes = quote_rows.get("close") or []
    rows = []
    for i, stamp in enumerate(timestamps):
        close = _number(closes[i] if i < len(closes) else None)
        if close is not None:
            rows.append({"timestamp": datetime.fromtimestamp(stamp, timezone.utc).isoformat(timespec="seconds"), "close": close})
    if not rows:
        raise RuntimeError(f"Yahoo Finance returned no usable intraday prices for {symbol}.")
    return rows


def fetch_market_data():
    """Fetch daily S&P 500 and constituent prices using Yahoo's chart JSON endpoint.

    This avoids the yfinance package, but Yahoo's endpoint is unofficial and can be
    rate-limited or changed without notice. Values are the latest available daily data.
    """
    symbols = [MARKET_SYMBOL] + [symbol for symbol, _ in TOP_CONSTITUENTS]
    fetched = {}
    errors = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(_fetch_yahoo_chart, symbol): symbol for symbol in symbols}
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                fetched[symbol] = future.result()
            except Exception as exc:
                errors.append(f"{symbol}: {exc}")
    if MARKET_SYMBOL not in fetched:
        detail = "; ".join(errors[:3])
        raise RuntimeError("Could not retrieve S&P 500 history from Yahoo Finance. " + detail + ". Check internet access, or try again later.")

    _, history_rows = fetched[MARKET_SYMBOL]
    intraday_rows = []
    try:
        intraday_rows = _fetch_yahoo_intraday(MARKET_SYMBOL)
    except Exception as exc:
        errors.append(f"{MARKET_SYMBOL} intraday: {exc}")
    latest_index = history_rows[-1]
    previous_index = history_rows[-2]["close"] if len(history_rows) > 1 else None
    index_change = latest_index["close"] - previous_index if previous_index is not None else None
    index_pct = index_change / previous_index * 100 if previous_index else None

    stocks = []
    for rank, (symbol, company) in enumerate(TOP_CONSTITUENTS, start=1):
        item = fetched.get(symbol)
        if not item:
            stocks.append({"symbol": symbol, "name": company, "rank": rank, "price": None,
                           "previous_close": None, "change": None, "change_percent": None,
                           "error": next((e.split(": ", 1)[1] for e in errors if e.startswith(symbol + ":")), "No quote returned")})
            continue
        _, rows = item
        current = rows[-1]["close"]
        previous = rows[-2]["close"] if len(rows) > 1 else None
        change = current - previous if previous is not None else None
        percent = change / previous * 100 if change is not None and previous else None
        stocks.append({"symbol": symbol, "name": company, "rank": rank, "price": current,
                       "previous_close": previous, "change": change, "change_percent": percent})

    return {"index": {"symbol": MARKET_SYMBOL, "name": "S&P 500", "price": latest_index["close"],
                       "previous_close": previous_index, "change": index_change, "change_percent": index_pct,
                       "market_date": latest_index["date"]},
            "history": history_rows, "intraday": intraday_rows, "stocks": stocks,
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "Yahoo Finance chart data; daily values may be delayed",
            "warnings": errors}


def save_market_data(payload):
    """Persist fetched index history and a timestamped quote snapshot in SQLite."""
    index = payload["index"]
    with connect_db() as db:
        for item in payload["history"]:
            db.execute("""INSERT INTO market_history(symbol,market_date,open,high,low,close,volume,fetched_at)
                VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
                ON CONFLICT(symbol,market_date) DO UPDATE SET open=excluded.open,high=excluded.high,
                low=excluded.low,close=excluded.close,volume=excluded.volume,fetched_at=CURRENT_TIMESTAMP""",
                (MARKET_SYMBOL, item["date"], item["open"], item["high"], item["low"], item["close"], item["volume"]))
        cur = db.execute("""INSERT INTO market_snapshots(symbol,price,previous_close,change_value,change_percent,market_date)
            VALUES(?,?,?,?,?,?)""", (MARKET_SYMBOL, index["price"], index["previous_close"], index["change"], index["change_percent"], index["market_date"]))
        snapshot_id = cur.lastrowid
        for stock in payload["stocks"]:
            if stock["price"] is None:
                continue
            db.execute("""INSERT INTO market_stock_quotes(snapshot_id,symbol,company_name,index_rank,price,previous_close,change_value,change_percent)
                VALUES(?,?,?,?,?,?,?,?)""", (snapshot_id, stock["symbol"], stock["name"], stock["rank"], stock["price"],
                stock["previous_close"], stock["change"], stock["change_percent"]))
        for item in payload.get("intraday", []):
            db.execute("""INSERT INTO market_intraday_history(symbol,observation_time,close,fetched_at)
                VALUES(?,?,?,CURRENT_TIMESTAMP)
                ON CONFLICT(symbol,observation_time) DO UPDATE SET close=excluded.close,fetched_at=CURRENT_TIMESTAMP""",
                (MARKET_SYMBOL, item["timestamp"], item["close"]))
    return payload


def read_market_data():
    """Return latest saved quote and up to one year of locally recorded daily history."""
    with connect_db() as db:
        snapshot = db.execute("SELECT * FROM market_snapshots WHERE symbol=? ORDER BY id DESC LIMIT 1", (MARKET_SYMBOL,)).fetchone()
        history = db.execute("SELECT market_date AS date,open,high,low,close,volume FROM market_history WHERE symbol=? ORDER BY market_date", (MARKET_SYMBOL,)).fetchall()
        intraday = db.execute("SELECT observation_time AS timestamp,close FROM market_intraday_history WHERE symbol=? AND observation_time >= datetime('now','-8 days') ORDER BY observation_time", (MARKET_SYMBOL,)).fetchall()
        stocks = []
        if snapshot:
            rows = db.execute("SELECT symbol,company_name AS name,index_rank AS rank,price,previous_close,change_value AS change,change_percent FROM market_stock_quotes WHERE snapshot_id=? ORDER BY index_rank", (snapshot["id"],)).fetchall()
            stocks = [dict(row) for row in rows]
        quote = None
        if snapshot:
            quote = {"symbol": snapshot["symbol"], "name": "S&P 500", "price": snapshot["price"],
                     "previous_close": snapshot["previous_close"], "change": snapshot["change_value"],
                     "change_percent": snapshot["change_percent"], "market_date": snapshot["market_date"]}
    intraday_rows = [dict(row) for row in intraday]
    return {"index": quote, "history": [dict(row) for row in history], "intraday": intraday_rows,
            "stocks": stocks, "fetched_at": snapshot["fetched_at"] if snapshot else None,
            "source": "Yahoo Finance chart data; daily values may be delayed"}


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

ADAPTIVE_QUESTS = [
 # Finance: practical money management, career, and business-building actions.
 ('fin','fin','Review this week’s spending','Group recent purchases into needs, wants, and business expenses.',15,25,1,10),
 ('fin','fin','Build or update a simple budget','Set realistic limits for essentials, savings, debt, and discretionary spending.',20,35,1,20),
 ('fin','fin','Audit subscriptions and recurring bills','Identify unused subscriptions or bills worth comparing; do not cancel anything you still need.',10,20,1,30),
 ('fin','fin','Update your savings target','Choose a target, current balance, and next small contribution.',10,20,1,40),
 ('fin','fin','Review debt and payment dates','List balances, due dates, and minimum payments so nothing is missed.',15,30,1,50),
 ('fin','fin','Research one income opportunity','Compare startup cost, likely effort, risks, and first practical step.',20,30,2,60),
 ('fin','fin','Draft a one-page business idea','Write the customer, problem, offer, price, and how you would find the first customer.',25,40,2,70),
 ('fin','fin','Review income and plan the next move','Check logged income and identify one action to improve the next week.',15,25,1,80),
 ('fin','fin','Build a simple cash-flow forecast','Estimate money coming in and bills due over the next 30 days.',25,40,2,90),
 ('fin','fin','Compare one essential bill','Check alternatives and terms before deciding whether a change is worthwhile.',15,25,2,100),
 # Other focuses so the same planner can adapt beyond Finance later.
 ('fit','fit','Take a brisk walk','Move at a comfortable pace and record how you feel afterward.',20,25,1,20),
 ('fit','fit','Complete a strength session','Use your planned exercises and prioritize controlled form.',30,40,2,30),
 ('fit','fit','Prepare a healthy meal','Make one easy meal or prep ingredient for later.',20,25,1,40),
 ('learn','code','Practice a technical skill','Work through one lesson or a small coding exercise.',25,30,1,20),
 ('learn','read','Review notes and recall key ideas','Summarize what you learned without looking at your notes.',15,20,1,30),
 ('learn','re','Study a career topic','Read a trusted guide and write down three useful takeaways.',25,30,1,40),
 ('balanced','fin','Check tomorrow’s priorities','Choose one meaningful next step and make it specific.',10,15,1,10),
 ('balanced','fit','Move or stretch','Take a short walk or do gentle mobility work.',10,15,1,20),
 ('balanced','read','Learn for a few minutes','Read, study, or practice one useful skill.',15,20,1,30),
 ('balanced','chr','Reset one small area','Spend a few minutes making one part of your space easier to use.',10,15,1,40),
]

SKILL_NODES = [
 ('strength_1','Strength','Foundation of Strength','Complete fitness quests to build this skill.',1,0,'💪'),
 ('strength_2','Strength','Progressive Training','Unlocks after earning 100 Fitness XP.',2,100,'🏋️'),
 ('intelligence_1','Intelligence','Curious Mind','Build your knowledge through learning and quizzes.',1,0,'🧠'),
 ('intelligence_2','Intelligence','Deep Study','Unlocks after earning 100 Coding or Real Estate XP.',2,100,'📚'),
 ('discipline_1','Discipline','Show Up','Build consistency by completing quests.',1,0,'🛡️'),
 ('discipline_2','Discipline','Unbreakable Routine','Unlocks after completing 10 main quests.',2,0,'🔥'),
 ('wealth_1','Wealth','Money Awareness','Build financial habits through Finance quests.',1,0,'💰'),
 ('wealth_2','Wealth','Business Builder','Unlocks after earning 100 Finance XP.',2,100,'📈'),
 ('social_1','Social','Make Connections','Complete networking or communication goals.',1,0,'🤝'),
 ('social_2','Social','Community Builder','Unlocks after earning 250 total XP.',2,250,'🌐'),
]
CAMPAIGNS = [
 ('fitness_foundation','Fitness Foundation','fit','Build a repeatable fitness routine.',json.dumps(['Complete 3 workouts','Log a workout on two different days','Complete a weekly fitness review']),120,30,1),
 ('financial_foundation','Financial Foundation','fin','Get a clearer picture of your money and create a simple plan.',json.dumps(['Review recent spending','Create or update a budget','Set a savings target']),150,40,1),
 ('career_builder','Career Builder','code','Build momentum toward a stronger career.',json.dumps(['Study one useful career skill','Create or improve one portfolio item','Reach out to one professional contact']),150,40,1),
 ('linux_path','Linux & Coding Path','code','Develop practical technical skills one step at a time.',json.dumps(['Complete a Linux lesson','Practice one command or coding exercise','Write down what you learned']),180,50,2),
]
ACHIEVEMENTS = [
 ('first_quest','First Steps','Complete your first main quest.','⚔️','main_quests',1,10),
 ('quest_10','Questing Habit','Complete 10 main quests.','🗡️','main_quests',10,25),
 ('xp_100','Rising Adventurer','Earn 100 total XP.','⭐','total_xp',100,20),
 ('xp_500','Seasoned Adventurer','Earn 500 total XP.','🌟','total_xp',500,50),
 ('streak_3','The Consistent','Reach a 3-day streak.','🔥','best_streak',3,25),
 ('workout_5','Iron Will','Log five workouts.','💪','workouts',5,35),
 ('learning_5','Scholar','Complete five learning resources.','📚','resources_completed',5,35),
 ('finance_100','Money Manager','Earn 100 Finance XP.','💰','finance_xp',100,35),
 ('campaign_1','Campaigner','Complete your first campaign.','🧭','campaigns_completed',1,40),
]
COSMETICS = [
 ('campfire','Campfire','A warm place to rest between quests.','🔥',0,'decoration'),
 ('bookshelf','Scholar’s Bookshelf','A display for your learning milestones.','📚',40,'decoration'),
 ('training_dummy','Training Dummy','A reminder to keep getting stronger.','🥊',50,'decoration'),
 ('coin_fountain','Coin Fountain','A little symbol of financial progress.','⛲',75,'decoration'),
 ('banner','Hero Banner','A banner for your headquarters.','🏳️',100,'decoration'),
 ('crystal','XP Crystal','A glowing crystal earned through effort.','💎',150,'decoration'),
 ('theme_ember','Ember Theme','A warm ember accent for your interface.','🌋',80,'theme'),
 ('theme_arcane','Arcane Theme','A mystical violet accent for your interface.','🔮',120,'theme'),
 ('icon_owl','Owl Avatar','A wise owl for your player badge.','🦉',60,'avatar'),
 ('icon_crown','Crown Avatar','A crown for your player badge.','👑',100,'avatar'),
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
    if db.execute('SELECT COUNT(*) FROM adaptive_quest_templates').fetchone()[0] == 0:
        db.executemany('INSERT INTO adaptive_quest_templates(focus,category,title,description,minutes,xp,min_energy,priority,active) VALUES(?,?,?,?,?,?,?,?,1)', ADAPTIVE_QUESTS)
    if db.execute('SELECT COUNT(*) FROM skill_nodes').fetchone()[0] == 0:
        db.executemany('INSERT INTO skill_nodes(id,attribute,title,description,cost,required_xp,icon,active) VALUES(?,?,?,?,?,?,?,1)', SKILL_NODES)
    if db.execute('SELECT COUNT(*) FROM campaign_templates').fetchone()[0] == 0:
        db.executemany('INSERT INTO campaign_templates(id,title,category,description,steps_json,reward_xp,reward_coins,tier,active) VALUES(?,?,?,?,?,?,?,?,1)', CAMPAIGNS)
    if db.execute('SELECT COUNT(*) FROM achievement_templates').fetchone()[0] == 0:
        db.executemany('INSERT INTO achievement_templates(id,title,description,icon,rule_type,rule_target,reward_coins,active) VALUES(?,?,?,?,?,?,?,1)', ACHIEVEMENTS)
    if db.execute('SELECT COUNT(*) FROM cosmetic_templates').fetchone()[0] == 0:
        db.executemany('INSERT INTO cosmetic_templates(id,title,description,icon,cost,kind,active) VALUES(?,?,?,?,?,?,1)', COSMETICS)

def read_catalogs():
    # Read editable quest templates, exercise suggestions, and learning resources.
    quests = {}
    with connect_db() as db:
        for row in db.execute('SELECT category,title,xp FROM quest_templates WHERE active=1 ORDER BY id'):
            quests.setdefault(row['category'], []).append([row['title'], row['xp']])
        exercises = [row['name'] for row in db.execute('SELECT name FROM exercise_templates WHERE active=1 ORDER BY name')]
        resources = [dict(row) for row in db.execute('SELECT id,category,title,resource_type,url,notes,completed FROM learning_resources ORDER BY completed,category,title')]
        skills = [dict(row) for row in db.execute('SELECT id,attribute,title,description,cost,required_xp,icon FROM skill_nodes WHERE active=1 ORDER BY attribute,id')]
        campaigns = []
        for row in db.execute('SELECT id,title,category,description,steps_json,reward_xp,reward_coins,tier FROM campaign_templates WHERE active=1 ORDER BY tier,id'):
            item = dict(row); item['steps'] = json.loads(item.pop('steps_json')); campaigns.append(item)
        achievements = [dict(row) for row in db.execute('SELECT id,title,description,icon,rule_type,rule_target,reward_coins FROM achievement_templates WHERE active=1 ORDER BY rule_target,id')]
        cosmetics = [dict(row) for row in db.execute('SELECT id,title,description,icon,cost,kind FROM cosmetic_templates WHERE active=1 ORDER BY cost,id')]
    return {'quests': quests, 'exercises': exercises, 'resources': resources, 'skills': skills, 'campaigns': campaigns, 'achievements': achievements, 'cosmetics': cosmetics}

def read_adaptive_quests():
    """Read the curated planner suggestions from SQLite; JS adapts them to user settings."""
    with connect_db() as db:
        rows = db.execute(
            'SELECT id,focus,category,title,description,minutes,xp,min_energy,priority FROM adaptive_quest_templates WHERE active=1 ORDER BY priority,id'
        ).fetchall()
    return [dict(row) for row in rows]

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
        if path == "/api/adaptive-quests":
            self.send_json(read_adaptive_quests())
            return
        if path == "/api/finance/market":
            self.send_json(read_market_data())
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
            if path == '/api/finance/refresh':
                market = save_market_data(fetch_market_data())
                self.send_json(market)
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
    print("Quiz questions, catalogs, adaptive planner templates, learning resources, and player progress are stored in SQLite.")
    print("Press Ctrl+C to stop the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Life RPG server...")
    finally:
        server.server_close()
