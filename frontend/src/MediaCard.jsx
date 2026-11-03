import { posterUrl } from './api';

export const TYPE_LABELS = { movie: 'Movie', tv: 'Show' };

export default function MediaCard({ item, onSelect, children }) {
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
          className="result-image result-image--poster"
          src={posterUrl(item.poster_path)}
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
        {children}
      </div>
    </div>
  );
}
