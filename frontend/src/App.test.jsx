import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, test, expect, beforeEach, afterEach, describe } from 'vitest';
import axios from 'axios';
import App from './App';
import { statusLabels } from './api';

vi.mock('axios');

const DUNE = {
  id: 1,
  media_type: 'movie',
  title: 'Dune',
  year: '2021',
  overview: 'Spice.',
  poster_path: '/dune.jpg',
  rating: 8,
  vote_count: 100,
};
const BREAKING_BAD = {
  id: 1,
  media_type: 'tv',
  title: 'Breaking Bad',
  year: '2008',
  overview: 'Chemistry.',
  poster_path: null,
  rating: 8.9,
  vote_count: 100,
};
const SHOW_DETAILS = {
  id: 1,
  status: 'Ended',
  number_of_seasons: 1,
  number_of_episodes: 7,
  genres: ['Drama'],
  seasons: [{ season_number: 1, name: 'Season 1', episode_count: 7, year: '2008' }],
};
const OK_COMPUTER = { id: 9, title: 'OK Computer', artists: ['Radiohead'], year: 1997 };
const ALBUM = {
  id: 9,
  title: 'OK Computer',
  artists: ['Radiohead'],
  year: '1997',
  cover_image: 'https://img/ok.jpg',
  tracks: [
    { track_index: 0, position: 'A1', title: 'Airbag', duration: '4:44' },
    { track_index: 1, position: 'A2', title: 'Paranoid Android', duration: null },
    { track_index: 2, position: 'B1', title: 'Karma Police', duration: null },
  ],
};
const SHELF = { id: 5, name: 'Favorites', description: null, item_count: 0, cover_posters: [] };

function libraryItem(overrides = {}) {
  return {
    id: 50,
    source_id: 1,
    media_type: 'movie',
    title: 'Dune',
    year: '2021',
    overview: 'Spice.',
    poster_path: null,
    status: null,
    rating: null,
    review: null,
    finished_on: null,
    seasons: [],
    shelf_ids: [],
    ...overrides,
  };
}

const NOT_FOUND = { response: { status: 404, data: { detail: 'Not found' } } };

function searchResponse(results, page = 1, total_pages = 1) {
  return { results, page, total_pages };
}

// What each GET route answers with. A test replaces only the ones it cares about. A function runs per
// request, and an Error-like object with a response is treated as a failed request.
let routes;

function respond(route) {
  const value = typeof route === 'function' ? route() : route;
  if (value instanceof Promise) return value;
  return value?.response ? Promise.reject(value) : Promise.resolve({ data: value });
}

function setRoutes(overrides) {
  routes = { ...routes, ...overrides };
}

function search(title) {
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: title } });
  clickSearch();
}

function clickSearch() {
  const form = screen.getByRole('region', { name: 'search' });
  fireEvent.click(within(form).getByRole('button', { name: 'Search' }));
}

async function openFromSearch(item) {
  setRoutes({ search: searchResponse([item]) });
  render(<App />);
  search(item.title);
  fireEvent.click(await screen.findByText(item.title));
  return screen.findByRole('region', { name: 'title detail' });
}

function goTo(label) {
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: label }));
}

beforeEach(() => {
  vi.resetAllMocks();
  routes = {
    search: searchResponse([]),
    show: SHOW_DETAILS,
    item: NOT_FOUND,
    library: [],
    shelves: [],
    shelf: null,
    music: [],
    musicText: [],
    album: ALBUM,
    albumItem: NOT_FOUND,
    albumSongs: [],
  };
  axios.get.mockImplementation((url) => {
    if (url.includes('/search/media')) return respond(routes.search);
    if (url.endsWith('/search/music')) return respond(routes.musicText);
    if (url.includes('/albums/')) return respond(routes.album);
    if (url.includes('/shows/')) return respond(routes.show);
    if (/\/library\/album\/\d+\/songs$/.test(url)) return respond(routes.albumSongs);
    if (/\/library\/album\//.test(url)) return respond(routes.albumItem);
    if (/\/library\/(movie|tv|song)\//.test(url)) return respond(routes.item);
    if (url.endsWith('/library')) return respond(routes.library);
    if (/\/shelves\/\d+$/.test(url)) return respond(routes.shelf);
    if (url.endsWith('/shelves')) return respond(routes.shelves);
    if (url.endsWith('/search')) return respond(routes.music);
    throw new Error(`Unexpected GET ${url}`);
  });
  window.matchMedia = () => ({ matches: false });
  window.scrollTo = () => {};
  window.history.replaceState(null, '', '/');
});

test('searches everything by default, including music', async () => {
  setRoutes({ search: searchResponse([DUNE]), musicText: [OK_COMPUTER] });
  render(<App />);
  search('radiohead');

  expect(await screen.findByText('OK Computer')).toBeInTheDocument();
  expect(screen.getByText('Dune')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Music' })).toBeInTheDocument();
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/search/music'), {
    params: { query: 'radiohead', page: 1 },
  });
});

test('music comes first when it clearly matches the search', async () => {
  setRoutes({
    search: searchResponse([{ ...DUNE, title: 'A Film About Radiohead' }]),
    musicText: [{ ...OK_COMPUTER, match: 'artist' }],
  });
  render(<App />);
  search('radiohead');
  await screen.findByText('OK Computer');

  const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(headings.indexOf('Music')).toBeLessThan(headings.indexOf('Movies & Shows'));
});

test('music naming the artist and title also comes first', async () => {
  setRoutes({
    search: searchResponse([{ ...DUNE, title: 'A Film' }]),
    musicText: [{ ...OK_COMPUTER, match: 'artist_and_title' }],
  });
  render(<App />);
  search('radiohead ok computer');
  await screen.findByText('OK Computer');

  const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(headings.indexOf('Music')).toBeLessThan(headings.indexOf('Movies & Shows'));
});

test('a movie with the exact title stays ahead of matching music', async () => {
  setRoutes({
    search: searchResponse([DUNE]),
    musicText: [{ ...OK_COMPUTER, match: 'artist' }],
  });
  render(<App />);
  search('dune');
  await screen.findByText('OK Computer');

  const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(headings.indexOf('Movies & Shows')).toBeLessThan(headings.indexOf('Music'));
});

test('music stays last when it is not a clear match', async () => {
  setRoutes({
    search: searchResponse([{ ...DUNE, title: 'Something' }]),
    musicText: [{ ...OK_COMPUTER, match: null }],
  });
  render(<App />);
  search('computer');
  await screen.findByText('OK Computer');

  const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(headings.indexOf('Movies & Shows')).toBeLessThan(headings.indexOf('Music'));
});

test('only music results still count as found', async () => {
  setRoutes({ musicText: [OK_COMPUTER] });
  render(<App />);
  search('radiohead');

  expect(await screen.findByText('OK Computer')).toBeInTheDocument();
  expect(screen.queryByText('No results found.')).not.toBeInTheDocument();
});

test('a music failure still shows movies and shows', async () => {
  setRoutes({
    search: searchResponse([DUNE]),
    musicText: { response: { status: 429, data: { detail: 'Rate limited by Discogs' } } },
  });
  render(<App />);
  search('dune');

  expect(await screen.findByText('Dune')).toBeInTheDocument();
  expect(screen.getByText('Rate limited by Discogs')).toBeInTheDocument();
});

test('a movies and shows failure still shows music', async () => {
  setRoutes({
    search: { response: { status: 502, data: { detail: 'Could not reach TMDB' } } },
    musicText: [OK_COMPUTER],
  });
  render(<App />);
  search('dune');

  expect(await screen.findByText('OK Computer')).toBeInTheDocument();
  expect(screen.getByText('Could not reach TMDB')).toBeInTheDocument();
});

test('filtering to movies or shows leaves music out', async () => {
  setRoutes({ search: searchResponse([DUNE]), musicText: [OK_COMPUTER] });
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Movies' }));
  search('dune');

  await screen.findByText('Dune');
  expect(screen.queryByText('OK Computer')).not.toBeInTheDocument();
  expect(axios.get).not.toHaveBeenCalledWith(expect.stringContaining('/search/music'), expect.anything());
});

test('going back from a music result returns to the same search and page', async () => {
  setRoutes({ search: searchResponse([DUNE], 2, 3), musicText: [OK_COMPUTER] });
  render(<App />);
  search('radiohead');
  fireEvent.click(await screen.findByText('OK Computer'));
  await screen.findByText('Airbag');
  axios.get.mockClear();

  fireEvent.click(screen.getByRole('button', { name: '← Back to results' }));

  expect(screen.getByLabelText('Search')).toBeVisible();
  expect(screen.getByLabelText('Search')).toHaveValue('radiohead');
  expect(screen.getByText('Dune')).toBeVisible();
  expect(screen.getByText('Page 2 of 3')).toBeVisible();
  expect(screen.queryByRole('region', { name: 'album detail' })).not.toBeInTheDocument();
  expect(window.location.search).toBe('?q=radiohead');
  expect(axios.get).not.toHaveBeenCalledWith(expect.stringContaining('/search/'), expect.anything());
});

test('the search is hidden while a music result is open', async () => {
  setRoutes({ musicText: [OK_COMPUTER] });
  render(<App />);
  search('radiohead');
  fireEvent.click(await screen.findByText('OK Computer'));
  await screen.findByText('Airbag');

  expect(screen.getByLabelText('Search')).not.toBeVisible();
});

test.each([
  ['a filter', () => fireEvent.click(screen.getByRole('tab', { name: 'Movies' }))],
  ['the page navigation', () => goTo('My Library')],
])('leaving through %s closes the music result', async (_, leave) => {
  setRoutes({ musicText: [OK_COMPUTER] });
  render(<App />);
  search('radiohead');
  fireEvent.click(await screen.findByText('OK Computer'));
  await screen.findByText('Airbag');

  leave();

  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'album detail' })).not.toBeInTheDocument()
  );
});

test('the Music tab still goes back to its own results', async () => {
  setRoutes({ music: [OK_COMPUTER] });
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Music' }));
  fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'Radiohead' } });
  clickSearch();
  fireEvent.click(await screen.findByText('OK Computer'));
  await screen.findByText('Airbag');

  fireEvent.click(screen.getByRole('button', { name: '← Back to results' }));

  expect(await screen.findByText('OK Computer')).toBeVisible();
  expect(screen.getByLabelText('Artist')).toHaveValue('Radiohead');
});

test('the search box is labeled for everything it searches', async () => {
  render(<App />);
  expect(screen.getByLabelText('Search')).toHaveAttribute('placeholder', 'Search movies, shows and music');
  expect(screen.queryByText('Title', { selector: 'label' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Movies' }));
  expect(screen.getByLabelText('Search')).toHaveAttribute('placeholder', 'Search movies');
});

test('searches movies and shows together by default', async () => {
  setRoutes({ search: searchResponse([DUNE, BREAKING_BAD]) });
  render(<App />);
  search('  dune ');

  expect(await screen.findByText('Dune')).toBeInTheDocument();
  expect(screen.getByText('Breaking Bad')).toBeInTheDocument();
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/search/media'), {
    params: { query: 'dune', type: 'all', page: 1 },
  });
  expect(window.location.search).toBe('?q=dune');
});

test('changing the filter reruns the current search', async () => {
  setRoutes({ search: searchResponse([DUNE, BREAKING_BAD]) });
  render(<App />);
  search('dune');
  await screen.findByText('Dune');

  setRoutes({ search: searchResponse([BREAKING_BAD]) });
  fireEvent.click(screen.getByRole('tab', { name: 'Shows' }));

  await screen.findByText('Breaking Bad');
  expect(screen.queryByText('Dune')).not.toBeInTheDocument();
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/search/media'), {
    params: { query: 'dune', type: 'tv', page: 1 },
  });
  expect(window.location.search).toBe('?q=dune&type=tv');
});

