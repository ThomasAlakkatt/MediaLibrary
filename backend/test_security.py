import io
import contextlib

import pytest
import requests

import music_service


def test_requests_for_other_hosts_are_refused(client):
    assert client.get("/shelves", headers={"Host": "evil.example"}).status_code == 400
    assert client.post("/shelves", json={"name": "x"}, headers={"Host": "evil.example:8000"}).status_code == 400
    assert client.get("/shelves").json() == []


@pytest.mark.parametrize("host", ["localhost:8000", "127.0.0.1:8000", "localhost"])
def test_requests_for_this_computer_work(client, host):
    assert client.get("/shelves", headers={"Host": host}).status_code == 200


def test_other_websites_cannot_send_json_writes(client):
    preflight = client.options(
        "/library/movie/1",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert preflight.status_code == 400
    assert "access-control-allow-origin" not in preflight.headers


@pytest.mark.parametrize("content_type", ["text/plain", "application/x-www-form-urlencoded"])
def test_simple_cross_site_posts_are_not_accepted(client, content_type):
    response = client.post(
        "/shelves",
        content='{"name": "pwned"}',
        headers={"Origin": "https://evil.example", "Content-Type": content_type},
    )
    assert response.status_code == 422
    assert client.get("/shelves").json() == []


@pytest.mark.parametrize(
    "field, size",
    [("review", 20001), ("title", 501), ("overview", 20001), ("creators", 501), ("poster_path", 501)],
)
def test_oversized_text_is_refused(client, field, size):
    body = {"title": "x", "rating": 1, field: "a" * size}
    assert client.put("/library/movie/1", json=body).status_code == 422
    assert client.get("/library").json() == []


def test_long_but_reasonable_text_is_kept(client):
    review = "a" * 20000
    assert client.put("/library/movie/1", json={"title": "x", "review": review}).status_code == 200
    assert client.get("/library/movie/1").json()["review"] == review


def test_oversized_shelf_description_is_refused(client):
    assert client.post("/shelves", json={"name": "x", "description": "a" * 2001}).status_code == 422


def test_discogs_errors_never_print_the_key(monkeypatch):
    monkeypatch.setattr(music_service, "my_user_token", "FAKE_SECRET_123")
    printed = io.StringIO()

    def fail(method, url, **kwargs):
        address = requests.Request(method, url, params={"token": "FAKE_SECRET_123"}).prepare().url
        raise requests.exceptions.ConnectionError(f"Max retries exceeded with url: {address}")

    monkeypatch.setattr(music_service.client._fetcher, "request", fail)
    music_service._search_cache.clear()
    with contextlib.redirect_stdout(printed):
        for call in (lambda: music_service.search_music_text("x"), lambda: music_service.get_album(1)):
            try:
                call()
            except Exception:
                pass

    assert "Max retries" in printed.getvalue()
    assert "FAKE_SECRET_123" not in printed.getvalue()
    assert "token=[hidden]" in printed.getvalue()


def test_a_user_agent_is_always_set():
    assert music_service.my_user_agent
