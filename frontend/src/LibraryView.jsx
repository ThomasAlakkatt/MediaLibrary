import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  API_URL,
  MIXED_STATUS_LABELS,
  formatDate,
  getErrorMessage,
  isDateInRange,
  libraryItemToMedia,
  logStatusText,
  parseUsDate,
  statusLabels,
  titleMatchesSearch,
} from './api';
import DateRangeFilter, { DATE_RANGE_ORDER_MESSAGE } from './DateRangeFilter';
import ListSearch from './ListSearch';
import { Clapperboard } from './Loaders';
import MediaCard from './MediaCard';
import Pagination, { usePagination } from './Pagination';
import TitleDetail from './TitleDetail';

const SORT_OPTIONS = [
  { value: 'changed:desc', label: 'Recently changed' },
  { value: 'finished:desc', label: 'Date finished: newest first' },
  { value: 'finished:asc', label: 'Date finished: oldest first' },
  { value: 'release:desc', label: 'Release date: newest first' },
  { value: 'release:asc', label: 'Release date: oldest first' },
  { value: 'status', label: 'Status' },
  { value: 'rating:desc', label: 'Rating: highest first' },
  { value: 'rating:asc', label: 'Rating: lowest first' },
  { value: 'title', label: 'Title: A to Z' },
];

export default function LibraryView() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [mediaType, setMediaType] = useState('');
  const [status, setStatus] = useState('');
  const [sortOption, setSortOption] = useState('changed:desc');
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [dateField, setDateField] = useState('finished');
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  // Errors about a date's format wait until leaving the box, rather than appearing mid-typing.
  const [datesChecked, setDatesChecked] = useState(false);

  const fromDate = parseUsDate(fromText);
  const toDate = parseUsDate(toText);
  const datesReadable = fromDate !== undefined && toDate !== undefined;
  const datesInOrder = !fromDate || !toDate || fromDate <= toDate;
  // A range only applies once it makes sense, so a half-typed or backwards one doesn't empty the list.
  const rangeActive = datesReadable && datesInOrder && Boolean(fromDate || toDate);

  let dateError = null;
  if (!datesInOrder && datesReadable) dateError = DATE_RANGE_ORDER_MESSAGE;
  else if (datesChecked && fromDate === undefined) dateError = 'Enter the start date as mm/dd/yy.';
  else if (datesChecked && toDate === undefined) dateError = 'Enter the end date as mm/dd/yy.';

  function itemDate(item) {
    // Something still in progress counts as finishing today, like in the date sort.
    return dateField === 'finished' ? item.finished_sort_date : item.release_date || item.year;
  }

  const matchingItems = (items ?? []).filter(
    (item) =>
      titleMatchesSearch(query, item) && (!rangeActive || isDateInRange(itemDate(item), fromDate, toDate))
  );
  const pagination = usePagination(matchingItems);

  // Titles logged before release dates were stored may only have a year.
  const fillReleaseDates = dateField === 'release' && rangeActive;

  // Also reloads when coming back from a title's page, since its log may have changed there.
  useEffect(() => {
    if (selected) return undefined;
    let current = true;
    const params = {};
    if (mediaType) params.media_type = mediaType;
    if (status) params.status = status;
    if (fillReleaseDates) params.fill_release_dates = true;
    if (sortOption !== 'changed:desc') {
      const [sort, order] = sortOption.split(':');
      params.sort = sort;
      if (order) params.order = order;
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
  }, [mediaType, status, sortOption, selected, fillReleaseDates]);

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
  // Shows the date that's being sorted or filtered by on each card.
  const showFinishedDate = sortKind === 'finished' || (rangeActive && dateField === 'finished');
  const showReleaseDate = sortKind === 'release' || (rangeActive && dateField === 'release');

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
            <option value="book">Books</option>
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

      <ListSearch
        label="Search your library"
        placeholder="Search your library by title, artist or author"
        value={query}
        onChange={(value) => {
          setQuery(value);
          pagination.resetPage();
        }}
      />

      <DateRangeFilter
        field={dateField}
        onFieldChange={(value) => {
          setDateField(value);
          pagination.resetPage();
        }}
        from={fromText}
        onFromChange={(value) => {
          setFromText(value);
          setDatesChecked(false);
          pagination.resetPage();
        }}
        to={toText}
        onToChange={(value) => {
          setToText(value);
          setDatesChecked(false);
          pagination.resetPage();
        }}
        onBlur={() => setDatesChecked(true)}
        error={dateError}
      />

      {error && <p className="search-error">{error}</p>}
      {items === null && <Clapperboard label="Loading your library…" />}
      {items?.length === 0 && !error && (
        <p className="empty-state-hint page-empty">
          {isFiltered
            ? 'Nothing in your library matches these filters.'
            : 'Nothing logged yet. Search for something, then open it to log it.'}
        </p>
      )}
      {items?.length > 0 && matchingItems.length === 0 && (
        <p className="empty-state-hint page-empty">
          {query.trim()
            ? `Nothing in your library matches “${query.trim()}”${rangeActive ? ' in those dates' : ''}.`
            : 'Nothing in your library falls in those dates.'}
        </p>
      )}
      {matchingItems.length > 0 && (
        <div className="results">
          {pagination.pageItems.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              onSelect={setSelected}
            >
              {showFinishedDate && item.finished_date ? (
                <p className="result-year">
                  {statusLabels(item.media_type).finished} {formatDate(item.finished_date)}
                </p>
              ) : (
                logStatusText(item) && <p className="result-year">{logStatusText(item)}</p>
              )}
              {showReleaseDate && (item.release_date || item.year) && (
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