test('runs the search from a shared link', async () => {
  window.history.replaceState(null, '', '/?q=breaking&type=tv');
  setRoutes({ search: searchResponse([BREAKING_BAD]) });
  render(<App />);

  expect(await screen.findByText('Breaking Bad')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Shows' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('Search')).toHaveValue('breaking');
});

test('a blank search shows a message and sends nothing', () => {
  render(<App />);
  search('   ');
  expect(screen.getByText('Please enter a title to search for.')).toBeInTheDocument();
  expect(axios.get).not.toHaveBeenCalled();
});

test('shows when nothing was found', async () => {
  render(<App />);
  search('zzz');
  expect(await screen.findByText('No results found.')).toBeInTheDocument();
});

test('shows the error message from the backend', async () => {
  setRoutes({ search: { response: { status: 502, data: { detail: 'Could not reach TMDB' } } } });
  render(<App />);
  search('dune');
  expect(await screen.findByText('Could not reach TMDB')).toBeInTheDocument();
});

test('an older response cannot overwrite a newer search', async () => {
  let resolveOld;
  setRoutes({ search: () => new Promise((resolve) => (resolveOld = resolve)) });
  render(<App />);
  search('old');

  setRoutes({ search: searchResponse([BREAKING_BAD]) });
  fireEvent.click(screen.getByRole('tab', { name: 'Shows' }));
  await screen.findByText('Breaking Bad');

  resolveOld({ data: searchResponse([DUNE]) });
  await new Promise((resolve) => setTimeout(resolve));
  expect(screen.queryByText('Dune')).not.toBeInTheDocument();
});

test('a search finishing after leaving the page does not change the URL', async () => {
  let resolveOld;
  setRoutes({ search: () => new Promise((resolve) => (resolveOld = resolve)) });
  render(<App />);
  search('dune');

  goTo('My Library');
  expect(window.location.search).toBe('?view=library');
  resolveOld({ data: searchResponse([DUNE]) });
  await new Promise((resolve) => setTimeout(resolve));

  expect(window.location.search).toBe('?view=library');
});

test('pages through results', async () => {
  setRoutes({ search: searchResponse([DUNE], 1, 3) });
  render(<App />);
  search('dune');
  await screen.findByText('Page 1 of 3');
  expect(screen.getByRole('button', { name: '← Previous' })).toBeDisabled();

  setRoutes({ search: searchResponse([BREAKING_BAD], 2, 3) });
  fireEvent.click(screen.getByRole('button', { name: 'Next →' }));

  await screen.findByText('Page 2 of 3');
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/search/media'), {
    params: { query: 'dune', type: 'all', page: 2 },
  });
});

describe('paging when music runs further than movies and shows', () => {
  const tenReleases = (start = 1) =>
    Array.from({ length: 10 }, (_, index) => ({
      ...OK_COMPUTER,
      id: start + index,
      title: `Album ${start + index}`,
    }));

  test('a full page of music can go to the next page', async () => {
    setRoutes({ search: searchResponse([DUNE], 1, 1), musicText: tenReleases() });
    render(<App />);
    search('radiohead');
    await screen.findByText('Album 1');
    expect(screen.getByText('Page 1')).toBeInTheDocument();

    setRoutes({ search: searchResponse([], 2, 1), musicText: tenReleases(11) });
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));

    expect(await screen.findByText('Album 11')).toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(screen.queryByText('Dune')).not.toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/search/music'), {
      params: { query: 'radiohead', page: 2 },
    });
  });

  test('a partial page of music is the last, and can go back', async () => {
    setRoutes({ search: searchResponse([], 2, 1), musicText: [OK_COMPUTER] });
    window.history.replaceState(null, '', '/?q=radiohead');
    render(<App />);
    await screen.findByText('OK Computer');
    expect(screen.queryByRole('button', { name: 'Next →' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '← Previous' })).toBeEnabled();
  });

  test('a short search has no paging at all', async () => {
    setRoutes({ search: searchResponse([DUNE], 1, 1), musicText: [OK_COMPUTER] });
    render(<App />);
    search('dune');
    await screen.findByText('Dune');
    expect(screen.queryByRole('button', { name: 'Next →' })).not.toBeInTheDocument();
  });

  test('going past the last page says there is no more', async () => {
    setRoutes({ search: searchResponse([], 1, 1), musicText: tenReleases() });
    render(<App />);
    search('radiohead');
    await screen.findByText('Album 1');

    setRoutes({ search: searchResponse([], 2, 1), musicText: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));

    expect(await screen.findByText('No more results.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← Previous' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next →' })).toBeDisabled();
  });

  test('filtered searches keep their page count', async () => {
    setRoutes({ search: searchResponse([DUNE], 1, 3) });
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Movies' }));
    search('dune');
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
  });
});

test('opening a show loads its seasons', async () => {
  await openFromSearch(BREAKING_BAD);

  expect(await screen.findByText('Season 1')).toBeInTheDocument();
  expect(screen.getByText('7 episodes · 2008')).toBeInTheDocument();
  expect(screen.getByText('Ended · 1 season · 7 episodes')).toBeInTheDocument();
});

test('opening a movie shows its details and no seasons', async () => {
  const detail = await openFromSearch(DUNE);

  expect(within(detail).getByText('Spice.')).toBeInTheDocument();
  expect(within(detail).getByRole('link', { name: 'View on TMDB' })).toHaveAttribute(
    'href',
    'https://www.themoviedb.org/movie/1'
  );
  await screen.findByLabelText('My rating');
  expect(axios.get).not.toHaveBeenCalledWith(expect.stringContaining('/shows/'));
});

test('reopening a show after a failed lookup tries again', async () => {
  setRoutes({ show: { response: { status: 502, data: { detail: 'Could not reach TMDB' } } } });
  await openFromSearch(BREAKING_BAD);
  await screen.findByText('Could not reach TMDB');

  fireEvent.click(screen.getByRole('button', { name: '← Back to results' }));
  setRoutes({ show: SHOW_DETAILS });
  fireEvent.click(await screen.findByText('Breaking Bad'));

  expect(await screen.findByText('Season 1')).toBeInTheDocument();
  expect(screen.queryByText('Could not reach TMDB')).not.toBeInTheDocument();
});

test.each([
  ['0.00', 0],
  ['7.500', 7.5],
  ['7.330', 7.33],
  ['10.000', 10],
  ['.2500', 0.25],
  ['10.00', 10],
  ['7.3', 7.3],
  ['7.25', 7.25],
  ['9.99', 9.99],
  ['.25', 0.25],
  ['8.', 8],
  ['0', 0],
  ['10', 10],
  ['.5', 0.5],
  [' 8 ', 8],
  ['', null],
])('the rating %j is saved as %j', async (typed, saved) => {
  axios.put.mockResolvedValue({ data: libraryItem({ rating: saved }) });
  await openFromSearch(DUNE);

  fireEvent.change(await screen.findByLabelText('My rating'), { target: { value: typed } });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'finished' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(axios.put).toHaveBeenCalled());
  expect(axios.put.mock.calls[0][1].rating).toBe(saved);
});

test.each(['-0.01', '11', '10.1', '10.01', '-1', 'great', '8/10', '1e1', '.', '7.333', '7.3301', '.125', '10.001'])(
  'the rating %j is rejected without saving',
  async (typed) => {
    await openFromSearch(DUNE);

    fireEvent.change(await screen.findByLabelText('My rating'), { target: { value: typed } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Rating must be a number between 0 and 10, with at most 2 decimal places.')).toBeInTheDocument();
    expect(axios.put).not.toHaveBeenCalled();
    expect(screen.getByLabelText('My rating')).toHaveValue(typed);
  }
);

test('a rating of 0 shows as a rating, not as nothing', async () => {
  setRoutes({ library: [libraryItem({ rating: 0 })], item: libraryItem({ rating: 0 }) });
  render(<App />);
  goTo('My Library');

  expect(await screen.findByText('★ 0 / 10')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Dune'));
  expect(await screen.findByLabelText('My rating')).toHaveValue('0');
  expect(screen.getByRole('button', { name: 'Clear log' })).toBeInTheDocument();
});

test('saving a log sends a half-point rating and goes to My Library', async () => {
  axios.put.mockResolvedValue({ data: libraryItem({ status: 'finished', rating: 8.5 }) });
  setRoutes({ library: [libraryItem({ status: 'finished', rating: 8.5 })] });
  await openFromSearch(DUNE);

  fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'finished' } });
  fireEvent.change(screen.getByLabelText('My rating'), { target: { value: '8.5' } });
  fireEvent.change(screen.getByLabelText('Review'), { target: { value: 'Great' } });
  fireEvent.change(screen.getByLabelText('Date finished'), { target: { value: '2026-11-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText('★ 8.5 / 10')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'my library' })).toBeInTheDocument();
  expect(window.location.search).toBe('?view=library');
  expect(axios.put).toHaveBeenCalledWith(expect.stringContaining('/library/movie/1'), {
    title: 'Dune',
    year: '2021',
    poster_path: '/dune.jpg',
    overview: 'Spice.',
    status: 'finished',
    rating: 8.5,
    review: 'Great',
    finished_on: '2026-11-01',
  });
});

describe('the default date', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Late evening, when the UTC date is already tomorrow in the US.
    vi.setSystemTime(new Date(2026, 10, 3, 23, 30));
  });
  afterEach(() => vi.useRealTimers());

  test('a new entry starts with today', async () => {
    await openFromSearch(DUNE);
    expect(await screen.findByLabelText('Date finished')).toHaveValue('2026-11-03');
  });

  test('saving a new entry sends today', async () => {
    axios.put.mockResolvedValue({ data: libraryItem({ rating: 8 }) });
    await openFromSearch(DUNE);
    fireEvent.change(await screen.findByLabelText('My rating'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(axios.put).toHaveBeenCalled());
    expect(axios.put.mock.calls[0][1].finished_on).toBe('2026-11-03');
  });

  test('a title only on a shelf counts as new', async () => {
    setRoutes({ item: libraryItem({ shelf_ids: [5] }) });
    await openFromSearch(DUNE);
    expect(await screen.findByLabelText('Date finished')).toHaveValue('2026-11-03');
  });

  test('an existing log without a date stays blank', async () => {
    setRoutes({ item: libraryItem({ status: 'in_progress' }) });
    await openFromSearch(DUNE);
    expect(await screen.findByLabelText('Date finished')).toHaveValue('');
  });

  test('an existing date is kept', async () => {
    setRoutes({ item: libraryItem({ status: 'finished', finished_on: '2020-01-02' }) });
    await openFromSearch(DUNE);
    expect(await screen.findByLabelText('Date finished')).toHaveValue('2020-01-02');
  });

  test.each(['want', 'in_progress'])('choosing %s removes the automatic date', async (status) => {
    await openFromSearch(DUNE);
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: status } });
    expect(screen.getByLabelText('Date finished')).toHaveValue('');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'finished' } });
    expect(screen.getByLabelText('Date finished')).toHaveValue('2026-11-03');
  });

  test('a date that was picked survives changing the status', async () => {
    await openFromSearch(DUNE);
    fireEvent.change(await screen.findByLabelText('Date finished'), { target: { value: '2026-01-15' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'want' } });
    expect(screen.getByLabelText('Date finished')).toHaveValue('2026-01-15');
  });

  test('the date can be cleared', async () => {
    axios.put.mockResolvedValue({ data: libraryItem({ rating: 8 }) });
    await openFromSearch(DUNE);
    fireEvent.change(await screen.findByLabelText('Date finished'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'finished' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(axios.put).toHaveBeenCalled());
    expect(axios.put.mock.calls[0][1].finished_on).toBeNull();
  });

  test('clearing a log goes back to today', async () => {
    setRoutes({ item: libraryItem({ rating: 7.5, finished_on: '2020-01-02' }) });
    axios.delete.mockResolvedValue({ data: null });
    await openFromSearch(DUNE);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear log' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, clear' }));

    await screen.findByText('Log cleared');
    expect(screen.getByLabelText('Date finished')).toHaveValue('2026-11-03');
  });

  test('marking a season as watched fills in today', async () => {
    axios.put.mockResolvedValue({ data: libraryItem({ media_type: 'tv' }) });
    await openFromSearch(BREAKING_BAD);
    fireEvent.change(await screen.findByLabelText('Season 1 status'), { target: { value: 'finished' } });

    await waitFor(() => expect(axios.put).toHaveBeenCalled());
    expect(axios.put.mock.calls[0][1]).toMatchObject({ status: 'finished', finished_on: '2026-11-03' });
  });

  test('other season statuses get no date', async () => {
    axios.put.mockResolvedValue({ data: libraryItem({ media_type: 'tv' }) });
    await openFromSearch(BREAKING_BAD);
    fireEvent.change(await screen.findByLabelText('Season 1 status'), { target: { value: 'want' } });

    await waitFor(() => expect(axios.put).toHaveBeenCalled());
    expect(axios.put.mock.calls[0][1].finished_on).toBeNull();
  });
});

