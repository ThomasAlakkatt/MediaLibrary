import os
import random
from dotenv import load_dotenv
import requests

# Mapping Dictionary used for turning Discog's Genres into TMDB Genres
from mapping import DISCOGS_TO_TMDB_GENRES, STYLE_TO_TMDB_KEYWORDS, TMDB_GENRE_NAMES
from tmdb_service import TMDBUnavailable

load_dotenv()
myBearerToken = os.getenv("TMDB_API_READ_ACCESS_TOKEN")

TMDB_BASE_URL = "https://api.themoviedb.org/3"

# Movie search by genre API:

# https://developer.themoviedb.org/reference/discover-movie


# Randomly pick from among the most popular pages of results, instead of always the single most
# popular page, so that releases sharing similar/identical genres don't all surface the same movies.
CANDIDATE_PAGES = 5

# Discover's certification.lte filter only excludes movies that HAVE a certification recorded above
# this value. Movies released unrated (e.g. certification "NR" or blank, often used for films whose
# content was too extreme for a rating) silently bypass that filter. So we treat "no confirmed
# certification" as excluded too, and only allow through movies explicitly certified at these levels.
ALLOWED_CERTIFICATIONS = {"G", "PG", "PG-13"}


def _has_allowed_certification(movie_id):
    try:
        response = requests.get(
            f"{TMDB_BASE_URL}/movie/{movie_id}/release_dates",
            headers={
                "Authorization": f"Bearer {myBearerToken}",
                "accept": "application/json",
            },
            timeout=10,
        )
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"TMDB API Error checking certification for movie {movie_id}: {e}")
        return False

    data = response.json()
    for country_entry in data.get("results", []):
        if country_entry.get("iso_3166_1") != "US":
            continue
        for release in country_entry.get("release_dates", []):
            if release.get("certification") in ALLOWED_CERTIFICATIONS:
                return True

    return False


def _get_trailer_url(movie_id):
    try:
        response = requests.get(
            f"{TMDB_BASE_URL}/movie/{movie_id}/videos",
            headers={
                "Authorization": f"Bearer {myBearerToken}",
                "accept": "application/json",
            },
            timeout=10,
        )
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"TMDB API Error fetching videos for movie {movie_id}: {e}")
        return None

    videos = response.json().get("results", [])
    trailers = [v for v in videos if v.get("site") == "YouTube" and v.get("type") == "Trailer"]
    if not trailers:
        return None

    official_trailers = [v for v in trailers if v.get("official")]
    chosen = official_trailers[0] if official_trailers else trailers[0]
    return f"https://www.youtube.com/watch?v={chosen['key']}"


def _discover_movies(genre_ids, keyword_ids=None, max_page=CANDIDATE_PAGES):
    headers = {
        "Authorization": f"Bearer {myBearerToken}",
        "accept": "application/json",
    }
    params = {
        "with_genres": "|".join(str(genre_id) for genre_id in genre_ids),
        "sort_by": "popularity.desc",
        "page": random.randint(1, max_page),
        "include_adult": False,
        "certification_country": "US",
        "certification.lte": "PG-13",
        "vote_average.gte": 6.5,
        "vote_count.gte": 50,
    }
    if keyword_ids:
        params["with_keywords"] = "|".join(str(keyword_id) for keyword_id in keyword_ids)

    try:
        response = requests.get(
            f"{TMDB_BASE_URL}/discover/movie",
            headers=headers,
            params=params,
            timeout=10,
        )
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"TMDB API Error: {e}")
        raise TMDBUnavailable() from e

    results = response.json().get("results", [])
    random.shuffle(results)
    return results


# Takes a list of Discogs genre strings (e.g. from a release's "genres" field) and, optionally, its
# more specific "styles" (e.g. "Trance", "Gangsta"). Genres map to TMDB genre IDs; styles map to TMDB
# keyword IDs for finer mood-based matching. We try the narrower genre+style match first (since it's
# more tailored to this specific release), then fall back to a broader genre-only match to fill any
# remaining slots, since not every style has a curated keyword mapping and narrow queries can be thin.
def get_movies_by_genres(discogs_genres, discogs_styles=None, number_of_results=10):
    genre_ids = set()
    for genre in discogs_genres:
        genre_ids.update(DISCOGS_TO_TMDB_GENRES.get(genre, []))

    if not genre_ids:
        return []

    keyword_ids = set()
    for style in discogs_styles or []:
        keyword_ids.update(STYLE_TO_TMDB_KEYWORDS.get(style, []))

    candidate_batches = []
    if keyword_ids:
        candidate_batches.append(_discover_movies(genre_ids, keyword_ids, max_page=2))
    candidate_batches.append(_discover_movies(genre_ids))

    movie_list = []
    seen_ids = set()
    for batch in candidate_batches:
        for movie in batch:
            if len(movie_list) >= number_of_results:
                break

            movie_id = movie.get("id")
            if movie_id in seen_ids:
                continue

            if not _has_allowed_certification(movie_id):
                continue

            seen_ids.add(movie_id)
            genre_names = [
                TMDB_GENRE_NAMES[genre_id]
                for genre_id in movie.get("genre_ids", [])
                if genre_id in TMDB_GENRE_NAMES
            ]
            movie_list.append(
                {
                    "id": movie_id,
                    "title": movie.get("title"),
                    "overview": movie.get("overview"),
                    "release_date": movie.get("release_date"),
                    "poster_path": movie.get("poster_path"),
                    "rating": movie.get("vote_average"),
                    "vote_count": movie.get("vote_count"),
                    "genres": genre_names,
                    "trailer_url": _get_trailer_url(movie_id),
                }
            )

        if len(movie_list) >= number_of_results:
            break

    return movie_list
