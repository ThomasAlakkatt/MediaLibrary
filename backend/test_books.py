import pytest
import requests

import book_service
import library_service
from test_library import make_version_1_database, upgraded_client

HOBBIT = {
    "key": "/works/OL27482W",
    "title": "The Hobbit",
    "author_name": ["J.R.R. Tolkien"],
    "first_publish_year": 1937,
    "cover_i": 14627509,
}


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


def fake_open_library(monkeypatch, response):
    calls = []

    def get(url, **kwargs):
        calls.append({"url": url, **kwargs})
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(book_service.requests, "get", get)
    return calls


def search_body(*docs, found=None):
    return {"numFound": len(docs) if found is None else found, "docs": list(docs)}


def test_search_sends_the_query_and_identifies_itself(client, monkeypatch):
    calls = fake_open_library(monkeypatch, FakeResponse(body=search_body()))
    client.get("/search/books", params={"query": "  the hobbit ", "page": 3})

    assert calls[0]["url"].endswith("/search.json")
    assert calls[0]["params"]["q"] == "the hobbit"
    assert calls[0]["params"]["page"] == 3
    assert calls[0]["params"]["limit"] == 10
    assert calls[0]["headers"]["User-Agent"] == "MediaLibrary/1.0"


def test_results_come_back_in_the_shared_shape(client, monkeypatch):
    fake_open_library(monkeypatch, FakeResponse(body=search_body(HOBBIT)))
    body = client.get("/search/books", params={"query": "hobbit"}).json()

    assert body["results"] == [
        {
            "id": 27482,
            "media_type": "book",
            "title": "The Hobbit",
            "creators": "J.R.R. Tolkien",
            "year": "1937",
            "release_date": None,
            "poster_path": "https://covers.openlibrary.org/b/id/14627509-L.jpg",
            "overview": None,
        }
    ]


def test_several_authors_are_joined_and_limited(client, monkeypatch):
    doc = {**HOBBIT, "author_name": ["A", "B", "C", "D"]}
    fake_open_library(monkeypatch, FakeResponse(body=search_body(doc)))
    result = client.get("/search/books", params={"query": "x"}).json()["results"][0]
    assert result["creators"] == "A, B, C"


def test_missing_details_are_fine(client, monkeypatch):
    doc = {"key": "/works/OL1W", "title": "Bare"}
    fake_open_library(monkeypatch, FakeResponse(body=search_body(doc)))
    result = client.get("/search/books", params={"query": "x"}).json()["results"][0]
    assert (result["creators"], result["year"], result["poster_path"]) == (None, None, None)


@pytest.mark.parametrize(
    "doc",
    [
        {"key": "/books/OL1M", "title": "An edition, not a work"},
        {"title": "No key"},
        {"key": "/works/OL1W"},
    ],
)
def test_results_that_cannot_be_used_are_left_out(client, monkeypatch, doc):
    fake_open_library(monkeypatch, FakeResponse(body=search_body(doc)))
    assert client.get("/search/books", params={"query": "x"}).json()["results"] == []


@pytest.mark.parametrize(
    "found, pages", [(0, 0), (1, 1), (10, 1), (11, 2), (20, 2), (21, 3)]
)
def test_page_count(client, monkeypatch, found, pages):
    fake_open_library(monkeypatch, FakeResponse(body=search_body(found=found)))
    body = client.get("/search/books", params={"query": "x"}).json()
    assert body["total_pages"] == pages


FAILURES = [
    requests.exceptions.ConnectionError("down"),
    requests.exceptions.Timeout("slow"),
    FakeResponse(status_code=429),
    FakeResponse(status_code=500),
    FakeResponse(invalid_json=True),
]


@pytest.mark.parametrize("failure", FAILURES)
@pytest.mark.parametrize("path, params", [("/search/books", {"query": "x"}), ("/books/1", {})])
def test_failures_become_a_502(client, monkeypatch, failure, path, params):
    fake_open_library(monkeypatch, failure)
    response = client.get(path, params=params)
    assert response.status_code == 502
    assert response.json() == {"detail": "Could not reach Open Library, please try again."}


@pytest.mark.parametrize("params", [{"query": "   "}, {"query": "x", "page": 0}])
def test_bad_searches_never_reach_open_library(client, monkeypatch, params):
    calls = fake_open_library(monkeypatch, FakeResponse(body=search_body()))
    assert client.get("/search/books", params=params).status_code in (400, 422)
    assert calls == []


