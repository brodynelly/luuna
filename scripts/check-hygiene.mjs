import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbidden = tracked.filter(path => existsSync(path) && (
  /(^|\/)\.pi\/(agent\/auth\.json|sessions\/)/.test(path) ||
  /(^|\/)\.env($|\.(?!example))/u.test(path) ||
  /(^|\/)node_modules\//.test(path)
));
if (forbidden.length) {
  console.error('Tracked local/private artifacts:', forbidden.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Repository hygiene: no tracked session histories, auth stores, real .env files, or dependencies.');
}
