import json

import pytest

import music_service

RESULT = {"type": "master", "id": 9, "title": "Radiohead - OK Computer", "year": "1997"}


@pytest.fixture(autouse=True)
def empty_search_cache():
    music_service._search_cache.clear()


def release(release_id, full_title, have=0):
    return {
        "type": "master",
        "id": release_id,
        "title": full_title,
        "year": "2000",
        "community": {"have": have},
    }


def search_kind(url):
    if "artist=" in url:
        return "artist"
    if "release_title=" in url:
        return "title"
    return "general"


# results and status can be one value for every search, or a dict by search kind.
def fake_discogs(monkeypatch, status=200, results=None):
    urls = []

    def fetch(client, method, url, data=None, headers=None, json_body=True):
        urls.append(url)
        kind = search_kind(url)
        answer = status.get(kind, 200) if isinstance(status, dict) else status
        if answer != 200:
            return json.dumps({"message": "failed"}).encode(), answer
        found = results.get(kind, []) if isinstance(results, dict) else results or []
        body = {"results": found, "pagination": {"pages": 1, "items": 1}}
        return json.dumps(body).encode(), 200

    monkeypatch.setattr(music_service.client._fetcher, "fetch", fetch)
    return urls


def test_music_text_search(client, monkeypatch):
    urls = fake_discogs(monkeypatch, results=[RESULT])
    response = client.get("/search/music", params={"query": " ok computer "})

    assert response.status_code == 200
    assert response.json()[0]["title"] == "OK Computer"
    assert response.json()[0]["artists"] == ["Radiohead"]
    assert sorted(search_kind(url) for url in urls) == ["artist", "general", "title"]
    assert all("type=master" in url and "per_page=100" in url for url in urls)
    assert any("q=ok%20computer" in url for url in urls)


def test_blank_music_text_search_is_rejected(client, monkeypatch):
    urls = fake_discogs(monkeypatch)
    assert client.get("/search/music", params={"query": "  "}).status_code == 400
    assert urls == []


def test_music_text_search_errors(client, monkeypatch):
    fake_discogs(monkeypatch, status=429)
    assert client.get("/search/music", params={"query": "x"}).status_code == 429
    fake_discogs(monkeypatch, status=500)
    assert client.get("/search/music", params={"query": "x"}).status_code == 502


def test_artist_and_release_search_still_works(client, monkeypatch):
    urls = fake_discogs(monkeypatch, results=[RESULT])
    response = client.get("/search", params={"artist": "Radiohead", "title": ""})

    assert response.json()[0]["title"] == "OK Computer"
    assert "artist=Radiohead" in urls[0]
    assert "q=" not in urls[0]


def titles(response):
    return [(item["artists"][0], item["title"]) for item in response.json()]


def test_the_artist_comes_first_then_the_title_then_the_rest(client, monkeypatch):
    fake_discogs(
        monkeypatch,
        results={
            "general": [
                release(1, "Cage - Radiohead", have=1038),
                release(2, "Various - Radiohead In Jazz", have=613),
                release(3, "Someone - Unrelated", have=9999),
                release(4, "Radiohead - OK Computer", have=285572),
            ],
            "artist": [
                release(5, "Radiohead - Street Spirit", have=7176),
                release(4, "Radiohead - OK Computer", have=285572),
            ],
            "title": [release(1, "Cage - Radiohead", have=1038)],
        },
    )
    response = client.get("/search/music", params={"query": "radiohead"})

    assert titles(response) == [
        ("Radiohead", "OK Computer"),
        ("Radiohead", "Street Spirit"),
        ("Cage", "Radiohead"),
        ("Various", "Radiohead In Jazz"),
        ("Someone", "Unrelated"),
    ]
    assert [item["match"] for item in response.json()] == ["artist", "artist", "title", None, None]


