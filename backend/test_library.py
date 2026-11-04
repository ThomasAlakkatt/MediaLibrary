import sqlite3

import pytest

import library_service

DUNE = {"media_type": "movie", "tmdb_id": 1, "title": "Dune", "year": "2021", "poster_path": "/d.jpg"}
BB = {"media_type": "tv", "tmdb_id": 2, "title": "Breaking Bad", "year": "2008", "poster_path": "/b.jpg"}
HEAT = {"media_type": "movie", "tmdb_id": 3, "title": "Heat", "year": "1995", "poster_path": None}


def details(title):
    return {key: title[key] for key in ("title", "year", "poster_path")}


def save_log(client, title, **log):
    return client.put(
        f"/library/{title['media_type']}/{title['tmdb_id']}", json={**details(title), **log}
    )


def make_shelf(client, name="Favorites"):
    response = client.post("/shelves", json={"name": name})
    assert response.status_code == 201
    return response.json()["id"]


def add(client, shelf_id, title):
    return client.post(f"/shelves/{shelf_id}/items", json=title)


def titles(shelf):
    return [item["title"] for item in shelf["items"]]


@pytest.mark.parametrize("rating", [0, 0.5, 0.01, 1, 7.3, 7.33, 8, 9.75, 9.99, 10])
def test_valid_ratings_are_saved(client, rating):
    response = save_log(client, DUNE, rating=rating)
    assert response.status_code == 200
    assert response.json()["rating"] == rating


@pytest.mark.parametrize("rating", [-1, -0.1, -0.01, 10.01, 10.1, 11, 7.333, 0.001])
def test_invalid_ratings_are_rejected(client, rating):
    assert save_log(client, DUNE, rating=rating).status_code == 422
    assert client.get("/library").json() == []


def test_a_rating_of_zero_counts_as_logged(client):
    save_log(client, DUNE, rating=0)
    assert client.get("/library/movie/1").json()["rating"] == 0
    assert [i["title"] for i in client.get("/library").json()] == ["Dune"]


def test_log_round_trip(client):
    save_log(client, DUNE, status="finished", rating=8.5, review="  Great  ", finished_on="2026-11-01")
    item = client.get("/library/movie/1").json()
    assert (item["status"], item["rating"], item["review"], item["finished_on"]) == (
        "finished",
        8.5,
        "Great",
        "2026-11-01",
    )


def test_invalid_status_and_date_are_rejected(client):
    assert save_log(client, DUNE, status="abandoned").status_code == 422
    assert save_log(client, DUNE, finished_on="not-a-date").status_code == 422


def test_saving_replaces_the_previous_log(client):
    save_log(client, DUNE, status="finished", rating=8)
    item = save_log(client, DUNE, status="want").json()
    assert (item["status"], item["rating"]) == ("want", None)


def test_same_id_for_a_movie_and_a_show_stays_separate(client):
    save_log(client, {**DUNE, "tmdb_id": 5}, rating=1)
    save_log(client, {**BB, "tmdb_id": 5}, rating=9)
    assert client.get("/library/movie/5").json()["title"] == "Dune"
    assert client.get("/library/tv/5").json()["title"] == "Breaking Bad"


def test_unknown_title_is_a_404(client):
    assert client.get("/library/movie/999").status_code == 404


def test_library_filters(client):
    save_log(client, DUNE, status="finished")
    save_log(client, BB, status="want")
    assert len(client.get("/library").json()) == 2
    assert [i["title"] for i in client.get("/library?media_type=tv").json()] == ["Breaking Bad"]
    assert [i["title"] for i in client.get("/library?status=finished").json()] == ["Dune"]


def test_an_empty_log_leaves_nothing_behind(client):
    save_log(client, DUNE, rating=8)
    assert save_log(client, DUNE).json() is None
    assert client.get("/library/movie/1").status_code == 404


def test_season_logs(client):
    url = "/library/tv/2/seasons"
    item = client.put(f"{url}/1", json={**details(BB), "status": "finished"}).json()
    assert item["seasons"] == [{"season_number": 1, "status": "finished", "finished_on": None}]
    assert item["status"] is None
    assert [i["title"] for i in client.get("/library").json()] == ["Breaking Bad"]

    client.put(f"{url}/0", json={**details(BB), "status": "want"})
    item = client.put(f"{url}/1", json={**details(BB), "status": "in_progress"}).json()
    assert [(s["season_number"], s["status"]) for s in item["seasons"]] == [
        (0, "want"),
        (1, "in_progress"),
    ]


