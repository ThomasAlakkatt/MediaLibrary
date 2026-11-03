# OS allows access to my environmental variables
import os

# re is the RegEx library for RegEx operations
import re

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


def release_details(release_id_number):
    try:
        # search_releases() searches with type="master", so the IDs it returns are master IDs,
        # not release IDs. Master objects don't have "artists"/"country" directly, so those come
        # from the master's main_release instead.
        response = client.master(release_id_number)
        main_release = response.main_release
        release_details_dict = {
            "year": response.year,
            "styles": response.styles,
            "artists": parse_artists(main_release.artists),
            "country": main_release.country,
            "genres": response.genres,
        }
        return release_details_dict
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


# This function parses the artists list that is returned from the client, then returns the parsed list of one or more strings,
# I dont think I need artist ID at this point, maybe down the line for reference info, and pictures of the artist which would be cool
def parse_artists(artists):
    # iterate over the list, this goes through each artist
    # make a dict with artist id as a key and name as value, we can add the pictures in
    # later when we wanna display, when we do this we can change format
    artist_dict = {}
    for artist_entry in artists:
        cleaned_artist_name = clean_name(artist_entry.name)
        artist_dict[artist_entry.id] = {"name": cleaned_artist_name}
    return artist_dict


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

    return _search_masters(
        [],
        {"artist": artist_name, "release_title": releaseTitle, "type": music_type},
        number_of_results,
        page_number,
    )


# Searches everything Discogs knows about from a single piece of text, like "radiohead ok computer".
def search_music_text(query, number_of_results=10, page_number=1, music_type="master"):
    query = query.strip()
    if not query:
        return []
    return _search_masters([query], {"type": music_type}, number_of_results, page_number)


def _search_masters(query, fields, number_of_results, page_number):
    # client.search() only builds the query, the request itself is sent by .page(), so .page() has to be
    # inside the try. Page size is set on the list object because the library appends its own page and
    # per_page values to the URL, which would otherwise conflict with any passed to client.search().
    try:
        search_results = client.search(*query, **fields)
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
            search_dict["title"] = release_title_only
            search_dict["artists"] = artist_names
            search_dict["year"] = release.year
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
