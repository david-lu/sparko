import 'dotenv/config';
import { openAsBlob } from 'node:fs';
import { put } from '@vercel/blob';

if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Set BLOB_READ_WRITE_TOKEN from your Vercel Blob store before uploading.');
const file = await openAsBlob(new URL('../episode_mock.mp4', import.meta.url), { type: 'video/mp4' });
const result = await put('defaults/episode_mock.mp4', file, {
  access: 'public', contentType: 'video/mp4', addRandomSuffix: true, multipart: true,
});
console.log('Set DEFAULT_VIDEO_URL in Vercel to this URL:');
console.log(result.url);