def test_seasons_do_not_have_ratings(client):
    response = client.put("/library/tv/2/seasons/1", json={**details(BB), "rating": 7})
    assert response.status_code == 200
    assert response.json() is None
    assert client.get("/library/tv/2").status_code == 404

    item = client.put(
        "/library/tv/2/seasons/1", json={**details(BB), "status": "want", "rating": 7}
    ).json()
    assert "rating" not in item["seasons"][0]


def test_clearing_all_season_logs_removes_an_otherwise_empty_title(client):
    client.put("/library/tv/2/seasons/1", json={**details(BB), "status": "want"})
    assert client.put("/library/tv/2/seasons/1", json=details(BB)).json() is None
    assert client.get("/library").json() == []


def test_clearing_a_log_removes_seasons_but_keeps_shelves(client):
    shelf_id = make_shelf(client)
    add(client, shelf_id, BB)
    client.put("/library/tv/2/seasons/1", json={**details(BB), "status": "want"})
    save_log(client, BB, rating=9)

    item = client.delete("/library/tv/2").json()

    assert (item["rating"], item["seasons"], item["shelf_ids"]) == (None, [], [shelf_id])
    assert client.get("/library").json() == []
    assert titles(client.get(f"/shelves/{shelf_id}").json()) == ["Breaking Bad"]


def test_clearing_a_log_that_does_not_exist_is_harmless(client):
    response = client.delete("/library/movie/999")
    assert response.status_code == 200
    assert response.json() is None


def test_shelf_mixes_movies_and_shows_in_the_order_added(client):
    shelf_id = make_shelf(client)
    for title in (DUNE, BB, HEAT):
        assert add(client, shelf_id, title).status_code == 200
    assert titles(client.get(f"/shelves/{shelf_id}").json()) == ["Dune", "Breaking Bad", "Heat"]


def test_title_can_be_on_several_shelves_but_only_once_per_shelf(client):
    first, second = make_shelf(client, "A"), make_shelf(client, "B")
    add(client, first, DUNE)
    add(client, first, DUNE)
    add(client, second, DUNE)
    assert titles(client.get(f"/shelves/{first}").json()) == ["Dune"]
    assert sorted(client.get("/library/movie/1").json()["shelf_ids"]) == sorted([first, second])


def test_shelved_title_is_not_in_the_library_until_logged(client):
    add(client, make_shelf(client), DUNE)
    assert client.get("/library").json() == []
    save_log(client, DUNE, rating=8)
    assert len(client.get("/library").json()) == 1


def test_shelving_keeps_an_existing_log(client):
    save_log(client, DUNE, rating=8.5)
    add(client, make_shelf(client), DUNE)
    assert client.get("/library/movie/1").json()["rating"] == 8.5


def test_shelf_list_counts_and_covers(client):
    shelf_id = make_shelf(client)
    for title in (DUNE, HEAT, BB):
        add(client, shelf_id, title)
    shelf = client.get("/shelves").json()[0]
    assert shelf["item_count"] == 3
    assert shelf["cover_posters"] == ["/d.jpg", "/b.jpg"]


def test_shelf_names_are_required_and_unique_ignoring_case(client):
    make_shelf(client, "Favorites")
    assert client.post("/shelves", json={"name": "  fAVORITES "}).status_code == 409
    assert client.post("/shelves", json={"name": "   "}).status_code == 422


def test_rename_shelf(client):
    first, second = make_shelf(client, "A"), make_shelf(client, "B")
    assert client.patch(f"/shelves/{first}", json={"name": "C"}).json()["name"] == "C"
    assert client.patch(f"/shelves/{first}", json={"name": "b"}).status_code == 409
    assert client.get(f"/shelves/{second}").json()["name"] == "B"


def test_reorder_shelf(client):
    shelf_id = make_shelf(client)
    ids = [add(client, shelf_id, t).json()["items"][-1]["id"] for t in (DUNE, BB, HEAT)]
    reordered = client.put(f"/shelves/{shelf_id}/order", json={"item_ids": ids[::-1]})
    assert titles(reordered.json()) == ["Heat", "Breaking Bad", "Dune"]


@pytest.mark.parametrize("bad_order", [[], [1], [1, 1], [1, 2, 3]])
def test_reorder_must_list_exactly_the_shelf(client, bad_order):
    shelf_id = make_shelf(client)
    add(client, shelf_id, DUNE)
    add(client, shelf_id, BB)
    assert client.put(f"/shelves/{shelf_id}/order", json={"item_ids": bad_order}).status_code == 400
    assert titles(client.get(f"/shelves/{shelf_id}").json()) == ["Dune", "Breaking Bad"]


