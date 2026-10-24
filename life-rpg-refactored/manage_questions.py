"""Import/export the Life RPG quiz bank as a spreadsheet-friendly CSV.

Examples:
  python manage_questions.py export data/questions.csv
  python manage_questions.py import data/questions.csv --replace
"""
import argparse
import csv
from pathlib import Path

from server import CSV_PATH, connect_db, import_questions_csv, initialize_database


def export_questions(destination: Path) -> int:
    """Write the current SQLite question bank to a CSV file."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["category", "question", "option_a", "option_b", "option_c",
                         "option_d", "correct_option", "explanation"])
        with connect_db() as db:
            questions = db.execute(
                "SELECT id, category, question, explanation FROM questions ORDER BY id"
            ).fetchall()
            count = 0
            for q in questions:
                answers = db.execute(
                    "SELECT answer_text, is_correct FROM answers WHERE question_id = ? ORDER BY answer_order",
                    (q["id"],),
                ).fetchall()
                if len(answers) != 4:
                    continue
                correct = next((i for i, a in enumerate(answers) if a["is_correct"]), -1)
                if correct < 0:
                    continue
                writer.writerow([q["category"], q["question"], *[a["answer_text"] for a in answers], correct, q["explanation"]])
                count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage the Life RPG quiz question bank.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    export_parser = subparsers.add_parser("export", help="Export SQL questions to a CSV spreadsheet.")
    export_parser.add_argument("path", nargs="?", type=Path, default=CSV_PATH)
    import_parser = subparsers.add_parser("import", help="Import a spreadsheet CSV into SQLite.")
    import_parser.add_argument("path", nargs="?", type=Path, default=CSV_PATH)
    import_parser.add_argument("--replace", action="store_true", help="Replace the entire question bank (recommended when importing an edited export).")
    args = parser.parse_args()

    initialize_database()
    if args.command == "export":
        count = export_questions(args.path)
        print(f"Exported {count} questions to {args.path}")
    else:
        count = import_questions_csv(args.path, replace=args.replace)
        print(f"Imported {count} questions from {args.path}")
        if not args.replace:
            print("Note: rows were added to the existing bank. Use --replace to avoid duplicates after editing an export.")


if __name__ == "__main__":
    main()