@pytest.mark.parametrize(
    "query, artist",
    [
        ("radiohead", "Radiohead"),
        ("RADIOHEAD", "Radiohead"),
        ("radio head", "Radiohead"),
        ("beatles", "The Beatles"),
        ("the beatles", "The Beatles"),
        ("beatles", "The Beatles = ビートルズ*"),
        ("beatles", "Beatles*"),
        ("sigur ros", "Sigur Rós"),
        ("ac/dc", "AC/DC"),
        ("dune", "Dune (3)"),
    ],
)
def test_artist_names_match_loosely(client, monkeypatch, query, artist):
    fake_discogs(monkeypatch, results={"general": [release(1, f"{artist} - Album")]})
    response = client.get("/search/music", params={"query": query})
    assert response.json()[0]["match"] == "artist"


@pytest.mark.parametrize("artist", ["Greenhouse Effect vs. Radiohead", "Radioheadz", "Various"])
def test_other_artists_do_not_count_as_a_match(client, monkeypatch, artist):
    fake_discogs(monkeypatch, results={"general": [release(1, f"{artist} - Album")]})
    response = client.get("/search/music", params={"query": "radiohead"})
    assert response.json()[0]["match"] is None


def test_a_search_of_only_punctuation_matches_nothing(client, monkeypatch):
    fake_discogs(monkeypatch, results={"general": [release(1, "Someone - Album")]})
    response = client.get("/search/music", params={"query": "!!!"})
    assert response.json()[0]["match"] is None


def test_results_are_not_repeated(client, monkeypatch):
    fake_discogs(monkeypatch, results=[RESULT])
    assert len(client.get("/search/music", params={"query": "ok computer"}).json()) == 1


def test_pages_come_from_the_ranked_list_without_more_requests(client, monkeypatch):
    many = [release(i, f"Radiohead - Album {i}", have=i) for i in range(1, 26)]
    urls = fake_discogs(monkeypatch, results={"artist": many})

    first = client.get("/search/music", params={"query": "radiohead"}).json()
    second = client.get("/search/music", params={"query": "RadioHead", "page": 2}).json()
    third = client.get("/search/music", params={"query": "radiohead", "page": 3}).json()
    past_the_end = client.get("/search/music", params={"query": "radiohead", "page": 4}).json()

    assert [item["title"] for item in first][:2] == ["Album 25", "Album 24"]
    assert second[0]["title"] == "Album 15"
    assert (len(first), len(second), len(third), past_the_end) == (10, 10, 5, [])
    assert len(urls) == 3


def test_one_failed_search_still_returns_the_others(client, monkeypatch):
    fake_discogs(monkeypatch, status={"artist": 500}, results=[RESULT])
    response = client.get("/search/music", params={"query": "ok computer"})
    assert response.status_code == 200
    assert titles(response) == [("Radiohead", "OK Computer")]


def test_partial_results_are_not_kept(client, monkeypatch):
    urls = fake_discogs(monkeypatch, status={"artist": 500}, results=[RESULT])
    client.get("/search/music", params={"query": "ok computer"})
    client.get("/search/music", params={"query": "ok computer"})
    assert len(urls) == 6


def test_a_rate_limit_is_reported_when_every_search_fails(client, monkeypatch):
    fake_discogs(monkeypatch, status={"general": 500, "artist": 429, "title": 500})
    assert client.get("/search/music", params={"query": "x"}).status_code == 429


def test_a_much_more_popular_exact_title_beats_a_small_artist(client, monkeypatch):
    fake_discogs(
        monkeypatch,
        results={
            "artist": [release(1, "Abbey Road - Easy", have=40)],
            "title": [release(2, "The Beatles - Abbey Road", have=535124)],
        },
    )
    response = client.get("/search/music", params={"query": "abbey road"})
    assert titles(response) == [("The Beatles", "Abbey Road"), ("Abbey Road", "Easy")]


def artist_search(client, artist="", title="", page=1):
    return client.get("/search", params={"artist": artist, "title": title, "page": page})


