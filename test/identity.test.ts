import { privateCases } from './path-cases.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { repositoryEnvironment } from '../scripts/environment.ts';

test('identity gate allows public URI paths and refuses actual private paths in tracked content', () => {
  const root = mkdtempSync(join(tmpdir(), 'screen-identity-'));
  const inherited = { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: join(root, 'event.json'), github_sha: 'foreign', runner_temp: root, ci: 'true', GIT_DIR: 'foreign', NPM_TOKEN: 'synthetic' };
  const env = { ...repositoryEnvironment(inherited), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  /** Exercise the actual gate against a disposable committed repository with explicit identity. */
  const run = (command: string, args: string[]) => spawnSync(command, args, { cwd: root, env, encoding: 'utf8' });
  const check = () => run(process.execPath, [resolve('scripts/identity-gate.ts')]);
  const publicUri = 'https://github.com/' + ['users', 'public', 'issues', '1'].join('/');
  try {
    assert.ok(!Object.keys(env).some(key => /^(?:GITHUB_|RUNNER_|CI$)/i.test(key)), 'Disposable repositories must exclude parent CI context');
    writeFileSync(join(root, 'event.json'), JSON.stringify({ pull_request: { base: { sha: '1'.repeat(40) }, head: { sha: '2'.repeat(40) } } }));
    mkdirSync(join(root, '.github')); copyFileSync('.github/approved-git-identities.txt', join(root, '.github/approved-git-identities.txt'));
    writeFileSync(join(root, 'public.txt'), `${publicUri} and ${publicUri.replace('https://', '')} src/home/index.ts components/Users/List.tsx`);
    for (const args of [['init', '-q'], ['add', '.github/approved-git-identities.txt', 'public.txt'], ['-c', 'user.name=SteveBot', '-c', 'user.email=1153461+unbraind@users.noreply.github.com', 'commit', '-qm', 'Public fixture']]) assert.equal(run('git', args).status, 0);
    const accepted = check(); assert.equal(accepted.status, 0, accepted.stderr);
    for (const path of [...privateCases().filter(path => !['~', '$HOME', '${HOME}', '%USERPROFILE%', '/' + 'home', '/' + 'Users', '/' + 'root'].includes(path)).flatMap(path => [path, path + '...']), '/' + ['home', 'example', 'private'].join('/'), '/' + ['Users', 'example', 'private'].join('/'), '/' + ['root', 'private'].join('/'), 'C:' + String.fromCharCode(92) + ['Users', 'example', 'private'].join(String.fromCharCode(92))]) {
      writeFileSync(join(root, 'public.txt'), `${publicUri} and ${path}`); const refused = check(); assert.equal(refused.status, 1); assert.match(refused.stderr, /Private path policy failed/);
    }
    writeFileSync(join(root, 'public.txt'), `${publicUri} and ${publicUri.replace('https://', '')} src/home/index.ts components/Users/List.tsx`); assert.equal(check().status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
