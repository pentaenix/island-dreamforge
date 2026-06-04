import React, { useRef, useState } from 'react';

export default function ProfilesBar({
  profiles,
  activeProfileId,
  activeProfileName,
  lastSavedAt,
  saving,
  onSelectProfile,
  onNewProfile,
  onDuplicateProfile,
  onRenameProfile,
  onDeleteProfile,
  onExportJson,
  onImportJson,
}) {
  const importRef = useRef(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(activeProfileName);

  React.useEffect(() => {
    if (!renaming) setRenameValue(activeProfileName);
  }, [activeProfileName, renaming]);

  const savedLabel = lastSavedAt
    ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
    : 'Not saved yet';

  return (
    <section className="profiles-bar" aria-label="Work profiles">
      <div className="profiles-bar-main">
        <label className="profiles-label">
          <span>Active profile</span>
          <select
            value={activeProfileId || ''}
            onChange={(e) => onSelectProfile(e.target.value)}
            disabled={!profiles.length || saving}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        {renaming ? (
          <form
            className="profiles-rename"
            onSubmit={(e) => {
              e.preventDefault();
              onRenameProfile(renameValue);
              setRenaming(false);
            }}
          >
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              maxLength={64}
            />
            <button type="submit" className="ghost">Save</button>
            <button type="button" className="ghost" onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        ) : (
          <button type="button" className="ghost profiles-rename-btn" onClick={() => setRenaming(true)}>
            Rename
          </button>
        )}
        <span className={`profiles-save-hint ${saving ? 'is-saving' : ''}`}>
          {saving ? 'Saving…' : savedLabel}
        </span>
      </div>
      <div className="profiles-bar-actions">
        <button type="button" className="ghost" onClick={onNewProfile} title="New empty profile">New</button>
        <button type="button" className="ghost" onClick={onDuplicateProfile} title="Copy current profile">Duplicate</button>
        <button type="button" className="ghost" onClick={onExportJson} title="Download profile JSON (sliders + images)">Export JSON</button>
        <button type="button" className="ghost" onClick={() => importRef.current?.click()}>Import JSON</button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportJson(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="ghost danger"
          onClick={onDeleteProfile}
          disabled={profiles.length <= 1}
          title={profiles.length <= 1 ? 'Keep at least one profile' : 'Delete this profile'}
        >
          Delete
        </button>
      </div>
      <p className="small muted profiles-tip">
        Slider values, color ladder, base map, overlays, and generated height previews auto-save to the active profile.
        Export JSON for backups before long tuning sessions.
      </p>
    </section>
  );
}
