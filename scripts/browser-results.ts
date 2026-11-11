// Decides whether a CI browser shard passed, from Playwright's JSON report.
// Tests tagged @flaky have failed at random in CI on code that passed in another
// run. They still run, but if one fails after its retry it is reported as a
// warning instead of failing the shard. Any other failure, a run-level error or
// a missing report still fails the shard.
//
//   tsx scripts/browser-results.ts test-results/results.json
import { readFileSync } from 'node:fs';
import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter';

const OPTIONAL_TAG = 'flaky';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('Usage: tsx scripts/browser-results.ts <playwright-report.json>');
  process.exit(1);
}

let report: JSONReport;
try {
  report = JSON.parse(readFileSync(file, 'utf8')) as JSONReport;
} catch (error) {
  console.error(`No readable Playwright report at ${file}: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const required: string[] = [], optional: string[] = [];
const visit = (suite: JSONReportSuite) => {
  for (const spec of suite.specs) for (const test of spec.tests) {
    if (test.status !== 'unexpected') continue;
    // The JSON reporter drops the leading @ from tags.
    const tags = spec.tags.map(tag => tag.replace(/^@/, ''));
    (tags.includes(OPTIONAL_TAG) ? optional : required).push(`${spec.file}:${spec.line} › ${spec.title}`);
  }
  suite.suites?.forEach(visit);
};
report.suites.forEach(visit);

// GitHub shows these as warnings on the run summary without failing the job.
for (const test of optional) console.log(`::warning title=Optional @flaky browser test failed::${test}`);
for (const error of report.errors) console.error(`Run error: ${error.message ?? error.value ?? 'unknown'}`);
for (const test of required) console.error(`Failed: ${test}`);

if (report.errors.length || required.length) process.exit(1);
// Playwright failed without a failing test, for example when no tests ran.
if (!optional.length) {
  console.error('Playwright failed without a failing test. See its output above.');
  process.exit(1);
}
console.log(`Only optional @flaky tests failed (${optional.length}); the shard passes.`);
