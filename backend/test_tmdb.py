import pytest
import requests

import tmdb_service

MOVIE = {
    "id": 1,
    "media_type": "movie",
    "title": "Dune",
    "name": "wrong field",
    "release_date": "2021-09-15",
    "overview": "Spice.",
    "poster_path": "/dune.jpg",
    "vote_average": 7.8,
    "vote_count": 100,
}
SHOW = {
    "id": 2,
    "media_type": "tv",
    "name": "Dune: Prophecy",
    "title": "wrong field",
    "first_air_date": "2024-11-17",
    "overview": "Sisters.",
    "poster_path": None,
    "vote_average": 7.1,
    "vote_count": 50,
}
PERSON = {"id": 3, "media_type": "person", "name": "Frank Herbert"}


class FakeResponse:
    def __init__(self, status_code=200, body=None, invalid_json=False):
        self.status_code = status_code
        self.body = body
        self.invalid_json = invalid_json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(str(self.status_code))

    def json(self):
        if self.invalid_json:
            raise ValueError("not JSON")
        return self.body


def fake_tmdb(monkeypatch, response):
    calls = []

    def get(url, **kwargs):
        calls.append({"url": url, **kwargs})
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(tmdb_service.requests, "get", get)
    return calls


def search_body(*results, page=1, total_pages=1):
    return {"results": list(results), "page": page, "total_pages": total_pages}


@pytest.mark.parametrize(
    "media_type, path",
    [("all", "/search/multi"), ("movie", "/search/movie"), ("tv", "/search/tv")],
)
def test_each_type_uses_its_search_endpoint(client, monkeypatch, media_type, path):
    calls = fake_tmdb(monkeypatch, FakeResponse(body=search_body()))
    client.get("/search/media", params={"query": "  dune ", "type": media_type, "page": 2})

    assert calls[0]["url"].endswith(path)
    assert calls[0]["params"] == {"query": "dune", "page": 2, "include_adult": False}


def test_the_token_is_sent_as_a_header_and_not_in_the_url(client, monkeypatch):
    monkeypatch.setattr(tmdb_service, "TMDB_BEARER_TOKEN", "secret")
    calls = fake_tmdb(monkeypatch, FakeResponse(body=search_body()))
    client.get("/search/media", params={"query": "dune"})

    assert calls[0]["headers"]["Authorization"] == "Bearer secret"
    assert "secret" not in calls[0]["url"]
    assert "secret" not in str(calls[0]["params"])


def test_movies_and_shows_come_back_in_one_shape(client, monkeypatch):
    fake_tmdb(monkeypatch, FakeResponse(body=search_body(MOVIE, SHOW)))
    results = client.get("/search/media", params={"query": "dune"}).json()["results"]

    assert results == [
        {
            "id": 1,
            "media_type": "movie",
            "title": "Dune",
            "year": "2021",
            "overview": "Spice.",
            "poster_path": "/dune.jpg",
            "rating": 7.8,
            "vote_count": 100,
        },
        {
            "id": 2,
            "media_type": "tv",
            "title": "Dune: Prophecy",
            "year": "2024",
            "overview": "Sisters.",
            "poster_path": None,
            "rating": 7.1,
            "vote_count": 50,
        },
    ]


def test_people_are_left_out(client, monkeypatch):
    fake_tmdb(monkeypatch, FakeResponse(body=search_body(PERSON, MOVIE)))
    results = client.get("/search/media", params={"query": "dune"}).json()["results"]
    assert [item["id"] for item in results] == [1]


@pytest.mark.parametrize(
    "media_type, item, title",
    [("movie", {"id": 1, "title": "Dune"}, "Dune"), ("tv", {"id": 2, "name": "Severance"}, "Severance")],
)
def test_single_type_results_get_their_type_from_the_search(client, monkeypatch, media_type, item, title):
    fake_tmdb(monkeypatch, FakeResponse(body=search_body(item)))
    result = client.get("/search/media", params={"query": "x", "type": media_type}).json()["results"][0]
    assert (result["media_type"], result["title"]) == (media_type, title)


