/**
 * ShareBox
 *
 * Displays a generated share URL alongside a copy-to-clipboard button.
 * Renders nothing when both `url` and `status` are empty, so it is safe
 * to always include it in the layout.
 *
 * @param {object}   props
 * @param {string}   props.url    - The generated share URL (empty string while not yet generated)
 * @param {string}   props.status - Status text shown while saving / after copying
 * @param {Function} props.onCopy - Callback invoked when the copy button is clicked
 */
export default function ShareBox({ url, status, onCopy }) {
  if (!url && !status) return null

  return (
    <div className="share-box">
      {status && <span className="share-status">{status}</span>}
      {url && (
        <div className="share-row">
          <input
            className="share-url"
            readOnly
            value={url}
            onClick={(e) => e.target.select()}
            aria-label="Link de compartilhamento"
          />
          <button type="button" className="btn-sm" onClick={onCopy}>
            Copiar link
          </button>
        </div>
      )}
    </div>
  )
}
