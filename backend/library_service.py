import sqlite3
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
def _ensure_item(connection, media_type, tmdb_id, details, track_index=-1):
    connection.execute(
        """
        INSERT INTO library_items (
            media_type, tmdb_id, track_index, title, artists, album_title,
            year, release_date, poster_path, overview
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (media_type, tmdb_id, track_index) DO UPDATE SET
            title = excluded.title,
            artists = excluded.artists,
            album_title = excluded.album_title,
            year = excluded.year,
            release_date = COALESCE(excluded.release_date, release_date),
            poster_path = excluded.poster_path,
            overview = excluded.overview
        """,
        (
            media_type,
            tmdb_id,
            track_index,
            details["title"],
            details.get("artists"),
            details.get("album_title"),
            details.get("year"),
            details.get("release_date"),
            details.get("poster_path"),
            details.get("overview"),
        ),
    )
    row = connection.execute(
        "SELECT id FROM library_items WHERE media_type = ? AND tmdb_id = ? AND track_index = ?",
        (media_type, tmdb_id, track_index),
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


def _load_item(connection, media_type, tmdb_id, track_index=-1):
    row = connection.execute(
        "SELECT * FROM library_items WHERE media_type = ? AND tmdb_id = ? AND track_index = ?",
        (media_type, tmdb_id, track_index),
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


def get_item(media_type, tmdb_id, track_index=-1):
    with get_connection() as connection:
        item = _load_item(connection, media_type, tmdb_id, track_index)
    if item is None:
        raise ItemNotFound()
    return item


# Titles logged before release dates were stored only have a year, so this fills in what's missing.
# It's only worth the TMDB requests when sorting by release, and a failure just leaves the year in place.
def _fill_missing_release_dates():
    with get_connection() as connection:
        missing = connection.execute(
            """
            SELECT id, media_type, tmdb_id FROM library_items
            WHERE release_date IS NULL AND media_type IN ('movie', 'tv')
            """
        ).fetchall()

    for row in missing:
        release_date = get_release_date(row["media_type"], row["tmdb_id"])
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


def _is_being_watched(item, seasons):
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


# Both date sorts treat a title with no date as the latest of all. Dates are written YYYY-MM-DD, or
# just YYYY for a release year, so they compare correctly as text. Python keeps tied items in their
# existing order, so ties stay most recently changed first.
def _sort_by_date(items, date_of, order):
    def sort_key(item):
        item_date = date_of(item)
        return (item_date is None, item_date or "")

    return sorted(items, key=sort_key, reverse=order == "desc")


# sort is "changed", "watched" or "release", and order is "desc" (newest first) or "asc".
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

    # Lets a show logged only by season say something useful about itself.
    for item in items:
        seasons = seasons_by_item.get(item["id"], [])
        item["season_counts"] = {
            season_status: sum(1 for season in seasons if season["status"] == season_status)
            for season_status in ("want", "in_progress", "finished")
        }

    if sort == "watched":
        today = date.today().isoformat()

        def watched_sort_date(item):
            seasons = seasons_by_item.get(item["id"], [])
            # Something still being watched counts as watched today.
            return today if _is_being_watched(item, seasons) else _finished_date(item, seasons)

        for item in items:
            seasons = seasons_by_item.get(item["id"], [])
            being_watched = _is_being_watched(item, seasons)
            item["watched_date"] = None if being_watched else _finished_date(item, seasons)
        return _sort_by_date(items, watched_sort_date, order)

    if sort == "release":
        return _sort_by_date(items, lambda item: item["release_date"] or item["year"], order)

    return items if order == "desc" else items[::-1]


# Replaces a title's log. Returns the saved title, or None if nothing about it is left to keep.
def save_log(media_type, tmdb_id, details, log, track_index=-1):
    with get_connection() as connection:
        item_id = _ensure_item(connection, media_type, tmdb_id, details, track_index)
        connection.execute(
            """
            UPDATE library_items
            SET status = ?, rating = ?, review = ?, finished_on = ?, updated_at = datetime('now')
            WHERE id = ?
            """,
            (*(log.get(field) for field in LOG_FIELDS), item_id),
        )
        _prune_item(connection, item_id)
        return _load_item(connection, media_type, tmdb_id, track_index)


# Saves the same log to each song in tracks, all or nothing, where each becomes its own entry.
def save_songs_log(album_id, album_details, tracks, log):
    with get_connection() as connection:
        for track in tracks:
            details = {
                **album_details,
                "title": track["title"],
                "album_title": album_details["title"],
                "overview": None,
            }
            item_id = _ensure_item(connection, "song", album_id, details, track["track_index"])
            connection.execute(
                """
                UPDATE library_items
                SET status = ?, rating = ?, review = ?, finished_on = ?, updated_at = datetime('now')
                WHERE id = ?
                """,
                (*(log.get(field) for field in LOG_FIELDS), item_id),
            )
            _prune_item(connection, item_id)
    return list_album_songs(album_id)


# The songs from an album that are in the library, in tracklist order.
def list_album_songs(album_id):
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM library_items WHERE media_type = 'song' AND tmdb_id = ? ORDER BY track_index",
            (album_id,),
        ).fetchall()
    return [dict(row) for row in rows]


# Clears a title's log and season logs, but leaves it on its shelves.
def clear_log(media_type, tmdb_id, track_index=-1):
    where = "media_type = ? AND tmdb_id = ? AND track_index = ?"
    key = (media_type, tmdb_id, track_index)
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
            WHERE media_type = ? AND tmdb_id = ? AND track_index = ?
            """,
            key,
        )
        row = connection.execute(f"SELECT id FROM library_items WHERE {where}", key).fetchone()
        if row is not None:
            _prune_item(connection, row["id"])
        return _load_item(connection, media_type, tmdb_id, track_index)


# Saves one season's log for a show. An empty log removes that season's entry.
def save_season_log(tmdb_id, season_number, details, log):
    with get_connection() as connection:
        item_id = _ensure_item(connection, "tv", tmdb_id, details)
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
        return _load_item(connection, "tv", tmdb_id)


def _require_shelf(connection, shelf_id):
    row = connection.execute("SELECT * FROM shelves WHERE id = ?", (shelf_id,)).fetchone()
    if row is None:
        raise ShelfNotFound()
    return dict(row)


def _shelf_items(connection, shelf_id):
    return [
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


def get_shelf(shelf_id):
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
def add_to_shelf(shelf_id, media_type, tmdb_id, details, track_index=-1):
    with get_connection() as connection:
        _require_shelf(connection, shelf_id)
        item_id = _ensure_item(connection, media_type, tmdb_id, details, track_index)
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
