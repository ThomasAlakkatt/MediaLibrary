export const API_URL = 'http://localhost:8000';

// The backend sends failures as HTTP error statuses with a { detail: "message" } body.
export function getErrorMessage(err, fallback) {
  const detail = err.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

export const STATUS_LABELS = {
  want: 'Want to watch',
  in_progress: 'Watching',
  finished: 'Watched',
};

// 0.5, 1, 1.5, ... 10
export const RATING_OPTIONS = Array.from({ length: 20 }, (_, index) => (index + 1) / 2);

export function formatRating(rating) {
  return Number.isInteger(rating) ? `${rating}` : rating.toFixed(1);
}

export function posterUrl(posterPath, size = 'w342') {
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}

// The TMDB details the backend stores alongside a title.
export function titleDetails(media) {
  return {
    title: media.title,
    year: media.year,
    poster_path: media.poster_path,
    overview: media.overview,
  };
}

// Library and shelf rows use tmdb_id, while search results and the detail page use id for the TMDB ID.
export function libraryItemToMedia(item) {
  return {
    id: item.tmdb_id,
    media_type: item.media_type,
    ...titleDetails(item),
  };
}
