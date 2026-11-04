export const API_URL = 'http://localhost:8000';

// The backend sends failures as HTTP error statuses with a { detail: "message" } body.
export function getErrorMessage(err, fallback) {
  const detail = err.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

const WATCH_LABELS = { want: 'Want to watch', in_progress: 'Watching', finished: 'Watched' };

// The words for a status depend on what kind of title it is.
const STATUS_LABELS_BY_TYPE = {
  movie: WATCH_LABELS,
  tv: WATCH_LABELS,
  book: { want: 'Want to read', in_progress: 'Reading', finished: 'Read' },
  music: { want: 'Want to listen', in_progress: 'Listening', finished: 'Listened' },
};

export function statusLabels(mediaType) {
  return STATUS_LABELS_BY_TYPE[mediaType];
}

// What to say about a title's status. A show logged only by season goes by its seasons, and this returns
// nothing if there's no status to report.
export function logStatusText(log) {
  const labels = statusLabels(log.media_type);
  if (log.status) return labels[log.status];

  const counts = log.season_counts;
  if (!counts) return null;
  if (counts.in_progress > 0) return labels.in_progress;
  if (counts.finished > 0) {
    return `${labels.finished} ${counts.finished} ${counts.finished === 1 ? 'season' : 'seasons'}`;
  }
  return counts.want > 0 ? labels.want : null;
}

// For places that cover every kind of title at once, like the My Library filter.
export const MIXED_STATUS_LABELS = {
  want: 'Planned',
  in_progress: 'In progress',
  finished: 'Finished',
};

export const INVALID_RATING_MESSAGE =
  'Rating must be a number between 0 and 10, with at most 2 decimal places.';

// Turns what was typed into a rating. Blank means no rating, and undefined means it isn't valid.
export function parseRating(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Extra zeros don't change the number, so 7.500 is fine but 7.501 isn't.
  if (!/^(\d+(\.\d{0,2}0*)?|\.\d{1,2}0*)$/.test(trimmed)) return undefined;
  const rating = Number(trimmed);
  return rating >= 0 && rating <= 10 ? rating : undefined;
}

// Today's date on the viewer's own calendar. toISOString() would give the UTC date, which is already
// tomorrow during the evening in the US.
export function todayString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function ratingText(rating) {
  return rating === null || rating === undefined ? '' : String(rating);
}

// Shows 2026-11-03 as "Nov 3, 2026", or leaves a year alone. Built from its parts because new Date()
// would read it as UTC, which is the previous day in the US.
export function formatDate(text) {
  const [year, month, day] = text.split('-').map(Number);
  if (!month || !day) return text;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function posterUrl(posterPath, size = 'w342') {
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}

// The TMDB details the backend stores alongside a title.
export function titleDetails(media) {
  return {
    title: media.title,
    year: media.year,
    release_date: media.release_date,
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
