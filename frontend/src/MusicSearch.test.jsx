import { render, screen, fireEvent } from '@testing-library/react';
import { vi, test, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import MusicSearch from './MusicSearch';

vi.mock('axios');

const OK_COMPUTER = { id: 9, title: 'OK Computer', artists: ['Radiohead'], year: 1997 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  window.history.replaceState(null, '', '/');
  axios.get.mockResolvedValue({ data: [OK_COMPUTER] });
});

afterEach(() => vi.useRealTimers());

test.each(['Artist', 'Release'])('typing in %s sends no search and offers no suggestions', (label) => {
  render(<MusicSearch />);
  const box = screen.getByLabelText(label);
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: 'radio' } });
  vi.advanceTimersByTime(2000);

  expect(box).toHaveValue('radio');
  expect(axios.get).not.toHaveBeenCalled();
  expect(document.querySelector('.suggestions-dropdown')).toBeNull();
});

test('the search button still searches', async () => {
  vi.useRealTimers();
  render(<MusicSearch />);
  fireEvent.change(screen.getByLabelText('Artist'), { target: { value: 'Radiohead' } });
  fireEvent.change(screen.getByLabelText('Release'), { target: { value: 'OK Computer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByText('OK Computer')).toBeInTheDocument();
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/search$/), {
    params: { artist: 'Radiohead', title: 'OK Computer', page: 1 },
  });
});