def test_adding_after_a_removal_goes_to_the_end(client):
    shelf_id = make_shelf(client)
    first_id = add(client, shelf_id, DUNE).json()["items"][0]["id"]
    add(client, shelf_id, BB)
    client.delete(f"/shelves/{shelf_id}/items/{first_id}")
    assert titles(add(client, shelf_id, HEAT).json()) == ["Breaking Bad", "Heat"]


def test_removing_from_a_shelf_keeps_a_logged_title(client):
    shelf_id = make_shelf(client)
    save_log(client, DUNE, rating=8)
    item_id = add(client, shelf_id, DUNE).json()["items"][0]["id"]
    assert titles(client.delete(f"/shelves/{shelf_id}/items/{item_id}").json()) == []
    assert client.get("/library/movie/1").json()["rating"] == 8


def test_removing_an_unlogged_title_from_its_last_shelf_removes_it(client):
    first, second = make_shelf(client, "A"), make_shelf(client, "B")
    item_id = add(client, first, DUNE).json()["items"][0]["id"]
    add(client, second, DUNE)
    client.delete(f"/shelves/{first}/items/{item_id}")
    assert client.get("/library/movie/1").status_code == 200
    client.delete(f"/shelves/{second}/items/{item_id}")
    assert client.get("/library/movie/1").status_code == 404


def test_deleting_a_shelf_keeps_logs_and_other_shelves(client):
    doomed, kept = make_shelf(client, "A"), make_shelf(client, "B")
    save_log(client, DUNE, rating=8)
    add(client, doomed, DUNE)
    add(client, doomed, BB)
    add(client, doomed, HEAT)
    add(client, kept, HEAT)

    assert client.delete(f"/shelves/{doomed}").status_code == 204

    assert client.get(f"/shelves/{doomed}").status_code == 404
    assert client.get("/library/movie/1").json()["rating"] == 8
    assert client.get("/library/tv/2").status_code == 404
    assert titles(client.get(f"/shelves/{kept}").json()) == ["Heat"]


@pytest.mark.parametrize(
    "method, path, body",
    [
        ("get", "/shelves/999", None),
        ("patch", "/shelves/999", {"name": "x"}),
        ("delete", "/shelves/999", None),
        ("post", "/shelves/999/items", DUNE),
        ("delete", "/shelves/999/items/1", None),
        ("put", "/shelves/999/order", {"item_ids": []}),
    ],
)
def test_missing_shelf_is_a_404(client, method, path, body):
    kwargs = {"json": body} if body else {}
    assert getattr(client, method)(path, **kwargs).status_code == 404


def test_add_to_missing_shelf_stores_nothing(client):
    add(client, 999, DUNE)
    assert client.get("/library/movie/1").status_code == 404


def test_library_data_survives_a_restart(client):
    save_log(client, DUNE, rating=8)
    from database import init_db

    init_db()
    assert client.get("/library/movie/1").json()["rating"] == 8


# The first version of the database, exactly as older libraries have it.
OLD_SCHEMA = """
CREATE TABLE library_items (
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
CREATE TABLE season_logs (
    item_id INTEGER NOT NULL REFERENCES library_items (id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    status TEXT CHECK (status IN ('want', 'in_progress', 'finished')),
    rating REAL CHECK (rating BETWEEN 0.5 AND 10),
    finished_on TEXT,
    PRIMARY KEY (item_id, season_number)
);
CREATE TABLE shelves (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE shelf_items (
    shelf_id INTEGER NOT NULL REFERENCES shelves (id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES library_items (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (shelf_id, item_id)
);
INSERT INTO library_items (id, media_type, tmdb_id, title, status, rating, review)
VALUES (7, 'tv', 2, 'Breaking Bad', 'finished', 9.5, 'Great');
INSERT INTO season_logs VALUES (7, 1, 'finished', 8.5, '2026-11-01');
INSERT INTO shelves (id, name) VALUES (3, 'Favorites');
INSERT INTO shelf_items VALUES (3, 7, 0);
"""


