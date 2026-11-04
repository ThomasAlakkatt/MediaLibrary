# OS allows access to my environmental variables
import os

# re is the RegEx library for RegEx operations
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor

# dotenv loads the .env file, i do import load_dotenv from here because it makes it easier to do something like
# just load_dotenv() as opposed to dotenv.load_dotenv(). Just makes the code cleaner!
from dotenv import load_dotenv
import discogs_client
from discogs_client.exceptions import DiscogsAPIError, HTTPError

# Because of how Discogs API is set-up, I don't need to use the 'requests' library/package here

# Loads the env file in
load_dotenv()

# These two lines load my private, unique user token and user agent into variables
my_user_token = os.getenv("DISCOGS_API_KEY")
my_user_agent = os.getenv("DISCOGS_USER_AGENT")

# This is an object authenticated with my user agent and token that allows me to make calls to the Discogs API!
client = discogs_client.Client(user_agent=my_user_agent, user_token=my_user_token)

# The library's default behavior on a 429 (rate limited) is to silently retry up to 100 times with
# exponential backoff, which can hang a request for minutes with no feedback. We'd rather fail fast
# and surface a clear error to the user instead.
client.backoff_enabled = False


# These let app.py tell the different failures apart and return the right HTTP status for each.
class DiscogsRateLimited(Exception):
    pass


class DiscogsUnavailable(Exception):
    pass


class ReleaseNotFound(Exception):
    pass


# All functions that make a call using client.ACTION, we will need to wrap it in a try except block for an exception handling catch all

# year is an int, styles is a list, artists is a list, country is a string (Can be None, Worldwide, or specific), genres is a list.

# Adding a seperate function to parse out the 'artists' part of the response
# The only HTTP response I want from this is a 200 OK, the rest of them (there are 8 others) are different use cases that I should
# address


# Looks up an album by its Discogs master ID, including its tracklist.
def get_album(master_id):
    try:
        master = client.master(master_id)
        master.refresh()
        data = master.data
    except HTTPError as e:
        print(f"Discogs API Error {e}")
        if e.status_code == 404:
            raise ReleaseNotFound() from e
        if e.status_code == 429:
            raise DiscogsRateLimited() from e
        raise DiscogsUnavailable() from e
    except Exception as e:
        print(f"Internal Error {e}")
        raise DiscogsUnavailable() from e

    # A tracklist can also hold section headings, like the "Eeny" and "Meeny" sides of OK Computer. A
    # song is identified by its place among the real tracks, so headings aren't counted.
    tracks = [
        {
            "track_index": index,
            "position": track.get("position") or None,
            "title": track.get("title"),
            "duration": track.get("duration") or None,
        }
        for index, track in enumerate(
            track for track in data.get("tracklist", []) if track.get("type_") == "track"
        )
    ]
    images = data.get("images") or []
    return {
        "id": data.get("id"),
        "title": data.get("title"),
        "artists": [clean_name(artist.get("name", "")) for artist in data.get("artists", [])],
        "year": str(data["year"]) if data.get("year") else None,
        "cover_image": images[0].get("uri") if images else None,
        "genres": data.get("genres") or [],
        "styles": data.get("styles") or [],
        "tracks": tracks,
    }


# This search function (as it is now) behaves like the "Advanced Search" feature in Discogs
def search_releases(
    artist_name="",
    releaseTitle="",
    number_of_results=10,
    page_number=1,
    music_type="master",
):

    # The type here is set to "Master". This is useful because it combines all the different releases of a song or an album into one,
    # consolidated item. This way, we won't be displaying duplicate items fto the user.

    # this will be user input, so make sure to consider empty name and title variables, and to cut out any whitespaces from them too
    # if artist name OR release title is empty:

    # strips both strings of leading and trailing white spaces
    # remember that python strings are immutable, hence why we need to reassign instead of simply having artist_name.strip() for example

    artist_name = artist_name.strip()
    releaseTitle = releaseTitle.strip()

    # This checks for empty strings and White-space only values (after strip)
    if not artist_name and not releaseTitle:
        return []

    fields = {"artist": artist_name, "release_title": releaseTitle, "type": music_type}

    # Discogs sorts by how many people own each release, so the first batch holds the best-known ones.
    # Only that batch gets ranked further. Pages past it carry on in Discogs' order, so an artist with
    # hundreds of releases can still be paged through to the end.
    start = (page_number - 1) * number_of_results
    if start >= CANDIDATES_PER_SEARCH:
        discogs_page = start // CANDIDATES_PER_SEARCH + 1
        results = _search_masters([], fields, CANDIDATES_PER_SEARCH, discogs_page, most_owned_first=True)
        offset = start % CANDIDATES_PER_SEARCH
        return results[offset : offset + number_of_results]

    cache_key = ("fields", artist_name.casefold(), releaseTitle.casefold(), music_type)
    ranked = _cached_results(cache_key)
    if ranked is None:
        candidates = _search_masters([], fields, CANDIDATES_PER_SEARCH, 1, most_owned_first=True)
        ranked = _rank_field_matches(artist_name, releaseTitle, candidates)
        _search_cache[cache_key] = {"time": time.monotonic(), "results": ranked}
    return ranked[start : start + number_of_results]


