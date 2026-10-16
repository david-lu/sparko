import type { FalJob } from '../../../shared/contracts';
import type { MediaSource } from '../../media/media';
import { sendForm } from '../../shared/api';

export async function submitFal(source: MediaSource, values: { start: number; resume: number; duration: number; prompt: string; resolution: string }): Promise<FalJob> {
  const body = new FormData();
  for (const [key, value] of Object.entries(values)) body.set(key, String(value));
  body.set('source', source.file ? 'upload' : 'default');
  if (source.file) {
    if (source.file.size > 256 * 1024 * 1024) throw new Error('fal uploads are limited to 256 MB in this app.');
    body.set('video', source.file);
  }
  return sendForm<FalJob>('/api/fal/jobs', body);
}
