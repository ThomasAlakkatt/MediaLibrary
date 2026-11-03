export function SpinningRecord({ label }) {
  return (
    <div className="record-loading">
      <div className="vinyl-record">
        <div className="vinyl-label" />
      </div>
      {label && <p className="record-loading-text">{label}</p>}
    </div>
  );
}

export function Clapperboard({ label }) {
  return (
    <div className="record-loading">
      <div className="clapperboard">
        <div className="clapperboard-top" />
        <div className="clapperboard-body" />
      </div>
      {label && <p className="record-loading-text">{label}</p>}
    </div>
  );
}
