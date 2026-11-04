import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL, isMusic, logStatusText, posterUrl } from './api';

export const TYPE_LABELS = { movie: 'Movie', tv: 'Show', album: 'Album', song: 'Song' };

export function LoggedBadge({ log }) {
  const status = logStatusText(log) ?? 'Logged';
  return (
    <p className="logged-badge">
      ✓ {status}
      {log.rating !== null && ` · ★ ${log.rating}`}
    </p>
  );
}

// Everything logged, by media type and ID, for marking search results. Reloads when coming back from a
// title's page, since it may have just been logged. The marks are a nice extra, so failures are ignored.
export function useLoggedTitles(results, openTitle) {
  const [logs, setLogs] = useState({});

  useEffect(() => {
    if (openTitle || results.length === 0) return undefined;
    let current = true;
    axios
      .get(`${API_URL}/library`)
      .then((response) => {
        if (!current) return;
        setLogs(
          Object.fromEntries(response.data.map((log) => [`${log.media_type}-${log.source_id}`, log]))
        );
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [results, openTitle]);

  return logs;
}

export default function MediaCard({ item, onSelect, children }) {
  const music = isMusic(item.media_type);
  const imageClass = music ? 'result-image' : 'result-image result-image--poster';
  return (
    <div
      className="result-card"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(item);
        }
      }}
    >
      {item.poster_path ? (
        <img
          className={imageClass}
          src={posterUrl(item.poster_path)}
          alt={`${item.title} ${music ? 'cover art' : 'poster'}`}
          loading="lazy"
        />
      ) : (
        <div className={`${imageClass} result-image--placeholder`}>No Image</div>
      )}
      <div className="result-info">
        <h2>{item.title}</h2>
        <p className="result-artist">{TYPE_LABELS[item.media_type]}</p>
        {item.artists && <p className="result-year">{item.artists}</p>}
        {item.album_title && <p className="result-year">{item.album_title}</p>}
        {item.year && <p className="result-year">{item.year}</p>}
        {children}
      </div>
    </div>
  );
}
