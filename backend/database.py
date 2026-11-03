import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).parent / "medialibrary.db"

# library_items holds one row per movie or show, with a copy of its TMDB details so the library can
# be shown without calling TMDB. Log fields are all optional because a title can be on a shelf without
# being logged. A rating is 0.5 to 10 in half steps.
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
    rating REAL CHECK (rating BETWEEN 0.5 AND 10),
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
    rating REAL CHECK (rating BETWEEN 0.5 AND 10),
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


def init_db():
    with get_connection() as connection:
        connection.executescript(SCHEMA)