@pytest.mark.parametrize("date", [None, ""])
def test_a_missing_date_means_no_year(client, monkeypatch, date):
    fake_tmdb(monkeypatch, FakeResponse(body=search_body({**MOVIE, "release_date": date})))
    result = client.get("/search/media", params={"query": "dune"}).json()["results"][0]
    assert result["year"] is None


def test_paging_details_are_passed_along(client, monkeypatch):
    fake_tmdb(monkeypatch, FakeResponse(body=search_body(MOVIE, page=2, total_pages=7)))
    body = client.get("/search/media", params={"query": "dune", "page": 2}).json()
    assert (body["page"], body["total_pages"]) == (2, 7)


def test_a_404_from_search_is_just_no_results(client, monkeypatch):
    fake_tmdb(monkeypatch, FakeResponse(status_code=404))
    body = client.get("/search/media", params={"query": "dune", "page": 3}).json()
    assert body == {"results": [], "page": 3, "total_pages": 0}


@pytest.mark.parametrize(
    "response",
    [
        requests.exceptions.ConnectionError("down"),
        requests.exceptions.Timeout("slow"),
        FakeResponse(status_code=401),
        FakeResponse(status_code=429),
        FakeResponse(status_code=500),
        FakeResponse(invalid_json=True),
    ],
)
@pytest.mark.parametrize("path, params", [("/search/media", {"query": "dune"}), ("/shows/1", {})])
def test_tmdb_failures_become_a_502(client, monkeypatch, response, path, params):
    fake_tmdb(monkeypatch, response)
    result = client.get(path, params=params)
    assert result.status_code == 502
    assert result.json() == {"detail": "Could not reach TMDB, please try again."}


@pytest.mark.parametrize(
    "params",
    [
        {"query": "   "},
        {"query": "x", "type": "book"},
        {"query": "x", "page": 0},
        {"query": "x", "page": 501},
    ],
)
def test_bad_search_requests_never_reach_tmdb(client, monkeypatch, params):
    calls = fake_tmdb(monkeypatch, FakeResponse(body=search_body()))
    assert client.get("/search/media", params=params).status_code in (400, 422)
    assert calls == []


SHOW_DETAILS = {
    "id": 1396,
    "status": "Ended",
    "number_of_seasons": 2,
    "number_of_episodes": 20,
    "genres": [{"id": 18, "name": "Drama"}, {"id": 80, "name": "Crime"}],
    "seasons": [
        {"season_number": 0, "name": "Specials", "episode_count": 9, "air_date": "2009-02-17"},
        {"season_number": 2, "name": "Season 2", "episode_count": 13, "air_date": "2009-03-08"},
        {"season_number": 1, "name": "Season 1", "episode_count": 7, "air_date": None},
    ],
}


def test_show_details(client, monkeypatch):
    calls = fake_tmdb(monkeypatch, FakeResponse(body=SHOW_DETAILS))
    body = client.get("/shows/1396").json()

    assert calls[0]["url"].endswith("/tv/1396")
    assert (body["id"], body["status"], body["number_of_seasons"], body["number_of_episodes"]) == (
        1396,
        "Ended",
        2,
        20,
    )
    assert body["genres"] == ["Drama", "Crime"]


def test_seasons_are_in_order_with_specials_last(client, monkeypatch):
    fake_tmdb(monkeypatch, FakeResponse(body=SHOW_DETAILS))
    assert client.get("/shows/1396").json()["seasons"] == [
        {"season_number": 1, "name": "Season 1", "episode_count": 7, "year": None},
        {"season_number": 2, "name": "Season 2", "episode_count": 13, "year": "2009"},
        {"season_number": 0, "name": "Specials", "episode_count": 9, "year": "2009"},
    ]


def test_a_show_with_no_seasons_or_genres(client, monkeypatch):
    fake_tmdb(monkeypatch, FakeResponse(body={"id": 5, "status": "Planned"}))
    body = client.get("/shows/5").json()
    assert (body["seasons"], body["genres"]) == ([], [])


def test_a_missing_show_is_a_404(client, monkeypatch):
    fake_tmdb(monkeypatch, FakeResponse(status_code=404))
    response = client.get("/shows/999")
    assert response.status_code == 404
    assert response.json() == {"detail": "Could not find that show."}
