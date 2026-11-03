import pytest

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


@pytest.mark.parametrize("rating", [0.5, 1, 7.5, 8, 9.5, 10])
def test_valid_ratings_are_saved(client, rating):
    response = save_log(client, DUNE, rating=rating)
    assert response.status_code == 200
    assert response.json()["rating"] == rating


@pytest.mark.parametrize("rating", [0, -1, 0.25, 7.3, 10.5, 11])
def test_invalid_ratings_are_rejected(client, rating):
    assert save_log(client, DUNE, rating=rating).status_code == 422
    assert client.get("/library").json() == []


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
    item = client.put(f"{url}/1", json={**details(BB), "status": "finished", "rating": 9.5}).json()
    assert item["seasons"] == [
        {"season_number": 1, "status": "finished", "rating": 9.5, "finished_on": None}
    ]
    assert item["status"] is None
    assert [i["title"] for i in client.get("/library").json()] == ["Breaking Bad"]

    client.put(f"{url}/0", json={**details(BB), "status": "want"})
    item = client.put(f"{url}/1", json={**details(BB), "rating": 7}).json()
    assert [(s["season_number"], s["status"], s["rating"]) for s in item["seasons"]] == [
        (0, "want", None),
        (1, None, 7),
    ]


def test_invalid_season_rating_is_rejected(client):
    response = client.put("/library/tv/2/seasons/1", json={**details(BB), "rating": 3.3})
    assert response.status_code == 422


def test_clearing_all_season_logs_removes_an_otherwise_empty_title(client):
    client.put("/library/tv/2/seasons/1", json={**details(BB), "rating": 7})
    assert client.put("/library/tv/2/seasons/1", json=details(BB)).json() is None
    assert client.get("/library").json() == []


def test_clearing_a_log_removes_seasons_but_keeps_shelves(client):
    shelf_id = make_shelf(client)
    add(client, shelf_id, BB)
    client.put("/library/tv/2/seasons/1", json={**details(BB), "rating": 7})
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
