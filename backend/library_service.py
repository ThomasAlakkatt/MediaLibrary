import re
import sqlite3
import unicodedata
from datetime import date

from database import get_connection
from tmdb_service import get_release_date


class ShelfNotFound(Exception):
    pass


class ItemNotFound(Exception):
    pass


class DuplicateShelfName(Exception):
    pass


class InvalidShelfOrder(Exception):
    pass


LOG_FIELDS = ("status", "rating", "review", "finished_on")

# A title counts as logged, and so appears in the library, if any of this is set.
IS_LOGGED_SQL = """(
    i.status IS NOT NULL OR i.rating IS NOT NULL OR i.review IS NOT NULL OR i.finished_on IS NOT NULL
    OR EXISTS (SELECT 1 FROM season_logs s WHERE s.item_id = i.id)
)"""


# Adds the title if it's new, or refreshes its TMDB details if not. Returns its library_items id.
def _ensure_item(connection, media_type, source_id, details, track_index=-1):
    connection.execute(
        """
        INSERT INTO library_items (
            media_type, source_id, track_index, title, creators, album_title,
            year, release_date, poster_path, overview
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (media_type, source_id, track_index) DO UPDATE SET
            title = excluded.title,
            creators = excluded.creators,
            album_title = excluded.album_title,
            year = excluded.year,
            release_date = COALESCE(excluded.release_date, release_date),
            poster_path = excluded.poster_path,
            overview = excluded.overview
        """,
        (
            media_type,
            source_id,
            track_index,
            details["title"],
            details.get("creators"),
            details.get("album_title"),
            details.get("year"),
            details.get("release_date"),
            details.get("poster_path"),
            details.get("overview"),
        ),
    )
    row = connection.execute(
        "SELECT id FROM library_items WHERE media_type = ? AND source_id = ? AND track_index = ?",
        (media_type, source_id, track_index),
    ).fetchone()
    return row["id"]


# A title that's no longer logged or on any shelf has no reason to be kept.
def _prune_item(connection, item_id):
    connection.execute(
        f"""
        DELETE FROM library_items AS i
        WHERE i.id = ?
          AND NOT {IS_LOGGED_SQL}
          AND NOT EXISTS (SELECT 1 FROM shelf_items si WHERE si.item_id = i.id)
        """,
        (item_id,),
    )


def _touch_item(connection, item_id):
    connection.execute(
        "UPDATE library_items SET updated_at = datetime('now') WHERE id = ?", (item_id,)
    )


def _load_item(connection, media_type, source_id, track_index=-1):
    row = connection.execute(
        "SELECT * FROM library_items WHERE media_type = ? AND source_id = ? AND track_index = ?",
        (media_type, source_id, track_index),
    ).fetchone()
    if row is None:
        return None

    item = dict(row)
    item["seasons"] = [
        dict(season)
        for season in connection.execute(
            """
            SELECT season_number, status, finished_on
            FROM season_logs WHERE item_id = ? ORDER BY season_number
            """,
            (item["id"],),
        )
    ]
    item["shelf_ids"] = [
        shelf["shelf_id"]
        for shelf in connection.execute(
            "SELECT shelf_id FROM shelf_items WHERE item_id = ?", (item["id"],)
        )
    ]
    return item


def get_item(media_type, source_id, track_index=-1):
    with get_connection() as connection:
        item = _load_item(connection, media_type, source_id, track_index)
    if item is None:
        raise ItemNotFound()
    return item


# Titles logged before release dates were stored only have a year, so this fills in what's missing.
# It's only worth the TMDB requests when sorting by release, and a failure just leaves the year in place.
def _fill_missing_release_dates():
    with get_connection() as connection:
        missing = connection.execute(
            """
            SELECT id, media_type, source_id FROM library_items
            WHERE release_date IS NULL AND media_type IN ('movie', 'tv')
            """
        ).fetchall()

    for row in missing:
        release_date = get_release_date(row["media_type"], row["source_id"])
        if release_date:
            with get_connection() as connection:
                connection.execute(
                    "UPDATE library_items SET release_date = ? WHERE id = ?",
                    (release_date, row["id"]),
                )


