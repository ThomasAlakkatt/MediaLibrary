import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, test, expect, beforeEach, afterEach, describe } from 'vitest';
import axios from 'axios';
import App from './App';

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
const SHELF = { id: 5, name: 'Favorites', description: null, item_count: 0, cover_posters: [] };

function libraryItem(overrides = {}) {
  return {
    id: 50,
    tmdb_id: 1,
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
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: title } });
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
  };
  axios.get.mockImplementation((url) => {
    if (url.includes('/search/media')) return respond(routes.search);
    if (url.endsWith('/search/music')) return respond(routes.musicText);
    if (url.includes('/movies/')) return respond(routes.recommendations);
    if (url.includes('/shows/')) return respond(routes.show);
    if (/\/library\/(movie|tv)\//.test(url)) return respond(routes.item);
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

test('opening a music result shows its recommendations', async () => {
  setRoutes({ musicText: [OK_COMPUTER], recommendations: [] });
  render(<App />);
  search('radiohead');
  fireEvent.click(await screen.findByText('OK Computer'));

  expect(await screen.findByText(/No movie recommendations found/)).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/movies/9'));
  expect(window.location.search).toBe('?q=radiohead');
});

test('going back from a music result returns to the same search and page', async () => {
  setRoutes({ search: searchResponse([DUNE], 2, 3), musicText: [OK_COMPUTER], recommendations: [] });
  render(<App />);
  search('radiohead');
  fireEvent.click(await screen.findByText('OK Computer'));
  await screen.findByText(/No movie recommendations found/);
  axios.get.mockClear();

  fireEvent.click(screen.getByRole('button', { name: '← Back to results' }));

  expect(screen.getByLabelText('Title')).toBeVisible();
  expect(screen.getByLabelText('Title')).toHaveValue('radiohead');
  expect(screen.getByText('Dune')).toBeVisible();
  expect(screen.getByText('Page 2 of 3')).toBeVisible();
  expect(screen.queryByText(/No movie recommendations found/)).not.toBeInTheDocument();
  expect(window.location.search).toBe('?q=radiohead');
  expect(axios.get).not.toHaveBeenCalled();
});

test('the search is hidden while a music result is open', async () => {
  setRoutes({ musicText: [OK_COMPUTER], recommendations: [] });
  render(<App />);
  search('radiohead');
  fireEvent.click(await screen.findByText('OK Computer'));
  await screen.findByText(/No movie recommendations found/);

  expect(screen.getByLabelText('Title')).not.toBeVisible();
});

test.each([
  ['a filter', () => fireEvent.click(screen.getByRole('tab', { name: 'Movies' }))],
  ['the page navigation', () => goTo('My Library')],
])('leaving through %s closes the music result', async (_, leave) => {
  setRoutes({ musicText: [OK_COMPUTER], recommendations: [] });
  render(<App />);
  search('radiohead');
  fireEvent.click(await screen.findByText('OK Computer'));
  await screen.findByText(/No movie recommendations found/);

  leave();

  await waitFor(() =>
    expect(screen.queryByText(/No movie recommendations found/)).not.toBeInTheDocument()
  );
});

test('the Music tab still goes back to its own results', async () => {
  setRoutes({ music: [OK_COMPUTER], recommendations: [] });
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Music' }));
  fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'Radiohead' } });
  clickSearch();
  fireEvent.click(await screen.findByText('OK Computer'));
  await screen.findByText(/No movie recommendations found/);

  fireEvent.click(screen.getByRole('button', { name: '← Back to results' }));

  expect(await screen.findByText('OK Computer')).toBeVisible();
  expect(screen.getByLabelText('Artist')).toHaveValue('Radiohead');
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
  expect(axios.get).toHaveBeenLastCalledWith(expect.stringContaining('/search/media'), {
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
  expect(screen.getByLabelText('Title')).toHaveValue('breaking');
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
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(axios.put).toHaveBeenCalled());
  expect(axios.put.mock.calls[0][1].rating).toBe(saved);
});

test.each(['-0.01', '11', '10.1', '10.01', '-1', 'great', '8/10', '1e1', '.', '7.333', '.125', '7.500'])(
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

test('rating a season saves when leaving the box', async () => {
  axios.put.mockResolvedValue({
    data: libraryItem({
      media_type: 'tv',
      seasons: [{ season_number: 1, status: null, rating: 9.5, finished_on: null }],
    }),
  });
  await openFromSearch(BREAKING_BAD);

  fireEvent.change(await screen.findByLabelText('Season 1 rating'), { target: { value: '9.5' } });
  expect(axios.put).not.toHaveBeenCalled();
  fireEvent.blur(screen.getByLabelText('Season 1 rating'));

  await waitFor(() => expect(axios.put).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByLabelText('Season 1 rating')).toHaveValue('9.5'));
  expect(axios.put).toHaveBeenCalledWith(
    expect.stringContaining('/library/tv/1/seasons/1'),
    expect.objectContaining({ title: 'Breaking Bad', rating: 9.5, status: null })
  );
});

test('an invalid season rating is not saved', async () => {
  await openFromSearch(BREAKING_BAD);
  fireEvent.change(await screen.findByLabelText('Season 1 rating'), { target: { value: '12' } });
  fireEvent.blur(screen.getByLabelText('Season 1 rating'));

  expect(await screen.findByText('Rating must be a number between 0 and 10, with at most 2 decimal places.')).toBeInTheDocument();
  expect(axios.put).not.toHaveBeenCalled();
});

test('a season date only shows once the season is finished', async () => {
  setRoutes({
    item: libraryItem({
      media_type: 'tv',
      seasons: [{ season_number: 1, status: 'in_progress', rating: null, finished_on: null }],
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
    expect.objectContaining({ media_type: 'movie', tmdb_id: 1, title: 'Dune' })
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

test('a library title opens using its TMDB id', async () => {
  setRoutes({
    library: [libraryItem({ id: 50, tmdb_id: 77, status: 'finished' })],
    item: libraryItem({ id: 50, tmdb_id: 77, status: 'finished' }),
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
  await screen.findByLabelText('Status');

  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByRole('region', { name: 'my library' })).toBeInTheDocument();
  expect(window.location.search).toBe('?view=library');
});

test('rating a season stays on the page', async () => {
  axios.put.mockResolvedValue({ data: libraryItem({ media_type: 'tv' }) });
  await openFromSearch(BREAKING_BAD);
  fireEvent.change(await screen.findByLabelText('Season 1 rating'), { target: { value: '9.5' } });
  fireEvent.keyDown(screen.getByLabelText('Season 1 rating'), { key: 'Enter' });
  await waitFor(() => expect(axios.put).toHaveBeenCalled());
  expect(screen.getByRole('region', { name: 'title detail' })).toBeInTheDocument();
});

function twoItemShelf() {
  return {
    ...SHELF,
    items: [
      libraryItem({ id: 50, title: 'Dune', rating: 8.5 }),
      libraryItem({ id: 51, tmdb_id: 2, media_type: 'tv', title: 'Breaking Bad' }),
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

  expect(await screen.findByLabelText('Title')).toBeInTheDocument();
});

test('the Music filter keeps the artist and release search', async () => {
  setRoutes({ music: [{ id: 9, title: 'OK Computer', artists: ['Radiohead'], year: 1997 }] });
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Music' }));
  expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();

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
