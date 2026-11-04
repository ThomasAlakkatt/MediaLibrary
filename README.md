# MediaLibrary

An all-in-one logger for books, shows, movies, and music.

This project is at an early stage and started as a copy of an earlier project, Music2Movies.

- **Search:** search movies, shows, music and books together, or filter to one of them. Results show what's already logged.
- **Movies and shows:** search with the TMDB API, and log a status, rating, review and date finished. Each season of a show can also have its own status and date finished. A rating can be any number from 0 to 10, with up to 2 decimal places.
- **My Library:** search, filter by type, status and date range, and sort by date finished, release date, status, rating or title.
- **Shelves:** ordered lists that mix movies, shows, albums and songs, like playlists, and can hold books too. Search your shelves, or search, sort and filter what's on one.
- **Music:** search with the Discogs API, and log a whole album or any of its songs, each as its own entry.
- **Books:** search with the Open Library API, which needs no key, and log them the same way.

## Your Data

Your library is stored in a SQLite database at `backend/medialibrary.db`, created the first time the backend starts. Git ignores it, so it isn't included in the repo. To back up your library, copy that file while the app is stopped.

To use a different database file, set `MEDIALIBRARY_DB` to its path before starting the backend.

## API Keys

This app requires your own free API credentials from Discogs and TMDB

1. Create a `backend/.env` file with the following variables:
   ```
   DISCOGS_API_KEY=your_discogs_personal_access_token
   DISCOGS_USER_AGENT=your_app_name/1.0
   TMDB_API_READ_ACCESS_TOKEN=your_tmdb_read_access_token
   ```
2. Get a Discogs token: log into [Discogs](https://www.discogs.com/), go to Settings > Developers, and generate a personal access token. `DISCOGS_USER_AGENT` can be any identifying string (e.g. `MediaLibrary/1.0`) — Discogs requires one on every request.
3. Get a TMDB token: create a free account at [TMDB](https://www.themoviedb.org/), go to Settings > API, and copy the "API Read Access Token" (not the shorter API Key).

Without these, the backend will start but every search/recommendation request will fail with an error.

## Running the App

1. Create a virtual environment with Python 3.13 and install backend dependencies (from `backend/`):
   ```
   python3.13 -m venv venv
   venv/bin/pip install -r requirements.txt
   ```
2. Install root dependencies (from the project root): `npm install`
3. Install frontend dependencies (from `frontend/`): `npm install`
4. Start both the frontend and backend together (from the project root): `npm run dev`

The frontend runs at `http://localhost:3000` and the backend at `http://localhost:8000`.

## Backend Tests

From `backend/`, install the test tools and run the tests. They use a temporary database, so they never touch your library.

```
venv/bin/pip install -r requirements-dev.txt
venv/bin/python -m pytest
```

## Frontend Commands

Run these from `frontend/`:

- `npm start`: start the Vite dev server
- `npm run build`: build for production into `frontend/dist`
- `npm test`: run tests with Vitest
- `npm run lint`: check the code with ESLint

## Frontend Packages

- axios
- react
- react-dom

### Development

- @eslint/js
- @testing-library/dom
- @testing-library/jest-dom
- @testing-library/react
- @testing-library/user-event
- @vitejs/plugin-react
- eslint
- eslint-plugin-react-hooks
- globals
- jsdom
- vite
- vitest

## Backend Packages

- fastapi
- python-dotenv
- python3-discogs-client
- requests
- uvicorn
