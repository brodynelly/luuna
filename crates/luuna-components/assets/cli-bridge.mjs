// Fixed adapter transport only: component semantics remain in the pinned CLI.
// Private content travels through stdin rather than an OS-visible command line.
import { pathToFileURL } from 'node:url';
try {
  const request = JSON.parse(await Bun.stdin.text());
  if (typeof request.entrypoint !== 'string' || !Array.isArray(request.args) ||
      request.args.some(value => typeof value !== 'string')) throw new Error();
  process.argv = [process.execPath, request.entrypoint, ...request.args];
  // Commander otherwise sees the transport's --eval and slices CLI argv as an
  // eval program instead of a normal source entrypoint (Atlas uses auto-detect).
  process.execArgv = [];
  await import(pathToFileURL(request.entrypoint).href);
} catch {
  process.stderr.write('Component CLI transport failed.\n');
  process.exitCode = 1;
}
