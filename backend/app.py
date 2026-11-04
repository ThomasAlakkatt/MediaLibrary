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
    release_details,
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
from movie_service import get_movies_by_genres
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
    return JSONResponse(status_code=404, content={"detail": "Could not find that release."})


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


MediaType = Literal["movie", "tv"]
Status = Literal["want", "in_progress", "finished"]
Rating = Annotated[Optional[float], AfterValidator(_validate_rating)]
OptionalText = Annotated[Optional[str], AfterValidator(_blank_to_none)]
ShelfName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


# The TMDB details stored with a title, so the library can be shown without calling TMDB.
class TitleDetails(BaseModel):
    title: str = Field(min_length=1)
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
    tmdb_id: int


class ShelfRequest(BaseModel):
    name: ShelfName
    description: OptionalText = None


class ShelfOrderRequest(BaseModel):
    item_ids: list[int]


def _split_details(body, log_fields):
    data = body.model_dump()
    details = {key: data[key] for key in ("title", "year", "release_date", "poster_path", "overview")}
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


# Given a Discogs release ID, looks up that release's genres/styles and returns movie
# recommendations matching them.
@app.get("/movies/{release_id}")
def movies_for_release(release_id: int):
    details = release_details(release_id)
    return get_movies_by_genres(
        details.get("genres", []), details.get("styles", []), number_of_results=10
    )


# Your logged movies and shows, most recently changed first unless a sort is chosen.
@app.get("/library")
def library(
    media_type: Optional[MediaType] = None,
    status: Optional[Status] = None,
    sort: Literal["changed", "watched", "release"] = "changed",
    order: Literal["desc", "asc"] = "desc",
):
    return library_service.list_library(media_type, status, sort, order)


@app.get("/library/{media_type}/{tmdb_id}")
def library_item(media_type: MediaType, tmdb_id: int):
    return library_service.get_item(media_type, tmdb_id)


# Replaces a title's log. Returns null if that leaves nothing to keep.
@app.put("/library/{media_type}/{tmdb_id}")
def save_log(media_type: MediaType, tmdb_id: int, body: LogRequest):
    details, log = _split_details(body, ("status", "rating", "review", "finished_on"))
    return library_service.save_log(media_type, tmdb_id, details, log)


# Clears a title's log and season logs, leaving it on its shelves. Returns null if that leaves nothing.
@app.delete("/library/{media_type}/{tmdb_id}")
def clear_log(media_type: MediaType, tmdb_id: int):
    return library_service.clear_log(media_type, tmdb_id)


@app.put("/library/tv/{tmdb_id}/seasons/{season_number}")
def save_season_log(tmdb_id: int, season_number: int, body: SeasonLogRequest):
    details, log = _split_details(body, ("status", "finished_on"))
    return library_service.save_season_log(tmdb_id, season_number, details, log)


@app.get("/shelves")
def shelves():
    return library_service.list_shelves()


@app.post("/shelves", status_code=201)
def create_shelf(body: ShelfRequest):
    return library_service.create_shelf(body.name, body.description)


@app.get("/shelves/{shelf_id}")
def shelf(shelf_id: int):
    return library_service.get_shelf(shelf_id)


@app.patch("/shelves/{shelf_id}")
def update_shelf(shelf_id: int, body: ShelfRequest):
    return library_service.update_shelf(shelf_id, body.name, body.description)


@app.delete("/shelves/{shelf_id}", status_code=204)
def delete_shelf(shelf_id: int):
    library_service.delete_shelf(shelf_id)


@app.post("/shelves/{shelf_id}/items")
def add_to_shelf(shelf_id: int, body: ShelfItemRequest):
    details, _ = _split_details(body, ())
    return library_service.add_to_shelf(shelf_id, body.media_type, body.tmdb_id, details)


@app.delete("/shelves/{shelf_id}/items/{item_id}")
def remove_from_shelf(shelf_id: int, item_id: int):
    return library_service.remove_from_shelf(shelf_id, item_id)


@app.put("/shelves/{shelf_id}/order")
def reorder_shelf(shelf_id: int, body: ShelfOrderRequest):
    return library_service.reorder_shelf(shelf_id, body.item_ids)
