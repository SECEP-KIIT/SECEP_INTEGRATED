// Syntax-checks every .js file with `node --check`. npm on Windows can't expand globs, hence a script.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['src', 'test', 'scripts'];
const files = roots.flatMap((dir) =>
  readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => join(dir, f)),
);

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    process.stderr.write(err.stderr);
  }
}

console.log(`node --check: ${files.length - failed}/${files.length} files OK`);
process.exitCode = failed ? 1 : 0;
