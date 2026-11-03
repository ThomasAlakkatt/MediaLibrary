import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_URL, getErrorMessage } from './api';
import { Clapperboard } from './Loaders';
import MediaCard from './MediaCard';
import MediaDetail from './MediaDetail';

const SEARCH_LABELS = { all: 'movies, shows and music', movie: 'movies', tv: 'shows' };

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
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasResponse, setHasResponse] = useState(false);

  const [selected, setSelected] = useState(null);

  // Lets a slower, older request be ignored if a newer search has started since.
  const latestRequest = useRef(0);

  async function performSearch(searchQuery, searchPage) {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError(null);
    setSubmittedQuery(searchQuery);

    setMusicError(null);

    // Music comes from a different service when searching everything, so if one fails the other's
    // results still show.
    const mediaRequest = axios
      .get(`${API_URL}/search/media`, { params: { query: searchQuery, type, page: searchPage } })
      .then((response) => ({ data: response.data }))
      .catch((err) => ({ err }));
    const musicRequest =
      type === 'all'
        ? axios
            .get(`${API_URL}/search/music`, { params: { query: searchQuery, page: searchPage } })
            .then((response) => ({ data: response.data }))
            .catch((err) => ({ err }))
        : Promise.resolve({ data: [] });

    try {
      const [media, music] = await Promise.all([mediaRequest, musicRequest]);
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

  return (
    <>
      <section aria-label="search" className="search-card">
        <form onSubmit={handleSubmit}>
          <div className="input-row">
            <div className="input-group">
              <label htmlFor="media-query">Title</label>
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
            <strong>Dune</strong> or <strong>Radiohead</strong>.
          </p>
        </section>
      )}

      {error && <p className="search-error">{error}</p>}

      {loading && <Clapperboard label="Searching…" />}

      {!loading && results.length > 0 && type === 'all' && musicResults.length > 0 && (
        <h2 className="results-heading">Movies &amp; Shows</h2>
      )}

      {!loading && results.length > 0 && (
        <section aria-label="results" className="results">
          {results.map((item) => (
            <MediaCard key={`${item.media_type}-${item.id}`} item={item} onSelect={handleSelect} />
          ))}
        </section>
      )}

      {!loading && musicResults.length > 0 && (
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
                  </span>
                </button>
              );
            })}
          </section>
        </>
      )}

      {!loading && musicError && <p className="search-error">{musicError}</p>}

      {!loading && !error && !musicError && hasResponse && results.length === 0 && musicResults.length === 0 && (
        <p className="search-error">No results found.</p>
      )}

      {!loading && !error && totalPages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            onClick={() => performSearch(submittedQuery, page - 1)}
            disabled={page <= 1}
          >
            ← Previous
          </button>
          <span className="pagination-page">
            Page {page} of {totalPages}
          </span>
          <button
            className="pagination-btn"
            onClick={() => performSearch(submittedQuery, page + 1)}
            disabled={page >= totalPages}
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
