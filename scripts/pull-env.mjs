import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [environment = 'development', ...extra] = process.argv.slice(2);
const usage = 'Usage: npm run vercel:env -- [development|preview|production]';
if (environment === '--help' || environment === '-h') {
  console.log(`${usage}\nDefaults to development. Backs up an existing .env before updating it.`);
  process.exit(0);
}
if (extra.length || !['development', 'preview', 'production'].includes(environment)) {
  console.error(usage);
  process.exit(1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, '.env');
const temporaryName = `.env.pull-${randomUUID()}`;
const temporary = path.join(root, temporaryName);
// New environment files and backups should only be readable by their owner.
process.umask(0o077);

try {
  await access(path.join(root, '.vercel', 'project.json')).catch(() => {
    throw new Error('First run npx vercel login and npx vercel link from the Sparko folder, selecting your existing project.');
  });
  const previous = await readFile(destination).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  // Seed the temporary file so Vercel can preserve local-only values when merging.
  await writeFile(temporary, previous ?? '', { flag: 'wx', mode: 0o600 });
  console.log(`Fetching Vercel ${environment} variables into .env...`);
  const result = spawnSync('npx', ['--yes', 'vercel', 'env', 'pull', temporaryName, `--environment=${environment}`, '--yes'], {
    cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    throw new Error('Vercel pull failed; your existing .env was left unchanged.');
  }
  await chmod(temporary, 0o600);
  if (previous !== null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `.env.backup-${timestamp}-${randomUUID()}`;
    await writeFile(path.join(root, backup), previous, { flag: 'wx', mode: 0o600 });
    console.log(`Previous .env saved as ${backup}`);
  }
  await rename(temporary, destination);
  console.log('Updated .env. Restart npm run dev to load the new values.');
} catch (error) {
  console.error(error.message);
  process.exitCode ||= 1;
} finally {
  await rm(temporary, { force: true });
}
