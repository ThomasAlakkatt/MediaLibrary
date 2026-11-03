import { useEffect, useState } from 'react';
import './App.css';
import MediaSearch from './MediaSearch';
import MusicSearch from './MusicSearch';

const TABS = [
  { id: 'all', label: 'Movies & Shows' },
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

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [tab, setTab] = useState(getInitialTab);

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
    setTab(newTab);
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
      </header>
      <main>{tab === 'music' ? <MusicSearch /> : <MediaSearch type={tab} />}</main>
    </div>
  );
}
