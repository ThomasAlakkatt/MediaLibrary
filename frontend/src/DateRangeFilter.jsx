export const DATE_RANGE_ORDER_MESSAGE = 'The start date must be the same as or before the end date.';

// Picks which date to filter by, and the range to keep. Each date is typed as mm/dd/yy.
export default function DateRangeFilter({
  field,
  onFieldChange,
  from,
  onFromChange,
  to,
  onToChange,
  onBlur,
  error,
}) {
  return (
    <fieldset className="date-range">
      <legend>Date range</legend>
      <div className="date-range-fields">
        <select
          aria-label="Date to filter by"
          value={field}
          onChange={(event) => onFieldChange(event.target.value)}
        >
          <option value="finished">Date finished</option>
          <option value="release">Release date</option>
        </select>
        <input
          type="text"
          aria-label="From date"
          aria-invalid={Boolean(error)}
          inputMode="numeric"
          placeholder="mm/dd/yy"
          maxLength="10"
          autoComplete="off"
          value={from}
          onChange={(event) => onFromChange(event.target.value)}
          onBlur={onBlur}
        />
        <span className="date-range-to">to</span>
        <input
          type="text"
          aria-label="To date"
          aria-invalid={Boolean(error)}
          inputMode="numeric"
          placeholder="mm/dd/yy"
          maxLength="10"
          autoComplete="off"
          value={to}
          onChange={(event) => onToChange(event.target.value)}
          onBlur={onBlur}
        />
        {(from || to) && (
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              onFromChange('');
              onToChange('');
            }}
          >
            Clear dates
          </button>
        )}
      </div>
      {error && (
        <p className="movie-status movie-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
