import AlbumDetail from './AlbumDetail';
import MediaDetail from './MediaDetail';

// Opens the right page for any title in the library or on a shelf.
export default function TitleDetail({ item, ...props }) {
  return item.media_type === 'album' ? (
    <AlbumDetail item={item} {...props} />
  ) : (
    <MediaDetail item={item} {...props} />
  );
}
