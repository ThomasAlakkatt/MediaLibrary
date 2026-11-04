import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  API_URL,
  INVALID_RATING_MESSAGE,
  externalLink,
  isMusic,
  logUrl,
  statusLabels,
  getErrorMessage,
  parseRating,
  posterUrl,
  ratingText,
  titleDetails,
  todayString,
} from './api';
import { Clapperboard } from './Loaders';
import { TYPE_LABELS } from './MediaCard';

function pluralize(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function StatusSelect({ id, label, mediaType, value, onChange, disabled }) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">No status</option>
      {Object.entries(statusLabels(mediaType)).map(([status, text]) => (
        <option key={status} value={status}>
          {text}
        </option>
      ))}
    </select>
  );
}

function RatingInput({ id, value, onChange }) {
  return (
    <span className="rating-input">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        placeholder="0–10"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="rating-input-suffix">/ 10</span>
    </span>
  );
}

// A new entry starts with today's date. A title only on a shelf, or with only season logs, is still new.
function isNewEntry(log) {
  return !log || !(log.status || log.rating !== null || log.review || log.finished_on);
}

function newDraft() {
  return { status: null, rating: '', review: '', finished_on: todayString() };
}

function draftFromLog(log) {
  if (isNewEntry(log)) return newDraft();
  return {
    status: log.status,
    rating: ratingText(log.rating),
    review: log.review ?? '',
    finished_on: log.finished_on ?? '',
  };
}

