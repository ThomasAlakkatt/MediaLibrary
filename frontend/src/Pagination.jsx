import { useState } from 'react';

const PAGE_SIZE = 10;

// Splits a list that's already fully loaded into pages. If the list shrinks, such as after removing the
// only title on the last page, this falls back to the new last page.
export function usePagination(items) {
  const [requestedPage, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const startIndex = (page - 1) * PAGE_SIZE;

  function goToPage(newPage) {
    setPage(newPage);
    window.scrollTo?.(0, 0);
  }

  return {
    page,
    totalPages,
    startIndex,
    pageItems: items.slice(startIndex, startIndex + PAGE_SIZE),
    goToPage,
    // For when the list itself changes, like a new filter. This keeps the scroll position where it is.
    resetPage: () => setPage(1),
    // For staying with a title that moved to another page. This also keeps the scroll position.
    showIndex: (index) => setPage(Math.floor(index / PAGE_SIZE) + 1),
  };
}

export default function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pages">
      <button className="pagination-btn" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
        ← Previous
      </button>
      <span className="pagination-page">
        Page {page} of {totalPages}
      </span>
      <button
        className="pagination-btn"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
      >
        Next →
      </button>
    </nav>
  );
}
