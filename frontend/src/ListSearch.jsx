// A search box for narrowing a list that's already loaded.
export default function ListSearch({ label, placeholder, value, onChange }) {
  return (
    <div className="list-search">
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        maxLength="100"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
