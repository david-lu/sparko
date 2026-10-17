import { assetIds, type Asset, type Project } from './types';

const DATABASE = 'sparko-projects';
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('recentFiles')) db.createObjectStore('recentFiles', { keyPath: 'id' });
    };
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onblocked = () => { connection = undefined; reject(new Error('Close other Sparko tabs to update local storage.')); };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
  });
}
function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function committed(transaction: IDBTransaction, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { try { transaction.abort(); } catch { /* Already committed or aborted. */ } };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    transaction.oncomplete = () => { cleanup(); resolve(); };
    transaction.onabort = () => { cleanup(); reject(signal?.aborted ? signal.reason : transaction.error || new Error('Local storage transaction was cancelled.')); };
    transaction.onerror = () => { /* The abort event carries the transaction error. */ };
  });
}
export async function readAsset(id: string) { return result<Asset | undefined>((await database()).transaction('assets').objectStore('assets').get(id)); }
export async function readProject(id: string) { return result<Project | undefined>((await database()).transaction('projects').objectStore('projects').get(id)); }
export type RecentFile = { id: string; name: string; updatedAt: number; handle: FileSystemFileHandle };
export async function listRecentFiles() {
  return (await result<RecentFile[]>((await database()).transaction('recentFiles').objectStore('recentFiles').getAll()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function rememberRecentFile(handle: FileSystemFileHandle) {
  const existing = await listRecentFiles();
  let id: string = crypto.randomUUID();
  for (const item of existing) if (await handle.isSameEntry(item.handle)) { id = item.id; break; }
  const record = { id, name: handle.name, updatedAt: Date.now(), handle };
  const transaction = (await database()).transaction('recentFiles', 'readwrite');
  const done = committed(transaction);
  transaction.objectStore('recentFiles').put(record);
  await done;
  return record;
}
export async function forgetRecentFile(id: string) {
  const transaction = (await database()).transaction('recentFiles', 'readwrite');
  const done = committed(transaction);
  transaction.objectStore('recentFiles').delete(id);
  await done;
}
export async function listSavedProjects() {
  const projects = await result<Project[]>((await database()).transaction('projects').objectStore('projects').getAll());
  const activeId = await result<string | undefined>((await database()).transaction('settings').objectStore('settings').get('activeProject'));
  return projects.filter(project => project.saved === true || (project.saved === undefined && project.id === activeId && !project.id.startsWith('draft:')))
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function deleteSavedProject(id: string) {
  const db = await database();
  const transaction = db.transaction(['projects', 'assets'], 'readwrite');
  const done = committed(transaction);
  try {
    const store = transaction.objectStore('projects');
    const project = await result<Project | undefined>(store.get(id));
    if (!project || project.saved === false || (!project.saved && project.id.startsWith('draft:'))) throw new Error('Saved project not found.');
    // Keep media shared with the current draft or another project.
    const projects = await result<Project[]>(store.getAll());
    const used = new Set(projects.filter(item => item.id !== id).flatMap(assetIds));
    store.delete(id);
    for (const assetId of assetIds(project)) if (!used.has(assetId)) transaction.objectStore('assets').delete(assetId);
  } catch (error) { try { transaction.abort(); } catch { /* Already aborted. */ } await done.catch(() => undefined); throw error; }
  await done;
}
export async function readActiveProject() {
  const id = await result<string | undefined>((await database()).transaction('settings').objectStore('settings').get('activeProject'));
  return id ? readProject(id) : undefined;
}
export async function writeAsset(asset: Asset, signal?: AbortSignal) {
  const db = await database(); signal?.throwIfAborted();
  const transaction = db.transaction('assets', 'readwrite');
  const done = committed(transaction, signal);
  try { transaction.objectStore('assets').put(asset); }
  catch (error) { try { transaction.abort(); } catch { /* Already aborted. */ } await done.catch(() => undefined); throw error; }
  await done;
}
/** Import is one transaction: a failed write cannot replace the current project or leave partial assets. */
export async function writeProject(project: Project, assets: Asset[] = [], activate = false, signal?: AbortSignal) {
  const db = await database(); signal?.throwIfAborted();
  const transaction = db.transaction(['projects', 'assets', 'settings'], 'readwrite');
  const done = committed(transaction, signal);
  try {
    for (const asset of assets) { signal?.throwIfAborted(); transaction.objectStore('assets').put(asset); }
    signal?.throwIfAborted();
    transaction.objectStore('projects').put(project);
    if (activate) transaction.objectStore('settings').put(project.id, 'activeProject');
  } catch (error) { try { transaction.abort(); } catch { /* Already aborted. */ } await done.catch(() => undefined); throw error; }
  await done;
}
export function storageError(error: unknown) {
  return error instanceof DOMException && error.name === 'QuotaExceededError'
    ? 'Browser storage is full. Free space and retry, or export your project as a backup.'
    : error instanceof Error ? error.message : 'Unable to save this project locally.';
}
