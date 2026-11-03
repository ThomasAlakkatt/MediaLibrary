import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_URL, getErrorMessage } from './api';
import { Clapperboard } from './Loaders';

const TYPE_LABELS = { movie: 'Movie', tv: 'Show' };
const SEARCH_LABELS = { all: 'movies and shows', movie: 'movies', tv: 'shows' };

function posterUrl(posterPath, size) {
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}

function pluralize(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function ShowSeasons({ entry, loading }) {
  if (loading) return <Clapperboard label="Loading seasons…" />;
  if (entry?.error) return <p className="movie-status movie-error">{entry.error}</p>;
  if (!entry?.show) return null;

  const { show } = entry;
  return (
    <>
      <p className="media-detail-facts">
        {[show.status, pluralize(show.number_of_seasons, 'season'), pluralize(show.number_of_episodes, 'episode')]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {show.genres.length > 0 && <p className="movie-genres">{show.genres.join(', ')}</p>}
      <h3>Seasons</h3>
      {show.seasons.length === 0 ? (
        <p className="movie-status">No season information yet.</p>
      ) : (
        <ul className="season-list">
          {show.seasons.map((season) => (
            <li className="season-row" key={season.season_number}>
              <span className="season-name">{season.name}</span>
              <span className="season-meta">
                {[pluralize(season.episode_count, 'episode'), season.year].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function MediaDetail({ item, showEntry, showLoading, onBack }) {
  const tmdbUrl = `https://www.themoviedb.org/${item.media_type}/${item.id}`;
  return (
    <section aria-label="title detail" className="detail-view">
      <button className="back-btn" onClick={onBack}>
        ← Back to results
      </button>

      <div className="detail-layout">
        <div className="detail-release">
          {item.poster_path ? (
            <img
              className="detail-release-image result-image--poster"
              src={posterUrl(item.poster_path, 'w342')}
              alt={`${item.title} poster`}
            />
          ) : (
            <div className="detail-release-image detail-release-image--placeholder result-image--poster">
              No Image
            </div>
          )}
          <h2>{item.title}</h2>
          <p className="detail-release-artist">{TYPE_LABELS[item.media_type]}</p>
          <div className="movie-meta">
            {item.vote_count > 0 && <span className="movie-rating">★ {item.rating.toFixed(1)}</span>}
            {item.year && <span className="movie-release-date">{item.year}</span>}
          </div>
          <a className="movie-trailer-link" href={tmdbUrl} target="_blank" rel="noopener noreferrer">
            View on TMDB
          </a>
        </div>

        <div className="detail-movies">
          <h3>Overview</h3>
          <p className="media-detail-overview">{item.overview || 'No overview available.'}</p>
          {item.media_type === 'tv' && <ShowSeasons entry={showEntry} loading={showLoading} />}
        </div>
      </div>
    </section>
  );
}

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
  const [showCache, setShowCache] = useState({});
  const [showLoadingId, setShowLoadingId] = useState(null);

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

  async function handleSelect(item) {
    setSelected(item);
    window.scrollTo?.(0, 0);

    // Only successful lookups count as cached, so reopening a show after a failure tries again.
    if (item.media_type !== 'tv' || showCache[item.id]?.show) return;

    setShowCache((prev) => ({ ...prev, [item.id]: undefined }));
    setShowLoadingId(item.id);
    try {
      const response = await axios.get(`${API_URL}/shows/${item.id}`);
      setShowCache((prev) => ({ ...prev, [item.id]: { show: response.data } }));
    } catch (err) {
      setShowCache((prev) => ({
        ...prev,
        [item.id]: { error: getErrorMessage(err, 'Something went wrong loading this show.') },
      }));
    } finally {
      setShowLoadingId((current) => (current === item.id ? null : current));
    }
  }

  if (selected) {
    return (
      <MediaDetail
        item={selected}
        showEntry={showCache[selected.id]}
        showLoading={showLoadingId === selected.id}
        onBack={() => setSelected(null)}
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
            <div
              className="result-card"
              key={`${item.media_type}-${item.id}`}
              role="button"
              tabIndex={0}
              onClick={() => handleSelect(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleSelect(item);
                }
              }}
            >
              {item.poster_path ? (
                <img
                  className="result-image result-image--poster"
                  src={posterUrl(item.poster_path, 'w342')}
                  alt={`${item.title} poster`}
                  loading="lazy"
                />
              ) : (
                <div className="result-image result-image--poster result-image--placeholder">No Image</div>
              )}
              <div className="result-info">
                <h2>{item.title}</h2>
                <p className="result-artist">{TYPE_LABELS[item.media_type]}</p>
                {item.year && <p className="result-year">{item.year}</p>}
              </div>
            </div>
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