# The date a title was finished: its own date, otherwise its most recent season's.
def _finished_date(item, seasons):
    if item["finished_on"]:
        return item["finished_on"]
    return max((s["finished_on"] for s in seasons if s["finished_on"]), default=None)


def _is_in_progress(item, seasons):
    if item["status"] == "in_progress":
        return True
    if item["status"] or item["finished_on"]:
        return False
    return any(s["status"] == "in_progress" for s in seasons)


def _load_seasons_by_item(connection):
    seasons = {}
    for row in connection.execute("SELECT item_id, status, finished_on FROM season_logs"):
        seasons.setdefault(row["item_id"], []).append(dict(row))
    return seasons


# Adds what's worked out from a title's log and season logs, for showing and sorting it anywhere:
# season_counts lets a show logged only by season say something useful about itself, finished_date is
# the date it was really finished, and finished_sort_date counts anything still in progress as today.
def _add_log_summaries(items, seasons_by_item):
    today = date.today().isoformat()
    for item in items:
        seasons = seasons_by_item.get(item["id"], [])
        in_progress = _is_in_progress(item, seasons)
        finished = _finished_date(item, seasons)
        item["season_counts"] = {
            season_status: sum(1 for season in seasons if season["status"] == season_status)
            for season_status in ("want", "in_progress", "finished")
        }
        item["finished_date"] = None if in_progress else finished
        item["finished_sort_date"] = today if in_progress else finished


# Both date sorts treat a title with no date as the latest of all. Dates are written YYYY-MM-DD, or
# just YYYY for a release year, so they compare correctly as text. Python keeps tied items in their
# existing order, so ties stay most recently changed first.
def _sort_by_date(items, date_of, order):
    def sort_key(item):
        item_date = date_of(item)
        return (item_date is None, item_date or "")

    return sorted(items, key=sort_key, reverse=order == "desc")


# Orders titles the way people read them: numbers by value, so Rocky 2 comes before Rocky 10, ignoring
# capitals and accents. Splitting on numbers always leaves them at the odd positions.
def _title_sort_key(item):
    decomposed = unicodedata.normalize("NFKD", item["title"])
    text = "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()
    parts = re.split(r"(\d+)", text)
    return [int(part) if index % 2 else part for index, part in enumerate(parts)]


# In progress comes first, then not started, then finished, then no status at all. A show
# logged only by season goes by its seasons.
def _status_rank(item):
    status_order = ("in_progress", "want", "finished")
    if item["status"]:
        return status_order.index(item["status"])
    for rank, status in enumerate(status_order):
        if item["season_counts"][status] > 0:
            return rank
    return len(status_order)


