// Splits browser spec files across CI shards by their recorded CI duration.
// Playwright's own --shard splits by test count, which leaves the slow files'
// shards running minutes after the rest have finished.
//
//   tsx scripts/browser-shard.ts 3/12                  print shard 3's test list
//   tsx scripts/browser-shard.ts --update a.json ...   refresh durations from JSON reports
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const testDir = 'tests/browser';
const durationsFile = path.join(testDir, 'durations.json');

type Durations = Record<string, number>;
type ReportSuite = { file?: string; suites?: ReportSuite[]; specs?: { file: string; tests: { results: { duration: number }[] }[] }[] };

const specFiles = () => readdirSync(testDir).filter(file => file.endsWith('.spec.ts')).sort();

function shard(index: number, total: number) {
  const durations: Durations = JSON.parse(readFileSync(durationsFile, 'utf8'));
  const files = specFiles();
  const known = files.map(file => durations[file]).filter(seconds => seconds > 0).sort((a, b) => a - b);
  // New files have no history yet; the median keeps them from skewing a shard.
  const fallback = known[Math.floor(known.length / 2)] ?? 1;
  const weight = (file: string) => durations[file] ?? fallback;
  const shards = Array.from({ length: total }, () => ({ seconds: 0, files: [] as string[] }));
  // Longest files first, each onto the least loaded shard. The order is stable,
  // so every CI job computes the same assignment independently.
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const target = shards.reduce((least, next) => next.seconds < least.seconds ? next : least);
    target.files.push(file); target.seconds += weight(file);
  }
  // --test-list resolves paths against the config's testDir.
  return shards[index - 1].files;
}

function update(reports: string[]) {
  const durations: Durations = {};
  const visit = (suite: ReportSuite) => {
    for (const spec of suite.specs ?? []) for (const test of spec.tests) {
      // The final attempt reflects the test's normal cost; retries are noise.
      const last = test.results.at(-1); if (!last) continue;
      const file = path.basename(spec.file);
      durations[file] = (durations[file] ?? 0) + last.duration / 1000;
    }
    suite.suites?.forEach(visit);
  };
  for (const report of reports) (JSON.parse(readFileSync(report, 'utf8')) as { suites: ReportSuite[] }).suites.forEach(visit);
  // Files missing from the reports ran no CI tests (only @slow or @generation cases).
  const sorted = Object.fromEntries(specFiles().map(file => [file, file in durations ? Math.max(1, Math.round(durations[file])) : 0]));
  writeFileSync(durationsFile, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`Recorded ${Object.keys(sorted).length} spec files from ${reports.length} reports.`);
}

const [command, ...rest] = process.argv.slice(2);
const match = /^(\d+)\/(\d+)$/.exec(command ?? '');
if (command === '--update' && rest.length) update(rest);
else if (match && +match[1] >= 1 && +match[1] <= +match[2]) console.log(shard(+match[1], +match[2]).join('\n'));
else {
  console.error('Usage: tsx scripts/browser-shard.ts <shard>/<total> | --update <playwright-report.json>...');
  process.exit(1);
}
