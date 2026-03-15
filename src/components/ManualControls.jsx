import { useRef } from 'react'

export default function ManualControls({ chips, onFiles, onRemoveChip, onClear, onShare }) {
  const inputRef = useRef(null)

  const openFileDialog = () => inputRef.current?.click()

  const handleDrop = (event) => {
    event.preventDefault()
    const droppedFiles = event.dataTransfer?.files
    if (droppedFiles?.length) onFiles(droppedFiles)
  }

  return (
    <section className="manual-box">
      <h3>Importe os JSONs exportados pela extensao</h3>
      <div
        className={`drop-area ${chips.length ? 'loaded' : ''}`}
        onClick={openFileDialog}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <p>
          {chips.length
            ? `${chips.length} arquivo${chips.length > 1 ? 's' : ''} carregado${chips.length > 1 ? 's' : ''}`
            : 'Clique aqui ou arraste arquivos .json'}
        </p>
        <span>Selecione varios arquivos para consolidar os mercados</span>
      </div>

      <div className="chip-list">
        {chips.map((chip) => (
          <span className="chip" key={`${chip.text}-${chip.index}`} title={chip.title}>
            {chip.text}
            <button type="button" onClick={() => onRemoveChip(chip.index)}>
              x
            </button>
          </span>
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".json"
        multiple
        className="hidden-input"
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files)
          event.target.value = ''
        }}
      />

      <div className="manual-actions">
        <button type="button" className="btn-sm primary" onClick={openFileDialog}>
          Abrir arquivos
        </button>
        <button type="button" className="btn-sm" onClick={onClear}>
          Limpar tudo
        </button>
        {chips.length > 0 && (
          <button type="button" className="btn-sm share" onClick={onShare}>
            Compartilhar
          </button>
        )}
      </div>
    </section>
  )
}