# sort is "changed", "finished", "release", "status", "rating" or "title". order is "desc" (newest or
# highest first) or "asc", and doesn't apply to status or title, which each have one natural order.
def list_library(media_type=None, status=None, sort="changed", order="desc"):
    if sort == "release":
        _fill_missing_release_dates()

    filters = [IS_LOGGED_SQL]
    params = []
    if media_type:
        filters.append("i.media_type = ?")
        params.append(media_type)
    if status:
        # A show logged only by season counts as having the statuses of its seasons.
        filters.append(
            """(i.status = ? OR (i.status IS NULL AND EXISTS (
                SELECT 1 FROM season_logs s WHERE s.item_id = i.id AND s.status = ?
            )))"""
        )
        params.extend([status, status])

    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT i.* FROM library_items i
            WHERE {" AND ".join(filters)}
            ORDER BY i.updated_at DESC, i.id DESC
            """,
            params,
        ).fetchall()
        seasons_by_item = _load_seasons_by_item(connection)

    items = [dict(row) for row in rows]
    _add_log_summaries(items, seasons_by_item)

    if sort == "finished":
        return _sort_by_date(items, lambda item: item["finished_sort_date"], order)

    if sort == "release":
        return _sort_by_date(items, lambda item: item["release_date"] or item["year"], order)

    if sort == "status":
        return sorted(items, key=_status_rank)

    if sort == "rating":
        direction = -1 if order == "desc" else 1
        # Unrated titles stay last in both directions, since they haven't scored low or high.
        return sorted(
            items,
            key=lambda item: (item["rating"] is None, direction * (item["rating"] or 0)),
        )

    if sort == "title":
        return sorted(items, key=_title_sort_key)

    return items if order == "desc" else items[::-1]


# Replaces a title's log. Returns the saved title, or None if nothing about it is left to keep.
def save_log(media_type, source_id, details, log, track_index=-1):
    with get_connection() as connection:
        item_id = _ensure_item(connection, media_type, source_id, details, track_index)
        connection.execute(
            """
            UPDATE library_items
            SET status = ?, rating = ?, review = ?, finished_on = ?, updated_at = datetime('now')
            WHERE id = ?
            """,
            (*(log.get(field) for field in LOG_FIELDS), item_id),
        )
        _prune_item(connection, item_id)
        return _load_item(connection, media_type, source_id, track_index)


# The songs from an album that are in the library, in tracklist order.
def list_album_songs(album_id):
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM library_items WHERE media_type = 'song' AND source_id = ? ORDER BY track_index",
            (album_id,),
        ).fetchall()
    return [dict(row) for row in rows]


# Clears a title's log and season logs, but leaves it on its shelves.
def clear_log(media_type, source_id, track_index=-1):
    where = "media_type = ? AND source_id = ? AND track_index = ?"
    key = (media_type, source_id, track_index)
    with get_connection() as connection:
        connection.execute(
            f"DELETE FROM season_logs WHERE item_id IN (SELECT id FROM library_items WHERE {where})",
            key,
        )
        connection.execute(
            """
            UPDATE library_items
            SET status = NULL, rating = NULL, review = NULL, finished_on = NULL,
                updated_at = datetime('now')
            WHERE media_type = ? AND source_id = ? AND track_index = ?
            """,
            key,
        )
        row = connection.execute(f"SELECT id FROM library_items WHERE {where}", key).fetchone()
        if row is not None:
            _prune_item(connection, row["id"])
        return _load_item(connection, media_type, source_id, track_index)


# Saves one season's log for a show. An empty log removes that season's entry.
def save_season_log(source_id, season_number, details, log):
    with get_connection() as connection:
        item_id = _ensure_item(connection, "tv", source_id, details)
        if any(log.get(field) is not None for field in ("status", "finished_on")):
            connection.execute(
                """
                INSERT INTO season_logs (item_id, season_number, status, finished_on)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (item_id, season_number) DO UPDATE SET
                    status = excluded.status,
                    finished_on = excluded.finished_on
                """,
                (item_id, season_number, log.get("status"), log.get("finished_on")),
            )
        else:
            connection.execute(
                "DELETE FROM season_logs WHERE item_id = ? AND season_number = ?",
                (item_id, season_number),
            )
        _touch_item(connection, item_id)
        _prune_item(connection, item_id)
        return _load_item(connection, "tv", source_id)


def _require_shelf(connection, shelf_id):
    row = connection.execute("SELECT * FROM shelves WHERE id = ?", (shelf_id,)).fetchone()
    if row is None:
        raise ShelfNotFound()
    return dict(row)


def _shelf_items(connection, shelf_id):
    items = [
        dict(row)
        for row in connection.execute(
            """
            SELECT i.*, si.position FROM shelf_items si
            JOIN library_items i ON i.id = si.item_id
            WHERE si.shelf_id = ?
            ORDER BY si.position
            """,
            (shelf_id,),
        )
    ]
    _add_log_summaries(items, _load_seasons_by_item(connection))
    return items


def list_shelves():
    with get_connection() as connection:
        shelves = [
            dict(row)
            for row in connection.execute("SELECT * FROM shelves ORDER BY name COLLATE NOCASE")
        ]
        for shelf in shelves:
            items = _shelf_items(connection, shelf["id"])
            shelf["item_count"] = len(items)
            # The first few posters act as the shelf's cover.
            shelf["cover_posters"] = [i["poster_path"] for i in items if i["poster_path"]][:4]
    return shelves


def create_shelf(name, description=None):
    try:
        with get_connection() as connection:
            cursor = connection.execute(
                "INSERT INTO shelves (name, description) VALUES (?, ?)", (name, description)
            )
            return _require_shelf(connection, cursor.lastrowid) | {"item_count": 0, "cover_posters": []}
    except sqlite3.IntegrityError as e:
        raise DuplicateShelfName() from e


# fill_release_dates looks up any that are missing first, for sorting a shelf by release date.
def get_shelf(shelf_id, fill_release_dates=False):
    if fill_release_dates:
        _fill_missing_release_dates()

    with get_connection() as connection:
        shelf = _require_shelf(connection, shelf_id)
        shelf["items"] = _shelf_items(connection, shelf_id)
    return shelf


def update_shelf(shelf_id, name, description=None):
    try:
        with get_connection() as connection:
            _require_shelf(connection, shelf_id)
            connection.execute(
                "UPDATE shelves SET name = ?, description = ? WHERE id = ?",
                (name, description, shelf_id),
            )
            shelf = _require_shelf(connection, shelf_id)
            shelf["items"] = _shelf_items(connection, shelf_id)
            return shelf
    except sqlite3.IntegrityError as e:
        raise DuplicateShelfName() from e


# Deletes the shelf only. Its titles stay in the library if they're logged or on another shelf.
def delete_shelf(shelf_id):
    with get_connection() as connection:
        _require_shelf(connection, shelf_id)
        item_ids = [item["id"] for item in _shelf_items(connection, shelf_id)]
        connection.execute("DELETE FROM shelves WHERE id = ?", (shelf_id,))
        for item_id in item_ids:
            _prune_item(connection, item_id)


# Adds a title to the end of a shelf, like a playlist. Adding one that's already there changes nothing.
def add_to_shelf(shelf_id, media_type, source_id, details, track_index=-1):
    with get_connection() as connection:
        _require_shelf(connection, shelf_id)
        item_id = _ensure_item(connection, media_type, source_id, details, track_index)
        connection.execute(
            """
            INSERT OR IGNORE INTO shelf_items (shelf_id, item_id, position)
            VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM shelf_items WHERE shelf_id = ?))
            """,
            (shelf_id, item_id, shelf_id),
        )
    return get_shelf(shelf_id)


def remove_from_shelf(shelf_id, item_id):
    with get_connection() as connection:
        _require_shelf(connection, shelf_id)
        connection.execute(
            "DELETE FROM shelf_items WHERE shelf_id = ? AND item_id = ?", (shelf_id, item_id)
        )
        _prune_item(connection, item_id)
    return get_shelf(shelf_id)


# item_ids is the shelf's new order and must list exactly the titles on the shelf.
def reorder_shelf(shelf_id, item_ids):
    with get_connection() as connection:
        _require_shelf(connection, shelf_id)
        current = {item["id"] for item in _shelf_items(connection, shelf_id)}
        if len(item_ids) != len(current) or set(item_ids) != current:
            raise InvalidShelfOrder()
        connection.executemany(
            "UPDATE shelf_items SET position = ? WHERE shelf_id = ? AND item_id = ?",
            [(position, shelf_id, item_id) for position, item_id in enumerate(item_ids)],
        )
    return get_shelf(shelf_id)