@pytest.fixture
def old_database(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    connection = sqlite3.connect(path)
    connection.executescript(OLD_SCHEMA)
    connection.close()
    monkeypatch.setenv("MEDIALIBRARY_DB", str(path))
    return path


def upgraded_client():
    from fastapi.testclient import TestClient

    from app import app

    return TestClient(app)


def test_upgrade_keeps_everything_and_allows_new_ratings(old_database):
    with upgraded_client() as client:
        item = client.get("/library/tv/2").json()
        assert (item["id"], item["rating"], item["review"]) == (7, 9.5, "Great")
        assert item["shelf_ids"] == [3]
        assert item["seasons"] == [
            {"season_number": 1, "status": "finished", "finished_on": "2026-11-01"}
        ]
        assert [i["title"] for i in client.get("/shelves/3").json()["items"]] == ["Breaking Bad"]

        assert save_log(client, DUNE, rating=0).status_code == 200


def test_upgrade_keeps_a_copy_of_the_old_file(old_database):
    with upgraded_client():
        pass
    backup = sqlite3.connect(f"{old_database}-before-rating-change")
    assert backup.execute("SELECT rating FROM library_items").fetchone()[0] == 9.5
    backup.close()


def test_links_between_tables_still_work_after_upgrade(old_database):
    with upgraded_client() as client:
        assert client.delete("/shelves/3").status_code == 204
        client.delete("/library/tv/2")
        assert client.get("/library/tv/2").status_code == 404
    connection = sqlite3.connect(old_database)
    assert connection.execute("SELECT COUNT(*) FROM season_logs").fetchone()[0] == 0
    connection.close()


def test_upgrade_only_runs_once(old_database):
    with upgraded_client() as client:
        save_log(client, DUNE, rating=0)
    with upgraded_client() as client:
        assert client.get("/library/movie/1").json()["rating"] == 0


def make_version_1_database(path, monkeypatch, rows):
    connection = sqlite3.connect(path)
    connection.executescript(OLD_SCHEMA)
    connection.executescript(rows)
    connection.execute("PRAGMA user_version = 1")
    connection.close()
    monkeypatch.setenv("MEDIALIBRARY_DB", str(path))


def test_upgrade_removes_season_ratings_and_keeps_the_rest(tmp_path, monkeypatch):
    make_version_1_database(tmp_path / "v1.db", monkeypatch, "")
    with upgraded_client() as client:
        item = client.get("/library/tv/2").json()
        assert item["rating"] == 9.5
        assert item["seasons"] == [
            {"season_number": 1, "status": "finished", "finished_on": "2026-11-01"}
        ]
    connection = sqlite3.connect(tmp_path / "v1.db")
    columns = [row[1] for row in connection.execute("PRAGMA table_info(season_logs)")]
    assert columns == ["item_id", "season_number", "status", "finished_on"]
    assert connection.execute("PRAGMA user_version").fetchone()[0] == 3
    connection.close()


def test_upgrade_removes_what_only_had_a_season_rating(tmp_path, monkeypatch):
    make_version_1_database(
        tmp_path / "v1.db",
        monkeypatch,
        """
        INSERT INTO season_logs VALUES (7, 2, NULL, 6, NULL);
        INSERT INTO library_items (id, media_type, tmdb_id, title) VALUES (8, 'tv', 8, 'Only A Rating');
        INSERT INTO season_logs VALUES (8, 1, NULL, 5, NULL);
        INSERT INTO library_items (id, media_type, tmdb_id, title) VALUES (9, 'tv', 9, 'On A Shelf');
        INSERT INTO season_logs VALUES (9, 1, NULL, 5, NULL);
        INSERT INTO shelf_items VALUES (3, 9, 1);
        """,
    )
    with upgraded_client() as client:
        assert [s["season_number"] for s in client.get("/library/tv/2").json()["seasons"]] == [1]
        assert client.get("/library/tv/8").status_code == 404
        kept = client.get("/library/tv/9").json()
        assert (kept["seasons"], kept["shelf_ids"]) == ([], [3])


def test_upgrade_to_version_2_keeps_a_copy_of_the_old_file(tmp_path, monkeypatch):
    make_version_1_database(tmp_path / "v1.db", monkeypatch, "")
    with upgraded_client():
        pass
    backup = sqlite3.connect(f"{tmp_path / 'v1.db'}-before-season-rating-removal")
    assert backup.execute("SELECT rating FROM season_logs").fetchone()[0] == 8.5
    backup.close()


def movie(tmdb_id, title, release_date=None, year=None):
    return {
        "media_type": "movie",
        "tmdb_id": tmdb_id,
        "title": title,
        "release_date": release_date,
        "year": year or (release_date[:4] if release_date else None),
        "poster_path": None,
    }


def log_movie(client, title, **log):
    url = f"/library/{title['media_type']}/{title['tmdb_id']}"
    body = {key: title[key] for key in ("title", "release_date", "year")}
    assert client.put(url, json={**body, **log}).status_code == 200


def library_titles(client, **params):
    return [item["title"] for item in client.get("/library", params=params).json()]


@pytest.fixture
def fixed_today(monkeypatch):
    class FixedDate(library_service.date):
        @classmethod
        def today(cls):
            return cls(2026, 11, 3)

    monkeypatch.setattr(library_service, "date", FixedDate)


@pytest.fixture
def no_tmdb_lookups(monkeypatch):
    looked_up = []

    def fake_lookup(media_type, tmdb_id):
        looked_up.append((media_type, tmdb_id))
        return None

    monkeypatch.setattr(library_service, "get_release_date", fake_lookup)
    return looked_up


def test_sort_by_date_watched(client, fixed_today):
    log_movie(client, movie(1, "Older"), status="finished", finished_on="2020-01-01")
    log_movie(client, movie(2, "Upcoming"), status="want")
    log_movie(client, movie(3, "Recent"), status="finished", finished_on="2026-10-01")
    log_movie(client, movie(4, "Watching"), status="in_progress")

    assert library_titles(client, sort="watched") == ["Upcoming", "Watching", "Recent", "Older"]
    assert library_titles(client, sort="watched", order="asc") == [
        "Older",
        "Recent",
        "Watching",
        "Upcoming",
    ]


def test_being_watched_counts_as_today_even_against_future_dates(client, fixed_today):
    log_movie(client, movie(1, "Watching"), status="in_progress")
    log_movie(client, movie(2, "Yesterday"), status="finished", finished_on="2026-11-02")
    log_movie(client, movie(3, "Tomorrow"), status="finished", finished_on="2026-11-04")
    assert library_titles(client, sort="watched") == ["Tomorrow", "Watching", "Yesterday"]


def test_being_watched_ignores_an_old_date(client, fixed_today):
    log_movie(client, movie(1, "Rewatching"), status="in_progress", finished_on="2001-01-01")
    log_movie(client, movie(2, "Recent"), status="finished", finished_on="2026-10-01")
    assert library_titles(client, sort="watched") == ["Rewatching", "Recent"]


def test_a_title_with_no_date_of_any_kind_is_the_latest(client, fixed_today):
    log_movie(client, movie(1, "Dated"), status="finished", finished_on="2026-11-03")
    log_movie(client, movie(2, "Finished No Date"), status="finished")
    log_movie(client, movie(3, "Only Rated"), rating=8)
    assert library_titles(client, sort="watched")[-1] == "Dated"


def test_season_logs_give_a_show_its_watched_date(client, fixed_today):
    log_movie(client, movie(1, "Between"), status="finished", finished_on="2025-06-01")
    log_movie(client, movie(2, "Early"), status="finished", finished_on="2020-01-01")
    url = "/library/tv/9/seasons"
    client.put(f"{url}/1", json={**details(BB), "status": "finished", "finished_on": "2019-01-01"})
    client.put(f"{url}/2", json={**details(BB), "status": "finished", "finished_on": "2026-01-01"})

    assert library_titles(client, sort="watched") == ["Breaking Bad", "Between", "Early"]


def test_a_season_being_watched_counts_as_today(client, fixed_today):
    log_movie(client, movie(1, "Recent"), status="finished", finished_on="2026-10-01")
    client.put("/library/tv/9/seasons/1", json={**details(BB), "status": "in_progress"})
    assert library_titles(client, sort="watched") == ["Breaking Bad", "Recent"]


def test_watched_date_is_only_a_real_finished_date(client, fixed_today):
    log_movie(client, movie(1, "Done"), status="finished", finished_on="2026-10-01")
    log_movie(client, movie(2, "Watching"), status="in_progress", finished_on="2001-01-01")
    log_movie(client, movie(3, "Upcoming"), status="want")
    found = {i["title"]: i["watched_date"] for i in client.get("/library", params={"sort": "watched"}).json()}
    assert found == {"Done": "2026-10-01", "Watching": None, "Upcoming": None}


def test_sort_by_release_date(client, no_tmdb_lookups):
    log_movie(client, movie(1, "Middle", "2010-05-05"), rating=1)
    log_movie(client, movie(2, "Unreleased"), status="want")
    log_movie(client, movie(3, "Newest", "2025-01-01"), rating=1)
    log_movie(client, movie(4, "Oldest", "1995-12-15"), rating=1)

    assert library_titles(client, sort="release") == ["Unreleased", "Newest", "Middle", "Oldest"]
    assert library_titles(client, sort="release", order="asc") == [
        "Oldest",
        "Middle",
        "Newest",
        "Unreleased",
    ]


def test_release_sort_uses_the_full_date_within_a_year(client):
    log_movie(client, movie(1, "March", "2024-03-01"), rating=1)
    log_movie(client, movie(2, "October", "2024-10-01"), rating=1)
    assert library_titles(client, sort="release") == ["October", "March"]


def test_release_sort_fills_in_missing_dates_once(client, monkeypatch):
    looked_up = []

    def fake_lookup(media_type, tmdb_id):
        looked_up.append(tmdb_id)
        return {1: "2024-10-01", 2: "2024-03-01"}.get(tmdb_id)

    monkeypatch.setattr(library_service, "get_release_date", fake_lookup)
    log_movie(client, movie(1, "October", year="2024"), rating=1)
    log_movie(client, movie(2, "March", year="2024"), rating=1)

    assert library_titles(client, sort="release") == ["October", "March"]
    assert client.get("/library/movie/1").json()["release_date"] == "2024-10-01"
    library_titles(client, sort="release")
    assert sorted(looked_up) == [1, 2]


def test_release_sort_falls_back_to_the_year(client, no_tmdb_lookups):
    log_movie(client, movie(1, "Year Only", year="2030"), rating=1)
    log_movie(client, movie(2, "Full Date", "2024-03-01"), rating=1)
    assert library_titles(client, sort="release") == ["Year Only", "Full Date"]
    assert no_tmdb_lookups == [("movie", 1)]


def test_other_sorts_make_no_tmdb_requests(client, no_tmdb_lookups):
    log_movie(client, movie(1, "Year Only", year="2030"), rating=1)
    library_titles(client)
    library_titles(client, sort="watched")
    assert no_tmdb_lookups == []


def test_saving_without_a_release_date_keeps_the_stored_one(client):
    log_movie(client, movie(1, "Dune", "2021-09-15"), rating=1)
    log_movie(client, movie(1, "Dune"), rating=2)
    assert client.get("/library/movie/1").json()["release_date"] == "2021-09-15"


def test_sorting_works_with_filters(client, fixed_today):
    log_movie(client, movie(1, "A"), status="finished", finished_on="2020-01-01")
    log_movie(client, movie(2, "B"), status="finished", finished_on="2021-01-01")
    log_movie(client, movie(3, "C"), status="want")
    assert library_titles(client, sort="watched", status="finished") == ["B", "A"]


@pytest.mark.parametrize("params", [{"sort": "title"}, {"order": "sideways"}])
def test_unknown_sorts_are_rejected(client, params):
    assert client.get("/library", params=params).status_code == 422


def test_upgrade_adds_release_dates_without_losing_data(old_database):
    with upgraded_client() as client:
        item = client.get("/library/tv/2").json()
        assert item["release_date"] is None
        assert item["rating"] == 9.5


def test_library_items_count_their_seasons_by_status(client):
    url = "/library/tv/2/seasons"
    client.put(f"{url}/1", json={**details(BB), "status": "finished"})
    client.put(f"{url}/2", json={**details(BB), "status": "finished"})
    client.put(f"{url}/3", json={**details(BB), "status": "in_progress"})
    save_log(client, DUNE, rating=8)

    counts = {i["title"]: i["season_counts"] for i in client.get("/library").json()}
    assert counts["Breaking Bad"] == {"want": 0, "in_progress": 1, "finished": 2}
    assert counts["Dune"] == {"want": 0, "in_progress": 0, "finished": 0}


def test_status_filter_includes_shows_logged_only_by_season(client):
    url = "/library/tv/2/seasons"
    client.put(f"{url}/1", json={**details(BB), "status": "finished"})
    client.put(f"{url}/2", json={**details(BB), "status": "in_progress"})
    save_log(client, DUNE, status="want")

    assert library_titles(client, status="finished") == ["Breaking Bad"]
    assert library_titles(client, status="in_progress") == ["Breaking Bad"]
    assert library_titles(client, status="want") == ["Dune"]


def test_a_shows_own_status_beats_its_seasons_in_the_filter(client):
    save_log(client, BB, status="want")
    client.put("/library/tv/2/seasons/1", json={**details(BB), "status": "finished"})
    assert library_titles(client, status="finished") == []
    assert library_titles(client, status="want") == ["Breaking Bad"]
