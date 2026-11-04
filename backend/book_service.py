import re

import requests

# Open Library needs no API key, and asks clients to say who they are.
OPEN_LIBRARY_URL = "https://openlibrary.org"
COVERS_URL = "https://covers.openlibrary.org/b/id"
HEADERS = {"User-Agent": "MediaLibrary/1.0"}

BOOKS_PER_PAGE = 10
MAX_AUTHORS_SHOWN = 3
MAX_SUBJECTS_SHOWN = 8

SEARCH_FIELDS = "key,title,author_name,first_publish_year,cover_i"


class BooksUnavailable(Exception):
    pass


class BookNotFound(Exception):
    pass


# Sends a GET request to Open Library and returns the parsed JSON, or None if it answers 404.
def _open_library_get(path, params=None):
    try:
        response = requests.get(
            f"{OPEN_LIBRARY_URL}{path}", headers=HEADERS, params=params, timeout=10
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()
    except (requests.exceptions.RequestException, ValueError) as e:
        print(f"Open Library Error: {e}")
        raise BooksUnavailable() from e


# A work's key looks like /works/OL27482W. Only the number is stored, since every book's is unique.
def _work_number(key):
    match = re.fullmatch(r"/works/OL(\d+)W", key or "")
    return int(match.group(1)) if match else None


def _normalize_book(doc):
    year = doc.get("first_publish_year")
    cover_id = doc.get("cover_i")
    authors = doc.get("author_name") or []
    return {
        "id": _work_number(doc.get("key")),
        "media_type": "book",
        "title": doc.get("title"),
        "creators": ", ".join(authors[:MAX_AUTHORS_SHOWN]) or None,
        "year": str(year) if year else None,
        "release_date": None,
        "poster_path": f"{COVERS_URL}/{cover_id}-L.jpg" if cover_id else None,
        "overview": None,
    }


# Returns one page of results in the same shape as movie and show searches.
def search_books(query, page=1):
    data = _open_library_get(
        "/search.json",
        params={
            "q": query.strip(),
            "fields": SEARCH_FIELDS,
            "limit": BOOKS_PER_PAGE,
            "page": page,
        },
    )
    if data is None:
        return {"results": [], "page": page, "total_pages": 0}

    results = [
        book
        for book in (_normalize_book(doc) for doc in data.get("docs", []))
        if book["id"] is not None and book["title"]
    ]
    found = data.get("numFound", 0)
    return {
        "results": results,
        "page": page,
        "total_pages": (found + BOOKS_PER_PAGE - 1) // BOOKS_PER_PAGE,
    }


# A book's details that search results don't include. A description can be plain text or a small object.
def get_book_details(book_id):
    data = _open_library_get(f"/works/OL{book_id}W.json")
    if data is None:
        raise BookNotFound()

    description = data.get("description")
    if isinstance(description, dict):
        description = description.get("value")
    return {
        "id": book_id,
        "description": description or None,
        "subjects": (data.get("subjects") or [])[:MAX_SUBJECTS_SHOWN],
    }
