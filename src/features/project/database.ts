import type { Asset, Project } from './types';

const DATABASE = 'sparko-projects';
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('assets', { keyPath: 'id' });
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('settings');
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
