import { idbDelete, idbGet, idbSet } from './localDb.js';
import {
  LEGACY_AUTOSAVE_KEY,
  buildProfileDocument,
  legacyAutosaveToSnapshot,
  profileDocumentToSnapshot,
} from './projectSnapshot.js';

const INDEX_KEY = 'island-dreamforge-profiles-index';

function profileStorageKey(id) {
  return `island-dreamforge-profile:${id}`;
}

export function newProfileId() {
  return `prof_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function loadProfileIndex() {
  const raw = await idbGet(INDEX_KEY);
  return raw || { schemaVersion: 1, activeProfileId: null, profiles: [] };
}

async function saveProfileIndex(index) {
  await idbSet(INDEX_KEY, index);
}

export async function loadProfileDocument(profileId) {
  return idbGet(profileStorageKey(profileId));
}

export async function saveProfileDocument(profileId, document) {
  await idbSet(profileStorageKey(profileId), document);
}

export async function deleteProfileDocument(profileId) {
  await idbDelete(profileStorageKey(profileId));
}

/** Ensure an active profile exists; migrate legacy v7 autosave into first profile. */
export async function ensureActiveProfile() {
  let index = await loadProfileIndex();
  const legacy = await idbGet(LEGACY_AUTOSAVE_KEY);
  const now = new Date().toISOString();

  if (!index.profiles?.length && legacy?.version >= 6) {
    const id = newProfileId();
    const name = 'Imported autosave';
    const snapshot = legacyAutosaveToSnapshot(legacy);
    const doc = buildProfileDocument(snapshot, { profileId: id, name });
    await saveProfileDocument(id, doc);
    index = {
      schemaVersion: 1,
      activeProfileId: id,
      profiles: [{ id, name, createdAt: now, updatedAt: now }],
    };
    await saveProfileIndex(index);
    await idbDelete(LEGACY_AUTOSAVE_KEY);
    return { index, snapshot, profileId: id, profileName: name };
  }

  if (!index.activeProfileId || !index.profiles?.some((p) => p.id === index.activeProfileId)) {
    const id = newProfileId();
    const name = `Profile ${(index.profiles?.length || 0) + 1}`;
    const doc = buildProfileDocument(emptySnapshot(), { profileId: id, name });
    await saveProfileDocument(id, doc);
    index.profiles = [...(index.profiles || []), { id, name, createdAt: now, updatedAt: now }];
    index.activeProfileId = id;
    await saveProfileIndex(index);
    return { index, snapshot: emptySnapshot(), profileId: id, profileName: name };
  }

  const activeId = index.activeProfileId;
  const meta = index.profiles.find((p) => p.id === activeId);
  const doc = await loadProfileDocument(activeId);
  const snapshot = profileDocumentToSnapshot(doc) || emptySnapshot();
  return {
    index,
    snapshot,
    profileId: activeId,
    profileName: meta?.name || doc?.name || 'Profile',
  };
}

export function emptySnapshot() {
  return {
    stage: 1,
    mapUrl: '',
    mapFileName: 'map.png',
    samples: null,
    picked: '#b7d3dc',
    newHeight: 0,
    dominant: [],
    cleanedPreview: '',
    heightmap16: '',
    heightPreview: '',
    heightGenFingerprint: '',
    bakedHeightmap16: '',
    bakedPreview: '',
    waterMask: '',
    layers: [],
    activeLayerId: null,
    options: null,
    waterSettings: null,
    textureSettings: null,
    exportSettings: null,
    derivedMaps: null,
    worldSettings: null,
    mapSizePx: { width: 0, height: 0 },
    tool: 'move',
    selectedMaterial: 'trees',
    brush: null,
    similarRadius: 18,
    analyzeCount: 12,
    advancedOpen: false,
  };
}

export async function persistActiveProfile(profileId, profileName, snapshot) {
  const doc = buildProfileDocument(snapshot, { profileId, name: profileName });
  await saveProfileDocument(profileId, doc);
  const index = await loadProfileIndex();
  const now = doc.savedAt;
  const profiles = (index.profiles || []).map((p) => (
    p.id === profileId ? { ...p, name: profileName, updatedAt: now } : p
  ));
  if (!profiles.some((p) => p.id === profileId)) {
    profiles.push({ id: profileId, name: profileName, createdAt: now, updatedAt: now });
  }
  await saveProfileIndex({
    ...index,
    activeProfileId: profileId,
    profiles,
  });
  return doc.savedAt;
}

export async function setActiveProfile(profileId) {
  const index = await loadProfileIndex();
  if (!index.profiles?.some((p) => p.id === profileId)) {
    throw new Error('Profile not found');
  }
  await saveProfileIndex({ ...index, activeProfileId: profileId });
  const doc = await loadProfileDocument(profileId);
  const meta = index.profiles.find((p) => p.id === profileId);
  return {
    snapshot: profileDocumentToSnapshot(doc) || emptySnapshot(),
    profileName: meta?.name || doc?.name || 'Profile',
  };
}

export async function createProfile({ name, snapshot, makeActive = true }) {
  const id = newProfileId();
  const profileName = name || `Profile ${((await loadProfileIndex()).profiles?.length || 0) + 1}`;
  const now = new Date().toISOString();
  const doc = buildProfileDocument(snapshot || emptySnapshot(), { profileId: id, name: profileName });
  await saveProfileDocument(id, doc);
  const index = await loadProfileIndex();
  const profiles = [...(index.profiles || []), { id, name: profileName, createdAt: now, updatedAt: now }];
  await saveProfileIndex({
    ...index,
    activeProfileId: makeActive ? id : index.activeProfileId,
    profiles,
  });
  return { id, name: profileName, snapshot: snapshot || emptySnapshot() };
}

export async function duplicateProfile(sourceId, name) {
  const doc = await loadProfileDocument(sourceId);
  const snapshot = profileDocumentToSnapshot(doc) || emptySnapshot();
  const sourceMeta = (await loadProfileIndex()).profiles.find((p) => p.id === sourceId);
  return createProfile({
    name: name || `${sourceMeta?.name || 'Profile'} copy`,
    snapshot,
    makeActive: true,
  });
}

export async function renameProfile(profileId, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return;
  const index = await loadProfileIndex();
  const profiles = index.profiles.map((p) => (p.id === profileId ? { ...p, name: trimmed } : p));
  await saveProfileIndex({ ...index, profiles });
  const doc = await loadProfileDocument(profileId);
  if (doc) {
    doc.name = trimmed;
    await saveProfileDocument(profileId, doc);
  }
}

export async function deleteProfile(profileId) {
  const index = await loadProfileIndex();
  const profiles = (index.profiles || []).filter((p) => p.id !== profileId);
  await deleteProfileDocument(profileId);
  let activeProfileId = index.activeProfileId;
  if (activeProfileId === profileId) {
    activeProfileId = profiles[0]?.id || null;
  }
  if (!activeProfileId && profiles.length) {
    activeProfileId = profiles[0].id;
  }
  await saveProfileIndex({ ...index, profiles, activeProfileId });
  if (activeProfileId) {
    const doc = await loadProfileDocument(activeProfileId);
    return {
      profileId: activeProfileId,
      profileName: profiles.find((p) => p.id === activeProfileId)?.name || 'Profile',
      snapshot: profileDocumentToSnapshot(doc) || emptySnapshot(),
    };
  }
  return ensureActiveProfile();
}

export function downloadProfileJson(profileDoc, fileName) {
  const blob = new Blob([JSON.stringify(profileDoc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = globalThis.document.createElement('a');
  a.href = url;
  a.download = fileName || `${document.name || 'island_profile'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportProfileJson(profileId) {
  const doc = await loadProfileDocument(profileId);
  if (!doc) throw new Error('Profile not found');
  const safe = (doc.name || 'profile').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  downloadProfileJson(doc, `island_dreamforge_${safe}.json`);
}

export async function importProfileFromJson(parsed, { setActive = true } = {}) {
  const id = parsed.profileId && !(await loadProfileDocument(parsed.profileId))
    ? parsed.profileId
    : newProfileId();
  const name = parsed.name || `Imported ${new Date().toLocaleDateString()}`;
  const doc = { ...parsed, profileId: id, name, savedAt: new Date().toISOString() };
  await saveProfileDocument(id, doc);
  const index = await loadProfileIndex();
  const now = doc.savedAt;
  const exists = index.profiles?.some((p) => p.id === id);
  const profiles = exists
    ? index.profiles.map((p) => (p.id === id ? { ...p, name, updatedAt: now } : p))
    : [...(index.profiles || []), { id, name, createdAt: now, updatedAt: now }];
  await saveProfileIndex({
    ...index,
    activeProfileId: setActive ? id : index.activeProfileId,
    profiles,
  });
  return {
    id,
    name,
    snapshot: profileDocumentToSnapshot(doc) || emptySnapshot(),
  };
}
