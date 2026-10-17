import 'dotenv/config';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { put } from '@vercel/blob';
import { unpackProject } from '../src/features/project/archive';

if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Set BLOB_READ_WRITE_TOKEN from your Vercel Blob store before uploading.');
const filename = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL('../examples/sample.sparko', import.meta.url));
const file = await openAsBlob(filename, { type: 'application/zip' });
// Reject missing media, corrupt archives and Git LFS pointers before publishing anything.
const { project } = await unpackProject(file, new AbortController().signal, () => undefined);
console.log(`Uploading ${project.name}: ${project.interstitials.length} interstitials, ${(file.size / 1024 ** 2).toFixed(1)} MiB.`);
const result = await put('defaults/sample.sparko', file, {
  access: 'public', contentType: 'application/zip', addRandomSuffix: true, multipart: true,
});
console.log('Set DEFAULT_PROJECT_URL in Vercel to this URL, then redeploy:');
console.log(result.url);
