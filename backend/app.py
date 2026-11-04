from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated, Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import AfterValidator, BaseModel, Field, StringConstraints

# we don't need to specify "music_service.py" because python automatically drops the .py when importing
from music_service import (
    DiscogsRateLimited,
    DiscogsUnavailable,
    ReleaseNotFound,
    search_releases,
    get_album,
    search_music_text,
)
from database import init_db
import library_service
from library_service import (
    DuplicateShelfName,
    InvalidShelfOrder,
    ItemNotFound,
    ShelfNotFound,
)
from tmdb_service import ShowNotFound, TMDBUnavailable, get_show_details, search_media

# CORS is needed so that when I run my frontend and FastAPI on localhost from two different origins. CORS allows the frontend to make
# these API calls to my app.py file
from fastapi.middleware.cors import CORSMiddleware


@asynccontextmanager
async def lifespan(app):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Failures are returned as real HTTP error statuses with a {"detail": "..."} message, the same shape
# FastAPI uses for HTTPException. "Nothing found" is not a failure, so those routes return an empty list.
@app.exception_handler(DiscogsRateLimited)
def discogs_rate_limited(request, exc):
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limited by Discogs, please wait a moment and try again."},
    )


@app.exception_handler(DiscogsUnavailable)
def discogs_unavailable(request, exc):
    return JSONResponse(
        status_code=502,
        content={"detail": "Could not reach Discogs, please try again."},
    )


@app.exception_handler(ReleaseNotFound)
def release_not_found(request, exc):
    return JSONResponse(status_code=404, content={"detail": "Could not find that album."})


@app.exception_handler(TMDBUnavailable)
def tmdb_unavailable(request, exc):
    return JSONResponse(
        status_code=502,
        content={"detail": "Could not reach TMDB, please try again."},
    )


@app.exception_handler(ItemNotFound)
def item_not_found(request, exc):
    return JSONResponse(status_code=404, content={"detail": "That title isn't in your library."})


@app.exception_handler(ShelfNotFound)
def shelf_not_found(request, exc):
    return JSONResponse(status_code=404, content={"detail": "Could not find that shelf."})


@app.exception_handler(DuplicateShelfName)
def duplicate_shelf_name(request, exc):
    return JSONResponse(status_code=409, content={"detail": "You already have a shelf with that name."})


@app.exception_handler(InvalidShelfOrder)
def invalid_shelf_order(request, exc):
    return JSONResponse(
        status_code=400,
        content={"detail": "That order doesn't match what's on the shelf. Please reload and try again."},
    )


@app.exception_handler(ShowNotFound)
def show_not_found(request, exc):
    return JSONResponse(status_code=404, content={"detail": "Could not find that show."})


def _validate_rating(rating):
    if rating is not None and (not 0 <= rating <= 10 or round(rating, 2) != rating):
        raise ValueError("Rating must be between 0 and 10, with at most 2 decimal places")
    return rating


def _blank_to_none(text):
    return (text or "").strip() or None


# A song is identified differently from everything else, so it has routes of its own.
LoggableType = Literal["movie", "tv", "album"]
MediaType = Literal["movie", "tv", "album", "song"]
Status = Literal["want", "in_progress", "finished"]
Rating = Annotated[Optional[float], AfterValidator(_validate_rating)]
OptionalText = Annotated[Optional[str], AfterValidator(_blank_to_none)]
ShelfName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


# The TMDB details stored with a title, so the library can be shown without calling TMDB.
class TitleDetails(BaseModel):
    title: str = Field(min_length=1)
    creators: Optional[str] = None
    album_title: Optional[str] = None
    year: Optional[str] = None
    release_date: Optional[str] = None
    poster_path: Optional[str] = None
    overview: Optional[str] = None


class LogRequest(TitleDetails):
    status: Optional[Status] = None
    rating: Rating = None
    review: OptionalText = None
    finished_on: Optional[date] = None


class SeasonLogRequest(TitleDetails):
    status: Optional[Status] = None
    finished_on: Optional[date] = None


class ShelfItemRequest(TitleDetails):
    media_type: MediaType
    source_id: int
    track_index: int = -1


class ShelfRequest(BaseModel):
    name: ShelfName
    description: OptionalText = None


class ShelfOrderRequest(BaseModel):
    item_ids: list[int]


def _split_details(body, log_fields):
    data = body.model_dump()
    details = {
        key: data[key]
        for key in (
            "title",
            "creators",
            "album_title",
            "year",
            "release_date",
            "poster_path",
            "overview",
        )
    }
    log = {key: data[key] for key in log_fields}
    if log.get("finished_on"):
        log["finished_on"] = log["finished_on"].isoformat()
    return details, log


# Each route in here is an API endpoint


