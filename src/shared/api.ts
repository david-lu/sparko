import type { AppStatus } from '../../shared/contracts';

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, headers: { ...appHeaders(), ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) window.dispatchEvent(new Event('sparko:auth-required'));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body as T;
}
export function appHeaders() {
  return { 'x-sparko-request': '1', 'x-sparko-password': sessionStorage.getItem('sparko:password') || '' };
}
let appStatus: AppStatus | undefined;
export const getStatus = async () => appStatus = await request<AppStatus>('/api/status');

export async function sendForm<T>(path: string, body: FormData, signal?: AbortSignal): Promise<T> {
  const status = appStatus || await getStatus();
  if (status.uploadMode === 'local') return request<T>(path, { method: 'POST', body, signal });
  const { upload } = await import('@vercel/blob/client');
  const urls: string[] = [];
  try {
    const payload: { fields: Record<string, string>; file?: { url: string; name: string; mime: string; field: string } } = { fields: {} };
    for (const [field, value] of body.entries()) {
      if (typeof value === 'string') payload.fields[field] = value;
      else {
        const extension = value.type.includes('wav') ? 'wav' : value.type.includes('webm') ? 'webm' : value.type.includes('quicktime') ? 'mov' : value.type.includes('matroska') ? 'mkv' : 'mp4';
        const blob = await upload(`transient/${crypto.randomUUID()}.${extension}`, value, {
          access: 'public', handleUploadUrl: '/api/uploads', contentType: value.type,
          headers: appHeaders(), multipart: value.size > 5 * 1024 * 1024, abortSignal: signal,
        });
        urls.push(blob.url); payload.file = { url: blob.url, name: value.name, mime: value.type, field };
      }
    }
    const blob = await upload(`transient/${crypto.randomUUID()}.json`, new Blob([JSON.stringify(payload)], { type: 'application/json' }), {
      access: 'public', handleUploadUrl: '/api/uploads', contentType: 'application/json', headers: appHeaders(), abortSignal: signal,
    });
    urls.push(blob.url);
    return await request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payloadUrl: blob.url }), signal });
  } finally {
    if (urls.length) await request('/api/uploads', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }) }).catch(() => undefined);
  }
}
