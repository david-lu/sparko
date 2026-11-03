import { useState } from 'react';
import ModalBackdrop from '../../shared/ModalBackdrop';

export default function LibraryFolderDialog({ initialName, onSubmit, onCancel, restoreFocus }: {
  initialName?: string; onSubmit: (name: string) => void; onCancel: () => void; restoreFocus: () => void;
}) {
  const [name, setName] = useState(initialName ?? 'New folder');
  const renaming = initialName !== undefined;
  return <ModalBackdrop labelledBy="library-folder-title" onCancel={onCancel} restoreFocus={restoreFocus}>
    <form className="project-card library-folder-dialog" onSubmit={e => { e.preventDefault(); if (name.trim()) onSubmit(name.trim()); }}>
      <h2 id="library-folder-title">{renaming ? 'Rename folder' : 'New folder'}</h2>
      <label className="field">Folder name<input autoFocus required maxLength={1000} value={name} onFocus={e => e.currentTarget.select()} onChange={e => setName(e.target.value)}/></label>
      <div className="close-project-actions">
        <button className="button" type="button" onClick={onCancel}>Cancel</button>
        <button className="button primary" type="submit" disabled={!name.trim()}>{renaming ? 'Save name' : 'Create folder'}</button>
      </div>
    </form>
  </ModalBackdrop>;
}
