import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API_URL, getErrorMessage } from './api';
import { Clapperboard } from './Loaders';
import MediaCard, { LoggedBadge, useLoggedTitles } from './MediaCard';
import MediaDetail from './MediaDetail';

const SEARCH_LABELS = {
  all: 'movies, shows, music and books',
  movie: 'movies',
  tv: 'shows',
  book: 'books',
};

// The backend sends this many music results per page, so a full page means there may be more.
const MUSIC_PAGE_SIZE = 10;

function updateShareableUrl(query, type) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (query && type !== 'all') params.set('type', type);
  const queryString = params.toString();
  window.history.replaceState(
    null,
    '',
    queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname
  );
}

// Searches movies and shows by title. type is "all", "movie" or "tv".
export default function MediaSearch({ type, onLogSubmitted, onOpenRelease }) {
  const [initialQuery] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [musicResults, setMusicResults] = useState([]);
  const [musicError, setMusicError] = useState(null);
  const [bookResults, setBookResults] = useState([]);
  const [bookPages, setBookPages] = useState(0);
  const [bookError, setBookError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasResponse, setHasResponse] = useState(false);

  const [selected, setSelected] = useState(null);
  const allResults = useMemo(
    () => [...results, ...musicResults, ...bookResults],
    [results, musicResults, bookResults]
  );
  const logs = useLoggedTitles(allResults, selected);

  // Lets a slower, older request be ignored if a newer search has started since.
  const latestRequest = useRef(0);

  async function performSearch(searchQuery, searchPage) {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError(null);
    setSubmittedQuery(searchQuery);

    setMusicError(null);
    setBookError(null);

    // Each kind of title comes from a different service when searching everything, so if one fails the
    // others' results still show.
    const mediaRequest = axios
      .get(
        ...(type === 'book'
          ? [`${API_URL}/search/books`, { params: { query: searchQuery, page: searchPage } }]
          : [`${API_URL}/search/media`, { params: { query: searchQuery, type, page: searchPage } }])
      )
      .then((response) => ({ data: response.data }))
      .catch((err) => ({ err }));
    const bookRequest =
      type === 'all'
        ? axios
            .get(`${API_URL}/search/books`, { params: { query: searchQuery, page: searchPage } })
            .then((response) => ({ data: response.data }))
            .catch((err) => ({ err }))
        : Promise.resolve({ data: { results: [], total_pages: 0 } });
    const musicRequest =
      type === 'all'
        ? axios
            .get(`${API_URL}/search/music`, { params: { query: searchQuery, page: searchPage } })
            .then((response) => ({ data: response.data }))
            .catch((err) => ({ err }))
        : Promise.resolve({ data: [] });

    try {
      const [media, music, books] = await Promise.all([mediaRequest, musicRequest, bookRequest]);
      if (requestId !== latestRequest.current) return;

      if (media.err) {
        setError(getErrorMessage(media.err, 'Something went wrong while searching. Please try again.'));
        setResults([]);
        setTotalPages(0);
      } else {
        setResults(media.data.results);
        setPage(media.data.page);
        setTotalPages(media.data.total_pages);
        setHasResponse(true);
        updateShareableUrl(searchQuery, type);
      }

      setMusicResults(music.data ?? []);
      if (music.err) {
        setMusicError(getErrorMessage(music.err, 'Something went wrong searching music.'));
      }

      setBookResults(books.data?.results ?? []);
      setBookPages(books.data?.total_pages ?? 0);
      if (books.err) {
        setBookError(getErrorMessage(books.err, 'Something went wrong searching books.'));
      }
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }

  // Runs the search from a shared link on load, and reruns the current search when the filter changes.
  useEffect(() => {
    setSelected(null);
    if (submittedQuery) performSearch(submittedQuery, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // A search still running when this page closes must not rewrite the URL of the page that replaced it.
  useEffect(
    () => () => {
      latestRequest.current += 1;
    },
    []
  );

  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setError('Please enter a title to search for.');
      setResults([]);
      setMusicResults([]);
      setBookResults([]);
      setBookPages(0);
      setTotalPages(0);
      return;
    }
    performSearch(trimmed, 1);
  }

  function handleClear() {
    latestRequest.current += 1;
    setQuery('');
    setSubmittedQuery('');
    setResults([]);
    setMusicResults([]);
    setMusicError(null);
    setBookResults([]);
    setBookPages(0);
    setBookError(null);
    setPage(1);
    setTotalPages(0);
    setLoading(false);
    setError(null);
    setHasResponse(false);
    updateShareableUrl('', type);
  }

  function handleSelect(item) {
    setSelected(item);
    window.scrollTo?.(0, 0);
  }

  if (selected) {
    return (
      <MediaDetail
        item={selected}
        onBack={() => setSelected(null)}
        onLogSubmitted={onLogSubmitted}
      />
    );
  }

  // Music and books can run for more pages than movies and shows, so paging has to allow for any of them.
  const moreElsewhere =
    type === 'all' && (musicResults.length === MUSIC_PAGE_SIZE || page < bookPages);
  const pageTotalUnknown = type === 'all' && (moreElsewhere || page > totalPages);

  const mediaSection = !loading && results.length > 0 && (
    <>
      {type === 'all' && (musicResults.length > 0 || bookResults.length > 0) && (
        <h2 className="results-heading">Movies &amp; Shows</h2>
      )}
      <section aria-label="results" className="results">
        {results.map((item) => {
          const key = `${item.media_type}-${item.id}`;
          return (
            <MediaCard key={key} item={item} onSelect={handleSelect}>
              {logs[key] && <LoggedBadge log={logs[key]} />}
            </MediaCard>
          );
        })}
      </section>
    </>
  );

  const musicSection = !loading && musicResults.length > 0 && (
    <>
      <h2 className="results-heading">Music</h2>
      <section aria-label="music results" className="results">
        {musicResults.map((release) => {
          const image = release.cover_image || release.thumb;
          return (
            <button
              type="button"
              className="result-card music-card"
              key={release.id}
              onClick={() => onOpenRelease(release)}
            >
              {image ? (
                <img
                  className="result-image"
                  src={image}
                  alt={`${release.title} cover art`}
                  loading="lazy"
                />
              ) : (
                <span className="result-image result-image--placeholder">No Image</span>
              )}
              <span className="result-info">
                <span className="music-card-title">{release.title}</span>
                <span className="result-artist">{release.artists.join(', ')}</span>
                {release.year ? <span className="result-year">{release.year}</span> : null}
                {logs[`album-${release.id}`] && <LoggedBadge log={logs[`album-${release.id}`]} />}
              </span>
            </button>
          );
        })}
      </section>
    </>
  );

  const bookSection = !loading && bookResults.length > 0 && (
    <>
      <h2 className="results-heading">Books</h2>
      <section aria-label="book results" className="results">
        {bookResults.map((item) => {
          const key = `book-${item.id}`;
          return (
            <MediaCard key={key} item={item} onSelect={handleSelect}>
              {logs[key] && <LoggedBadge log={logs[key]} />}
            </MediaCard>
          );
        })}
      </section>
    </>
  );

  // Music or books go first when they're clearly what was searched for, unless a movie or show has that
  // exact title. If both are clear matches, books come first.
  const searchedTitle = submittedQuery.trim().toLowerCase();
  const movieOrShowHasTitle = results.some(
    (item) => item.title?.trim().toLowerCase() === searchedTitle
  );
  const musicFirst = Boolean(musicResults[0]?.match) && !movieOrShowHasTitle;
  const topBook = bookResults[0];
  const booksFirst =
    Boolean(topBook) &&
    !movieOrShowHasTitle &&
    (topBook.title?.trim().toLowerCase() === searchedTitle ||
      topBook.creators?.toLowerCase().split(', ').includes(searchedTitle));

  return (
    <>
      <section aria-label="search" className="search-card">
        <form onSubmit={handleSubmit}>
          <div className="input-row">
            <div className="input-group">
              <label htmlFor="media-query">Search</label>
              <input
                type="search"
                id="media-query"
                name="media-query"
                autoComplete="off"
                maxLength="100"
                placeholder={`Search ${SEARCH_LABELS[type]}`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
          <div className="search-actions">
            <button id="search-btn" type="submit" disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
            {(submittedQuery || query) && (
              <button type="button" className="clear-btn" onClick={handleClear} disabled={loading}>
                Clear Search
              </button>
            )}
          </div>
        </form>
      </section>

      {!submittedQuery && !error && (
        <section className="empty-state" aria-label="getting started">
          <p className="empty-state-hint">
            Search everything at once, or pick a filter above to narrow it down. Try{' '}
            <strong>Dune</strong>, <strong>Radiohead</strong> or <strong>Stephen King</strong>.
          </p>
        </section>
      )}

      {error && <p className="search-error">{error}</p>}

      {loading && <Clapperboard label="Searching…" />}

      {booksFirst && bookSection}
      {musicFirst && musicSection}
      {mediaSection}
      {!musicFirst && musicSection}
      {!booksFirst && bookSection}

      {!loading && musicError && <p className="search-error">{musicError}</p>}
      {!loading && bookError && <p className="search-error">{bookError}</p>}

      {!loading && !error && !musicError && !bookError && hasResponse && allResults.length === 0 && (
        <p className="search-error">{page > 1 ? 'No more results.' : 'No results found.'}</p>
      )}

      {!loading && !error && (totalPages > 1 || moreElsewhere || page > 1) && (
        <div className="pagination">
          <button
            className="pagination-btn"
            onClick={() => performSearch(submittedQuery, page - 1)}
            disabled={page <= 1}
          >
            ← Previous
          </button>
          <span className="pagination-page">
            {pageTotalUnknown ? `Page ${page}` : `Page ${page} of ${totalPages}`}
          </span>
          <button
            className="pagination-btn"
            onClick={() => performSearch(submittedQuery, page + 1)}
            disabled={page >= totalPages && !moreElsewhere}
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