test('an existing log fills in the form', async () => {
  setRoutes({ item: libraryItem({ status: 'in_progress', rating: 7.5, review: 'So far so good' }) });
  await openFromSearch(DUNE);

  expect(await screen.findByLabelText('My rating')).toHaveValue('7.5');
  expect(screen.getByLabelText('Status')).toHaveValue('in_progress');
  expect(screen.getByLabelText('Review')).toHaveValue('So far so good');
});

describe('saving with nothing filled in', () => {
  test('a new entry is not saved', async () => {
    await openFromSearch(DUNE);
    await screen.findByLabelText('My rating');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Add a status, rating or review before saving.')).toBeInTheDocument();
    expect(axios.put).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'title detail' })).toBeInTheDocument();
  });

  test('a review of only spaces does not count', async () => {
    await openFromSearch(DUNE);
    fireEvent.change(await screen.findByLabelText('Review'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Add a status, rating or review before saving.')).toBeInTheDocument();
    expect(axios.put).not.toHaveBeenCalled();
  });

  test('a date picked by hand is enough to save', async () => {
    axios.put.mockResolvedValue({ data: libraryItem({ finished_on: '2026-01-15' }) });
    await openFromSearch(DUNE);
    fireEvent.change(await screen.findByLabelText('Date finished'), { target: { value: '2026-01-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(axios.put).toHaveBeenCalled());
    expect(axios.put.mock.calls[0][1].finished_on).toBe('2026-01-15');
  });

  test.each([
    ['a status', 'Status', 'want'],
    ['a rating of 0', 'My rating', '0'],
    ['a review', 'Review', 'Good'],
  ])('%s is enough to save', async (_, label, value) => {
    axios.put.mockResolvedValue({ data: libraryItem() });
    await openFromSearch(DUNE);
    fireEvent.change(await screen.findByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(axios.put).toHaveBeenCalled());
  });

  test('an existing log can have everything removed', async () => {
    setRoutes({ item: libraryItem({ status: 'want' }) });
    axios.put.mockResolvedValue({ data: null });
    await openFromSearch(DUNE);
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(axios.put).toHaveBeenCalled());
  });
});

test('a failed save shows the error and keeps what was typed', async () => {
  axios.put.mockRejectedValue({ response: { status: 500, data: {} } });
  await openFromSearch(DUNE);

  fireEvent.change(await screen.findByLabelText('Review'), { target: { value: 'Keep me' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText(/Something went wrong saving your log/)).toBeInTheDocument();
  expect(screen.getByLabelText('Review')).toHaveValue('Keep me');
  expect(window.location.search).not.toContain('view=library');
});

test('clearing a log asks first', async () => {
  setRoutes({ item: libraryItem({ rating: 7.5 }) });
  axios.delete.mockResolvedValue({ data: null });
  await openFromSearch(DUNE);

  fireEvent.click(await screen.findByRole('button', { name: 'Clear log' }));
  expect(axios.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Yes, clear' }));

  expect(await screen.findByText('Log cleared')).toBeInTheDocument();
  expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/library/movie/1'));
  expect(screen.getByLabelText('My rating')).toHaveValue('');
});

test('changing a season status saves straight away', async () => {
  axios.put.mockResolvedValue({
    data: libraryItem({
      media_type: 'tv',
      seasons: [{ season_number: 1, status: 'in_progress', finished_on: null }],
    }),
  });
  await openFromSearch(BREAKING_BAD);

  fireEvent.change(await screen.findByLabelText('Season 1 status'), { target: { value: 'in_progress' } });

  await waitFor(() => expect(screen.getByLabelText('Season 1 status')).toHaveValue('in_progress'));
  expect(axios.put).toHaveBeenCalledWith(expect.stringContaining('/library/tv/1/seasons/1'), {
    title: 'Breaking Bad',
    year: '2008',
    poster_path: null,
    overview: 'Chemistry.',
    status: 'in_progress',
    finished_on: null,
  });
});

test('seasons do not have a rating box', async () => {
  await openFromSearch(BREAKING_BAD);
  await screen.findByLabelText('Season 1 status');

  expect(screen.queryByLabelText('Season 1 rating')).not.toBeInTheDocument();
  expect(screen.getAllByLabelText('My rating')).toHaveLength(1);
});

test('a season date only shows once the season is finished', async () => {
  setRoutes({
    item: libraryItem({
      media_type: 'tv',
      seasons: [{ season_number: 1, status: 'in_progress', finished_on: null }],
    }),
  });
  await openFromSearch(BREAKING_BAD);
  await screen.findByLabelText('Season 1 status');
  expect(screen.queryByLabelText('Season 1 date finished')).not.toBeInTheDocument();
});

test('ticking a shelf adds the title to it', async () => {
  setRoutes({ shelves: [SHELF] });
  axios.post.mockResolvedValue({ data: {} });
  await openFromSearch(DUNE);
  const checkbox = await screen.findByRole('checkbox', { name: 'Favorites' });

  setRoutes({ item: libraryItem({ shelf_ids: [5] }) });
  fireEvent.click(checkbox);

  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Favorites' })).toBeChecked());
  expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining('/shelves/5/items'),
    expect.objectContaining({ media_type: 'movie', source_id: 1, title: 'Dune' })
  );
});

test('unticking a shelf removes the title from it', async () => {
  setRoutes({ shelves: [SHELF], item: libraryItem({ shelf_ids: [5] }) });
  axios.delete.mockResolvedValue({ data: {} });
  await openFromSearch(DUNE);
  const checkbox = await screen.findByRole('checkbox', { name: 'Favorites' });
  expect(checkbox).toBeChecked();

  setRoutes({ item: NOT_FOUND });
  fireEvent.click(checkbox);

  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Favorites' })).not.toBeChecked());
  expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/shelves/5/items/50'));
});

test('a new shelf can be created from a title page', async () => {
  axios.post
    .mockResolvedValueOnce({ data: SHELF })
    .mockResolvedValueOnce({ data: {} });
  await openFromSearch(DUNE);

  fireEvent.change(await screen.findByLabelText('New shelf name'), { target: { value: 'Favorites' } });
  setRoutes({ item: libraryItem({ shelf_ids: [5] }) });
  fireEvent.click(screen.getByRole('button', { name: 'Create and add' }));

  expect(await screen.findByRole('checkbox', { name: 'Favorites' })).toBeChecked();
  expect(screen.getByLabelText('New shelf name')).toHaveValue('');
});

describe('choosing shelves', () => {
  const NAMES = ['Comedy Night', 'Comfort Movies', 'Favorites', 'Sci-Fi Night', 'Weekend'];
  const MANY = NAMES.map((name, index) => ({ ...SHELF, id: index + 1, name }));

  async function openWithShelves(shelves, item = libraryItem()) {
    setRoutes({ shelves, item });
    await openFromSearch(DUNE);
    await screen.findByLabelText('My rating');
  }

  function searchBox() {
    return screen.findByRole('combobox', { name: 'Search or create a shelf' });
  }

  function optionNames() {
    return within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent);
  }

  test('4 shelves are all listed, with no search box', async () => {
    await openWithShelves(MANY.slice(0, 4));
    expect(await screen.findByRole('checkbox', { name: 'Favorites' })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    expect(screen.getByLabelText('New shelf name')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Search or create a shelf' })).not.toBeInTheDocument();
  });

  test('5 shelves get a search box and are not listed', async () => {
    await openWithShelves(MANY);
    await searchBox();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New shelf name')).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('clicking into the box lists the shelves to browse', async () => {
    await openWithShelves(MANY);
    fireEvent.focus(await searchBox());
    expect(optionNames()).toEqual(NAMES);
  });

  test('typing narrows the list, ignoring case', async () => {
    await openWithShelves(MANY);
    fireEvent.change(await searchBox(), { target: { value: 'NIGHT' } });
    expect(optionNames()).toEqual(['Comedy Night', 'Sci-Fi Night', '+ Create "NIGHT"']);
  });

  test('shelves the title is on show as pills, not options', async () => {
    await openWithShelves(MANY, libraryItem({ shelf_ids: [3] }));
    fireEvent.focus(await searchBox());
    expect(screen.getByRole('button', { name: 'Remove from Favorites' })).toBeInTheDocument();
    expect(optionNames()).toEqual(NAMES.filter((name) => name !== 'Favorites'));
  });

  test('clicking a shelf adds the title and clears the box', async () => {
    axios.post.mockResolvedValue({ data: {} });
    await openWithShelves(MANY);
    const box = await searchBox();
    fireEvent.change(box, { target: { value: 'week' } });

    setRoutes({ item: libraryItem({ shelf_ids: [5] }) });
    fireEvent.click(screen.getByRole('option', { name: 'Weekend' }));

    expect(await screen.findByRole('button', { name: 'Remove from Weekend' })).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/shelves/5/items'),
      expect.objectContaining({ media_type: 'movie', source_id: 1 })
    );
    expect(box).toHaveValue('');
  });

  test('the ✕ on a pill removes the title from that shelf', async () => {
    axios.delete.mockResolvedValue({ data: {} });
    await openWithShelves(MANY, libraryItem({ shelf_ids: [3] }));

    setRoutes({ item: libraryItem() });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from Favorites' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove from Favorites' })).not.toBeInTheDocument()
    );
    expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/shelves/3/items/50'));
  });

  test('Enter picks the top match', async () => {
    axios.post.mockResolvedValue({ data: {} });
    await openWithShelves(MANY);
    const box = await searchBox();
    fireEvent.change(box, { target: { value: 'com' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/shelves/1/items'), expect.anything())
    );
  });

  test('Enter with an empty box does nothing', async () => {
    await openWithShelves(MANY);
    const box = await searchBox();
    fireEvent.focus(box);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('arrow keys choose an option, wrapping at the ends', async () => {
    axios.post.mockResolvedValue({ data: {} });
    await openWithShelves(MANY);
    const box = await searchBox();
    fireEvent.change(box, { target: { value: 'night' } });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Sci-Fi Night' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Comedy Night' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: '+ Create "night"' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Escape closes the list', async () => {
    await openWithShelves(MANY);
    const box = await searchBox();
    fireEvent.focus(box);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  test('a new name can be created, and the title added to it', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { ...SHELF, id: 9, name: 'Com' } })
      .mockResolvedValueOnce({ data: {} });
    await openWithShelves(MANY);
    const box = await searchBox();
    fireEvent.change(box, { target: { value: ' Com ' } });

    setRoutes({ item: libraryItem({ shelf_ids: [9] }) });
    fireEvent.click(screen.getByRole('option', { name: '+ Create "Com"' }));

    expect(await screen.findByRole('button', { name: 'Remove from Com' })).toBeInTheDocument();
    expect(axios.post).toHaveBeenNthCalledWith(1, expect.stringMatching(/\/shelves$/), { name: 'Com' });
    expect(axios.post).toHaveBeenNthCalledWith(2, expect.stringContaining('/shelves/9/items'), expect.anything());
  });

  test('Enter creates the shelf when nothing matches', async () => {
    axios.post.mockResolvedValue({ data: { ...SHELF, id: 9, name: 'New One' } });
    await openWithShelves(MANY);
    const box = await searchBox();
    fireEvent.change(box, { target: { value: 'New One' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/shelves$/), { name: 'New One' })
    );
  });

  test('an exact name, in any case, offers no Create', async () => {
    await openWithShelves(MANY);
    fireEvent.change(await searchBox(), { target: { value: 'favorites' } });
    expect(optionNames()).toEqual(['Favorites']);
  });

  test('typing a shelf the title is already on says so', async () => {
    await openWithShelves(MANY, libraryItem({ shelf_ids: [3] }));
    fireEvent.change(await searchBox(), { target: { value: 'favorites' } });
    expect(within(screen.getByRole('listbox')).queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByText('Already on Favorites')).toBeInTheDocument();
  });

  test('being on every shelf says so', async () => {
    await openWithShelves(MANY, libraryItem({ shelf_ids: [1, 2, 3, 4, 5] }));
    fireEvent.focus(await searchBox());
    expect(screen.getByText('This title is on all your shelves')).toBeInTheDocument();
  });

  test('a failed add shows the error and keeps what was typed', async () => {
    axios.post.mockRejectedValue({ response: { status: 500, data: {} } });
    await openWithShelves(MANY);
    const box = await searchBox();
    fireEvent.change(box, { target: { value: 'week' } });
    fireEvent.click(screen.getByRole('option', { name: 'Weekend' }));

    expect(await screen.findByText(/Something went wrong updating that shelf/)).toBeInTheDocument();
    expect(box).toHaveValue('week');
  });

  test('creating the 5th shelf switches to the search box', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { ...SHELF, id: 9, name: 'Fifth' } })
      .mockResolvedValueOnce({ data: {} });
    await openWithShelves(MANY.slice(0, 4));
    fireEvent.change(await screen.findByLabelText('New shelf name'), { target: { value: 'Fifth' } });
    setRoutes({ item: libraryItem({ shelf_ids: [9] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Create and add' }));

    expect(await screen.findByRole('button', { name: 'Remove from Fifth' })).toBeInTheDocument();
    expect(await searchBox()).toBeInTheDocument();
  });
});

describe('marking logged titles in search results', () => {
  test('a logged title shows its status and rating', async () => {
    setRoutes({
      search: searchResponse([DUNE, { ...DUNE, id: 2, title: 'Not Logged' }]),
      library: [libraryItem({ status: 'finished', rating: 8.5 })],
    });
    render(<App />);
    search('dune');

    expect(await screen.findByText('✓ Watched · ★ 8.5')).toBeInTheDocument();
    expect(screen.getAllByText(/^✓/)).toHaveLength(1);
  });

  test('a rating of 0 still shows', async () => {
    setRoutes({
      search: searchResponse([DUNE]),
      library: [libraryItem({ status: 'finished', rating: 0 })],
    });
    render(<App />);
    search('dune');
    expect(await screen.findByText('✓ Watched · ★ 0')).toBeInTheDocument();
  });

  test('a title with no status or rating says Logged', async () => {
    setRoutes({ search: searchResponse([DUNE]), library: [libraryItem({ review: 'Good' })] });
    render(<App />);
    search('dune');
    expect(await screen.findByText('✓ Logged')).toBeInTheDocument();
  });

  test('a movie and show with the same id are not confused', async () => {
    setRoutes({
      search: searchResponse([BREAKING_BAD]),
      library: [libraryItem({ media_type: 'movie', source_id: 1, status: 'finished' })],
    });
    render(<App />);
    search('breaking');
    await screen.findByText('Breaking Bad');
    await waitFor(() => expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/library$/)));
    await new Promise((resolve) => setTimeout(resolve));
    expect(screen.queryByText(/^✓/)).not.toBeInTheDocument();
  });

  test('coming back after logging shows the new mark', async () => {
    axios.put.mockResolvedValue({ data: libraryItem({ rating: 9 }) });
    setRoutes({ search: searchResponse([DUNE]) });
    render(<App />);
    search('dune');
    fireEvent.click(await screen.findByText('Dune'));
    await screen.findByLabelText('My rating');
    expect(screen.queryByText(/^✓/)).not.toBeInTheDocument();

    setRoutes({ library: [libraryItem({ status: 'finished', rating: 9 })] });
    fireEvent.click(screen.getByRole('button', { name: '← Back to results' }));

    expect(await screen.findByText('✓ Watched · ★ 9')).toBeInTheDocument();
  });

  test('results still show if the library cannot be loaded', async () => {
    setRoutes({
      search: searchResponse([DUNE]),
      library: { response: { status: 500, data: {} } },
    });
    render(<App />);
    search('dune');
    expect(await screen.findByText('Dune')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve));
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });

  test('no library request is made without results', async () => {
    render(<App />);
    search('zzz');
    await screen.findByText('No results found.');
    expect(axios.get).not.toHaveBeenCalledWith(expect.stringMatching(/\/library$/));
  });
});

describe('shows logged only by season', () => {
  const show = (counts) =>
    libraryItem({
      media_type: 'tv',
      title: 'Breaking Bad',
      season_counts: { want: 0, in_progress: 0, finished: 0, ...counts },
    });

  test.each([
    [{ finished: 1 }, 'Watched 1 season'],
    [{ finished: 3 }, 'Watched 3 seasons'],
    [{ finished: 2, in_progress: 1 }, 'Watching'],
    [{ want: 2 }, 'Want to watch'],
    [{ finished: 1, want: 2 }, 'Watched 1 season'],
  ])('with %j the library card says %s', async (counts, text) => {
    setRoutes({ library: [show(counts)] });
    render(<App />);
    goTo('My Library');
    await screen.findByText('Breaking Bad');
    expect(screen.getByText(text, { selector: 'p' })).toBeInTheDocument();
  });

  test('a show with its own status ignores its seasons', async () => {
    setRoutes({ library: [{ ...show({ finished: 3 }), status: 'want' }] });
    render(<App />);
    goTo('My Library');
    await screen.findByText('Breaking Bad');
    expect(screen.getByText('Want to watch', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText(/season/, { selector: 'p' })).not.toBeInTheDocument();
  });

  test('search results use the same words', async () => {
    setRoutes({ search: searchResponse([BREAKING_BAD]), library: [show({ finished: 2 })] });
    render(<App />);
    search('breaking');
    expect(await screen.findByText('✓ Watched 2 seasons')).toBeInTheDocument();
  });
});

describe('album pages', () => {
  const albumLibraryItem = (overrides = {}) =>
    libraryItem({ id: 60, source_id: 9, media_type: 'album', title: 'OK Computer', artists: 'Radiohead', ...overrides });
  const songItem = (trackIndex, title, overrides = {}) =>
    libraryItem({
      id: 70 + trackIndex,
      source_id: 9,
      media_type: 'song',
      track_index: trackIndex,
      title,
      album_title: 'OK Computer',
      artists: 'Radiohead',
      ...overrides,
    });

  async function openAlbum() {
    setRoutes({ music: [OK_COMPUTER] });
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Music' }));
    fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'Radiohead' } });
    clickSearch();
    fireEvent.click(await screen.findByText('OK Computer'));
    await screen.findByText('Airbag');
    return screen.findByLabelText('Status');
  }

  async function chooseSongs(...titles) {
    await openAlbum();
    fireEvent.click(screen.getByRole('radio', { name: 'Choose songs' }));
    titles.forEach((title) => fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(title) })));
  }

  test('opens with the tracklist and no movie recommendations', async () => {
    await openAlbum();
    expect(screen.getByRole('radio', { name: 'Whole album' })).toBeChecked();
    expect(screen.getByText('Paranoid Android')).toBeInTheDocument();
    expect(screen.getByText('4:44')).toBeInTheDocument();
    expect(screen.queryByText(/Recommended Movies/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View on Discogs' })).toHaveAttribute(
      'href',
      'https://www.discogs.com/master/9'
    );
  });

  test('uses listening words', async () => {
    const select = await openAlbum();
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'No status',
      'Want to listen',
      'Listening',
      'Listened',
    ]);
  });

  test('tracks can only be ticked after choosing songs', async () => {
    await openAlbum();
    const tracklist = screen.getByRole('region', { name: 'tracklist' });
    expect(within(tracklist).queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Choose songs' }));
    expect(within(tracklist).getAllByRole('checkbox')).toHaveLength(3);
  });

  test('logging the whole album saves one album entry and goes to My Library', async () => {
    axios.put.mockResolvedValue({ data: albumLibraryItem({ rating: 9 }) });
    await openAlbum();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'finished' } });
    fireEvent.change(screen.getByLabelText('My rating'), { target: { value: '9.25' } });
    fireEvent.change(screen.getByLabelText('Review'), { target: { value: 'Great' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('region', { name: 'my library' })).toBeInTheDocument();
    expect(axios.put).toHaveBeenCalledTimes(1);
    const [url, body] = axios.put.mock.calls[0];
    expect(url).toMatch(/\/library\/album\/9$/);
    expect(body).toMatchObject({
      title: 'OK Computer',
      artists: 'Radiohead',
      status: 'finished',
      rating: 9.25,
      review: 'Great',
    });
  });

  test('logging chosen songs saves them together and goes to My Library', async () => {
    axios.put.mockResolvedValue({ data: [] });
    await chooseSongs('Airbag', 'Karma Police');
    expect(screen.getByText(/2 songs selected/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('My rating'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('region', { name: 'my library' })).toBeInTheDocument();
    const [url, body] = axios.put.mock.calls[0];
    expect(url).toMatch(/\/library\/album\/9\/songs$/);
    expect(body.tracks).toEqual([
      { track_index: 0, title: 'Airbag' },
      { track_index: 2, title: 'Karma Police' },
    ]);
    expect(body).toMatchObject({ title: 'OK Computer', artists: 'Radiohead', rating: 9 });
  });

  test('saving needs at least one song chosen', async () => {
    await chooseSongs();
    fireEvent.change(screen.getByLabelText('My rating'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Choose at least one song to log.')).toBeInTheDocument();
    expect(axios.put).not.toHaveBeenCalled();
  });

  test('unticking a song leaves it out', async () => {
    axios.put.mockResolvedValue({ data: [] });
    await chooseSongs('Airbag', 'Karma Police');
    fireEvent.click(screen.getByRole('checkbox', { name: /Airbag/ }));
    fireEvent.change(screen.getByLabelText('My rating'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(axios.put).toHaveBeenCalled());
    expect(axios.put.mock.calls[0][1].tracks).toEqual([{ track_index: 2, title: 'Karma Police' }]);
  });

  test('an existing album log fills the form', async () => {
    setRoutes({ albumItem: albumLibraryItem({ status: 'in_progress', rating: 7.5 }) });
    await openAlbum();
    expect(screen.getByLabelText('Status')).toHaveValue('in_progress');
    expect(screen.getByLabelText('My rating')).toHaveValue('7.5');
  });

  test('logged songs are marked in the tracklist', async () => {
    setRoutes({ albumSongs: [songItem(2, 'Karma Police', { status: 'finished', rating: 9 })] });
    await openAlbum();
    expect(await screen.findByText('✓ Listened · ★ 9')).toBeInTheDocument();
  });

  test('choosing one logged song opens its log, and it can be cleared', async () => {
    setRoutes({ albumSongs: [songItem(2, 'Karma Police', { status: 'finished', rating: 9 })] });
    axios.delete.mockResolvedValue({ data: null });
    await chooseSongs('Karma Police');
    expect(screen.getByLabelText('My rating')).toHaveValue('9');

    setRoutes({ albumSongs: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Clear log' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, clear' }));

    await waitFor(() =>
      expect(axios.delete).toHaveBeenCalledWith(expect.stringMatching(/\/library\/song\/9\/2$/))
    );
    await waitFor(() => expect(screen.queryByText('✓ Listened · ★ 9')).not.toBeInTheDocument());
  });

  test('saving over logged songs warns first', async () => {
    setRoutes({ albumSongs: [songItem(0, 'Airbag', { rating: 5 })] });
    await chooseSongs('Airbag', 'Karma Police');
    expect(screen.getByText(/1 of these is already logged. Saving replaces its log./)).toBeInTheDocument();
  });

  test('switching to whole album keeps the chosen songs out of it', async () => {
    axios.put.mockResolvedValue({ data: albumLibraryItem({ rating: 8 }) });
    await chooseSongs('Airbag');
    fireEvent.click(screen.getByRole('radio', { name: 'Whole album' }));
    fireEvent.change(screen.getByLabelText('My rating'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(axios.put).toHaveBeenCalled());
    expect(axios.put.mock.calls[0][0]).toMatch(/\/library\/album\/9$/);
    expect(axios.put.mock.calls[0][1].tracks).toBeUndefined();
  });

  test('the whole album can go on a shelf', async () => {
    setRoutes({ shelves: [SHELF] });
    axios.post.mockResolvedValue({ data: {} });
    await openAlbum();
    setRoutes({ albumItem: albumLibraryItem({ shelf_ids: [5] }) });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Favorites' }));

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Favorites' })).toBeChecked());
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/shelves/5/items'),
      expect.objectContaining({ media_type: 'album', source_id: 9, artists: 'Radiohead' })
    );
  });

  test('if tracks fail to load, the whole album can still be logged', async () => {
    setRoutes({ album: { response: { status: 429, data: { detail: 'Rate limited by Discogs' } } } });
    setRoutes({ music: [OK_COMPUTER] });
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Music' }));
    fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'Radiohead' } });
    clickSearch();
    fireEvent.click(await screen.findByText('OK Computer'));

    expect(await screen.findByText('Rate limited by Discogs')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Choose songs' })).toBeDisabled();
  });

  test('an album with no tracklist says so', async () => {
    setRoutes({ album: { ...ALBUM, tracks: [] } });
    setRoutes({ music: [OK_COMPUTER] });
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Music' }));
    fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'Radiohead' } });
    clickSearch();
    fireEvent.click(await screen.findByText('OK Computer'));
    expect(await screen.findByText('No tracklist available for this album.')).toBeInTheDocument();
  });

  test('opening an album from My Library shows its page', async () => {
    setRoutes({ library: [albumLibraryItem({ status: 'finished', rating: 9 })], albumItem: albumLibraryItem({ status: 'finished', rating: 9 }) });
    render(<App />);
    goTo('My Library');
    expect(await screen.findByText('Listened', { selector: 'p' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('OK Computer'));

    expect(await screen.findByText('Airbag')).toBeInTheDocument();
    expect(await screen.findByLabelText('My rating')).toHaveValue('9');
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/albums/9'));
  });

  test('a song opens from My Library and saves to itself', async () => {
    const song = songItem(2, 'Karma Police', { status: 'finished', rating: 9 });
    setRoutes({ library: [song], item: song });
    axios.put.mockResolvedValue({ data: song });
    render(<App />);
    goTo('My Library');
    expect(await screen.findByText('OK Computer')).toBeInTheDocument();
    expect(screen.getByText('Song')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Karma Police'));

    fireEvent.change(await screen.findByLabelText('My rating'), { target: { value: '8' } });
    expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/library\/song\/9\/2$/));
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(axios.put).toHaveBeenCalled());
    expect(axios.put.mock.calls[0][0]).toMatch(/\/library\/song\/9\/2$/);
    expect(axios.put.mock.calls[0][1]).toMatchObject({ title: 'Karma Police', album_title: 'OK Computer', rating: 8 });
  });

  test('a song goes on a shelf using its place on the album', async () => {
    const song = songItem(2, 'Karma Police', { rating: 9 });
    setRoutes({ library: [song], item: song, shelves: [SHELF] });
    axios.post.mockResolvedValue({ data: {} });
    render(<App />);
    goTo('My Library');
    fireEvent.click(await screen.findByText('Karma Police'));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Favorites' }));

    await waitFor(() => expect(axios.post).toHaveBeenCalled());
    expect(axios.post.mock.calls[0][1]).toMatchObject({ media_type: 'song', source_id: 9, track_index: 2 });
  });

  test('music search results are marked when logged', async () => {
    setRoutes({
      music: [OK_COMPUTER],
      library: [albumLibraryItem({ status: 'finished', rating: 9 })],
    });
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Music' }));
    fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'Radiohead' } });
    clickSearch();
    expect(await screen.findByText('✓ Listened · ★ 9')).toBeInTheDocument();
  });

  test('music in the All search is marked when logged', async () => {
    setRoutes({ musicText: [OK_COMPUTER], library: [albumLibraryItem({ rating: 9 })] });
    render(<App />);
    search('radiohead');
    expect(await screen.findByText('✓ Logged · ★ 9')).toBeInTheDocument();
  });

  test('My Library can filter to albums or songs', async () => {
    render(<App />);
    goTo('My Library');
    await screen.findByText(/Nothing logged yet/);
    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'song' } });
    await waitFor(() =>
      expect(axios.get).toHaveBeenLastCalledWith(expect.stringContaining('/library'), {
        params: { media_type: 'song' },
      })
    );
  });
});

