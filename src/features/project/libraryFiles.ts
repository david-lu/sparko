import type { LibraryAsset } from './types';

export type LibraryFile = { file: File; path: string };
export function mediaFile(file: File): File {
  if (file.type && file.type !== 'application/octet-stream') return file;
  const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', m4v: 'video/mp4' };
  return new File([file], file.name, { type: types[file.name.split('.').pop()!.toLowerCase()] || file.type, lastModified: file.lastModified });
}
export const mediaKind = (file: Pick<File, 'type' | 'name'>): LibraryAsset['kind'] => {
  if (/^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name)) return 'image';
  if (/^audio\//.test(file.type) || /\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(file.name)) return 'audio';
  if (/^video\//.test(file.type) || /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)) return 'video';
  throw new Error(`Unsupported asset: ${file.name}. Choose image, video, or audio files.`);
};
export function fileEntries(files: File[]): LibraryFile[] {
  return files.map(file => ({ file, path: file.webkitRelativePath || file.name }));
}
/** Read every directory batch; Chromium limits each readEntries call to 100 entries. */
export async function droppedFiles(data: DataTransfer): Promise<LibraryFile[]> {
  const roots = [...data.items].filter(item => item.kind === 'file').map(item => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => !!entry);
  const fallback = fileEntries([...data.files]);
  if (!roots.length) return fallback;
  const files: LibraryFile[] = [];
  const visit = async (entry: FileSystemEntry, prefix: string) => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      if (!file.name.startsWith('.')) files.push({ file, path: `${prefix}${file.name}` });
      if (files.length > 2000) throw new Error('Import up to 2,000 assets at once.');
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await visit(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const root of roots) await visit(root, '');
  return files;
}
export async function inspectAsset(blob: Blob, kind: LibraryAsset['kind'], signal?: AbortSignal): Promise<Partial<LibraryAsset>> {
  signal?.throwIfAborted();
  if (kind === 'image') {
    const bitmap = await createImageBitmap(blob);
    try { signal?.throwIfAborted(); return { width: bitmap.width, height: bitmap.height }; }
    finally { bitmap.close(); }
  }
  const element = document.createElement(kind === 'audio' ? 'audio' : 'video'), url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('Unable to read media metadata.')); }, 20_000);
      const cleanup = () => { clearTimeout(timer); element.onloadedmetadata = null; element.onerror = null; signal?.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(signal?.reason); };
      signal?.addEventListener('abort', abort, { once: true });
      element.onloadedmetadata = () => {
        cleanup();
        if (!Number.isFinite(element.duration) || element.duration <= 0) { reject(new Error('Media must have a finite duration.')); return; }
        resolve({ duration: element.duration, ...(element instanceof HTMLVideoElement ? { width: element.videoWidth, height: element.videoHeight } : {}) });
      };
      element.onerror = () => { cleanup(); reject(new Error('This browser cannot read the media. Try MP4, WebM, MP3, or WAV.')); };
      element.preload = 'metadata'; element.src = url;
    });
  } finally { element.removeAttribute('src'); element.load(); URL.revokeObjectURL(url); }
}
