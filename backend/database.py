import os
import sqlite3
import shutil
from contextlib import contextmanager
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).parent / "medialibrary.db"

# library_items holds one row per movie, show, album or song, with a copy of its details so the library
# can be shown without calling TMDB or Discogs. Log fields are all optional because a title can be on a
# shelf without being logged. A rating is any number from 0 to 10.
#
# tmdb_id is the source's ID: TMDB's for movies and shows, and the Discogs master's for albums and songs.
# poster_path is a TMDB path for movies and shows, and a full image address for music. A song has no ID
# of its own, so it's identified by its album's ID plus its place in the tracklist (track_index, which
# stays -1 for everything else).
SCHEMA = """
CREATE TABLE IF NOT EXISTS library_items (
    id INTEGER PRIMARY KEY,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv', 'album', 'song')),
    tmdb_id INTEGER NOT NULL,
    track_index INTEGER NOT NULL DEFAULT -1,
    title TEXT NOT NULL,
    artists TEXT,
    album_title TEXT,
    year TEXT,
    release_date TEXT,
    poster_path TEXT,
    overview TEXT,
    status TEXT CHECK (status IN ('want', 'in_progress', 'finished')),
    rating REAL CHECK (rating BETWEEN 0 AND 10),
    review TEXT,
    finished_on TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (media_type, tmdb_id, track_index)
);

CREATE TABLE IF NOT EXISTS season_logs (
    item_id INTEGER NOT NULL REFERENCES library_items (id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    status TEXT CHECK (status IN ('want', 'in_progress', 'finished')),
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
SCHEMA_VERSION = 4


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


# Version 1 let seasons have their own rating. Seasons now only have a status and date, so the column
# goes, along with season logs that had nothing else, and any title that leaves with nothing to keep.
def _upgrade_to_version_2():
    path = _db_path()
    shutil.copy2(path, f"{path}-before-season-rating-removal")

    connection = sqlite3.connect(path, isolation_level=None)
    try:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute("BEGIN")
        try:
            connection.execute(
                """
                CREATE TABLE new_season_logs (
                    item_id INTEGER NOT NULL REFERENCES library_items (id) ON DELETE CASCADE,
                    season_number INTEGER NOT NULL,
                    status TEXT CHECK (status IN ('want', 'in_progress', 'finished')),
                    finished_on TEXT,
                    PRIMARY KEY (item_id, season_number)
                )
                """
            )
            connection.execute(
                """
                INSERT INTO new_season_logs (item_id, season_number, status, finished_on)
                SELECT item_id, season_number, status, finished_on FROM season_logs
                WHERE status IS NOT NULL OR finished_on IS NOT NULL
                """
            )
            connection.execute("DROP TABLE season_logs")
            connection.execute("ALTER TABLE new_season_logs RENAME TO season_logs")
            connection.execute(
                """
                DELETE FROM library_items
                WHERE status IS NULL AND rating IS NULL AND review IS NULL AND finished_on IS NULL
                  AND id NOT IN (SELECT item_id FROM season_logs)
                  AND id NOT IN (SELECT item_id FROM shelf_items)
                """
            )
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("Database upgrade would break links between tables")
            connection.execute("PRAGMA user_version = 2")
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise
    finally:
        connection.close()


# Version 2 only stored a release year. Adding a column leaves existing rows untouched, so this needs no
# copy of the file. Existing titles get their dates from TMDB the first time they're sorted by release.
def _upgrade_to_version_3():
    with get_connection() as connection:
        connection.execute("ALTER TABLE library_items ADD COLUMN release_date TEXT")


# Version 3 only held movies and shows. Allowing other types means replacing a CHECK rule, so the table is
# rebuilt with every row and ID kept, which leaves shelves and season logs still pointing at the right rows.
def _upgrade_to_version_4():
    path = _db_path()
    shutil.copy2(path, f"{path}-before-music-logging")

    connection = sqlite3.connect(path, isolation_level=None)
    try:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute("BEGIN")
        try:
            connection.execute(
                """
                CREATE TABLE new_library_items (
                    id INTEGER PRIMARY KEY,
                    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv', 'album', 'song')),
                    tmdb_id INTEGER NOT NULL,
                    track_index INTEGER NOT NULL DEFAULT -1,
                    title TEXT NOT NULL,
                    artists TEXT,
                    album_title TEXT,
                    year TEXT,
                    release_date TEXT,
                    poster_path TEXT,
                    overview TEXT,
                    status TEXT CHECK (status IN ('want', 'in_progress', 'finished')),
                    rating REAL CHECK (rating BETWEEN 0 AND 10),
                    review TEXT,
                    finished_on TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    UNIQUE (media_type, tmdb_id, track_index)
                )
                """
            )
            columns = (
                "id, media_type, tmdb_id, title, year, release_date, poster_path, overview, "
                "status, rating, review, finished_on, created_at, updated_at"
            )
            connection.execute(
                f"INSERT INTO new_library_items ({columns}) SELECT {columns} FROM library_items"
            )
            connection.execute("DROP TABLE library_items")
            connection.execute("ALTER TABLE new_library_items RENAME TO library_items")
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("Database upgrade would break links between tables")
            connection.execute("PRAGMA user_version = 4")
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
    if has_library and version < 2:
        _upgrade_to_version_2()
    if has_library and version < 3:
        _upgrade_to_version_3()
    if has_library and version < 4:
        _upgrade_to_version_4()

    with get_connection() as connection:
        connection.executescript(SCHEMA)
        connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