describe('pagination', () => {
  const manyItems = (count) =>
    Array.from({ length: count }, (_, index) =>
      libraryItem({ id: index + 1, source_id: index + 1, title: `Title ${index + 1}` })
    );
  const manyShelves = (count) =>
    Array.from({ length: count }, (_, index) => ({ ...SHELF, id: index + 1, name: `Shelf ${index + 1}` }));
  const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
  const previous = () => fireEvent.click(screen.getByRole('button', { name: '← Previous' }));

  describe('My Library', () => {
    test('exactly one page of titles has no paging', async () => {
      setRoutes({ library: manyItems(10) });
      render(<App />);
      goTo('My Library');
      await screen.findByText('Title 10');
      expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
    });

    test('shows 10 titles a page and moves between pages', async () => {
      setRoutes({ library: manyItems(25) });
      render(<App />);
      goTo('My Library');
      await screen.findByText('Title 1');
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
      expect(screen.getByText('Title 10')).toBeInTheDocument();
      expect(screen.queryByText('Title 11')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '← Previous' })).toBeDisabled();

      next();
      expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
      expect(screen.getByText('Title 11')).toBeInTheDocument();
      expect(screen.queryByText('Title 1')).not.toBeInTheDocument();

      next();
      expect(screen.getByText('Title 25')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Next →' })).toBeDisabled();

      previous();
      expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    });

    test.each([
      ['Sort by', 'finished:desc'],
      ['Filter by type', 'album'],
      ['Filter by status', 'finished'],
    ])('changing %s goes back to the first page', async (label, value) => {
      setRoutes({ library: manyItems(25) });
      render(<App />);
      goTo('My Library');
      await screen.findByText('Title 1');
      next();
      expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(label), { target: { value } });

      expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    });

    test('coming back from a title stays on the same page', async () => {
      setRoutes({ library: manyItems(25), item: libraryItem() });
      render(<App />);
      goTo('My Library');
      await screen.findByText('Title 1');
      next();
      fireEvent.click(screen.getByText('Title 11'));
      await screen.findByLabelText('My rating');

      fireEvent.click(screen.getByRole('button', { name: '← Back to My Library' }));

      expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
      expect(screen.getByText('Title 11')).toBeInTheDocument();
    });

    test('a filter that shrinks the list falls back to a page that exists', async () => {
      setRoutes({ library: manyItems(25) });
      render(<App />);
      goTo('My Library');
      await screen.findByText('Title 1');
      next();
      next();
      fireEvent.click(screen.getByText('Title 25'));
      setRoutes({ item: libraryItem({ rating: 1 }), library: manyItems(5) });
      await screen.findByLabelText('My rating');
      fireEvent.click(screen.getByRole('button', { name: '← Back to My Library' }));

      expect(await screen.findByText('Title 5')).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
    });

    test('moving between pages returns to the top', async () => {
      const scrollTo = vi.fn();
      window.scrollTo = scrollTo;
      setRoutes({ library: manyItems(25) });
      render(<App />);
      goTo('My Library');
      await screen.findByText('Title 1');
      scrollTo.mockClear();
      next();
      expect(scrollTo).toHaveBeenCalledWith(0, 0);
    });
  });

  describe('Shelves', () => {
    test('shows 10 shelves a page', async () => {
      setRoutes({ shelves: manyShelves(15) });
      render(<App />);
      goTo('Shelves');
      await screen.findByText('Shelf 1');
      expect(screen.getByText('Shelf 10')).toBeInTheDocument();
      expect(screen.queryByText('Shelf 11')).not.toBeInTheDocument();
      next();
      expect(screen.getByText('Shelf 15')).toBeInTheDocument();
    });

    test('a few shelves have no paging', async () => {
      setRoutes({ shelves: manyShelves(3) });
      render(<App />);
      goTo('Shelves');
      await screen.findByText('Shelf 3');
      expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
    });
  });

  describe('inside a shelf', () => {
    function openLongShelf(count = 15) {
      window.history.replaceState(null, '', '/?view=shelves&shelf=5');
      setRoutes({ shelf: { ...SHELF, items: manyItems(count) } });
      render(<App />);
      return screen.findByText('Title 1');
    }

    function rowNumbers() {
      return [...document.querySelectorAll('.shelf-item-number')].map((el) => el.textContent);
    }

    test('shows 10 titles a page, numbered across pages', async () => {
      await openLongShelf();
      expect(screen.queryByText('Title 11')).not.toBeInTheDocument();
      expect(rowNumbers().slice(0, 2)).toEqual(['1', '2']);
      next();
      expect(screen.getByText('Title 11')).toBeInTheDocument();
      expect(rowNumbers()[0]).toBe('11');
    });

    test('reordering on a later page keeps the whole shelf in order', async () => {
      axios.put.mockImplementation((url, body) =>
        Promise.resolve({
          data: {
            ...SHELF,
            items: body.item_ids.map((id) => manyItems(15).find((item) => item.id === id)),
          },
        })
      );
      await openLongShelf();
      next();
      fireEvent.click(screen.getByRole('button', { name: 'Move Title 12 down' }));

      await waitFor(() => expect(axios.put).toHaveBeenCalled());
      const ids = axios.put.mock.calls[0][1].item_ids;
      expect(ids).toHaveLength(15);
      expect(ids.slice(10, 13)).toEqual([11, 13, 12]);
    });

    test('moving a title across a page edge follows it', async () => {
      axios.put.mockImplementation((url, body) =>
        Promise.resolve({
          data: {
            ...SHELF,
            items: body.item_ids.map((id) => manyItems(15).find((item) => item.id === id)),
          },
        })
      );
      await openLongShelf();
      fireEvent.click(screen.getByRole('button', { name: 'Move Title 10 down' }));

      expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
      expect(rowNumbers()[0]).toBe('11');
      expect(document.querySelector('.shelf-item .season-name').textContent).toBe('Title 10');
    });

    test('the very first and last titles still cannot move further', async () => {
      await openLongShelf();
      expect(screen.getByRole('button', { name: 'Move Title 1 up' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move Title 10 down' })).toBeEnabled();
      next();
      expect(screen.getByRole('button', { name: 'Move Title 11 up' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Move Title 15 down' })).toBeDisabled();
    });

    test('dragging on a later page uses the right positions', async () => {
      axios.put.mockImplementation((url, body) =>
        Promise.resolve({
          data: {
            ...SHELF,
            items: body.item_ids.map((id) => manyItems(15).find((item) => item.id === id)),
          },
        })
      );
      await openLongShelf();
      next();
      const rows = document.querySelectorAll('.shelf-item');
      fireEvent.dragStart(rows[2], { dataTransfer: { effectAllowed: '' } });
      fireEvent.dragOver(rows[0]);
      fireEvent.drop(rows[0]);

      await waitFor(() => expect(axios.put).toHaveBeenCalled());
      expect(axios.put.mock.calls[0][1].item_ids.slice(10, 13)).toEqual([13, 11, 12]);
    });

    test('removing the only title on the last page goes back a page', async () => {
      await openLongShelf(11);
      next();
      axios.delete.mockResolvedValue({ data: { ...SHELF, items: manyItems(10) } });
      fireEvent.click(screen.getByRole('button', { name: 'Remove Title 11 from shelf' }));

      expect(await screen.findByText('Title 10')).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
    });
  });

  test('search result marks still see the whole library', async () => {
    setRoutes({
      search: searchResponse([{ ...DUNE, id: 45, title: 'Late Title' }]),
      library: manyItems(45).map((item) => ({ ...item, status: 'finished' })),
    });
    render(<App />);
    search('late');
    expect(await screen.findByText('✓ Watched')).toBeInTheDocument();
  });
});

describe('searching lists', () => {
  const typeIn = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const title = (id, name, overrides = {}) => libraryItem({ id, source_id: id, title: name, ...overrides });
  const MIXED = [
    title(1, 'Dune'),
    title(2, 'Airbag', { media_type: 'song', artists: 'Radiohead', album_title: 'OK Computer' }),
    title(3, 'OK Computer', { media_type: 'album', artists: 'Radiohead' }),
    title(4, 'Ágætis byrjun', { media_type: 'album', artists: 'Sigur Rós' }),
  ];
  const many = (count) => Array.from({ length: count }, (_, i) => title(i + 1, `Title ${i + 1}`));

  describe('My Library', () => {
    async function openLibrary(library = MIXED) {
      setRoutes({ library });
      render(<App />);
      goTo('My Library');
      await screen.findByLabelText('Search your library');
      await screen.findByText(library[0].title);
    }

    test.each([
      ['dune', ['Dune']],
      ['DUNE', ['Dune']],
      ['radiohead', ['Airbag', 'OK Computer']],
      ['ok computer', ['Airbag', 'OK Computer']],
      ['airbag radiohead', ['Airbag']],
      ['sigur ros', ['Ágætis byrjun']],
      ['  dune  ', ['Dune']],
    ])('searching %j finds %j', async (query, expected) => {
      await openLibrary();
      typeIn('Search your library', query);
      const shown = [...document.querySelectorAll('.result-info h2')].map((el) => el.textContent);
      expect(shown).toEqual(expected);
    });

    test('says when nothing matches', async () => {
      await openLibrary();
      typeIn('Search your library', 'zzz');
      expect(screen.getByText('Nothing in your library matches “zzz”.')).toBeInTheDocument();
      expect(screen.queryByText(/Nothing logged yet/)).not.toBeInTheDocument();
    });

    test('searches every page, not just the one showing', async () => {
      await openLibrary(many(25));
      expect(screen.queryByText('Title 25')).not.toBeInTheDocument();
      typeIn('Search your library', 'title 25');
      expect(screen.getByText('Title 25')).toBeInTheDocument();
    });

    test('searching goes back to the first page, and results are paged', async () => {
      await openLibrary(many(25));
      fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
      expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();

      typeIn('Search your library', 'title 1');
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
      expect(screen.getByText('Title 1')).toBeInTheDocument();

      typeIn('Search your library', '');
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    });

    test('works with the filters, without another search request', async () => {
      await openLibrary();
      typeIn('Filter by type', 'album');
      setRoutes({ library: MIXED.filter((item) => item.media_type === 'album') });
      await waitFor(() => expect(screen.queryByText('Dune')).toBeInTheDocument());
      typeIn('Search your library', 'radiohead');
      expect(screen.getByText('Airbag')).toBeInTheDocument();
      expect(screen.getByLabelText('Search your library')).toHaveValue('radiohead');
    });

    test('the search stays when coming back from a title', async () => {
      await openLibrary();
      typeIn('Search your library', 'dune');
      fireEvent.click(screen.getByText('Dune'));
      await screen.findByLabelText('My rating');
      fireEvent.click(screen.getByRole('button', { name: '← Back to My Library' }));

      await screen.findByLabelText('Search your library');
      expect(screen.getByLabelText('Search your library')).toHaveValue('dune');
      expect(await screen.findByText('Dune')).toBeInTheDocument();
      expect(screen.queryByText('Airbag')).not.toBeInTheDocument();
    });
  });

  describe('the Shelves page', () => {
    const shelves = [
      { ...SHELF, id: 1, name: 'Comedy Night' },
      { ...SHELF, id: 2, name: 'Sci-Fi Night' },
      { ...SHELF, id: 3, name: 'Favorites' },
    ];

    async function openShelves(list = shelves) {
      setRoutes({ shelves: list });
      render(<App />);
      goTo('Shelves');
      await screen.findByText(list[0].name);
    }

    test('searches shelf names', async () => {
      await openShelves();
      typeIn('Search your shelves', 'NIGHT');
      expect(screen.getByText('Comedy Night')).toBeInTheDocument();
      expect(screen.getByText('Sci-Fi Night')).toBeInTheDocument();
      expect(screen.queryByText('Favorites')).not.toBeInTheDocument();
    });

    test('says when nothing matches', async () => {
      await openShelves();
      typeIn('Search your shelves', 'zzz');
      expect(screen.getByText('No shelves match “zzz”.')).toBeInTheDocument();
    });

    test('searches every page', async () => {
      await openShelves(Array.from({ length: 15 }, (_, i) => ({ ...SHELF, id: i + 1, name: `Shelf ${i + 1}` })));
      expect(screen.queryByText('Shelf 15')).not.toBeInTheDocument();
      typeIn('Search your shelves', 'shelf 15');
      expect(screen.getByText('Shelf 15')).toBeInTheDocument();
    });

    test('searching does not create a shelf', async () => {
      await openShelves();
      typeIn('Search your shelves', 'new');
      expect(screen.getByLabelText('New shelf name')).toHaveValue('');
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  describe('inside a shelf', () => {
    function numberOf(name) {
      const row = screen.getByText(name).closest('li');
      return row.querySelector('.shelf-item-number').textContent;
    }

    async function openShelf(items = MIXED) {
      window.history.replaceState(null, '', '/?view=shelves&shelf=5');
      setRoutes({ shelf: { ...SHELF, items } });
      render(<App />);
      await screen.findByText(items[0].title);
    }

    test('searches titles and artists, keeping their shelf numbers', async () => {
      await openShelf();
      typeIn('Search this shelf', 'radiohead');
      expect(screen.queryByText('Dune')).not.toBeInTheDocument();
      expect(numberOf('Airbag')).toBe('2');
      expect(numberOf('OK Computer')).toBe('3');
    });

    test('searches every page', async () => {
      await openShelf(many(15));
      expect(screen.queryByText('Title 15')).not.toBeInTheDocument();
      typeIn('Search this shelf', 'title 15');
      expect(numberOf('Title 15')).toBe('15');
    });

    test('says when nothing matches', async () => {
      await openShelf();
      typeIn('Search this shelf', 'zzz');
      expect(screen.getByText('Nothing on this shelf matches “zzz”.')).toBeInTheDocument();
    });

    test('reordering is off while searching and comes back after', async () => {
      await openShelf();
      expect(screen.getByRole('button', { name: 'Move Dune down' })).toBeInTheDocument();

      typeIn('Search this shelf', 'radiohead');
      expect(screen.getByText(/To reorder this shelf, use Shelf order/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
      expect(screen.getByText('Airbag').closest('li')).toHaveAttribute('draggable', 'false');

      typeIn('Search this shelf', '');
      expect(screen.getByRole('button', { name: 'Move Dune down' })).toBeInTheDocument();
      expect(screen.getByText('Airbag').closest('li')).toHaveAttribute('draggable', 'true');
    });

    test('a title can be removed while searching', async () => {
      await openShelf();
      axios.delete.mockResolvedValue({ data: { ...SHELF, items: MIXED.filter((item) => item.id !== 2) } });
      typeIn('Search this shelf', 'radiohead');
      fireEvent.click(screen.getByRole('button', { name: 'Remove Airbag from shelf' }));

      await waitFor(() => expect(screen.queryByText('Airbag')).not.toBeInTheDocument());
      expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/shelves/5/items/2'));
      expect(screen.getByText('OK Computer')).toBeInTheDocument();
      expect(screen.getByLabelText('Search this shelf')).toHaveValue('radiohead');
    });

    test('an empty shelf has no search box', async () => {
      window.history.replaceState(null, '', '/?view=shelves&shelf=5');
      setRoutes({ shelf: { ...SHELF, items: [] } });
      render(<App />);
      await screen.findByText(/This shelf is empty/);
      expect(screen.queryByLabelText('Search this shelf')).not.toBeInTheDocument();
    });
  });
});

describe('sorting and filtering a shelf', () => {
  const entry = (id, name, overrides = {}) =>
    libraryItem({
      id,
      source_id: id,
      title: name,
      updated_at: `2026-01-0${id} 00:00:00`,
      finished_sort_date: null,
      finished_date: null,
      season_counts: { want: 0, in_progress: 0, finished: 0 },
      ...overrides,
    });
  const ITEMS = [
    entry(1, 'Charlie', {
      status: 'finished',
      rating: 5,
      year: '2010',
      release_date: '2010-05-01',
      finished_sort_date: '2026-01-01',
      finished_date: '2026-01-01',
    }),
    entry(2, 'Alpha', {
      status: 'want',
      rating: null,
      year: null,
      release_date: null,
    }),
    entry(3, 'Bravo', {
      status: 'in_progress',
      rating: 9.5,
      year: '2024',
      release_date: '2024-03-01',
      finished_sort_date: '2026-11-03',
      media_type: 'album',
    }),
    entry(4, 'Delta', {
      status: 'finished',
      rating: 0,
      year: '1990',
      release_date: null,
      finished_sort_date: '2020-06-01',
      finished_date: '2020-06-01',
      media_type: 'tv',
    }),
  ];

  const order = () => [...document.querySelectorAll('.shelf-item .season-name')].map((el) => el.textContent);
  const choose = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  async function openShelf(items = ITEMS) {
    window.history.replaceState(null, '', '/?view=shelves&shelf=5');
    setRoutes({ shelf: { ...SHELF, items } });
    render(<App />);
    await screen.findByText(items[0].title);
  }

  test('starts in shelf order, with reordering available', async () => {
    await openShelf();
    expect(screen.getByLabelText('Sort by')).toHaveValue('shelf');
    expect(order()).toEqual(['Charlie', 'Alpha', 'Bravo', 'Delta']);
    expect(screen.getByRole('button', { name: 'Move Alpha up' })).toBeInTheDocument();
  });

  test.each([
    ['finished:desc', ['Alpha', 'Bravo', 'Charlie', 'Delta']],
    ['finished:asc', ['Delta', 'Charlie', 'Bravo', 'Alpha']],
    ['release:desc', ['Alpha', 'Bravo', 'Charlie', 'Delta']],
    ['release:asc', ['Delta', 'Charlie', 'Bravo', 'Alpha']],
    ['status', ['Bravo', 'Alpha', 'Charlie', 'Delta']],
    ['rating:desc', ['Bravo', 'Charlie', 'Delta', 'Alpha']],
    ['rating:asc', ['Delta', 'Charlie', 'Bravo', 'Alpha']],
    ['title', ['Alpha', 'Bravo', 'Charlie', 'Delta']],
    ['changed:desc', ['Delta', 'Bravo', 'Alpha', 'Charlie']],
  ])('sorting by %s gives %j', async (option, expected) => {
    await openShelf();
    choose('Sort by', option);
    expect(order()).toEqual(expected);
  });

  test('going back to Shelf order restores it', async () => {
    await openShelf();
    choose('Sort by', 'title');
    choose('Sort by', 'shelf');
    expect(order()).toEqual(['Charlie', 'Alpha', 'Bravo', 'Delta']);
  });

  test('sorting never saves a new order', async () => {
    await openShelf();
    choose('Sort by', 'title');
    choose('Sort by', 'rating:desc');
    expect(axios.put).not.toHaveBeenCalled();
  });

  test.each([
    ['Sort by', 'title'],
    ['Filter by type', 'album'],
    ['Filter by status', 'finished'],
  ])('reordering is off with %s changed', async (label, value) => {
    await openShelf();
    choose(label, value);

    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
    expect(screen.getByText(/To reorder this shelf, use Shelf order/)).toBeInTheDocument();
    expect(document.querySelector('.shelf-item')).toHaveAttribute('draggable', 'false');
  });

  test('titles keep their shelf numbers when sorted', async () => {
    await openShelf();
    choose('Sort by', 'title');
    const row = screen.getByText('Alpha').closest('li');
    expect(row.querySelector('.shelf-item-number').textContent).toBe('2');
  });

  test('sorted titles can still be removed, staying sorted', async () => {
    await openShelf();
    axios.delete.mockResolvedValue({ data: { ...SHELF, items: ITEMS.filter((item) => item.id !== 2) } });
    choose('Sort by', 'title');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alpha from shelf' }));

    await waitFor(() => expect(order()).toEqual(['Bravo', 'Charlie', 'Delta']));
    expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/shelves/5/items/2'));
  });

  test('filters by type', async () => {
    await openShelf();
    choose('Filter by type', 'album');
    expect(order()).toEqual(['Bravo']);
  });

  test('filters by status', async () => {
    await openShelf();
    choose('Filter by status', 'finished');
    expect(order()).toEqual(['Charlie', 'Delta']);
  });

  test('a show logged only by season counts under its seasons', async () => {
    await openShelf([
      entry(1, 'First', { status: 'want' }),
      entry(2, 'Season Show', {
        media_type: 'tv',
        season_counts: { want: 0, in_progress: 1, finished: 2 },
      }),
    ]);
    choose('Filter by status', 'finished');
    expect(order()).toEqual(['Season Show']);
    expect(screen.getByText(/Watching/)).toBeInTheDocument();

    choose('Filter by status', '');
    choose('Sort by', 'status');
    expect(order()).toEqual(['Season Show', 'First']);
  });

  test('filters, sorting and search work together', async () => {
    await openShelf();
    choose('Filter by status', 'finished');
    choose('Sort by', 'title');
    expect(order()).toEqual(['Charlie', 'Delta']);
    fireEvent.change(screen.getByLabelText('Search this shelf'), { target: { value: 'del' } });
    expect(order()).toEqual(['Delta']);
  });

  test('says when no titles match the filters', async () => {
    await openShelf();
    choose('Filter by type', 'song');
    expect(screen.getByText('Nothing on this shelf matches these filters.')).toBeInTheDocument();
  });

  test('sorted titles are paged, and sorting returns to the first page', async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      entry(i + 1, `Title ${String(i + 1).padStart(2, '0')}`, { rating: i })
    );
    await openShelf(many);
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();

    choose('Sort by', 'rating:desc');

    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(order()[0]).toBe('Title 15');
    expect(order()).toHaveLength(10);
  });

  test('rows show the date being sorted by', async () => {
    await openShelf();
    choose('Sort by', 'finished:desc');
    expect(screen.getByText('Watched Jan 1, 2026')).toBeInTheDocument();
    choose('Sort by', 'release:desc');
    expect(screen.getByText(/Released May 1, 2010/)).toBeInTheDocument();
  });

  test('sorting by release date fills in missing dates', async () => {
    await openShelf();
    axios.get.mockClear();
    choose('Sort by', 'release:desc');
    await waitFor(() =>
      expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/shelves\/5$/), {
        params: { fill_release_dates: true },
      })
    );
  });

  test('a failed date lookup still sorts', async () => {
    await openShelf();
    setRoutes({ shelf: { response: { status: 500, data: {} } } });
    choose('Sort by', 'release:asc');
    await new Promise((resolve) => setTimeout(resolve));
    expect(order()[0]).toBe('Delta');
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });
});

test('My Library lists logged titles with my rating', async () => {
  setRoutes({ library: [libraryItem({ status: 'finished', rating: 8.5 })] });
  render(<App />);
  goTo('My Library');

  expect(await screen.findByText('Dune')).toBeInTheDocument();
  expect(screen.getByText('Watched', { selector: 'p' })).toBeInTheDocument();
  expect(screen.getByText('★ 8.5 / 10')).toBeInTheDocument();
  expect(window.location.search).toBe('?view=library');
});

test('My Library filters by status', async () => {
  render(<App />);
  goTo('My Library');
  await screen.findByText(/Nothing logged yet/);

  fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'want' } });

  await screen.findByText(/matches these filters/);
  expect(axios.get).toHaveBeenLastCalledWith(expect.stringContaining('/library'), {
    params: { status: 'want' },
  });
});

describe('sorting My Library', () => {
  test('starts with the most recently changed, sending no sort', async () => {
    render(<App />);
    goTo('My Library');
    await screen.findByText(/Nothing logged yet/);

    expect(screen.getByLabelText('Sort by')).toHaveValue('changed:desc');
    expect(axios.get).toHaveBeenLastCalledWith(expect.stringContaining('/library'), { params: {} });
  });

  test.each([
    ['finished:desc', 'finished', 'desc'],
    ['finished:asc', 'finished', 'asc'],
    ['release:desc', 'release', 'desc'],
    ['release:asc', 'release', 'asc'],
    ['rating:desc', 'rating', 'desc'],
    ['rating:asc', 'rating', 'asc'],
  ])('choosing %s asks for that order', async (option, sort, order) => {
    render(<App />);
    goTo('My Library');
    await screen.findByText(/Nothing logged yet/);

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: option } });

    await waitFor(() =>
      expect(axios.get).toHaveBeenLastCalledWith(expect.stringContaining('/library'), {
        params: { sort, order },
      })
    );
  });

  test.each(['status', 'title'])('choosing %s has no direction to send', async (option) => {
    render(<App />);
    goTo('My Library');
    await screen.findByText(/Nothing logged yet/);

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: option } });

    await waitFor(() =>
      expect(axios.get).toHaveBeenLastCalledWith(expect.stringContaining('/library'), {
        params: { sort: option },
      })
    );
  });

  test('offers the same sorts as a shelf, apart from shelf order', async () => {
    render(<App />);
    goTo('My Library');
    const options = within(await screen.findByLabelText('Sort by'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual([
      'Recently changed',
      'Date finished: newest first',
      'Date finished: oldest first',
      'Release date: newest first',
      'Release date: oldest first',
      'Status',
      'Rating: highest first',
      'Rating: lowest first',
      'Title: A to Z',
    ]);
  });

  test('sorting combines with filters', async () => {
    render(<App />);
    goTo('My Library');
    await screen.findByText(/Nothing logged yet/);

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'finished:asc' } });
    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'tv' } });

    await waitFor(() =>
      expect(axios.get).toHaveBeenLastCalledWith(expect.stringContaining('/library'), {
        params: { media_type: 'tv', sort: 'finished', order: 'asc' },
      })
    );
  });

  test('titles appear in the order the backend sends', async () => {
    setRoutes({
      library: [
        libraryItem({ id: 1, source_id: 1, title: 'First' }),
        libraryItem({ id: 2, source_id: 2, title: 'Second' }),
      ],
    });
    render(<App />);
    goTo('My Library');
    await screen.findByText('First');

    const shown = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(shown.indexOf('First')).toBeLessThan(shown.indexOf('Second'));
  });

  test('the date being sorted by shows on each card', async () => {
    setRoutes({
      library: [
        libraryItem({
          status: 'finished',
          finished_date: '2026-11-03',
          release_date: '2021-09-15',
        }),
      ],
    });
    render(<App />);
    goTo('My Library');
    await screen.findByText('Dune');
    expect(screen.queryByText(/^Watched .*2026/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'finished:desc' } });
    expect(await screen.findByText('Watched Nov 3, 2026')).toBeInTheDocument();
    expect(screen.queryByText('Watched', { selector: 'p' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'release:desc' } });
    expect(await screen.findByText('Released Sep 15, 2021')).toBeInTheDocument();
  });

  test('a title with only a release year shows the year', async () => {
    setRoutes({ library: [libraryItem({ rating: 1, release_date: null, year: '2021' })] });
    render(<App />);
    goTo('My Library');
    await screen.findByText('Dune');

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'release:desc' } });

    expect(await screen.findByText('Released 2021')).toBeInTheDocument();
  });

  test('titles with no watched date show none', async () => {
    setRoutes({ library: [libraryItem({ status: 'want', finished_date: null })] });
    render(<App />);
    goTo('My Library');
    fireEvent.change(await screen.findByLabelText('Sort by'), { target: { value: 'finished:desc' } });

    await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/^Watched /)).not.toBeInTheDocument();
  });

  test('saving a log keeps the release date', async () => {
    axios.put.mockResolvedValue({ data: libraryItem({ rating: 8 }) });
    await openFromSearch({ ...DUNE, release_date: '2021-09-15' });
    fireEvent.change(await screen.findByLabelText('My rating'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(axios.put).toHaveBeenCalled());
    expect(axios.put.mock.calls[0][1].release_date).toBe('2021-09-15');
  });
});

