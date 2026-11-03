# MediaLibrary

An all-in-one logger for books, shows, movies, and music.

This project is at an early stage and started as a copy of an earlier project, Music2Movies. Logging isn't built yet. For now, the app searches for music with the Discogs API and recommends movies with the TMDB API.

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

1. Create a virtual environment and install backend dependencies (from `backend/`):
   ```
   python3 -m venv venv
   venv/bin/pip install -r requirements.txt
   ```
2. Install root dependencies (from the project root): `npm install`
3. Install frontend dependencies (from `frontend/`): `npm install`
4. Start both the frontend and backend together (from the project root): `npm run dev`

The frontend runs at `http://localhost:3000` and the backend at `http://localhost:8000`.

## Frontend Commands

Run these from `frontend/`:

- `npm start`: start the Vite dev server
- `npm run build`: build for production into `frontend/dist`
- `npm test`: run tests with Vitest
- `npm run lint`: check the code with ESLint

## Frontend Packages

- @testing-library/dom
- @testing-library/jest-dom
- @testing-library/react
- @testing-library/user-event
- axios
- react
- react-dom
- web-vitals

### Development

- @eslint/js
- @vitejs/plugin-react
- eslint
- eslint-plugin-react
- eslint-plugin-react-hooks
- globals
- jsdom
- vite
- vitest

## Backend Packages

- annotated-doc
- annotated-types
- anyio
- async-timeout
- certifi
- charset-normalizer
- click
- exceptiongroup
- fastapi
- h11
- idna
- oauthlib
- pydantic
- pydantic_core
- python-dateutil
- python-dotenv
- python3-discogs-client
- redis
- requests
- six
- starlette
- typing-inspection
- typing_extensions
- urllib3
- uvicorn
