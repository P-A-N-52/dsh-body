import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const tool = fileURLToPath(new URL('../tools/sync-organ-parameters.mjs', import.meta.url));
const begin = '<!-- organ-parameters:start -->';
const end = '<!-- organ-parameters:end -->';
const dir = 'organs/human-organs/demo';
const readme = `${dir}/README.md`;
const params = `${dir}/demo.parameters.json`;
const manual = '# 测试器官\n\n手写的前言。\n\n## 保留小节\n\n手写的正文。\n';

function fixture(t) {
  assert.ok(existsSync(tool), '参数 README 命令尚未实现');
  const base = join(tmpdir(), 'dsh-body');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'organ-docs.'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function put(path, content) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const get = (path) => readFileSync(join(root, path), 'utf8');
  mkdirSync(join(root, 'tools'));
  copyFileSync(tool, join(root, 'tools/sync-organ-parameters.mjs'));
  put('body-modules.json', JSON.stringify({ scripts: [`./${dir}/organ.ts`] }));
  put('body-modules.female.json', JSON.stringify({ scripts: [`./${dir}/regions/hand.ts`] }));
  put('body-modules.male.json', JSON.stringify({ scripts: [] }));
  put(`${dir}/organ.ts`, `
    import { active, reserved } from './core.ts';
    export const id = 'demo';
    export const heartbeat = () => active + (reserved ?? 0);
  `);
  put(`${dir}/core.ts`, `
    throw new Error('文档生成不能 import 模拟模块');
    const p = loadParameters(new URL('./demo.parameters.json', import.meta.url));
    export const active = scaleByBodyWeight(requireParameter(p, 'demo.active'), 'demo.active');
    export const reserved = p['demo.unknown'];
    // requireParameter(p, 'demo.registered');
  `);
  put(`${dir}/regions/hand.ts`, `
    import { active } from '../core.ts';
    export const id = 'hand';
    export const heartbeat = () => active;
  `);
  put(readme, manual);
  put(`${dir}/regions/README.md`, '# 手部\n');
  put('organs/human-organs/without-params/README.md', '# 无参数部位\n');
  put('organs/human-organs/without-params/part.ts', 'export const id = "withoutParams";');
  put('organs/presets/demo/body-modules.json', JSON.stringify({ scripts: ['../../human-organs/without-params/part.ts'] }));
  put('organs/presets/demo/README.md', '# 清单说明不是部位\n');
  put(params, JSON.stringify({ schemaVersion: 1, owner: 'demo', parameters: [
    { id: 'demo.active', value: 12.5, unit: 'mL/min', status: 'design' },
    { id: 'demo.unknown', value: null, unit: 'mL', status: 'unset' },
    { id: 'demo.registered', value: 0.01, unit: '1/min', status: 'prior' },
  ]}));
  return {
    put, get,
    run: (...args) => spawnSync(process.execPath, [join(root, 'tools/sync-organ-parameters.mjs'), ...args], { cwd: root, encoding: 'utf8' }),
  };
}

test('默认与 --check 报告缺失标记块而不写入 README', (t) => {
  const { run, get } = fixture(t);
  for (const args of [[], ['--check']]) {
    const result = run(...args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /demo\/README\.md/);
    assert.equal(get(readme), manual);
  }
});

test('--write 按 JSON 实数、单位和状态生成，只修改 README 标记块', (t) => {
  const { put, get, run } = fixture(t);
  const json = get(params);
  const result = run('--write');
  assert.equal(result.status, 0, result.stderr);
  const updated = get(readme);
  assert.match(updated, /\| `demo\.active` \| `12\.5` \| `mL\/min` \| `design` \| .*weightKg/);
  assert.match(updated, /\| `demo\.unknown` \| `null` \| `mL` \| `unset` \|/);
  assert.match(updated, /\| `demo\.registered` \| `0\.01` \| `1\/min` \| `prior` \| .*无读取/);
  assert.match(updated, /\]\(demo\.parameters\.json\)/);
  assert.match(updated, /\]\(core\.ts\)/);
  assert.match(updated, /\]\(organ\.ts\).*默认/);
  const start = updated.indexOf(begin);
  const finish = updated.indexOf(end) + end.length;
  assert.ok(start > 0 && finish > start);
  assert.equal((updated.slice(0, start) + updated.slice(finish)).replace(/\n{3,}/g, '\n\n').trimEnd(), manual.trimEnd());
  assert.equal(get(params), json);
  put(readme, `${updated.slice(0, start)}${begin}\n旧目录\n${end}${updated.slice(finish)}`);
  assert.equal(run('--check').status, 1);
  assert.equal(run('--write').status, 0);
  assert.equal(get(readme), updated);
  assert.equal(run('--check').status, 0);
  assert.equal(run('--write').status, 0);
  assert.equal(get(readme), updated);
});

test('共享 core 和无独立参数的可选部位均有本地目录，清单说明不被写入', (t) => {
  const { get, run } = fixture(t);
  const result = run('--write');
  assert.equal(result.status, 0, result.stderr);
  const region = get(`${dir}/regions/README.md`);
  assert.match(region, /无独立/);
  assert.match(region, /\]\(\.\.\/demo\.parameters\.json\)/);
  assert.match(region, /\]\(hand\.ts\).*女性/);
  assert.match(region, /`demo\.active`/);
  assert.doesNotMatch(region, /`demo\.registered`/);
  const noParams = get('organs/human-organs/without-params/README.md');
  assert.match(noParams, /无独立/);
  assert.match(noParams, /可选清单.*demo/);
  assert.equal(get('organs/presets/demo/README.md'), '# 清单说明不是部位\n');
});

test('标记单边缺失时 --write 拒绝修改任何 README', (t) => {
  const { get, put, run } = fixture(t);
  const malformed = `# 手部\n\n${begin}\n可能有手写文字。\n`;
  put(`${dir}/regions/README.md`, malformed);
  const result = run('--write');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /regions\/README\.md.*标记/);
  assert.equal(get(readme), manual);
  assert.equal(get(`${dir}/regions/README.md`), malformed);
});

test('--check 在 JSON 默认值更新后指出过期目录', (t) => {
  const { get, put, run } = fixture(t);
  assert.equal(run('--write').status, 0);
  const old = get(readme);
  const changed = JSON.parse(get(params));
  changed.parameters[0].value = 14;
  put(params, JSON.stringify(changed));
  const result = run('--check');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /demo\/README\.md/);
  assert.equal(get(readme), old);
  assert.equal(run('--write').status, 0);
  assert.match(get(readme), /\| `demo\.active` \| `14` \|/);
});

test('移出清单且无参数文件后，不让旧标记目录通过检查', (t) => {
  const { get, put, run } = fixture(t);
  assert.equal(run('--write').status, 0);
  const path = 'organs/human-organs/without-params/README.md';
  const old = get(path);
  put('organs/presets/demo/body-modules.json', JSON.stringify({ scripts: [] }));
  for (const mode of ['--check', '--write']) {
    const result = run(mode);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /without-params\/README\.md.*标记/);
    assert.equal(get(path), old);
  }
});

test('仓库中每个清单部位和本地 JSON 已同步到 README', () => {
  const result = spawnSync(process.execPath, [tool, '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