describe('status words', () => {
  function optionLabels(select) {
    return within(select).getAllByRole('option').map((option) => option.textContent);
  }

  test.each([
    ['a movie', DUNE],
    ['a show', BREAKING_BAD],
  ])('%s uses watch words', async (_, item) => {
    await openFromSearch(item);
    expect(optionLabels(await screen.findByLabelText('Status'))).toEqual([
      'No status',
      'Want to watch',
      'Watching',
      'Watched',
    ]);
  });

  test('season rows use watch words', async () => {
    await openFromSearch(BREAKING_BAD);
    expect(optionLabels(await screen.findByLabelText('Season 1 status'))).toContain('Watched');
  });

  test('the My Library filter uses words that fit every type', async () => {
    render(<App />);
    goTo('My Library');
    expect(optionLabels(await screen.findByLabelText('Filter by status'))).toEqual([
      'Any status',
      'Planned',
      'In progress',
      'Finished',
    ]);
  });

  test('the My Library sort says date finished', async () => {
    render(<App />);
    goTo('My Library');
    const options = optionLabels(await screen.findByLabelText('Sort by'));
    expect(options).toContain('Date finished: newest first');
    expect(options).toContain('Date finished: oldest first');
    expect(options.join()).not.toMatch(/watched/i);
  });

  test.each([
    ['book', 'want', 'Want to read'],
    ['book', 'in_progress', 'Reading'],
    ['book', 'finished', 'Read'],
    ['album', 'want', 'Want to listen'],
    ['album', 'in_progress', 'Listening'],
    ['song', 'finished', 'Listened'],
    ['movie', 'in_progress', 'Watching'],
  ])('a %s that is %s says %s', (mediaType, status, label) => {
    expect(statusLabels(mediaType)[status]).toBe(label);
  });
});

