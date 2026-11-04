import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import AlbumDetail from './AlbumDetail';
import { API_URL, getErrorMessage, releaseToMedia } from './api';
import { SpinningRecord } from './Loaders';
import { LoggedBadge, useLoggedTitles } from './MediaCard';

// initialRelease opens straight to that release, for one picked from the All search. onBack then
// returns to that search, since there are no music results here to go back to.
export default function MusicSearch({ initialRelease, onBack, onLogSubmitted }) {
  const [artistName, setArtistName] = useState('');
  const [releaseTitle, setReleaseTitle] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [placeholdersHidden, setPlaceholdersHidden] = useState(false);
  const [page, setPage] = useState(1);
  const [hasSearched, setHasSearched] = useState(false);

  const [selectedRelease, setSelectedRelease] = useState(initialRelease ?? null);

  const [artistSuggestions, setArtistSuggestions] = useState([]);
  const [releaseSuggestions, setReleaseSuggestions] = useState([]);
  const [showArtistSuggestions, setShowArtistSuggestions] = useState(false);
  const [showReleaseSuggestions, setShowReleaseSuggestions] = useState(false);
  const artistDebounceRef = useRef(null);
  const releaseDebounceRef = useRef(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const isMounted = useRef(true);

  function handleClearSearch() {
    setArtistName('');
    setReleaseTitle('');
    setResults([]);
    setError(null);
    setPage(1);
    setHasSearched(false);
    setPlaceholdersHidden(false);
    setArtistSuggestions([]);
    setReleaseSuggestions([]);
    setShowArtistSuggestions(false);
    setShowReleaseSuggestions(false);
    window.history.replaceState(null, '', window.location.pathname);
  }

  // A search still running when this page closes must not rewrite the URL of the page that replaced it.
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  function updateShareableUrl(searchArtist, searchRelease) {
    if (!isMounted.current) return;
    const params = new URLSearchParams();
    if (searchArtist.trim()) params.set('artist', searchArtist.trim());
    if (searchRelease.trim()) params.set('release', searchRelease.trim());
    const queryString = params.toString();
    const newUrl = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  }

  async function performSearch(searchPage, searchArtist = artistName, searchRelease = releaseTitle) {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.get(`${API_URL}/search`, {
        params: { artist: searchArtist, title: searchRelease, page: searchPage },
      });

      setResults(response.data);
      setPage(searchPage);
      updateShareableUrl(searchArtist, searchRelease);
    } catch (err) {
      setError(getErrorMessage(err, 'Something went wrong while searching. Please try again.'));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlArtist = params.get('artist') || '';
    const urlRelease = params.get('release') || '';

    if (urlArtist || urlRelease) {
      setArtistName(urlArtist);
      setReleaseTitle(urlRelease);
      setPlaceholdersHidden(true);
      setHasSearched(true);
      performSearch(1, urlArtist, urlRelease);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  async function fetchSuggestions(field, value) {
    if (!value.trim()) {
      if (field === 'artist') setArtistSuggestions([]);
      else setReleaseSuggestions([]);
      return;
    }

    try {
      const params =
        field === 'artist' ? { artist: value, title: '' } : { artist: '', title: value };
      const response = await axios.get(`${API_URL}/search`, { params });

      const values =
        field === 'artist'
          ? response.data.flatMap((release) => release.artists)
          : response.data.map((release) => release.title);
      const unique = [...new Set(values)].slice(0, 6);

      if (field === 'artist') setArtistSuggestions(unique);
      else setReleaseSuggestions(unique);
    } catch {
      // Suggestions are a nice-to-have; silently ignore failures here.
      if (field === 'artist') setArtistSuggestions([]);
      else setReleaseSuggestions([]);
    }
  }

  function handleArtistChange(event) {
    const value = event.target.value;
    setArtistName(value);
    setShowArtistSuggestions(true);
    clearTimeout(artistDebounceRef.current);
    artistDebounceRef.current = setTimeout(() => fetchSuggestions('artist', value), 400);
  }

  function handleReleaseChange(event) {
    const value = event.target.value;
    setReleaseTitle(value);
    setShowReleaseSuggestions(true);
    clearTimeout(releaseDebounceRef.current);
    releaseDebounceRef.current = setTimeout(() => fetchSuggestions('release', value), 400);
  }

  function selectArtistSuggestion(value) {
    setArtistName(value);
    setShowArtistSuggestions(false);
  }

  function selectReleaseSuggestion(value) {
    setReleaseTitle(value);
    setShowReleaseSuggestions(false);
  }

  async function handleSearch(event) {
    event.preventDefault();

    if (!artistName.trim() && !releaseTitle.trim()) {
      setError('Please enter an artist and/or a release title.');
      setResults([]);
      return;
    }

    setHasSearched(true);
    await performSearch(1);
  }

  async function handleNextPage() {
    await performSearch(page + 1);
  }

  async function handlePrevPage() {
    if (page <= 1) return;
    await performSearch(page - 1);
  }

  function handleReleaseClick(release) {
    setSelectedRelease(release);
  }

  function handleBackToResults() {
    if (onBack) onBack();
    else setSelectedRelease(null);
  }

  const logs = useLoggedTitles(results, selectedRelease);

  return (
    <>
      {!selectedRelease && (
        <>
          <section aria-label="search" className="search-card">
            <form onSubmit={handleSearch}>
              <div className="input-row">
                <div className="input-group">
                  <label htmlFor="artist-name">Artist</label>
                  <input
                    type="search"
                    id="artist-name"
                    name="artist-name"
                    autoComplete="off"
                    maxLength="100"
                    placeholder={placeholdersHidden ? '' : 'Taylor Swift'}
                    value={artistName}
                    onFocus={() => {
                      setPlaceholdersHidden(true);
                      setShowArtistSuggestions(true);
                    }}
                    onBlur={() => setTimeout(() => setShowArtistSuggestions(false), 150)}
                    onChange={handleArtistChange}
                  />
                  {showArtistSuggestions && artistSuggestions.length > 0 && (
                    <ul className="suggestions-dropdown">
                      {artistSuggestions.map((suggestion) => (
                        <li key={suggestion} onMouseDown={() => selectArtistSuggestion(suggestion)}>
                          {suggestion}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="input-group">
                  <label htmlFor="artist-release">Release</label>
                  <input
                    type="search"
                    id="artist-release"
                    name="artist-release"
                    autoComplete="off"
                    maxLength="100"
                    placeholder={placeholdersHidden ? '' : '22'}
                    value={releaseTitle}
                    onFocus={() => {
                      setPlaceholdersHidden(true);
                      setShowReleaseSuggestions(true);
                    }}
                    onBlur={() => setTimeout(() => setShowReleaseSuggestions(false), 150)}
                    onChange={handleReleaseChange}
                  />
                  {showReleaseSuggestions && releaseSuggestions.length > 0 && (
                    <ul className="suggestions-dropdown">
                      {releaseSuggestions.map((suggestion) => (
                        <li key={suggestion} onMouseDown={() => selectReleaseSuggestion(suggestion)}>
                          {suggestion}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="search-actions">
                <button id="search-btn" type="submit" disabled={loading}>
                  {loading ? 'Searching…' : 'Search'}
                </button>
                {(hasSearched || artistName || releaseTitle) && (
                  <button
                    type="button"
                    className="clear-btn"
                    onClick={handleClearSearch}
                    disabled={loading}
                  >
                    Clear Search
                  </button>
                )}
              </div>
            </form>
          </section>

          {!hasSearched && (
            <section className="empty-state" aria-label="getting started">
              <p className="empty-state-hint">
                Try searching an artist like <strong>Radiohead</strong>, or a release like{' '}
                <strong>Discovery</strong>.
              </p>
            </section>
          )}

          {error && <p className="search-error">{error}</p>}

          {loading && <SpinningRecord label="Searching…" />}

          {!loading && results.length > 0 && (
            <div className="copy-link-row">
              <button type="button" className="copy-link-btn" onClick={handleCopyLink}>
                {linkCopied ? 'Copied!' : '🔗 Copy Link to This Search'}
              </button>
            </div>
          )}

          {!loading && results.length > 0 && (
            <section aria-label="results" className="results">
              {results.map((release) => {
                const image = release.cover_image || release.thumb;
                return (
                  <div
                    className="result-card"
                    key={release.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleReleaseClick(release)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleReleaseClick(release);
                      }
                    }}
                  >
                    {image ? (
                      <img
                        className="result-image"
                        src={image}
                        alt={`${release.title} cover art`}
                        loading="lazy"
                      />
                    ) : (
                      <div className="result-image result-image--placeholder">No Image</div>
                    )}
                    <div className="result-info">
                      <h2>{release.title}</h2>
                      <p className="result-artist">{release.artists.join(', ')}</p>
                      <p className="result-year">{release.year}</p>
                      {logs[`album-${release.id}`] && <LoggedBadge log={logs[`album-${release.id}`]} />}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {hasSearched && !loading && !error && (
            <div className="pagination">
              <button
                className="pagination-btn"
                onClick={handlePrevPage}
                disabled={page <= 1}
              >
                ← Previous
              </button>
              <span className="pagination-page">Page {page}</span>
              <button
                className="pagination-btn"
                onClick={handleNextPage}
                disabled={results.length < 10}
              >
                Next →
              </button>
            </div>
          )}

          {hasSearched && !loading && !error && results.length === 0 && (
            <p className="search-error">{page > 1 ? 'No more results.' : 'No results found.'}</p>
          )}
        </>
      )}

      {selectedRelease && (
        <AlbumDetail
          item={releaseToMedia(selectedRelease)}
          onBack={handleBackToResults}
          onLogSubmitted={onLogSubmitted}
        />
      )}
    </>
  );
}
