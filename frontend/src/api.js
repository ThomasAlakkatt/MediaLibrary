export const API_URL = 'http://localhost:8000';

// The backend sends failures as HTTP error statuses with a { detail: "message" } body.
export function getErrorMessage(err, fallback) {
  const detail = err.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}