def test_book_details_with_a_plain_description(client, monkeypatch):
    calls = fake_open_library(
        monkeypatch, FakeResponse(body={"description": "A tale.", "subjects": ["Fantasy"]})
    )
    body = client.get("/books/27482").json()
    assert calls[0]["url"].endswith("/works/OL27482W.json")
    assert body == {"id": 27482, "description": "A tale.", "subjects": ["Fantasy"]}


def test_book_details_with_a_description_object_and_many_subjects(client, monkeypatch):
    subjects = [f"Subject {i}" for i in range(20)]
    fake_open_library(
        monkeypatch,
        FakeResponse(body={"description": {"type": "/type/text", "value": "A tale."}, "subjects": subjects}),
    )
    body = client.get("/books/1").json()
    assert body["description"] == "A tale."
    assert len(body["subjects"]) == 8


def test_book_details_with_nothing_extra(client, monkeypatch):
    fake_open_library(monkeypatch, FakeResponse(body={}))
    assert client.get("/books/1").json() == {"id": 1, "description": None, "subjects": []}


def test_a_missing_book_is_a_404(client, monkeypatch):
    fake_open_library(monkeypatch, FakeResponse(status_code=404))
    response = client.get("/books/1")
    assert response.status_code == 404
    assert response.json() == {"detail": "Could not find that book."}


BOOK = {
    "title": "The Hobbit",
    "creators": "J.R.R. Tolkien",
    "year": "1937",
    "poster_path": "https://covers.openlibrary.org/b/id/1-L.jpg",
}


def test_a_book_is_logged_like_a_movie(client):
    response = client.put(
        "/library/book/27482",
        json={**BOOK, "status": "finished", "rating": 9.25, "review": "Great", "finished_on": "2026-11-01"},
    )
    assert response.status_code == 200
    item = client.get("/library/book/27482").json()
    assert (item["media_type"], item["title"], item["creators"], item["rating"]) == (
        "book",
        "The Hobbit",
        "J.R.R. Tolkien",
        9.25,
    )
    assert client.delete("/library/book/27482").json() is None
    assert client.get("/library/book/27482").status_code == 404


def test_book_and_movie_with_the_same_id_stay_separate(client):
    client.put("/library/book/5", json={**BOOK, "rating": 1})
    client.put("/library/movie/5", json={"title": "Dune", "rating": 9})
    assert client.get("/library/book/5").json()["title"] == "The Hobbit"
    assert client.get("/library/movie/5").json()["title"] == "Dune"


def test_books_are_in_the_library_and_can_be_filtered(client):
    client.put("/library/book/1", json={**BOOK, "rating": 9})
    client.put("/library/movie/2", json={"title": "Dune", "rating": 8})
    titles = lambda **params: [i["title"] for i in client.get("/library", params=params).json()]
    assert sorted(titles()) == ["Dune", "The Hobbit"]
    assert titles(media_type="book") == ["The Hobbit"]


def test_books_go_on_shelves_with_everything_else(client):
    shelf_id = client.post("/shelves", json={"name": "Mix"}).json()["id"]
    client.post(f"/shelves/{shelf_id}/items", json={"media_type": "movie", "source_id": 1, "title": "Dune"})
    client.post(f"/shelves/{shelf_id}/items", json={"media_type": "book", "source_id": 2, **BOOK})
    shelf = client.get(f"/shelves/{shelf_id}").json()
    assert [item["title"] for item in shelf["items"]] == ["Dune", "The Hobbit"]
    assert client.get("/library/book/2").json()["shelf_ids"] == [shelf_id]


def test_books_never_look_up_release_dates_on_tmdb(client, monkeypatch):
    looked_up = []
    monkeypatch.setattr(
        library_service, "get_release_date", lambda media_type, source_id: looked_up.append(source_id)
    )
    client.put("/library/book/1", json={**BOOK, "rating": 9})
    client.put("/library/book/2", json={**BOOK, "title": "Newer", "year": "2021", "rating": 9})

    names = [i["title"] for i in client.get("/library", params={"sort": "release"}).json()]

    assert names == ["Newer", "The Hobbit"]
    assert looked_up == []


def test_upgrade_allows_books_and_keeps_everything(tmp_path, monkeypatch):
    make_version_1_database(tmp_path / "v1.db", monkeypatch, "")
    with upgraded_client() as client:
        item = client.get("/library/tv/2").json()
        assert (item["id"], item["rating"], item["shelf_ids"]) == (7, 9.5, [3])
        assert item["seasons"][0]["status"] == "finished"
        assert client.put("/library/book/1", json={**BOOK, "rating": 1}).status_code == 200
        assert [i["title"] for i in client.get("/shelves/3").json()["items"]] == ["Breaking Bad"]
    assert (tmp_path / "v1.db-before-books").exists()
