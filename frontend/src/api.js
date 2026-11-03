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

export const INVALID_RATING_MESSAGE = 'Rating must be a number between 0 and 10.';

// Turns what was typed into a rating. Blank means no rating, and undefined means it isn't valid.
export function parseRating(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(trimmed)) return undefined;
  const rating = Number(trimmed);
  return rating >= 0 && rating <= 10 ? rating : undefined;
}

export function ratingText(rating) {
  return rating === null || rating === undefined ? '' : String(rating);
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
