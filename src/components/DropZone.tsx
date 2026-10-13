type Props = {
  ready: boolean;
  dragging: boolean;
  onChoose: () => void;
  onGetModel: () => void;
};

export function DropZone({ ready, dragging, onChoose, onGetModel }: Props) {
  if (!ready) {
    return (
      <section className="dropzone disabled">
        <h2>First, get a model</h2>
        <p>The app needs a speech model before it can transcribe. Models are downloaded once, or added from a file.</p>
        <button type="button" className="primary" onClick={onGetModel}>
          Choose a model
        </button>
      </section>
    );
  }
  return (
    <section className={`dropzone${dragging ? " over" : ""}`} onClick={onChoose}>
      <h2>Drop an audio file here</h2>
      <p>or</p>
      <button type="button" className="primary" onClick={(e) => { e.stopPropagation(); onChoose(); }}>
        Choose a file…
      </button>
      <p className="hint">m4a, mp3, wav, mp4, flac and most other recordings. The transcript is saved next to the file.</p>
    </section>
  );
}