# How many results to compare from each search. 100 is the most Discogs returns at once.
CANDIDATES_PER_SEARCH = 100

# Paging through results shouldn't spend three more Discogs requests per page, since the limit is 60
# a minute, so the ranked list for a search is kept for a while.
SEARCH_CACHE_SECONDS = 600
_search_cache = {}


def _cached_results(cache_key):
    cached = _search_cache.get(cache_key)
    if cached and time.monotonic() - cached["time"] < SEARCH_CACHE_SECONDS:
        return cached["results"]
    return None


# Makes names comparable by ignoring case, accents, spacing and punctuation, so "radio head" and
# "Radiohead" match.
def _match_key(text):
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(character for character in decomposed.casefold() if character.isalnum())


# Discogs writes some artists with a translation and a marker, like "The Beatles = ビートルズ*".
# A leading "The" is ignored so "beatles" finds "The Beatles".
def _artist_keys(artist):
    keys = set()
    for name in artist.split(" = "):
        name = name.strip().rstrip("*").strip()
        keys.add(_match_key(re.sub(r"^the\s+", "", name, flags=re.IGNORECASE)))
    return keys


# Lower is better: both the artist and title, then the artist, then the exact title, then a title
# containing the search, then the rest.
# Discogs tells different artists with the same name apart with a number, like "Dune (3)". The number is
# removed from the name for display, so it's kept separately to stop their releases being mixed together.
def _artist_number(full_title):
    artist_part = full_title.partition(" - ")[0]
    match = re.search(r"\((\d+)\)", artist_part)
    return match.group(1) if match else ""


# Sort values that keep each same-name artist together, starting with the best known, and otherwise put
# the most-owned first.
def _same_name_artist_order(releases):
    best_by_number = {}
    for release in releases:
        number = release["artist_number"]
        best_by_number[number] = max(best_by_number.get(number, 0), release["popularity"])
    return lambda release: (
        -best_by_number[release["artist_number"]],
        release["artist_number"],
        -release["popularity"],
    )


def _match_rank(release, query_key, artist_query_key):
    if not query_key:
        return 3
    title_key = _match_key(release["title"])
    # A search naming both, like "radiohead ok computer", in either order.
    for artist in release["artists"]:
        for artist_key in _artist_keys(artist):
            if title_key and artist_key and artist_query_key in (
                artist_key + title_key,
                title_key + artist_key,
            ):
                return -1
    if any(artist_query_key in _artist_keys(artist) for artist in release["artists"]):
        return 0
    if title_key == query_key:
        return 1
    return 2 if query_key in title_key else 3


MATCH_LABELS = {-1: "artist_and_title", 0: "artist", 1: "title"}


def _rank_candidates(query, candidates):
    query_key = _match_key(query)
    artist_query_key = _match_key(re.sub(r"^the\s+", "", query, flags=re.IGNORECASE))

    ranked = []
    seen_ids = set()
    for release in candidates:
        if release["id"] in seen_ids:
            continue
        seen_ids.add(release["id"])
        rank = _match_rank(release, query_key, artist_query_key)
        ranked.append((rank, release))

    # The artist normally comes before the title, unless the best title match is the more popular one.
    # Searching "abbey road" should lead with the Beatles album, not a small band called Abbey Road.
    def best_popularity(rank):
        return max((r["popularity"] for entry_rank, r in ranked if entry_rank == rank), default=0)

    group_order = {-1: -1, 0: 0, 1: 1, 2: 2, 3: 3}
    if best_popularity(1) > best_popularity(0):
        group_order = {-1: -1, 0: 1, 1: 0, 2: 2, 3: 3}

    # Within a matching group, the release the most people own comes first. Results that don't match
    # stay in the order Discogs gave them (sorted() keeps ties in their original order).
    artist_order = _same_name_artist_order([release for rank, release in ranked if rank == 0])

    def sort_key(entry):
        rank, release = entry
        if rank == 0:
            return (group_order[rank], artist_order(release))
        return (group_order[rank], (-release["popularity"] if rank < 3 else 0,))

    ranked = sorted(ranked, key=sort_key)
    return [{**release, "match": MATCH_LABELS.get(rank)} for rank, release in ranked]


