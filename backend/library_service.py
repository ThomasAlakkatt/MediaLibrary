import sqlite3

from database import get_connection


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
def _ensure_item(connection, media_type, tmdb_id, details):
    connection.execute(
        """
        INSERT INTO library_items (media_type, tmdb_id, title, year, poster_path, overview)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (media_type, tmdb_id) DO UPDATE SET
            title = excluded.title,
            year = excluded.year,
            poster_path = excluded.poster_path,
            overview = excluded.overview
        """,
        (
            media_type,
            tmdb_id,
            details["title"],
            details.get("year"),
            details.get("poster_path"),
            details.get("overview"),
        ),
    )
    row = connection.execute(
        "SELECT id FROM library_items WHERE media_type = ? AND tmdb_id = ?", (media_type, tmdb_id)
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


def _load_item(connection, media_type, tmdb_id):
    row = connection.execute(
        "SELECT * FROM library_items WHERE media_type = ? AND tmdb_id = ?", (media_type, tmdb_id)
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


def get_item(media_type, tmdb_id):
    with get_connection() as connection:
        item = _load_item(connection, media_type, tmdb_id)
    if item is None:
        raise ItemNotFound()
    return item


def list_library(media_type=None, status=None):
    filters = [IS_LOGGED_SQL]
    params = []
    if media_type:
        filters.append("i.media_type = ?")
        params.append(media_type)
    if status:
        filters.append("i.status = ?")
        params.append(status)

    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT i.* FROM library_items i
            WHERE {" AND ".join(filters)}
            ORDER BY i.updated_at DESC, i.id DESC
            """,
            params,
        ).fetchall()
    return [dict(row) for row in rows]


# Replaces a title's log. Returns the saved title, or None if nothing about it is left to keep.
def save_log(media_type, tmdb_id, details, log):
    with get_connection() as connection:
        item_id = _ensure_item(connection, media_type, tmdb_id, details)
        connection.execute(
            """
            UPDATE library_items
            SET status = ?, rating = ?, review = ?, finished_on = ?, updated_at = datetime('now')
            WHERE id = ?
            """,
            (*(log.get(field) for field in LOG_FIELDS), item_id),
        )
        _prune_item(connection, item_id)
        return _load_item(connection, media_type, tmdb_id)


# Clears a title's log and season logs, but leaves it on its shelves.
def clear_log(media_type, tmdb_id):
    with get_connection() as connection:
        connection.execute(
            """
            DELETE FROM season_logs WHERE item_id IN (
                SELECT id FROM library_items WHERE media_type = ? AND tmdb_id = ?
            )
            """,
            (media_type, tmdb_id),
        )
        connection.execute(
            """
            UPDATE library_items
            SET status = NULL, rating = NULL, review = NULL, finished_on = NULL,
                updated_at = datetime('now')
            WHERE media_type = ? AND tmdb_id = ?
            """,
            (media_type, tmdb_id),
        )
        row = connection.execute(
            "SELECT id FROM library_items WHERE media_type = ? AND tmdb_id = ?",
            (media_type, tmdb_id),
        ).fetchone()
        if row is not None:
            _prune_item(connection, row["id"])
        return _load_item(connection, media_type, tmdb_id)


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
def add_to_shelf(shelf_id, media_type, tmdb_id, details):
    with get_connection() as connection:
        _require_shelf(connection, shelf_id)
        item_id = _ensure_item(connection, media_type, tmdb_id, details)
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