test('a library title opens using its TMDB id', async () => {
  setRoutes({
    library: [libraryItem({ id: 50, source_id: 77, status: 'finished' })],
    item: libraryItem({ id: 50, source_id: 77, status: 'finished' }),
  });
  render(<App />);
  goTo('My Library');
  fireEvent.click(await screen.findByText('Dune'));

  expect(await screen.findByLabelText('Status')).toHaveValue('finished');
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/library/movie/77'));
});

test('saving a log opened from My Library returns to the updated list', async () => {
  setRoutes({
    library: [libraryItem({ status: 'want' })],
    item: libraryItem({ status: 'want' }),
  });
  axios.put.mockResolvedValue({ data: libraryItem({ status: 'finished', rating: 9 }) });
  render(<App />);
  goTo('My Library');
  fireEvent.click(await screen.findByText('Dune'));
  await screen.findByLabelText('Status');

  setRoutes({ library: [libraryItem({ status: 'finished', rating: 9 })] });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText('★ 9 / 10')).toBeInTheDocument();
  expect(window.location.search).toBe('?view=library');
});

test('saving a log opened from a shelf goes to My Library', async () => {
  window.history.replaceState(null, '', '/?view=shelves&shelf=5');
  setRoutes({ shelf: { ...SHELF, items: [libraryItem()] } });
  axios.put.mockResolvedValue({ data: libraryItem({ rating: 9 }) });
  render(<App />);
  fireEvent.click(await screen.findByText('Dune'));
  fireEvent.change(await screen.findByLabelText('My rating'), { target: { value: '9' } });

  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByRole('region', { name: 'my library' })).toBeInTheDocument();
  expect(window.location.search).toBe('?view=library');
});