# Orders an artist and/or release search: releases by that exact artist with that exact title first,
# with the most-owned first among equally good matches. Anything else stays in the order it came in.
def _rank_field_matches(artist_name, release_title, candidates):
    artist_key = _match_key(re.sub(r"^the\s+", "", artist_name, flags=re.IGNORECASE))
    title_key = _match_key(release_title)

    def match_strength(release):
        artist_matches = bool(artist_key) and any(
            artist_key in _artist_keys(artist) for artist in release["artists"]
        )
        release_key = _match_key(release["title"])
        if not title_key:
            title_strength = 0
        elif release_key == title_key:
            title_strength = 2
        else:
            title_strength = 1 if title_key in release_key else 0
        return (artist_matches, title_strength)

    artist_order = _same_name_artist_order(
        [release for release in candidates if match_strength(release)[0]]
    )

    def sort_key(release):
        strength = match_strength(release)
        if strength[0]:
            return (False, -strength[1], artist_order(release))
        return (True, -strength[1], (-release["popularity"] if strength[1] else 0,))

    return sorted(candidates, key=sort_key)


# Searches from a single piece of text, like "radiohead" or "radiohead ok computer". A general Discogs
# search buries an artist's own releases under anything with their name in the title, so this also
# searches by artist and by title, then ranks all of it.
def search_music_text(query, number_of_results=10, page_number=1, music_type="master"):
    query = query.strip()
    if not query:
        return []

    cache_key = (query.casefold(), music_type)
    ranked = _cached_results(cache_key)
    if ranked is None:
        # Only the general search stays in Discogs' relevance order, since that's what makes a search
        # like "radiohead ok computer" work. The others would otherwise miss an artist's biggest albums.
        searches = [
            ([query], {"type": music_type}, False),
            ([], {"artist": query, "type": music_type}, True),
            ([], {"release_title": query, "type": music_type}, True),
        ]
        candidates = []
        errors = []

        def run_search(search):
            return _search_masters(
                search[0], search[1], CANDIDATES_PER_SEARCH, 1, most_owned_first=search[2]
            )

        with ThreadPoolExecutor(max_workers=len(searches)) as executor:
            futures = [executor.submit(run_search, search) for search in searches]
            for future in futures:
                try:
                    candidates.extend(future.result())
                except (DiscogsRateLimited, DiscogsUnavailable) as e:
                    errors.append(e)

        # Partial results are still worth showing, but only a complete set is worth keeping.
        if len(errors) == len(searches):
            rate_limited = [e for e in errors if isinstance(e, DiscogsRateLimited)]
            raise (rate_limited or errors)[0]

        ranked = _rank_candidates(query, candidates)
        if not errors:
            _search_cache[cache_key] = {"time": time.monotonic(), "results": ranked}

    start = (page_number - 1) * number_of_results
    return ranked[start : start + number_of_results]


def _search_masters(query, fields, number_of_results, page_number, most_owned_first=False):
    # client.search() only builds the query, the request itself is sent by .page(), so .page() has to be
    # inside the try. Page size is set on the list object because the library appends its own page and
    # per_page values to the URL, which would otherwise conflict with any passed to client.search().
    try:
        search_results = client.search(*query, **fields)
        if most_owned_first:
            search_results.sort("have", "desc")
        search_results.per_page = number_of_results
        page_results = search_results.page(page_number)
    except HTTPError as e:
        print(f"Discogs API Error {e}")
        # Discogs answers 404 when asked for a page past the last one
        if e.status_code == 404:
            return []
        if e.status_code == 429:
            raise DiscogsRateLimited() from e
        raise DiscogsUnavailable() from e
    except Exception as e:
        print(f"Internal Error {e}")
        raise DiscogsUnavailable() from e

    # We will be returning the output from the search API as a list of dictionaries, with the entries containing the information
    # for each search result

    # This is the list that will store the dictionaries
    search_list = []

    for release in page_results:
        try:
            search_dict = {}
            search_dict["id"] = release.id
            artist_names, release_title_only = parse_title(release.title)
            search_dict["artist_number"] = _artist_number(release.title)
            search_dict["title"] = release_title_only
            search_dict["artists"] = artist_names
            # Read straight from the result: release.year sends another request when a year is missing.
            search_dict["year"] = release.data.get("year")
            search_dict["popularity"] = (release.data.get("community") or {}).get("have") or 0
            search_dict["thumb"] = release.data.get("thumb")
            search_dict["cover_image"] = release.data.get("cover_image")
            search_list.append(search_dict)
        except DiscogsAPIError as e:
            print(f"Skipping release {release.id}: {e}")
            continue

    return search_list


# check default number of returns without specifying
# check if we need to go page 0 (0 index or if one is correct)
# check if we even need to specify the page number (albeit it wouldnt hurt just to leave it)


# The regex function is used to clean up the artist and label name(s). This is because of how Discogs displays these
def clean_name(media_name):
    # \s* = optional whitespace
    # \(\d+\) = parentheses with digits
    # $ = at end of string
    media_name = re.sub(r"\s*\(\d+\)$", "", media_name)
    return media_name


def parse_title(full_title):
    artist_part, separator, release_part = full_title.partition(" - ")
    if not separator:
        return [], full_title
    artist_names = [clean_name(name.strip()) for name in artist_part.split(", ")]
    return artist_names, release_part.strip()
