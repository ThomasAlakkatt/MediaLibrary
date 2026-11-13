# MediaLibrary

[![Tests](https://github.com/ThomasAlakkatt/MediaLibrary/actions/workflows/tests.yml/badge.svg)](https://github.com/ThomasAlakkatt/MediaLibrary/actions/workflows/tests.yml)

A personal logger for movies, shows, music and books, all in one place. Search everything at once, log what you've watched, listened to or read, and gather any mix of them onto shelves, like playlists.

It runs on your own computer, and your library stays there in a single SQLite file.

## Features

- **One search for everything:** movies and shows from TMDB, albums from Discogs and books from Open Library, together or filtered to one type. Results show what you've already logged.
- **Logging:** a status, a rating from 0 to 10 (up to 2 decimal places), a review and the date you finished. Today's date is filled in for you.
- **Shows and music in detail:** give each season of a show its own status and date, or log a whole album or any of its songs as separate entries.
- **My Library:** search, filter by type, status and date range, and sort by date finished, release date, status, rating or title.
- **Shelves:** ordered lists that mix any kind of title. Reorder by dragging or with arrows, and search, sort or filter what's on them.
- **Comfortable anywhere:** light and dark themes, and a layout that works at phone sizes.

## Built with

- **Frontend:** React 19, Vite and Vitest
- **Backend:** Python 3.13, FastAPI and SQLite
- **Data:** the TMDB, Discogs and Open Library APIs

## Getting started

You'll need Python 3.13, Node.js 20.19 or newer, and free API keys from TMDB and Discogs. Open Library needs no key.

1. **Clone the repo:**
   ```
   git clone https://github.com/ThomasAlakkatt/MediaLibrary.git
   cd MediaLibrary
   ```
2. **Add your API keys:** copy `backend/.env.example` to `backend/.env`, then fill it in.
   - **TMDB:** create a free account at [themoviedb.org](https://www.themoviedb.org/), go to Settings > API, and copy the **API Read Access Token** (the long one, not the API Key).
   - **Discogs:** log into [discogs.com](https://www.discogs.com/), go to Settings > Developers, and generate a personal access token.
3. **Set up the backend** (from `backend/`):
   ```
   python3.13 -m venv venv
   venv/bin/pip install -r requirements.txt
   ```
4. **Set up the frontend** (from the project root, then `frontend/`):
   ```
   npm install
   cd frontend && npm install
   ```
5. **Start both** (from the project root): `npm run dev`

Then open [http://localhost:3000](http://localhost:3000). The backend runs at `http://localhost:8000`.

## Your data

Your library is saved in `backend/medialibrary.db`, created the first time the backend starts. Git ignores it, so it's never committed. To back it up, copy that file while the app is stopped. To keep it somewhere else, set `MEDIALIBRARY_DB` in `backend/.env`.

When an update changes how the library is stored, the app upgrades it automatically and keeps a copy of the old file next to it, named like `medialibrary.db-before-…`.

## Security

MediaLibrary has no login, so anyone who can reach it can read and change your library. It's built to run only on your own computer:

- Both servers only listen on `localhost`.
- The backend refuses requests addressed to any other host, and only accepts requests from the app itself.
- Don't expose it to the internet, through port forwarding or a public tunnel for example, without adding authentication first.

Keep `backend/.env` private: it holds your API keys and is ignored by git.

## Running the tests

The tests fake every outside service, so they don't need API keys and never touch your library.

- **Backend** (from `backend/`):
  ```
  venv/bin/pip install -r requirements-dev.txt
  venv/bin/python -m pytest
  ```
- **Frontend** (from `frontend/`): `npm test`, plus `npm run lint` and `npm run build`

GitHub Actions runs both on every push.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB. Movie and show data and images come from [TMDB](https://www.themoviedb.org/).

Music data provided by [Discogs](https://www.discogs.com/). Book data and covers come from [Open Library](https://openlibrary.org/).

MediaLibrary started as a copy of an earlier project of mine, Music2Movies.

## License

[MIT](LICENSE)
