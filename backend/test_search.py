import json

import music_service

RESULT = {"type": "master", "id": 9, "title": "Radiohead - OK Computer", "year": "1997"}


def fake_discogs(monkeypatch, status=200, results=None):
    urls = []

    def fetch(client, method, url, data=None, headers=None, json_body=True):
        urls.append(url)
        if status != 200:
            return json.dumps({"message": "failed"}).encode(), status
        body = {"results": results or [], "pagination": {"pages": 1, "items": 1}}
        return json.dumps(body).encode(), 200

    monkeypatch.setattr(music_service.client._fetcher, "fetch", fetch)
    return urls


def test_music_text_search(client, monkeypatch):
    urls = fake_discogs(monkeypatch, results=[RESULT])
    response = client.get("/search/music", params={"query": " ok computer ", "page": 2})

    assert response.status_code == 200
    assert response.json()[0]["title"] == "OK Computer"
    assert response.json()[0]["artists"] == ["Radiohead"]
    assert "q=ok%20computer" in urls[0]
    assert "type=master" in urls[0]
    assert "page=2" in urls[0]
    assert "per_page=10" in urls[0]


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
