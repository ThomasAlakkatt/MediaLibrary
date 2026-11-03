import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  API_URL,
  STATUS_LABELS,
  formatRating,
  getErrorMessage,
  libraryItemToMedia,
} from './api';
import { Clapperboard } from './Loaders';
import MediaCard from './MediaCard';
import MediaDetail from './MediaDetail';

export default function LibraryView() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [mediaType, setMediaType] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);

  // Also reloads when coming back from a title's page, since its log may have changed there.
  useEffect(() => {
    if (selected) return undefined;
    let current = true;
    const params = {};
    if (mediaType) params.media_type = mediaType;
    if (status) params.status = status;
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
  }, [mediaType, status, selected]);

  if (selected) {
    return (
      <MediaDetail
        item={libraryItemToMedia(selected)}
        backLabel="← Back to My Library"
        onBack={() => setSelected(null)}
      />
    );
  }

  const isFiltered = Boolean(mediaType || status);

  return (
    <section aria-label="my library" className="page">
      <div className="page-toolbar">
        <h2>My Library</h2>
        <div className="page-filters">
          <select
            aria-label="Filter by type"
            value={mediaType}
            onChange={(event) => setMediaType(event.target.value)}
          >
            <option value="">Movies and shows</option>
            <option value="movie">Movies</option>
            <option value="tv">Shows</option>
          </select>
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Any status</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
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
            : 'Nothing logged yet. Search for a movie or show, then open it to log it.'}
        </p>
      )}
      {items?.length > 0 && (
        <div className="results">
          {items.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              onSelect={setSelected}
            >
              {item.status && <p className="result-year">{STATUS_LABELS[item.status]}</p>}
              {item.rating && <p className="my-rating">★ {formatRating(item.rating)} / 10</p>}
            </MediaCard>
          ))}
        </div>
      )}
    </section>
  );
}
