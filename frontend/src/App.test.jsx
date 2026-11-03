import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
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

function searchResponse(results, page = 1, total_pages = 1) {
  return { data: { results, page, total_pages } };
}

function search(title) {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: title } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

beforeEach(() => {
  vi.resetAllMocks();
  window.matchMedia = () => ({ matches: false });
  window.scrollTo = () => {};
  window.history.replaceState(null, '', '/');
});

test('searches movies and shows together by default', async () => {
  axios.get.mockResolvedValue(searchResponse([DUNE, BREAKING_BAD]));
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
  axios.get.mockResolvedValue(searchResponse([DUNE, BREAKING_BAD]));
  render(<App />);
  search('dune');
  await screen.findByText('Dune');

  axios.get.mockResolvedValue(searchResponse([BREAKING_BAD]));
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
  axios.get.mockResolvedValue(searchResponse([BREAKING_BAD]));
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
  axios.get.mockResolvedValue(searchResponse([]));
  render(<App />);
  search('zzz');
  expect(await screen.findByText('No results found.')).toBeInTheDocument();
});

test('shows the error message from the backend', async () => {
  axios.get.mockRejectedValue({ response: { status: 502, data: { detail: 'Could not reach TMDB' } } });
  render(<App />);
  search('dune');
  expect(await screen.findByText('Could not reach TMDB')).toBeInTheDocument();
});

test('an older response cannot overwrite a newer search', async () => {
  let resolveOld;
  axios.get.mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)));
  render(<App />);
  search('old');

  axios.get.mockResolvedValue(searchResponse([BREAKING_BAD]));
  fireEvent.click(screen.getByRole('tab', { name: 'Shows' }));
  await screen.findByText('Breaking Bad');

  resolveOld(searchResponse([DUNE]));
  await new Promise((resolve) => setTimeout(resolve));
  expect(screen.queryByText('Dune')).not.toBeInTheDocument();
});

test('pages through results', async () => {
  axios.get.mockResolvedValue(searchResponse([DUNE], 1, 3));
  render(<App />);
  search('dune');
  await screen.findByText('Page 1 of 3');
  expect(screen.getByRole('button', { name: '← Previous' })).toBeDisabled();

  axios.get.mockResolvedValue(searchResponse([BREAKING_BAD], 2, 3));
  fireEvent.click(screen.getByRole('button', { name: 'Next →' }));

  await screen.findByText('Page 2 of 3');
  expect(axios.get).toHaveBeenLastCalledWith(expect.stringContaining('/search/media'), {
    params: { query: 'dune', type: 'all', page: 2 },
  });
});

test('opening a show loads its seasons', async () => {
  axios.get.mockResolvedValue(searchResponse([BREAKING_BAD]));
  render(<App />);
  search('breaking');
  const card = await screen.findByText('Breaking Bad');

  axios.get.mockResolvedValue({ data: SHOW_DETAILS });
  fireEvent.click(card);

  expect(await screen.findByText('Season 1')).toBeInTheDocument();
  expect(screen.getByText('7 episodes · 2008')).toBeInTheDocument();
  expect(screen.getByText('Ended · 1 season · 7 episodes')).toBeInTheDocument();
  expect(axios.get).toHaveBeenLastCalledWith(expect.stringContaining('/shows/1'));
});

test('opening a movie shows its details without another request', async () => {
  axios.get.mockResolvedValue(searchResponse([DUNE]));
  render(<App />);
  search('dune');
  const card = await screen.findByText('Dune');
  axios.get.mockClear();

  fireEvent.click(card);

  const detail = screen.getByRole('region', { name: 'title detail' });
  expect(within(detail).getByText('Spice.')).toBeInTheDocument();
  expect(within(detail).getByRole('link', { name: 'View on TMDB' })).toHaveAttribute(
    'href',
    'https://www.themoviedb.org/movie/1'
  );
  expect(axios.get).not.toHaveBeenCalled();
});

test('reopening a show after a failed lookup tries again', async () => {
  axios.get.mockResolvedValue(searchResponse([BREAKING_BAD]));
  render(<App />);
  search('breaking');
  const card = await screen.findByText('Breaking Bad');

  axios.get.mockRejectedValue({ response: { status: 502, data: { detail: 'Could not reach TMDB' } } });
  fireEvent.click(card);
  await screen.findByText('Could not reach TMDB');

  fireEvent.click(screen.getByRole('button', { name: '← Back to results' }));
  axios.get.mockResolvedValue({ data: SHOW_DETAILS });
  fireEvent.click(await screen.findByText('Breaking Bad'));

  expect(await screen.findByText('Season 1')).toBeInTheDocument();
  expect(screen.queryByText('Could not reach TMDB')).not.toBeInTheDocument();
});

test('the Music filter keeps the artist and release search', async () => {
  axios.get.mockResolvedValue({ data: [{ id: 9, title: 'OK Computer', artists: ['Radiohead'], year: 1997 }] });
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Music' }));
  expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'Radiohead' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByText('OK Computer')).toBeInTheDocument();
  expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/search$/), {
    params: { artist: 'Radiohead', title: '', page: 1 },
  });
  expect(window.location.search).toBe('?artist=Radiohead');
});

test('a shared music link opens the Music filter', async () => {
  window.history.replaceState(null, '', '/?artist=Radiohead');
  axios.get.mockResolvedValue({ data: [{ id: 9, title: 'OK Computer', artists: ['Radiohead'], year: 1997 }] });
  render(<App />);

  expect(await screen.findByText('OK Computer')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Music' })).toHaveAttribute('aria-selected', 'true');
});

test('switching to and from Music clears the shared link', async () => {
  axios.get.mockResolvedValue(searchResponse([DUNE]));
  render(<App />);
  search('dune');
  await screen.findByText('Dune');

  fireEvent.click(screen.getByRole('tab', { name: 'Music' }));
  expect(window.location.search).toBe('');
});
