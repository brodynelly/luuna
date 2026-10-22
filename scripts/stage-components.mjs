// Stages the pinned Missions, Atlas and Beacon trees (and optionally the pinned
// Bun executable) into a portable layout the runtime can verify without Git
// metadata (ADR 0024). The source checkout must already satisfy the manifest
// pins and gitlinks (`scripts/components.mjs`); each component is installed in
// place with the same frozen, script-free Bun command `components.mjs setup`
// uses, then copied without its `.git` link and digested. The packager calls
// this on Windows; the digest and manifest formats are shared with
// `crates/luuna-components`.
//
//   node scripts/stage-components.mjs stage --out <dir> [--root <checkout>] [--bun <executable>] [--skip-install]
//   node scripts/stage-components.mjs digest <directory>
//   node scripts/stage-components.mjs verify <staged-root>
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bunExecutable, componentNames, manifest, repositoryRoot, verifyComponent } from './components.mjs';

export const DIST_MANIFEST = 'components/dist-manifest.json';
export const DIST_SCHEMA_VERSION = 1;
export const DIST_KIND = 'luuna-portable-components';
const LIMITS = { entries: 200_000, bytes: 2 * 1024 * 1024 * 1024, depth: 64 };

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const byteOrder = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

/**
 * Deterministic SHA-256 over a directory tree. One line per regular file
 * (`<relative path>\0file\0<sha256 of contents>`) or symbolic link
 * (`<relative path>\0link\0<sha256 of the link target>`), relative paths with
 * `/` separators sorted by their UTF-8 bytes, joined with `\n`. Empty
 * directories contribute nothing; any other entry kind is refused. The Rust
 * verifier (`luuna-components::tree_digest`) implements the same function.
 */
export function treeDigest(directory) {
  const lines = [];
  let bytes = 0;
  const visit = (rel, depth) => {
    if (depth > LIMITS.depth) throw new Error(`${directory}: nests deeper than ${LIMITS.depth} levels`);
    const full = rel ? join(directory, ...rel.split('/')) : directory;
    for (const name of readdirSync(full)) {
      const entry = rel ? `${rel}/${name}` : name;
      if (lines.length >= LIMITS.entries) throw new Error(`${directory}: more than ${LIMITS.entries} entries`);
      const stat = lstatSync(join(full, name));
      if (stat.isSymbolicLink()) {
        lines.push({ entry, line: `${entry}\0link\0${sha256(Buffer.from(readlinkSync(join(full, name)), 'utf8'))}` });
      } else if (stat.isDirectory()) {
        visit(entry, depth + 1);
      } else if (stat.isFile()) {
        bytes += stat.size;
        if (bytes > LIMITS.bytes) throw new Error(`${directory}: more than ${LIMITS.bytes} bytes`);
        lines.push({ entry, line: `${entry}\0file\0${sha256(readFileSync(join(full, name)))}` });
      } else {
        throw new Error(`${directory}: ${entry} is neither a file, a directory nor a symbolic link`);
      }
    }
  };
  visit('', 0);
  lines.sort((a, b) => byteOrder(a.entry, b.entry));
  const files = lines.filter((item) => item.line.includes('\0file\0')).length;
  return { digest: `sha256:${sha256(lines.map((item) => item.line).join('\n'))}`, entries: lines.length, files, bytes };
}

/** Copy a component checkout without its `.git` link into `destination`. */
export function copyTree(source, destination) {
  if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: (path) => basename(path) !== '.git' || resolve(path) !== resolve(source, '.git'),
  });
}

/** `bun install --frozen-lockfile --ignore-scripts`, exactly as `components.mjs setup`, with the root-hooks check. */
export function installComponent(root, bun, directory) {
  const hooks = () => spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).stdout;
  const before = hooks();
  execFileSync(bun, ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: directory, stdio: 'inherit' });
  if (before !== hooks()) throw new Error('Component installation changed root Git hooks');
}

function sourceCommit(root) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * Stage every pinned component (and the Bun executable when given) under
 * `out`, returning the distribution manifest that was written there.
 */
