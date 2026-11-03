from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

# we don't need to specify "music_service.py" because python automatically drops the .py when importing
from music_service import (
    DiscogsRateLimited,
    DiscogsUnavailable,
    ReleaseNotFound,
    search_releases,
    release_details,
)
from movie_service import TMDBUnavailable, get_movies_by_genres

# CORS is needed so that when I run my frontend and FastAPI on localhost from two different origins. CORS allows the frontend to make
# these API calls to my app.py file
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

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


# Each route in here is an API endpoint


# Returns up to 10 results per page. Pass page=2, page=3, etc. to page through more results.
@app.get("/search")
def search(artist: str, title: str, page: int = Query(1, ge=1)):
    if not artist.strip() and not title.strip():
        raise HTTPException(status_code=400, detail="Please enter an artist and/or a release title.")
    return search_releases(artist, title, number_of_results=10, page_number=page)


# Given a Discogs release ID, looks up that release's genres/styles and returns movie
# recommendations matching them.
@app.get("/movies/{release_id}")
def movies_for_release(release_id: int):
    details = release_details(release_id)
    return get_movies_by_genres(
        details.get("genres", []), details.get("styles", []), number_of_results=10
    )