test('changing a season stays on the page', async () => {
  axios.put.mockResolvedValue({ data: libraryItem({ media_type: 'tv' }) });
  await openFromSearch(BREAKING_BAD);
  fireEvent.change(await screen.findByLabelText('Season 1 status'), { target: { value: 'want' } });
  await waitFor(() => expect(axios.put).toHaveBeenCalled());
  expect(screen.getByRole('region', { name: 'title detail' })).toBeInTheDocument();
});

function twoItemShelf() {
  return {
    ...SHELF,
    items: [
      libraryItem({ id: 50, title: 'Dune', rating: 8.5 }),
      libraryItem({ id: 51, source_id: 2, media_type: 'tv', title: 'Breaking Bad' }),
    ],
  };
}

function openShelfUrl() {
  window.history.replaceState(null, '', '/?view=shelves&shelf=5');
}

function shownTitles() {
  return screen.getAllByRole('listitem').map((row) => row.querySelector('.season-name').textContent);
}

test('creating a shelf opens it', async () => {
  axios.post.mockResolvedValue({ data: SHELF });
  setRoutes({ shelf: { ...SHELF, items: [] } });
  render(<App />);
  goTo('Shelves');

  fireEvent.change(await screen.findByLabelText('New shelf name'), { target: { value: ' Favorites ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create shelf' }));

  expect(await screen.findByText(/This shelf is empty/)).toBeInTheDocument();
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/shelves'), { name: 'Favorites' });
  expect(window.location.search).toBe('?view=shelves&shelf=5');
});

