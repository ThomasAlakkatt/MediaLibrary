import os

from dotenv import load_dotenv
import requests

load_dotenv()
TMDB_BEARER_TOKEN = os.getenv("TMDB_API_READ_ACCESS_TOKEN")

TMDB_BASE_URL = "https://api.themoviedb.org/3"

# Which TMDB search endpoint each search type uses. /search/multi covers movies and shows together
# but also returns people, so its results get filtered in search_media().
SEARCH_PATHS = {
    "all": "/search/multi",
    "movie": "/search/movie",
    "tv": "/search/tv",
}


class TMDBUnavailable(Exception):
    pass


class ShowNotFound(Exception):
    pass


# Sends a GET request to TMDB and returns the parsed JSON, or None if TMDB answers 404.
def _tmdb_get(path, params=None):
    try:
        response = requests.get(
            f"{TMDB_BASE_URL}{path}",
            headers={
                "Authorization": f"Bearer {TMDB_BEARER_TOKEN}",
                "accept": "application/json",
            },
            params=params,
            timeout=10,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()
    except (requests.exceptions.RequestException, ValueError) as e:
        print(f"TMDB API Error: {e}")
        raise TMDBUnavailable() from e


def _year_from(date_string):
    return date_string[:4] if date_string else None


# Movies and shows name the same things differently in TMDB ("title" vs "name", "release_date" vs
# "first_air_date"), so every result is converted to one shape the frontend can treat alike.
def _normalize_result(item, media_type):
    is_movie = media_type == "movie"
    release_date = item.get("release_date") if is_movie else item.get("first_air_date")
    return {
        "id": item.get("id"),
        "media_type": media_type,
        "title": item.get("title") if is_movie else item.get("name"),
        "year": _year_from(release_date),
        "release_date": release_date or None,
        "overview": item.get("overview"),
        "poster_path": item.get("poster_path"),
        "rating": item.get("vote_average"),
        "vote_count": item.get("vote_count"),
    }


# media_type is "all", "movie" or "tv". Returns one page of results, plus the page count for paging.
def search_media(query, media_type="all", page=1):
    data = _tmdb_get(
        SEARCH_PATHS[media_type],
        params={"query": query.strip(), "page": page, "include_adult": False},
    )
    if data is None:
        return {"results": [], "page": page, "total_pages": 0}

    results = []
    for item in data.get("results", []):
        # Only /search/multi labels each result with its type. It's also the only one returning people.
        item_type = item.get("media_type", media_type)
        if item_type in ("movie", "tv"):
            results.append(_normalize_result(item, item_type))

    return {
        "results": results,
        "page": data.get("page", page),
        "total_pages": data.get("total_pages", 0),
    }


# Returns a title's release date, or None if TMDB doesn't have one or can't be reached.
def get_release_date(media_type, tmdb_id):
    try:
        data = _tmdb_get(f"/{media_type}/{tmdb_id}")
    except TMDBUnavailable:
        return None
    if data is None:
        return None
    return (data.get("release_date") if media_type == "movie" else data.get("first_air_date")) or None


def get_show_details(show_id):
    data = _tmdb_get(f"/tv/{show_id}")
    if data is None:
        raise ShowNotFound()

    seasons = [
        {
            "season_number": season.get("season_number"),
            "name": season.get("name"),
            "episode_count": season.get("episode_count"),
            "year": _year_from(season.get("air_date")),
        }
        for season in data.get("seasons", [])
    ]
    # TMDB lists specials as season 0, which reads better after the regular seasons than before them.
    seasons.sort(key=lambda season: (season["season_number"] == 0, season["season_number"]))

    return {
        "id": data.get("id"),
        "status": data.get("status"),
        "number_of_seasons": data.get("number_of_seasons"),
        "number_of_episodes": data.get("number_of_episodes"),
        "genres": [genre.get("name") for genre in data.get("genres", [])],
        "seasons": seasons,
    }