export function stageComponents({ out, root = repositoryRoot, bun = null, skipInstall = false } = {}) {
  if (!out) throw new Error('stage requires --out <directory>');
  out = resolve(out);
  root = resolve(root);
  const data = manifest(root);
  const manifestBytes = readFileSync(join(root, 'components/manifest.json'));
  // Every pin, URL and checkout is verified before any install or copy.
  for (const component of data.components) verifyComponent(root, component);
  if (bun) {
    const version = execFileSync(bun, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim();
    if (version !== data.runtime.version) throw new Error(`Use Bun ${data.runtime.version}; ${bun} is ${version}`);
  }
  const installer = skipInstall ? null : (bun ?? bunExecutable(root));
  const entries = [];
  for (const component of data.components) {
    const directory = verifyComponent(root, component);
    if (installer) installComponent(root, installer, directory);
    verifyComponent(root, component, true);
    const name = component.path.split('/')[1];
    const destination = join(out, 'components', name);
    copyTree(directory, destination);
    const { digest, entries: count, files, bytes } = treeDigest(destination);
    entries.push({
      name, path: component.path, package: component.package, sourceVersion: component.sourceVersion,
      repository: component.repository, commit: component.commit, digest, entries: count, files, bytes,
    });
  }
  let runtime = { name: data.runtime.name, version: data.runtime.version, executable: null, sha256: null };
  if (bun) {
    const file = process.platform === 'win32' ? 'bun.exe' : 'bun';
    mkdirSync(join(out, 'bun'), { recursive: true });
    cpSync(bun, join(out, 'bun', file), { dereference: true });
    runtime = { ...runtime, executable: `bun/${file}`, sha256: sha256(readFileSync(join(out, 'bun', file))) };
  }
  mkdirSync(join(out, 'components'), { recursive: true });
  writeFileSync(join(out, 'components/manifest.json'), manifestBytes);
  const dist = {
    schemaVersion: DIST_SCHEMA_VERSION,
    kind: DIST_KIND,
    generatedAt: new Date().toISOString(),
    source: { luunaCommit: sourceCommit(root), manifestSha256: sha256(manifestBytes) },
    runtime,
    components: entries,
  };
  writeFileSync(join(out, DIST_MANIFEST), `${JSON.stringify(dist, null, 2)}\n`);
  return dist;
}

/** Re-check a staged root the way the runtime does: digests, pins and the Bun hash. */
export function verifyStaged(out) {
  out = resolve(out);
  const dist = JSON.parse(readFileSync(join(out, DIST_MANIFEST), 'utf8'));
  if (dist.schemaVersion !== DIST_SCHEMA_VERSION || dist.kind !== DIST_KIND) throw new Error('Unknown distribution manifest');
  const data = manifest(out);
  if (sha256(readFileSync(join(out, 'components/manifest.json'))) !== dist.source?.manifestSha256) throw new Error('components/manifest.json differs from the distribution manifest');
  if (dist.runtime?.version !== data.runtime.version) throw new Error('Bun version differs between the manifests');
  const names = dist.components?.map((c) => c.name).sort();
  if (JSON.stringify(names) !== JSON.stringify([...componentNames].sort())) throw new Error('Distribution manifest must stage exactly Missions, Atlas and Beacon');
  for (const component of data.components) {
    const staged = dist.components.find((c) => c.path === component.path);
    if (!staged || staged.commit !== component.commit) throw new Error(`${component.brand}: pinned commit differs between the manifests`);
    const directory = join(out, ...component.path.split('/'));
    if (!existsSync(directory)) throw new Error(`${component.brand}: staged tree missing`);
    const { digest } = treeDigest(directory);
    if (digest !== staged.digest) throw new Error(`${component.brand}: staged tree digest ${digest} differs from ${staged.digest}`);
  }
  if (dist.runtime.executable) {
    const bun = join(out, ...dist.runtime.executable.split('/'));
    if (!statSync(bun).isFile() || sha256(readFileSync(bun)) !== dist.runtime.sha256) throw new Error('Staged Bun executable differs from the distribution manifest');
  }
  return dist;
}

function options(args) {
  const parsed = { positional: [] };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--skip-install') parsed.skipInstall = true;
    else if (args[i].startsWith('--')) { parsed[args[i].slice(2)] = args[i + 1]; i += 1; } else parsed.positional.push(args[i]);
  }
  return parsed;
}

function main() {
  const [action, ...rest] = process.argv.slice(2);
  const parsed = options(rest);
  if (action === 'stage') {
    const dist = stageComponents({ out: parsed.out, root: parsed.root ?? repositoryRoot, bun: parsed.bun ?? null, skipInstall: !!parsed.skipInstall });
    for (const component of dist.components) console.log(`${component.name}: ${component.commit} ${component.digest} (${component.files} files)`);
    if (dist.runtime.executable) console.log(`bun ${dist.runtime.version}: ${dist.runtime.sha256}`);
    console.log(`Wrote ${join(resolve(parsed.out), DIST_MANIFEST)}`);
  } else if (action === 'digest') {
    if (!parsed.positional[0]) throw new Error('digest requires a directory');
    console.log(treeDigest(resolve(parsed.positional[0])).digest);
  } else if (action === 'verify') {
    if (!parsed.positional[0]) throw new Error('verify requires the staged root');
    const dist = verifyStaged(parsed.positional[0]);
    for (const component of dist.components) console.log(`${component.name}: ${component.commit} ${component.digest} verified`);
    console.log(relative(process.cwd(), resolve(parsed.positional[0])) || '.');
  } else {
    throw new Error('Usage: node scripts/stage-components.mjs stage --out <dir> [--root <checkout>] [--bun <exe>] [--skip-install] | digest <dir> | verify <staged-root>');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
export const scriptPath = fileURLToPath(import.meta.url);