test('a duplicate shelf name shows the reason', async () => {
  axios.post.mockRejectedValue({
    response: { status: 409, data: { detail: 'You already have a shelf with that name.' } },
  });
  render(<App />);
  goTo('Shelves');

  fireEvent.change(await screen.findByLabelText('New shelf name'), { target: { value: 'Favorites' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create shelf' }));

  expect(await screen.findByText('You already have a shelf with that name.')).toBeInTheDocument();
});

test('a shelf shows movies and shows in order, and can be reordered', async () => {
  openShelfUrl();
  setRoutes({ shelf: twoItemShelf() });
  const reordered = { ...SHELF, items: [...twoItemShelf().items].reverse() };
  axios.put.mockResolvedValue({ data: reordered });
  render(<App />);

  await screen.findByText('Dune');
  expect(shownTitles()).toEqual(['Dune', 'Breaking Bad']);
  expect(screen.getByRole('button', { name: 'Move Dune up' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Move Dune down' }));

  await waitFor(() => expect(shownTitles()).toEqual(['Breaking Bad', 'Dune']));
  expect(axios.put).toHaveBeenCalledWith(expect.stringContaining('/shelves/5/order'), {
    item_ids: [51, 50],
  });
});

test('a shelf can be reordered by dragging', async () => {
  openShelfUrl();
  setRoutes({ shelf: twoItemShelf() });
  axios.put.mockResolvedValue({ data: { ...SHELF, items: [...twoItemShelf().items].reverse() } });
  render(<App />);
  await screen.findByText('Dune');

  const [first, second] = screen.getAllByRole('listitem');
  fireEvent.dragStart(second, { dataTransfer: { effectAllowed: '' } });
  fireEvent.dragOver(first);
  fireEvent.drop(first);

  await waitFor(() => expect(shownTitles()).toEqual(['Breaking Bad', 'Dune']));
  expect(axios.put).toHaveBeenCalledWith(expect.stringContaining('/shelves/5/order'), {
    item_ids: [51, 50],
  });
});

test('a failed reorder puts the shelf back', async () => {
  openShelfUrl();
  setRoutes({ shelf: twoItemShelf() });
  axios.put.mockRejectedValue({ response: { status: 500, data: {} } });
  render(<App />);
  await screen.findByText('Dune');

  fireEvent.click(screen.getByRole('button', { name: 'Move Dune down' }));

  expect(await screen.findByText(/saving the new order/)).toBeInTheDocument();
  expect(shownTitles()).toEqual(['Dune', 'Breaking Bad']);
});

test('removing a title from a shelf uses its library id', async () => {
  openShelfUrl();
  setRoutes({ shelf: twoItemShelf() });
  axios.delete.mockResolvedValue({ data: { ...SHELF, items: [twoItemShelf().items[1]] } });
  render(<App />);
  await screen.findByText('Dune');

  fireEvent.click(screen.getByRole('button', { name: 'Remove Dune from shelf' }));

  await waitFor(() => expect(screen.queryByText('Dune')).not.toBeInTheDocument());
  expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/shelves/5/items/50'));
});

test('renaming a shelf', async () => {
  openShelfUrl();
  setRoutes({ shelf: twoItemShelf() });
  axios.patch.mockResolvedValue({ data: { ...twoItemShelf(), name: 'Best' } });
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
  fireEvent.change(screen.getByLabelText('Shelf name'), { target: { value: 'Best' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

  expect(await screen.findByRole('heading', { name: 'Best' })).toBeInTheDocument();
});

test('deleting a shelf asks first, then returns to the list', async () => {
  openShelfUrl();
  setRoutes({ shelf: twoItemShelf() });
  axios.delete.mockResolvedValue({ data: null });
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: 'Delete shelf' }));
  expect(axios.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));

  expect(await screen.findByRole('button', { name: 'Create shelf' })).toBeInTheDocument();
  expect(window.location.search).toBe('?view=shelves');
});

test('a shelf that no longer exists shows an error', async () => {
  openShelfUrl();
  setRoutes({ shelf: { response: { status: 404, data: { detail: 'Could not find that shelf.' } } } });
  render(<App />);
  expect(await screen.findByText('Could not find that shelf.')).toBeInTheDocument();
});

test('the browser back button returns to the previous page', async () => {
  render(<App />);
  goTo('My Library');
  await screen.findByText(/Nothing logged yet/);

  window.history.pushState(null, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate'));

  expect(await screen.findByLabelText('Search')).toBeInTheDocument();
});

test('the Music filter keeps the artist and release search', async () => {
  setRoutes({ music: [{ id: 9, title: 'OK Computer', artists: ['Radiohead'], year: 1997 }] });
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Music' }));
  expect(screen.queryByLabelText('Search')).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'Radiohead' } });
  clickSearch();

  expect(await screen.findByText('OK Computer')).toBeInTheDocument();
  expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/search$/), {
    params: { artist: 'Radiohead', title: '', page: 1 },
  });
  expect(window.location.search).toBe('?artist=Radiohead');
});

test('a shared music link opens the Music filter', async () => {
  window.history.replaceState(null, '', '/?artist=Radiohead');
  setRoutes({ music: [{ id: 9, title: 'OK Computer', artists: ['Radiohead'], year: 1997 }] });
  render(<App />);

  expect(await screen.findByText('OK Computer')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Music' })).toHaveAttribute('aria-selected', 'true');
});

test('switching to and from Music clears the shared link', async () => {
  setRoutes({ search: searchResponse([DUNE]) });
  render(<App />);
  search('dune');
  await screen.findByText('Dune');

  fireEvent.click(screen.getByRole('tab', { name: 'Music' }));
  expect(window.location.search).toBe('');
});