// saveLog and clearLog replace the usual requests, for logs that aren't saved to the title itself.
// blockedMessage explains why saving isn't possible yet.
export function LogForm({ item, log, onSaved, onLogSubmitted, saveLog, clearLog, blockedMessage }) {
  const [draft, setDraft] = useState(() => draftFromLog(log));
  // True while the date is still the automatic one, rather than one that was saved or picked.
  const [dateIsDefault, setDateIsDefault] = useState(() => isNewEntry(log));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const isLogged = Boolean(
    log &&
      (log.status ||
        log.rating !== null ||
        log.review ||
        log.finished_on ||
        log.seasons?.length > 0)
  );

  function updateDraft(changes) {
    setDraft((prev) => ({ ...prev, ...changes }));
    setMessage(null);
  }

  function handleStatusChange(status) {
    if (!dateIsDefault) {
      updateDraft({ status });
      return;
    }
    // Something still being watched or waiting to be watched hasn't been finished today.
    const notFinished = status === 'want' || status === 'in_progress';
    updateDraft({ status, finished_on: notFinished ? '' : todayString() });
  }

  async function handleSave(event) {
    event.preventDefault();
    if (blockedMessage) {
      setError(blockedMessage);
      return;
    }

    const rating = parseRating(draft.rating);
    if (rating === undefined) {
      setError(INVALID_RATING_MESSAGE);
      return;
    }

    // The automatic date alone isn't a reason to add a title to the library.
    if (dateIsDefault && !draft.status && rating === null && !draft.review.trim()) {
      setError('Add a status, rating or review before saving.');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const logFields = {
        status: draft.status,
        rating,
        review: draft.review,
        finished_on: draft.finished_on || null,
      };
      const response = saveLog
        ? await saveLog(logFields)
        : await axios.put(logUrl(item), { ...titleDetails(item), ...logFields });
      onSaved(response.data);
      onLogSubmitted();
    } catch (err) {
      setError(getErrorMessage(err, 'Something went wrong saving your log. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = clearLog ? await clearLog() : await axios.delete(logUrl(item));
      onSaved(response.data);
      setDraft(newDraft());
      setDateIsDefault(true);
      setConfirmingClear(false);
      setMessage('Log cleared');
    } catch (err) {
      setError(getErrorMessage(err, 'Something went wrong clearing your log. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="log-form" onSubmit={handleSave}>
      <div className="log-fields">
        <div className="log-field">
          <label htmlFor="log-status">Status</label>
          <StatusSelect
            id="log-status"
            mediaType={item.media_type}
            value={draft.status}
            onChange={handleStatusChange}
          />
        </div>
        <div className="log-field">
          <label htmlFor="log-rating">My rating</label>
          <RatingInput
            id="log-rating"
            value={draft.rating}
            onChange={(rating) => updateDraft({ rating })}
          />
        </div>
        <div className="log-field">
          <label htmlFor="log-finished">Date finished</label>
          <input
            id="log-finished"
            type="date"
            value={draft.finished_on}
            onChange={(event) => {
              setDateIsDefault(false);
              updateDraft({ finished_on: event.target.value });
            }}
          />
        </div>
      </div>
      <div className="log-field">
        <label htmlFor="log-review">Review</label>
        <textarea
          id="log-review"
          rows="4"
          value={draft.review}
          onChange={(event) => updateDraft({ review: event.target.value })}
        />
      </div>
      {error && <p className="movie-status movie-error">{error}</p>}
      <div className="log-actions">
        <button className="primary-btn" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {isLogged && !confirmingClear && (
          <button
            type="button"
            className="secondary-btn"
            disabled={saving}
            onClick={() => setConfirmingClear(true)}
          >
            Clear log
          </button>
        )}
        {confirmingClear && (
          <>
            <span className="confirm-text">Clear this log{item.media_type === 'tv' ? ' and its season logs' : ''}?</span>
            <button type="button" className="danger-btn" disabled={saving} onClick={handleClear}>
              Yes, clear
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={saving}
              onClick={() => setConfirmingClear(false)}
            >
              Cancel
            </button>
          </>
        )}
        {message && <span className="save-message">{message}</span>}
      </div>
    </form>
  );
}

function SeasonRow({ item, season, seasonLog, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const name = season.name;

  async function save(changes) {
    const next = {
      status: seasonLog?.status ?? null,
      finished_on: seasonLog?.finished_on ?? null,
      ...changes,
    };
    // A date finished only applies to a finished season.
    if (next.status !== 'finished') next.finished_on = null;
    // Marking a season as watched fills in today, which can then be changed.
    else if (changes.status && !next.finished_on) next.finished_on = todayString();

    setSaving(true);
    setError(null);
    try {
      const response = await axios.put(
        `${API_URL}/library/tv/${item.id}/seasons/${season.season_number}`,
        { ...titleDetails(item), ...next }
      );
      onSaved(response.data);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save this season. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="season-row">
      <div className="season-heading">
        <span className="season-name">{name}</span>
        <span className="season-meta">
          {[pluralize(season.episode_count, 'episode'), season.year].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div className="season-controls">
        <StatusSelect
          label={`${name} status`}
          mediaType={item.media_type}
          value={seasonLog?.status}
          disabled={saving}
          onChange={(status) => save({ status })}
        />
        {seasonLog?.status === 'finished' && (
          <input
            type="date"
            aria-label={`${name} date finished`}
            value={seasonLog.finished_on ?? ''}
            disabled={saving}
            onChange={(event) => save({ finished_on: event.target.value || null })}
          />
        )}
      </div>
      {error && <p className="movie-status movie-error">{error}</p>}
    </li>
  );
}

function ShowSeasons({ item, log, onLogChanged }) {
  const [entry, setEntry] = useState(null);

  useEffect(() => {
    let current = true;
    axios
      .get(`${API_URL}/shows/${item.id}`)
      .then((response) => current && setEntry({ show: response.data }))
      .catch((err) => {
        if (current) {
          setEntry({ error: getErrorMessage(err, 'Something went wrong loading this show.') });
        }
      });
    return () => {
      current = false;
    };
  }, [item.id]);

  if (!entry) return <Clapperboard label="Loading seasons…" />;
  if (entry.error) return <p className="movie-status movie-error">{entry.error}</p>;

  const { show } = entry;
  return (
    <section aria-label="seasons">
      <p className="media-detail-facts">
        {[show.status, pluralize(show.number_of_seasons, 'season'), pluralize(show.number_of_episodes, 'episode')]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {show.genres.length > 0 && <p className="movie-genres">{show.genres.join(', ')}</p>}
      <h3>Seasons</h3>
      {show.seasons.length === 0 ? (
        <p className="movie-status">No season information yet.</p>
      ) : (
        <ul className="season-list">
          {show.seasons.map((season) => (
            <SeasonRow
              key={season.season_number}
              item={item}
              season={season}
              seasonLog={log?.seasons?.find((s) => s.season_number === season.season_number)}
              onSaved={onLogChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// With more shelves than this, a title page shows a search box instead of listing them all.
const MAX_LISTED_SHELVES = 4;

function ShelfSearch({ shelves, shelfIds, busy, onAdd, onRemove, onCreate }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const typed = query.trim();
  const lowerTyped = typed.toLowerCase();
  const onShelves = shelves.filter((shelf) => shelfIds.includes(shelf.id));
  const matches = shelves.filter(
    (shelf) => !shelfIds.includes(shelf.id) && shelf.name.toLowerCase().includes(lowerTyped)
  );
  const exactMatch = shelves.find((shelf) => shelf.name.toLowerCase() === lowerTyped);

  const options = matches.map((shelf) => ({
    id: `shelf-option-${shelf.id}`,
    label: shelf.name,
    pick: () => onAdd(shelf),
  }));
  if (typed && !exactMatch) {
    options.push({
      id: 'shelf-option-create',
      label: `+ Create "${typed}"`,
      pick: () => onCreate(typed),
    });
  }

  const activeOption = options[activeIndex];

  // Keeps the highlighted option visible when moving through a long list with the keyboard.
  useEffect(() => {
    if (activeOption) document.getElementById(activeOption.id)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOption?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateQuery(value) {
    setQuery(value);
    setOpen(true);
    setActiveIndex(value.trim() ? 0 : -1);
  }

  async function pick(option) {
    if (busy) return;
    const succeeded = await option.pick();
    if (succeeded) updateQuery('');
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (Math.max(index, step === 1 ? -1 : 0) + step + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption) pick(activeOption);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  let note = null;
  if (options.length === 0) {
    if (exactMatch) note = `Already on ${exactMatch.name}`;
    else if (!typed) note = 'This title is on all your shelves';
  }

  return (
    <>
      {onShelves.length > 0 && (
        <ul className="shelf-options">
          {onShelves.map((shelf) => (
            <li key={shelf.id} className="shelf-chip">
              ✓ {shelf.name}
              <button
                type="button"
                className="shelf-chip-remove"
                aria-label={`Remove from ${shelf.name}`}
                disabled={busy}
                onClick={() => onRemove(shelf)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="shelf-search">
        <input
          type="text"
          role="combobox"
          aria-label="Search or create a shelf"
          aria-expanded={open}
          aria-controls="shelf-search-options"
          aria-autocomplete="list"
          aria-activedescendant={open ? activeOption?.id : undefined}
          placeholder="Search or create a shelf..."
          maxLength="100"
          autoComplete="off"
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
        />
        {open && (options.length > 0 || note) && (
          <ul id="shelf-search-options" role="listbox" className="suggestions-dropdown">
            {options.map((option, index) => (
              <li
                key={option.id}
                id={option.id}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? 'shelf-option--active' : undefined}
                // Stops the box losing focus, which would close this list before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option)}
              >
                {option.label}
              </li>
            ))}
            {note && <li className="shelf-search-note">{note}</li>}
          </ul>
        )}
      </div>
    </>
  );
}

export function ShelfPicker({ item, log, onLogChanged }) {
  const [shelves, setShelves] = useState(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let current = true;
    axios
      .get(`${API_URL}/shelves`)
      .then((response) => current && setShelves(response.data))
      .catch((err) => {
        if (current) {
          setShelves([]);
          setError(getErrorMessage(err, 'Something went wrong loading your shelves.'));
        }
      });
    return () => {
      current = false;
    };
  }, []);

  const shelfIds = log?.shelf_ids ?? [];

  async function refreshLog() {
    try {
      const response = await axios.get(logUrl(item));
      onLogChanged(response.data);
    } catch (err) {
      if (err.response?.status !== 404) throw err;
      onLogChanged(null);
    }
  }

  function addRequest(shelfId) {
    return axios.post(`${API_URL}/shelves/${shelfId}/items`, {
      media_type: item.media_type,
      source_id: item.id,
      track_index: item.track_index,
      ...titleDetails(item),
    });
  }

  async function run(action, fallback) {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(getErrorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function handleToggle(shelf, checked) {
    return run(async () => {
      if (checked) await addRequest(shelf.id);
      else await axios.delete(`${API_URL}/shelves/${shelf.id}/items/${log.id}`);
      await refreshLog();
    }, 'Something went wrong updating that shelf. Please try again.');
  }

  function createAndAdd(name) {
    return run(async () => {
      const response = await axios.post(`${API_URL}/shelves`, { name });
      setShelves((prev) =>
        [...prev, response.data].sort((a, b) => a.name.localeCompare(b.name))
      );
      await addRequest(response.data.id);
      await refreshLog();
    }, 'Something went wrong creating that shelf. Please try again.');
  }

  async function handleCreate(event) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (await createAndAdd(name)) setNewName('');
  }

  const useSearch = shelves?.length > MAX_LISTED_SHELVES;

  return (
    <section aria-label="shelves" className="shelf-picker">
      <h3>Shelves</h3>
      {shelves === null && <p className="movie-status">Loading shelves…</p>}
      {shelves?.length === 0 && !error && <p className="movie-status">You don't have any shelves yet.</p>}
      {useSearch && (
        <ShelfSearch
          shelves={shelves}
          shelfIds={shelfIds}
          busy={busy}
          onAdd={(shelf) => handleToggle(shelf, true)}
          onRemove={(shelf) => handleToggle(shelf, false)}
          onCreate={createAndAdd}
        />
      )}
      {shelves?.length > 0 && !useSearch && (
        <ul className="shelf-options">
          {shelves.map((shelf) => (
            <li key={shelf.id}>
              <label>
                <input
                  type="checkbox"
                  checked={shelfIds.includes(shelf.id)}
                  disabled={busy}
                  onChange={(event) => handleToggle(shelf, event.target.checked)}
                />
                {shelf.name}
              </label>
            </li>
          ))}
        </ul>
      )}
      {!useSearch && (
        <form className="inline-form" onSubmit={handleCreate}>
          <input
            type="text"
            aria-label="New shelf name"
            placeholder="New shelf name"
            maxLength="100"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <button className="secondary-btn" type="submit" disabled={busy || !newName.trim()}>
            Create and add
          </button>
        </form>
      )}
      {error && <p className="movie-status movie-error">{error}</p>}
    </section>
  );
}

export default function MediaDetail({
  item,
  onBack,
  onLogSubmitted,
  backLabel = '← Back to results',
}) {
  const [log, setLog] = useState(null);
  const [logState, setLogState] = useState('loading');
  const [logError, setLogError] = useState(null);

  useEffect(() => {
    let current = true;
    axios
      .get(logUrl(item))
      .then((response) => {
        if (!current) return;
        setLog(response.data);
        setLogState('ready');
      })
      .catch((err) => {
        if (!current) return;
        if (err.response?.status === 404) {
          setLog(null);
          setLogState('ready');
        } else {
          setLogError(getErrorMessage(err, 'Something went wrong loading your log.'));
          setLogState('error');
        }
      });
    return () => {
      current = false;
    };
  }, [item.media_type, item.id, item.track_index]); // eslint-disable-line react-hooks/exhaustive-deps

  const music = isMusic(item.media_type);
  const imageClass = music ? 'detail-release-image' : 'detail-release-image result-image--poster';
  const link = externalLink(item);
  return (
    <section aria-label="title detail" className="detail-view">
      <button className="back-btn" onClick={onBack}>
        {backLabel}
      </button>

      <div className="detail-layout">
        <div className="detail-release">
          {item.poster_path ? (
            <img
              className={imageClass}
              src={posterUrl(item.poster_path)}
              alt={`${item.title} ${music ? 'cover art' : 'poster'}`}
            />
          ) : (
            <div className={`${imageClass} detail-release-image--placeholder`}>No Image</div>
          )}
          <h2>{item.title}</h2>
          <p className="detail-release-artist">{item.artists || TYPE_LABELS[item.media_type]}</p>
          {item.album_title && <p className="detail-release-year">{item.album_title}</p>}
          <div className="movie-meta">
            {item.vote_count > 0 && (
              <span className="movie-rating" title="TMDB rating">
                ★ {item.rating.toFixed(1)}
              </span>
            )}
            {item.year && <span className="movie-release-date">{item.year}</span>}
          </div>
          <a className="movie-trailer-link" href={link.url} target="_blank" rel="noopener noreferrer">
            {link.label}
          </a>
        </div>

        <div className="detail-movies">
          {!music && (
            <>
              <h3>Overview</h3>
              <p className="media-detail-overview">{item.overview || 'No overview available.'}</p>
            </>
          )}

          <h3>My log</h3>
          {logState === 'loading' && <p className="movie-status">Loading your log…</p>}
          {logState === 'error' && <p className="movie-status movie-error">{logError}</p>}
          {logState === 'ready' && (
            <>
              <LogForm item={item} log={log} onSaved={setLog} onLogSubmitted={onLogSubmitted} />
              <ShelfPicker item={item} log={log} onLogChanged={setLog} />
              {item.media_type === 'tv' && (
                <ShowSeasons item={item} log={log} onLogChanged={setLog} />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
