import pytest
import requests

import app as app_module
import movie_service


class FakeResponse:
    def __init__(self, body=None, status_code=200, invalid_json=False):
        self.body = body
        self.status_code = status_code
        self.invalid_json = invalid_json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(str(self.status_code))

    def json(self):
        if self.invalid_json:
            raise ValueError("not JSON")
        return self.body


def certified(certification):
    return FakeResponse(
        {"results": [{"iso_3166_1": "US", "release_dates": [{"certification": certification}]}]}
    )


@pytest.fixture
def tmdb(monkeypatch):
    """Fakes TMDB. Set answers[movie_id] to what that movie's certification check returns."""
    answers = {}

    def get(url, **kwargs):
        if url.endswith("/discover/movie"):
            movies = [{"id": movie_id, "title": f"Movie {movie_id}"} for movie_id in answers]
            return FakeResponse({"results": movies})
        if url.endswith("/videos"):
            return FakeResponse({"results": []})
        movie_id = int(url.split("/")[-2])
        answer = answers[movie_id]
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(movie_service.requests, "get", get)
    monkeypatch.setattr(
        app_module, "release_details", lambda release_id: {"genres": ["Rock"], "styles": []}
    )
    return answers


def recommended_ids(response):
    return sorted(movie["id"] for movie in response.json())


FAILURES = [
    requests.exceptions.ConnectionError("down"),
    requests.exceptions.Timeout("slow"),
    FakeResponse(status_code=401),
    FakeResponse(status_code=429),
    FakeResponse(status_code=500),
    FakeResponse(invalid_json=True),
]


@pytest.mark.parametrize("failure", FAILURES)
def test_failed_checks_are_an_error_and_not_an_empty_list(client, tmdb, failure):
    tmdb.update({1: failure, 2: failure})
    response = client.get("/movies/9")
    assert response.status_code == 502
    assert response.json() == {"detail": "Could not reach TMDB, please try again."}


def test_one_failed_check_still_returns_the_others(client, tmdb):
    tmdb.update({1: certified("PG-13"), 2: requests.exceptions.Timeout("slow"), 3: certified("G")})
    response = client.get("/movies/9")
    assert response.status_code == 200
    assert recommended_ids(response) == [1, 3]


def test_a_failed_check_with_only_rejected_movies_is_an_error(client, tmdb):
    tmdb.update({1: certified("R"), 2: requests.exceptions.Timeout("slow")})
    assert client.get("/movies/9").status_code == 502


def test_movies_that_really_fail_the_check_are_an_empty_list(client, tmdb):
    tmdb.update({1: certified("R"), 2: certified("NC-17"), 3: certified("")})
    response = client.get("/movies/9")
    assert response.status_code == 200
    assert response.json() == []


def test_a_movie_with_no_us_certification_is_left_out(client, tmdb):
    tmdb.update({1: FakeResponse({"results": []}), 2: certified("PG")})
    assert recommended_ids(client.get("/movies/9")) == [2]


def test_no_matching_genres_is_an_empty_list(client, tmdb, monkeypatch):
    monkeypatch.setattr(
        app_module, "release_details", lambda release_id: {"genres": ["Nothing"], "styles": []}
    )
    response = client.get("/movies/9")
    assert (response.status_code, response.json()) == (200, [])


def test_the_discover_search_failing_is_still_an_error(client, tmdb, monkeypatch):
    def get(url, **kwargs):
        raise requests.exceptions.ConnectionError("down")

    monkeypatch.setattr(movie_service.requests, "get", get)
    assert client.get("/movies/9").status_code == 502
