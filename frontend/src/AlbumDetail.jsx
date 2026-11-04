import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL, externalLink, getErrorMessage, logUrl, posterUrl, titleDetails } from './api';
import { Clapperboard } from './Loaders';
import { LoggedBadge } from './MediaCard';
import { LogForm, ShelfPicker } from './MediaDetail';

// An album's page: log the whole album as one entry, or pick songs to each get an entry of their own.
export default function AlbumDetail({
  item,
  onBack,
  onLogSubmitted,
  backLabel = '← Back to results',
}) {
  const [album, setAlbum] = useState(null);
  const [albumError, setAlbumError] = useState(null);
  const [albumLog, setAlbumLog] = useState(null);
  const [songs, setSongs] = useState([]);
  const [logState, setLogState] = useState('loading');
  const [logError, setLogError] = useState(null);
  const [mode, setMode] = useState('album');
  const [selectedIndexes, setSelectedIndexes] = useState([]);

  useEffect(() => {
    let current = true;
    axios
      .get(`${API_URL}/albums/${item.id}`)
      .then((response) => current && setAlbum(response.data))
      .catch((err) => {
        if (current) setAlbumError(getErrorMessage(err, 'Something went wrong loading this album.'));
      });
    return () => {
      current = false;
    };
  }, [item.id]);

  useEffect(() => {
    let current = true;
    const albumRequest = axios
      .get(`${API_URL}/library/album/${item.id}`)
      .then((response) => response.data)
      .catch((err) => {
        if (err.response?.status === 404) return null;
        throw err;
      });
    const songsRequest = axios.get(`${API_URL}/library/album/${item.id}/songs`);
    Promise.all([albumRequest, songsRequest])
      .then(([loadedLog, songsResponse]) => {
        if (!current) return;
        setAlbumLog(loadedLog);
        setSongs(songsResponse.data);
        setLogState('ready');
      })
      .catch((err) => {
        if (!current) return;
        setLogError(getErrorMessage(err, 'Something went wrong loading your log.'));
        setLogState('error');
      });
    return () => {
      current = false;
    };
  }, [item.id]);

  // What's already known about the album fills any gaps left by where it was opened from.
  const details = {
    ...item,
    title: item.title ?? album?.title,
    artists: item.artists ?? album?.artists.join(', '),
    year: item.year ?? album?.year,
    poster_path: item.poster_path ?? album?.cover_image,
  };
  const tracks = album?.tracks ?? [];
  const songLogs = Object.fromEntries(songs.map((song) => [song.track_index, song]));
  const selectedTracks = tracks.filter((track) => selectedIndexes.includes(track.track_index));
  const loggedSelected = selectedTracks.filter((track) => songLogs[track.track_index]);

  // One logged song opens its log for editing. Several are saved together with what's typed here.
  const singleSongLog =
    selectedTracks.length === 1 ? songLogs[selectedTracks[0].track_index] ?? null : null;

  function toggleTrack(trackIndex) {
    setSelectedIndexes((previous) =>
      previous.includes(trackIndex)
        ? previous.filter((index) => index !== trackIndex)
        : [...previous, trackIndex]
    );
  }

  async function saveSongs(log) {
    const response = await axios.put(`${API_URL}/library/album/${item.id}/songs`, {
      ...titleDetails(details),
      tracks: selectedTracks.map(({ track_index, title }) => ({ track_index, title })),
      ...log,
    });
    setSongs(response.data);
    return response;
  }

  async function clearSong() {
    const songUrl = logUrl({ media_type: 'song', id: item.id, track_index: singleSongLog.track_index });
    await axios.delete(songUrl);
    const response = await axios.get(`${API_URL}/library/album/${item.id}/songs`);
    setSongs(response.data);
    return { data: null };
  }

  return (
    <section aria-label="album detail" className="detail-view">
      <button className="back-btn" onClick={onBack}>
        {backLabel}
      </button>

      <div className="detail-layout">
        <div className="detail-release">
          {details.poster_path ? (
            <img
              className="detail-release-image"
              src={posterUrl(details.poster_path)}
              alt={`${details.title} cover art`}
            />
          ) : (
            <div className="detail-release-image detail-release-image--placeholder">No Image</div>
          )}
          <h2>{details.title}</h2>
          <p className="detail-release-artist">{details.artists}</p>
          {details.year && <p className="detail-release-year">{details.year}</p>}
          <a
            className="movie-trailer-link"
            href={externalLink(details).url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {externalLink(details).label}
          </a>
        </div>

        <div className="detail-movies">
          <h3>My log</h3>
          {logState === 'loading' && <p className="movie-status">Loading your log…</p>}
          {logState === 'error' && <p className="movie-status movie-error">{logError}</p>}
          {logState === 'ready' && (
            <>
              <fieldset className="log-scope">
                <legend>What are you logging?</legend>
                <label>
                  <input
                    type="radio"
                    name="log-scope"
                    checked={mode === 'album'}
                    onChange={() => setMode('album')}
                  />
                  Whole album
                </label>
                <label>
                  <input
                    type="radio"
                    name="log-scope"
                    checked={mode === 'songs'}
                    disabled={tracks.length === 0}
                    onChange={() => setMode('songs')}
                  />
                  Choose songs
                </label>
              </fieldset>

              <section aria-label="tracklist">
                <h3>Tracklist</h3>
                {!album && !albumError && <Clapperboard label="Loading tracks…" />}
                {albumError && <p className="movie-status movie-error">{albumError}</p>}
                {album && tracks.length === 0 && (
                  <p className="movie-status">No tracklist available for this album.</p>
                )}
                {tracks.length > 0 && (
                  <ol className="track-list">
                    {tracks.map((track) => {
                      const trackLog = songLogs[track.track_index];
                      const content = (
                        <>
                          {track.position && <span className="track-position">{track.position}</span>}
                          <span className="track-title">{track.title}</span>
                          {track.duration && <span className="season-meta">{track.duration}</span>}
                          {trackLog && <LoggedBadge log={trackLog} />}
                        </>
                      );
                      return (
                        <li key={track.track_index} className="track-row">
                          {mode === 'songs' ? (
                            <label className="track-content">
                              <input
                                type="checkbox"
                                checked={selectedIndexes.includes(track.track_index)}
                                onChange={() => toggleTrack(track.track_index)}
                              />
                              {content}
                            </label>
                          ) : (
                            <div className="track-content">{content}</div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              {mode === 'songs' && (
                <p className="media-detail-facts">
                  {selectedTracks.length === 0
                    ? 'Tick the songs to log. Each one gets its own entry.'
                    : `${selectedTracks.length} ${selectedTracks.length === 1 ? 'song' : 'songs'} selected. ${
                        selectedTracks.length === 1 ? 'It gets' : 'Each one gets'
                      } its own entry.`}
                </p>
              )}
              {mode === 'songs' && selectedTracks.length > 1 && loggedSelected.length > 0 && (
                <p className="movie-status movie-error">
                  {loggedSelected.length} of these {loggedSelected.length === 1 ? 'is' : 'are'} already
                  logged. Saving replaces {loggedSelected.length === 1 ? 'its log' : 'their logs'}.
                </p>
              )}

              {mode === 'album' ? (
                <>
                  <LogForm
                    key="album"
                    item={details}
                    log={albumLog}
                    onSaved={setAlbumLog}
                    onLogSubmitted={onLogSubmitted}
                  />
                  <ShelfPicker item={details} log={albumLog} onLogChanged={setAlbumLog} />
                </>
              ) : (
                <LogForm
                  key={singleSongLog ? `song-${singleSongLog.id}` : 'songs'}
                  item={details}
                  log={singleSongLog}
                  onSaved={() => {}}
                  onLogSubmitted={onLogSubmitted}
                  saveLog={saveSongs}
                  clearLog={singleSongLog ? clearSong : undefined}
                  blockedMessage={selectedTracks.length === 0 ? 'Choose at least one song to log.' : null}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
