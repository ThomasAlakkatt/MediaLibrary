import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL, externalLink, getErrorMessage, posterUrl } from './api';
import { Clapperboard } from './Loaders';
import { LoggedBadge } from './MediaCard';
import { LogForm, ShelfPicker } from './MediaDetail';

// An album's page: log the whole album as one entry, or tick songs to each get an entry box of their own.
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
  // Entry boxes stay mounted once opened, so unticking a song or switching modes keeps what was typed.
  const [openedIndexes, setOpenedIndexes] = useState([]);

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

  function toggleTrack(trackIndex) {
    setOpenedIndexes((previous) =>
      previous.includes(trackIndex) ? previous : [...previous, trackIndex]
    );
    setSelectedIndexes((previous) =>
      previous.includes(trackIndex)
        ? previous.filter((index) => index !== trackIndex)
        : [...previous, trackIndex]
    );
  }

  function updateSongLog(trackIndex, savedLog) {
    setSongs((previous) => [
      ...previous.filter((song) => song.track_index !== trackIndex),
      ...(savedLog ? [savedLog] : []),
    ]);
  }

  // A song's own details for its entry, with the album's filling in the rest.
  function songItem(track) {
    return {
      media_type: 'song',
      id: item.id,
      track_index: track.track_index,
      title: track.title,
      album_title: details.title,
      artists: details.artists,
      year: details.year,
      release_date: details.release_date,
      poster_path: details.poster_path,
    };
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
                      const entryOpen = mode === 'songs' && selectedIndexes.includes(track.track_index);
                      return (
                        <li
                          key={track.track_index}
                          className={`track-row${entryOpen ? ' track-row--open' : ''}`}
                        >
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
                          {openedIndexes.includes(track.track_index) && (
                            <div className="track-entry" hidden={!entryOpen}>
                              <LogForm
                                item={songItem(track)}
                                log={trackLog ?? null}
                                idPrefix={`song-${track.track_index}`}
                                formLabel={`Log for ${track.title}`}
                                onSaved={(savedLog) => updateSongLog(track.track_index, savedLog)}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              {mode === 'songs' && selectedIndexes.length === 0 && (
                <p className="media-detail-facts">
                  Tick a song to open its entry box. Each song is saved on its own.
                </p>
              )}

              {mode === 'album' && (
                <>
                  <LogForm
                    item={details}
                    log={albumLog}
                    formLabel="Log for the whole album"
                    onSaved={setAlbumLog}
                    onLogSubmitted={onLogSubmitted}
                  />
                  <ShelfPicker item={details} log={albumLog} onLogChanged={setAlbumLog} />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