# Returns up to 10 results per page. Pass page=2, page=3, etc. to page through more results.
@app.get("/search")
def search(artist: str, title: str, page: int = Query(1, ge=1)):
    if not artist.strip() and not title.strip():
        raise HTTPException(status_code=400, detail="Please enter an artist and/or a release title.")
    return search_releases(artist, title, number_of_results=10, page_number=page)


# Searches music from a single piece of text, for searching everything from one box.
@app.get("/search/music")
def search_music(query: str, page: int = Query(1, ge=1)):
    if not query.strip():
        raise HTTPException(status_code=400, detail="Please enter a title to search for.")
    return search_music_text(query, number_of_results=10, page_number=page)


# Searches movies and shows by title. TMDB doesn't serve pages past 500.
@app.get("/search/media")
def search_movies_and_shows(
    query: str,
    media_type: Literal["all", "movie", "tv"] = Query("all", alias="type"),
    page: int = Query(1, ge=1, le=500),
):
    if not query.strip():
        raise HTTPException(status_code=400, detail="Please enter a title to search for.")
    return search_media(query, media_type, page)


# Returns a show's details that search results don't include, like its list of seasons.
@app.get("/shows/{show_id}")
def show_details(show_id: int):
    return get_show_details(show_id)


# An album's details and tracklist.
@app.get("/albums/{album_id}")
def album(album_id: int):
    return get_album(album_id)


# Your logged titles, most recently changed first unless a sort is chosen.
@app.get("/library")
def library(
    media_type: Optional[MediaType] = None,
    status: Optional[Status] = None,
    sort: Literal["changed", "finished", "release", "status", "rating", "title"] = "changed",
    order: Literal["desc", "asc"] = "desc",
):
    return library_service.list_library(media_type, status, sort, order)


# The songs from an album that are in the library.
@app.get("/library/album/{album_id}/songs")
def album_songs(album_id: int):
    return library_service.list_album_songs(album_id)


@app.get("/library/song/{album_id}/{track_index}")
def song_item(album_id: int, track_index: int):
    return library_service.get_item("song", album_id, track_index)


@app.put("/library/song/{album_id}/{track_index}")
def save_song_log(album_id: int, track_index: int, body: LogRequest):
    details, log = _split_details(body, ("status", "rating", "review", "finished_on"))
    return library_service.save_log("song", album_id, details, log, track_index)


@app.delete("/library/song/{album_id}/{track_index}")
def clear_song_log(album_id: int, track_index: int):
    return library_service.clear_log("song", album_id, track_index)


@app.get("/library/{media_type}/{source_id}")
def library_item(media_type: LoggableType, source_id: int):
    return library_service.get_item(media_type, source_id)


# Replaces a title's log. Returns null if that leaves nothing to keep.
@app.put("/library/{media_type}/{source_id}")
def save_log(media_type: LoggableType, source_id: int, body: LogRequest):
    details, log = _split_details(body, ("status", "rating", "review", "finished_on"))
    return library_service.save_log(media_type, source_id, details, log)


# Clears a title's log and season logs, leaving it on its shelves. Returns null if that leaves nothing.
@app.delete("/library/{media_type}/{source_id}")
def clear_log(media_type: LoggableType, source_id: int):
    return library_service.clear_log(media_type, source_id)


@app.put("/library/tv/{source_id}/seasons/{season_number}")
def save_season_log(source_id: int, season_number: int, body: SeasonLogRequest):
    details, log = _split_details(body, ("status", "finished_on"))
    return library_service.save_season_log(source_id, season_number, details, log)


@app.get("/shelves")
def shelves():
    return library_service.list_shelves()


@app.post("/shelves", status_code=201)
def create_shelf(body: ShelfRequest):
    return library_service.create_shelf(body.name, body.description)


@app.get("/shelves/{shelf_id}")
def shelf(shelf_id: int, fill_release_dates: bool = False):
    return library_service.get_shelf(shelf_id, fill_release_dates)


@app.patch("/shelves/{shelf_id}")
def update_shelf(shelf_id: int, body: ShelfRequest):
    return library_service.update_shelf(shelf_id, body.name, body.description)


@app.delete("/shelves/{shelf_id}", status_code=204)
def delete_shelf(shelf_id: int):
    library_service.delete_shelf(shelf_id)


@app.post("/shelves/{shelf_id}/items")
def add_to_shelf(shelf_id: int, body: ShelfItemRequest):
    details, _ = _split_details(body, ())
    return library_service.add_to_shelf(
        shelf_id, body.media_type, body.source_id, details, body.track_index
    )


@app.delete("/shelves/{shelf_id}/items/{item_id}")
def remove_from_shelf(shelf_id: int, item_id: int):
    return library_service.remove_from_shelf(shelf_id, item_id)


@app.put("/shelves/{shelf_id}/order")
def reorder_shelf(shelf_id: int, body: ShelfOrderRequest):
    return library_service.reorder_shelf(shelf_id, body.item_ids)
