import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_URL, getErrorMessage } from './api';
import { Clapperboard } from './Loaders';
import MediaCard from './MediaCard';
import MediaDetail from './MediaDetail';

const SEARCH_LABELS = { all: 'movies and shows', movie: 'movies', tv: 'shows' };

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
export default function MediaSearch({ type }) {
  const [initialQuery] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
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

    try {
      const response = await axios.get(`${API_URL}/search/media`, {
        params: { query: searchQuery, type, page: searchPage },
      });
      if (requestId !== latestRequest.current) return;
      setResults(response.data.results);
      setPage(response.data.page);
      setTotalPages(response.data.total_pages);
      setHasResponse(true);
      updateShareableUrl(searchQuery, type);
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      setError(getErrorMessage(err, 'Something went wrong while searching. Please try again.'));
      setResults([]);
      setTotalPages(0);
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
    return <MediaDetail item={selected} onBack={() => setSelected(null)} />;
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
            Try searching for a movie like <strong>Dune</strong>, or a show like{' '}
            <strong>Breaking Bad</strong>.
          </p>
        </section>
      )}

      {error && <p className="search-error">{error}</p>}

      {loading && <Clapperboard label="Searching…" />}

      {!loading && results.length > 0 && (
        <section aria-label="results" className="results">
          {results.map((item) => (
            <MediaCard key={`${item.media_type}-${item.id}`} item={item} onSelect={handleSelect} />
          ))}
        </section>
      )}

      {!loading && !error && hasResponse && results.length === 0 && (
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
