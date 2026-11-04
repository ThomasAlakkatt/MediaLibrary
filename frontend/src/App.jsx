import { useEffect, useRef, useState } from 'react';
import './App.css';
import LibraryView from './LibraryView';
import MediaSearch from './MediaSearch';
import MusicSearch from './MusicSearch';
import ShelvesView from './ShelvesView';

const VIEWS = [
  { id: 'search', label: 'Search' },
  { id: 'library', label: 'My Library' },
  { id: 'shelves', label: 'Shelves' },
];

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'tv', label: 'Shows' },
  { id: 'music', label: 'Music' },
];

function getInitialTheme() {
  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// A shared link says which search it came from.
function getInitialTab() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('artist') || params.get('release')) return 'music';
  const type = params.get('type');
  return type === 'movie' || type === 'tv' ? type : 'all';
}

function getViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  return {
    view: view === 'library' || view === 'shelves' ? view : 'search',
    shelfId: view === 'shelves' ? Number(params.get('shelf')) || null : null,
  };
}

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [tab, setTab] = useState(getInitialTab);
  // A music result opened from the All search. The search stays mounted behind it, so coming back
  // finds the same results, page and scroll position.
  const [openRelease, setOpenRelease] = useState(null);
  const scrollBeforeRelease = useRef(0);
  const [{ view, shelfId }, setLocation] = useState(getViewFromUrl);

  // Keeps the page in step with the browser's back and forward buttons.
  useEffect(() => {
    function handlePopState() {
      setLocation(getViewFromUrl());
      setTab(getInitialTab());
      setOpenRelease(null);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function navigate(newView, newShelfId = null) {
    const params = new URLSearchParams();
    if (newView !== 'search') params.set('view', newView);
    if (newShelfId) params.set('shelf', newShelfId);
    const queryString = params.toString();
    window.history.pushState(
      null,
      '',
      queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname
    );
    setLocation({ view: newView, shelfId: newShelfId });
    setOpenRelease(null);
    window.scrollTo?.(0, 0);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }

  function handleTabChange(newTab) {
    // Music has its own kind of search, so its link and the movie and show link can't carry over.
    if (newTab === 'music' || tab === 'music') {
      window.history.replaceState(null, '', window.location.pathname);
    }
    setOpenRelease(null);
    setTab(newTab);
  }

  function handleOpenRelease(release) {
    scrollBeforeRelease.current = window.scrollY;
    setOpenRelease(release);
    window.scrollTo?.(0, 0);
  }

  function handleCloseRelease() {
    setOpenRelease(null);
    // Waits for the search to be showing again, since it can't be scrolled while hidden.
    requestAnimationFrame(() => window.scrollTo?.(0, scrollBeforeRelease.current));
  }

  return (
    <div className="App">
      <header>
        <button
          type="button"
          className="theme-toggle-btn"
          onClick={toggleTheme}
          aria-label="Toggle dark mode"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <h1>MediaLibrary</h1>
        <p>Your books, shows, movies, and music, all in one place</p>
        <nav className="main-nav" aria-label="Main">
          {VIEWS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-current={view === id ? 'page' : undefined}
              className={`main-nav-link${view === id ? ' main-nav-link--active' : ''}`}
              onClick={() => navigate(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {view === 'search' && (
          <div className="search-tabs" role="tablist" aria-label="What to search">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`search-tab${tab === id ? ' search-tab--active' : ''}`}
                onClick={() => handleTabChange(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </header>
      <main>
        {view === 'search' &&
          (tab === 'music' ? (
            <MusicSearch onLogSubmitted={() => navigate('library')} />
          ) : (
            <>
              <div hidden={Boolean(openRelease)}>
                <MediaSearch
                  type={tab}
                  onLogSubmitted={() => navigate('library')}
                  onOpenRelease={handleOpenRelease}
                />
              </div>
              {openRelease && (
                <MusicSearch
                  key={openRelease.id}
                  initialRelease={openRelease}
                  onBack={handleCloseRelease}
                  onLogSubmitted={() => navigate('library')}
                />
              )}
            </>
          ))}
        {view === 'library' && <LibraryView />}
        {view === 'shelves' && (
          <ShelvesView
            shelfId={shelfId}
            onOpenShelf={(id) => navigate('shelves', id)}
            onLogSubmitted={() => navigate('library')}
          />
        )}
      </main>
    </div>
  );
}
