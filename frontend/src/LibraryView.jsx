import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  API_URL,
  MIXED_STATUS_LABELS,
  formatDate,
  getErrorMessage,
  libraryItemToMedia,
  logStatusText,
  statusLabels,
} from './api';
import { Clapperboard } from './Loaders';
import MediaCard from './MediaCard';
import Pagination, { usePagination } from './Pagination';
import TitleDetail from './TitleDetail';

const SORT_OPTIONS = [
  { value: 'changed:desc', label: 'Recently changed' },
  { value: 'watched:desc', label: 'Date finished: newest first' },
  { value: 'watched:asc', label: 'Date finished: oldest first' },
  { value: 'release:desc', label: 'Release date: newest first' },
  { value: 'release:asc', label: 'Release date: oldest first' },
];

export default function LibraryView() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [mediaType, setMediaType] = useState('');
  const [status, setStatus] = useState('');
  const [sortOption, setSortOption] = useState('changed:desc');
  const [selected, setSelected] = useState(null);
  const pagination = usePagination(items ?? []);

  // Also reloads when coming back from a title's page, since its log may have changed there.
  useEffect(() => {
    if (selected) return undefined;
    let current = true;
    const params = {};
    if (mediaType) params.media_type = mediaType;
    if (status) params.status = status;
    if (sortOption !== 'changed:desc') {
      [params.sort, params.order] = sortOption.split(':');
    }
    axios
      .get(`${API_URL}/library`, { params })
      .then((response) => {
        if (!current) return;
        setItems(response.data);
        setError(null);
      })
      .catch((err) => {
        if (!current) return;
        setItems([]);
        setError(getErrorMessage(err, 'Something went wrong loading your library.'));
      });
    return () => {
      current = false;
    };
  }, [mediaType, status, sortOption, selected]);

  if (selected) {
    return (
      <TitleDetail
        item={libraryItemToMedia(selected)}
        backLabel="← Back to My Library"
        onBack={() => setSelected(null)}
        onLogSubmitted={() => setSelected(null)}
      />
    );
  }

  const isFiltered = Boolean(mediaType || status);
  const sortKind = sortOption.split(':')[0];

  return (
    <section aria-label="my library" className="page">
      <div className="page-toolbar">
        <h2>My Library</h2>
        <div className="page-filters">
          <select
            aria-label="Sort by"
            value={sortOption}
            onChange={(event) => {
              setSortOption(event.target.value);
              pagination.resetPage();
            }}
          >
            {SORT_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by type"
            value={mediaType}
            onChange={(event) => {
              setMediaType(event.target.value);
              pagination.resetPage();
            }}
          >
            <option value="">All types</option>
            <option value="movie">Movies</option>
            <option value="tv">Shows</option>
            <option value="album">Albums</option>
            <option value="song">Songs</option>
          </select>
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              pagination.resetPage();
            }}
          >
            <option value="">Any status</option>
            {Object.entries(MIXED_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="search-error">{error}</p>}
      {items === null && <Clapperboard label="Loading your library…" />}
      {items?.length === 0 && !error && (
        <p className="empty-state-hint page-empty">
          {isFiltered
            ? 'Nothing in your library matches these filters.'
            : 'Nothing logged yet. Search for something, then open it to log it.'}
        </p>
      )}
      {items?.length > 0 && (
        <div className="results">
          {pagination.pageItems.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              onSelect={setSelected}
            >
              {sortKind === 'watched' && item.watched_date ? (
                <p className="result-year">
                  {statusLabels(item.media_type).finished} {formatDate(item.watched_date)}
                </p>
              ) : (
                logStatusText(item) && <p className="result-year">{logStatusText(item)}</p>
              )}
              {sortKind === 'release' && (item.release_date || item.year) && (
                <p className="result-year">Released {formatDate(item.release_date || item.year)}</p>
              )}
              {item.rating !== null && <p className="my-rating">★ {item.rating} / 10</p>}
            </MediaCard>
          ))}
        </div>
      )}
      <Pagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        onPageChange={pagination.goToPage}
      />
    </section>
  );
}
