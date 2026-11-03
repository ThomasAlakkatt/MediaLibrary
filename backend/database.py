import os
import sqlite3
import shutil
from contextlib import contextmanager
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).parent / "medialibrary.db"

# library_items holds one row per movie or show, with a copy of its TMDB details so the library can
# be shown without calling TMDB. Log fields are all optional because a title can be on a shelf without
# being logged. A rating is any number from 0 to 10.
SCHEMA = """
CREATE TABLE IF NOT EXISTS library_items (
    id INTEGER PRIMARY KEY,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    tmdb_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    year TEXT,
    poster_path TEXT,
    overview TEXT,
    status TEXT CHECK (status IN ('want', 'in_progress', 'finished')),
    rating REAL CHECK (rating BETWEEN 0 AND 10),
    review TEXT,
    finished_on TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (media_type, tmdb_id)
);

CREATE TABLE IF NOT EXISTS season_logs (
    item_id INTEGER NOT NULL REFERENCES library_items (id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    status TEXT CHECK (status IN ('want', 'in_progress', 'finished')),
    rating REAL CHECK (rating BETWEEN 0 AND 10),
    finished_on TEXT,
    PRIMARY KEY (item_id, season_number)
);

CREATE TABLE IF NOT EXISTS shelves (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shelf_items (
    shelf_id INTEGER NOT NULL REFERENCES shelves (id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES library_items (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (shelf_id, item_id)
);
"""


def _db_path():
    # The override lets tests and trial runs use a throwaway database instead of the real library.
    return os.getenv("MEDIALIBRARY_DB") or DEFAULT_DB_PATH


# Opens a connection for one unit of work: commits if the block succeeds, rolls back if it raises.
@contextmanager
def get_connection():
    connection = sqlite3.connect(_db_path())
    connection.row_factory = sqlite3.Row
    # SQLite only enforces foreign keys, and so ON DELETE CASCADE, when this is set on each connection.
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


# Stored in the database file, so an older library can be upgraded when the app starts.
SCHEMA_VERSION = 1


# Version 0 only allowed ratings of 0.5 and up. SQLite can't edit a CHECK rule in place, so each table
# with one is rebuilt with the new rule and its rows copied across. A copy of the old file is kept first,
# and any failure rolls the whole change back.
def _upgrade_to_version_1():
    path = _db_path()
    shutil.copy2(path, f"{path}-before-rating-change")

    connection = sqlite3.connect(path, isolation_level=None)
    try:
        # Must be off so dropping library_items doesn't cascade and delete the rows that refer to it.
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute("BEGIN")
        try:
            for table in ("library_items", "season_logs"):
                old_sql = connection.execute(
                    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
                ).fetchone()[0]
                new_sql = old_sql.replace(
                    "CHECK (rating BETWEEN 0.5 AND 10)", "CHECK (rating BETWEEN 0 AND 10)"
                ).replace(f"CREATE TABLE {table}", f"CREATE TABLE new_{table}", 1)
                connection.execute(new_sql)
                connection.execute(f"INSERT INTO new_{table} SELECT * FROM {table}")
                connection.execute(f"DROP TABLE {table}")
                connection.execute(f"ALTER TABLE new_{table} RENAME TO {table}")
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("Database upgrade would break links between tables")
            connection.execute("PRAGMA user_version = 1")
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise
    finally:
        connection.close()


def init_db():
    with get_connection() as connection:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        has_library = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'library_items'"
        ).fetchone()

    if has_library and version < 1:
        _upgrade_to_version_1()

    with get_connection() as connection:
        connection.executescript(SCHEMA)
        connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