def test_music_tab_puts_the_artists_most_owned_releases_first(client, monkeypatch):
    fake_discogs(
        monkeypatch,
        results=[
            release(1, "Radiohead - Street Spirit", have=7176),
            release(2, "Radiohead Tribute Band - Covers", have=90000),
            release(3, "Radiohead - OK Computer", have=285572),
            release(4, "The Radiohead Experience - Live", have=5),
        ],
    )
    assert titles(artist_search(client, artist="radiohead")) == [
        ("Radiohead", "OK Computer"),
        ("Radiohead", "Street Spirit"),
        ("Radiohead Tribute Band", "Covers"),
        ("The Radiohead Experience", "Live"),
    ]


def test_music_tab_title_search_puts_exact_titles_first(client, monkeypatch):
    fake_discogs(
        monkeypatch,
        results=[
            release(1, "Someone - Unrelated", have=500000),
            release(2, "Various - Abbey Road Revisited", have=90000),
            release(3, "Tiny - Abbey Road", have=5),
            release(4, "The Beatles - Abbey Road", have=535124),
        ],
    )
    assert titles(artist_search(client, title="abbey road")) == [
        ("The Beatles", "Abbey Road"),
        ("Tiny", "Abbey Road"),
        ("Various", "Abbey Road Revisited"),
        ("Someone", "Unrelated"),
    ]


def test_music_tab_artist_and_title_together(client, monkeypatch):
    fake_discogs(
        monkeypatch,
        results=[
            release(1, "Radiohead - Creep (Live)", have=90000),
            release(2, "TLC - Creep", have=500000),
            release(3, "Radiohead - The Bends", have=147603),
            release(4, "Radiohead - Creep", have=9176),
        ],
    )
    assert titles(artist_search(client, artist="Radiohead", title="Creep")) == [
        ("Radiohead", "Creep"),
        ("Radiohead", "Creep (Live)"),
        ("Radiohead", "The Bends"),
        ("TLC", "Creep"),
    ]


def test_music_tab_pages_through_the_ranked_list_with_one_request(client, monkeypatch):
    many = [release(i, f"Radiohead - Album {i}", have=i) for i in range(1, 26)]
    urls = fake_discogs(monkeypatch, results=many)

    first = artist_search(client, artist="radiohead").json()
    second = artist_search(client, artist="radiohead", page=2).json()
    third = artist_search(client, artist="radiohead", page=3).json()
    past_the_end = artist_search(client, artist="radiohead", page=4).json()

    assert first[0]["title"] == "Album 25"
    assert second[0]["title"] == "Album 15"
    assert (len(first), len(second), len(third), past_the_end) == (10, 10, 5, [])
    assert len(urls) == 1


def test_music_tab_can_page_past_the_ranked_batch(client, monkeypatch):
    many = [release(i, f"Radiohead - Album {i}", have=i) for i in range(1, 101)]
    urls = fake_discogs(monkeypatch, results=many)

    response = artist_search(client, artist="radiohead", page=12).json()

    assert "page=2" in urls[0]
    assert [item["title"] for item in response] == [f"Album {i}" for i in range(11, 21)]


def test_music_tab_failures_are_reported_and_not_kept(client, monkeypatch):
    fake_discogs(monkeypatch, status=429)
    assert artist_search(client, artist="x").status_code == 429
    fake_discogs(monkeypatch, results=[RESULT])
    assert artist_search(client, artist="x").status_code == 200


def test_artist_and_title_searches_ask_for_the_most_owned_first(client, monkeypatch):
    urls = fake_discogs(monkeypatch, results=[RESULT])
    client.get("/search/music", params={"query": "ok computer"})
    sorted_by_owners = {search_kind(url): "sort=have&sort_order=desc" in url for url in urls}
    assert sorted_by_owners == {"general": False, "artist": True, "title": True}


def test_music_tab_asks_for_the_most_owned_first(client, monkeypatch):
    urls = fake_discogs(monkeypatch, results=[RESULT])
    artist_search(client, artist="radiohead")
    assert "sort=have&sort_order=desc" in urls[0]
