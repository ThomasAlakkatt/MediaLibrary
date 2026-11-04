import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  API_URL,
  getErrorMessage,
  libraryItemToMedia,
  matchesSearch,
  posterUrl,
  titleMatchesSearch,
} from './api';
import ListSearch from './ListSearch';
import { Clapperboard } from './Loaders';
import { TYPE_LABELS } from './MediaCard';
import Pagination, { usePagination } from './Pagination';
import TitleDetail from './TitleDetail';

function moveItem(items, fromIndex, toIndex) {
  const reordered = [...items];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered;
}

function ShelfPage({ shelfId, onBack, onLogSubmitted }) {
  const [shelf, setShelf] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [editingName, setEditingName] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [dropIndex, setDropIndex] = useState(null);
  const dragIndex = useRef(null);
  const [query, setQuery] = useState('');
  const searching = Boolean(query.trim());
  const matchingItems = (shelf?.items ?? []).filter((item) => titleMatchesSearch(query, item));
  const itemsPage = usePagination(matchingItems);

  // Also reloads when coming back from a title's page, since it may have left this shelf there.
  useEffect(() => {
    if (selected) return undefined;
    let current = true;
    axios
      .get(`${API_URL}/shelves/${shelfId}`)
      .then((response) => current && setShelf(response.data))
      .catch((err) => {
        if (current) setError(getErrorMessage(err, 'Something went wrong loading this shelf.'));
      });
    return () => {
      current = false;
    };
  }, [shelfId, selected]);

  async function reorder(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const previous = shelf;
    const items = moveItem(shelf.items, fromIndex, toIndex);
    // Moves right away so reordering feels instant, and moves back if saving fails.
    setShelf({ ...shelf, items });
    // Stays with the title if the move carries it onto another page.
    itemsPage.showIndex(toIndex);
    setError(null);
    try {
      const response = await axios.put(`${API_URL}/shelves/${shelfId}/order`, {
        item_ids: items.map((item) => item.id),
      });
      setShelf(response.data);
    } catch (err) {
      setShelf(previous);
      itemsPage.showIndex(fromIndex);
      setError(getErrorMessage(err, 'Something went wrong saving the new order.'));
    }
  }

  async function removeItem(item) {
    setError(null);
    try {
      const response = await axios.delete(`${API_URL}/shelves/${shelfId}/items/${item.id}`);
      setShelf(response.data);
    } catch (err) {
      setError(getErrorMessage(err, 'Something went wrong removing that title.'));
    }
  }

  async function saveName(event) {
    event.preventDefault();
    setError(null);
    try {
      const response = await axios.patch(`${API_URL}/shelves/${shelfId}`, {
        name: editingName,
        description: shelf.description,
      });
      setShelf(response.data);
      setEditingName(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Something went wrong renaming this shelf.'));
    }
  }

  async function deleteShelf() {
    setError(null);
    try {
      await axios.delete(`${API_URL}/shelves/${shelfId}`);
      onBack();
    } catch (err) {
      setConfirmingDelete(false);
      setError(getErrorMessage(err, 'Something went wrong deleting this shelf.'));
    }
  }

  if (selected) {
    return (
      <TitleDetail
        item={libraryItemToMedia(selected)}
        backLabel={`← Back to ${shelf.name}`}
        onBack={() => setSelected(null)}
        onLogSubmitted={onLogSubmitted}
      />
    );
  }

  return (
    <section aria-label="shelf" className="page">
      <button className="back-btn" onClick={onBack}>
        ← Back to Shelves
      </button>

      {error && <p className="search-error">{error}</p>}
      {!shelf && !error && <Clapperboard label="Loading shelf…" />}

      {shelf && (
        <>
          <div className="page-toolbar">
            {editingName === null ? (
              <h2>{shelf.name}</h2>
            ) : (
              <form className="inline-form" onSubmit={saveName}>
                <input
                  type="text"
                  aria-label="Shelf name"
                  maxLength="100"
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                />
                <button className="primary-btn" type="submit" disabled={!editingName.trim()}>
                  Save name
                </button>
                <button type="button" className="secondary-btn" onClick={() => setEditingName(null)}>
                  Cancel
                </button>
              </form>
            )}
            {editingName === null && (
              <div className="page-filters">
                {!confirmingDelete ? (
                  <>
                    <button type="button" className="secondary-btn" onClick={() => setEditingName(shelf.name)}>
                      Rename
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => setConfirmingDelete(true)}>
                      Delete shelf
                    </button>
                  </>
                ) : (
                  <>
                    <span className="confirm-text">Delete this shelf? Your logs stay.</span>
                    <button type="button" className="danger-btn" onClick={deleteShelf}>
                      Yes, delete
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => setConfirmingDelete(false)}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {shelf.items.length === 0 ? (
            <p className="empty-state-hint page-empty">
              This shelf is empty. Search for something, then open it to add it here.
            </p>
          ) : (
            <>
            <ListSearch
              label="Search this shelf"
              placeholder="Search this shelf by title or artist"
              value={query}
              onChange={(value) => {
                setQuery(value);
                itemsPage.resetPage();
              }}
            />
            {searching && matchingItems.length > 0 && (
              <p className="movie-status">Clear the search to reorder this shelf.</p>
            )}
            {matchingItems.length === 0 && (
              <p className="empty-state-hint page-empty">Nothing on this shelf matches “{query.trim()}”.</p>
            )}
            <ol className="shelf-items">
              {itemsPage.pageItems.map((item) => {
                // Its place on the whole shelf, which stays the same while searching.
                const index = shelf.items.indexOf(item);
                return (
                <li
                  key={item.id}
                  className={`shelf-item${dropIndex === index ? ' shelf-item--drop-target' : ''}`}
                  draggable={!searching}
                  onDragStart={(event) => {
                    dragIndex.current = index;
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDropIndex(index);
                  }}
                  onDragEnd={() => {
                    dragIndex.current = null;
                    setDropIndex(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDropIndex(null);
                    if (dragIndex.current !== null) reorder(dragIndex.current, index);
                    dragIndex.current = null;
                  }}
                >
                  <span className="shelf-item-number">{index + 1}</span>
                  {item.poster_path ? (
                    <img
                      className="shelf-item-poster"
                      src={posterUrl(item.poster_path, 'w92')}
                      alt=""
                      loading="lazy"
                      draggable={false}
                    />
                  ) : (
                    <div className="shelf-item-poster shelf-item-poster--empty" />
                  )}
                  <button type="button" className="shelf-item-title" onClick={() => setSelected(item)}>
                    <span className="season-name">{item.title}</span>
                    <span className="season-meta">
                      {[TYPE_LABELS[item.media_type], item.artists, item.year].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                  {item.rating !== null && <span className="my-rating">★ {item.rating}</span>}
                  <div className="shelf-item-actions">
                    {!searching && (
                      <>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Move ${item.title} up`}
                          disabled={index === 0}
                          onClick={() => reorder(index, index - 1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Move ${item.title} down`}
                          disabled={index === shelf.items.length - 1}
                          onClick={() => reorder(index, index + 1)}
                        >
                          ↓
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${item.title} from shelf`}
                      onClick={() => removeItem(item)}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              );
              })}
            </ol>
            </>
          )}
          <Pagination
            page={itemsPage.page}
            totalPages={itemsPage.totalPages}
            onPageChange={itemsPage.goToPage}
          />
        </>
      )}
    </section>
  );
}

function ShelfList({ onOpenShelf }) {
  const [shelves, setShelves] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const matchingShelves = (shelves ?? []).filter((shelf) => matchesSearch(query, [shelf.name]));
  const shelvesPage = usePagination(matchingShelves);

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

  async function handleCreate(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const response = await axios.post(`${API_URL}/shelves`, { name: trimmed });
      setName('');
      onOpenShelf(response.data.id);
    } catch (err) {
      setError(getErrorMessage(err, 'Something went wrong creating that shelf.'));
    }
  }

  return (
    <section aria-label="shelves" className="page">
      <div className="page-toolbar">
        <h2>Shelves</h2>
        <form className="inline-form" onSubmit={handleCreate}>
          <input
            type="text"
            aria-label="New shelf name"
            placeholder="New shelf name"
            maxLength="100"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="primary-btn" type="submit" disabled={!name.trim()}>
            Create shelf
          </button>
        </form>
      </div>

      <ListSearch
        label="Search your shelves"
        placeholder="Search your shelves by name"
        value={query}
        onChange={(value) => {
          setQuery(value);
          shelvesPage.resetPage();
        }}
      />

      {error && <p className="search-error">{error}</p>}
      {shelves === null && <Clapperboard label="Loading shelves…" />}
      {shelves?.length === 0 && !error && (
        <p className="empty-state-hint page-empty">
          No shelves yet. Create one to mix movies, shows and music, like a playlist.
        </p>
      )}
      {shelves?.length > 0 && matchingShelves.length === 0 && (
        <p className="empty-state-hint page-empty">No shelves match “{query.trim()}”.</p>
      )}
      {matchingShelves.length > 0 && (
        <div className="results">
          {shelvesPage.pageItems.map((shelf) => (
            <button
              type="button"
              className="shelf-card"
              key={shelf.id}
              onClick={() => onOpenShelf(shelf.id)}
            >
              <div className="shelf-cover">
                {shelf.cover_posters.map((poster) => (
                  <img key={poster} src={posterUrl(poster, 'w185')} alt="" loading="lazy" />
                ))}
              </div>
              <span className="shelf-card-info">
                <span className="season-name">{shelf.name}</span>
                <span className="season-meta">
                  {shelf.item_count} {shelf.item_count === 1 ? 'title' : 'titles'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <Pagination
        page={shelvesPage.page}
        totalPages={shelvesPage.totalPages}
        onPageChange={shelvesPage.goToPage}
      />
    </section>
  );
}

export default function ShelvesView({ shelfId, onOpenShelf, onLogSubmitted }) {
  return shelfId ? (
    <ShelfPage
      key={shelfId}
      shelfId={shelfId}
      onBack={() => onOpenShelf(null)}
      onLogSubmitted={onLogSubmitted}
    />
  ) : (
    <ShelfList onOpenShelf={onOpenShelf} />
  );
}
