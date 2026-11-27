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
    addEntries(...paths) {
      const path = 'body-modules.json';
      const manifest = JSON.parse(get(path));
      manifest.scripts.push(...paths.map((file) => `./${file}`));
      put(path, JSON.stringify(manifest));
    },
    run: (...args) => spawnSync(process.execPath, [join(root, 'tools/sync-organ-parameters.mjs'), ...args], { cwd: root, encoding: 'utf8' }),
  };
}

function rowFor(markdown, id) {
  const row = markdown.split('\n').find((line) => line.startsWith(`| \`${id}\` |`));
  assert.ok(row, `未列出 ${id}`);
  return row;
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

test('首次同步不把 shell 围栏里的 ## 注释当成目录插入点', (t) => {
  const { get, put, run } = fixture(t);
  const original = '\n```sh\n## 运行检查\nnode --test test/organs.heart.test.mjs\n```\n\n';
  const i = manual.indexOf('## 保留小节');
  const prefix = manual.slice(0, i) + original;
  const suffix = manual.slice(i);
  put(readme, prefix + suffix);
  const result = run('--write');
  assert.equal(result.status, 0, result.stderr);
  const updated = get(readme);
  assert.equal(updated.slice(0, prefix.length + begin.length), prefix + begin);
  assert.ok(updated.startsWith(`${prefix}${begin}\n## 个体可自定义参数与默认值\n`));
  assert.ok(updated.endsWith(`${end}\n\n${suffix}`));
  assert.equal(run('--check').status, 0);
});

test('Markdown 围栏内的同名标题和示例标记不是生成块边界', (t) => {
  const { get, put, run } = fixture(t);
  const prefix = [
    '# 测试器官', '', '~~~~markdown', begin, '## 个体可自定义参数与默认值',
    '保留这段手写 Markdown 示例。', '~~~sh', '## 内部示例', '~~~', end, '~~~~~', '', '',
  ].join('\r\n');
  const suffix = '## 保留小节\r\n\r\n手写的正文。\r\n';
  put(readme, prefix + suffix);
  const result = run('--write');
  assert.equal(result.status, 0, result.stderr);
  const updated = get(readme);
  assert.equal(updated.slice(0, prefix.length + begin.length), prefix + begin);
  assert.ok(updated.startsWith(`${prefix}${begin}\r\n## 个体可自定义参数与默认值\r\n`));
  assert.ok(updated.endsWith(`${end}\r\n\r\n${suffix}`));

  const preset = 'organs/presets/demo/README.md';
  put(preset, prefix + suffix);
  const check = run('--check');
  assert.equal(check.status, 0, check.stderr);
  assert.match(run('--write').stdout, /更新 0 份/);
  assert.equal(get(readme), updated);
  assert.equal(get(preset), prefix + suffix);
});

test('围栏未闭合或处在未解析的列表上下文时，整批拒写', (t) => {
  const { get, put, run } = fixture(t);
  const region = `${dir}/regions/README.md`;
  const cases = [
    '# 手部\n\n```sh\n## 这仍属于 shell 示例\n',
    '# 手部\n\n- ```sh\n  ## 列表内的示例\n  ```\n',
  ];
  for (const original of cases) {
    put(region, original);
    for (const mode of ['--write', '--check']) {
      const result = run(mode);
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.match(result.stderr, /regions\/README\.md.*围栏/);
      assert.equal(get(readme), manual);
      assert.equal(get(region), original);
    }
  }
});

test('真实起始标记不能与围栏内的结束示例配对', (t) => {
  const { get, put, run } = fixture(t);
  const region = `${dir}/regions/README.md`;
  const original = ['# 手部', '', begin, '```markdown', '保留这段示例。', end, '```', ''].join('\n');
  put(region, original);
  for (const mode of ['--write', '--check']) {
    const result = run(mode);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /regions\/README\.md.*标记/);
    assert.equal(get(readme), manual);
    assert.equal(get(region), original);
  }
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

test('双标记丢失且 JSON 漂移时拒绝生成第二份目录，整批只读', (t) => {
  const { get, put, run } = fixture(t);
  assert.equal(run('--write').status, 0);
  const region = `${dir}/regions/README.md`;
  const marked = get(region);
  const unmarked = marked.replace(`${begin}\n`, '').replace(`${end}\n`, '');
  put(region, unmarked);
  const original = get(readme);
  const changed = JSON.parse(get(params));
  changed.parameters[0].value = 14;
  put(params, JSON.stringify(changed));
  for (const mode of ['--write', '--check']) {
    const result = run(mode);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /regions\/README\.md.*同名.*标记/);
    assert.equal(get(region), unmarked);
    assert.equal(get(readme), original);
  }
  put(region, marked);
  assert.equal(run('--write').status, 0);
  assert.match(rowFor(get(region), 'demo.active'), /\| `14` \|/);
});

test('未受标记保护的同名手写节在首次生成和后续同步时都不被覆盖', (t) => {
  const { get, put, run } = fixture(t);
  const hand = '个体可自定义参数与默认值\n----------------------\n\n这是手写的参数解释。\n';
  put(readme, manual + '\n' + hand);
  const first = run('--write');
  assert.equal(first.status, 1, first.stderr || first.stdout);
  assert.match(first.stderr, /demo\/README\.md.*同名.*标记/);
  assert.equal(get(readme), manual + '\n' + hand);

  put(readme, manual);
  assert.equal(run('--write').status, 0);
  const duplicate = get(readme) + '\n### 个体可自定义参数与默认值 ###\n\n必须保留的正文。\n';
  put(readme, duplicate);
  const result = run('--check');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /demo\/README\.md.*同名.*标记/);
  assert.equal(get(readme), duplicate);
});

test('小肠非零 JSON 默认不会生成默认零的说明，并区分上游未加载与非法字段', (t) => {
  const { get, put, addEntries, run } = fixture(t);
  const organ = 'organs/human-organs/small-intestine';
  const source = `${organ}/water-absorption.ts`;
  const catalog = `${organ}/README.md`;
  put(catalog, '# 小肠\n');
  addEntries(source);
  put(source, `
    const p = loadParameters(new URL('./water-absorption.parameters.json', import.meta.url));
    export const heartbeat = () => requireParameter(p, 'smallIntestine.carbAbsorptionInsulinGain')
      + requireParameter(p, 'smallIntestine.carbAbsorptionGradientGain');
  `);
  put(`${organ}/water-absorption.parameters.json`, JSON.stringify({ schemaVersion: 1, owner: 'smallIntestine', parameters: [
    { id: 'smallIntestine.carbAbsorptionInsulinGain', value: 0.1, unit: '1', status: 'design' },
    { id: 'smallIntestine.carbAbsorptionGradientGain', value: 0.002, unit: '1', status: 'design' },
  ]}));
  const generated = run('--write');
  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(run('--check').status, 0);
  const markdown = get(catalog);
  const insulin = rowFor(markdown, 'smallIntestine.carbAbsorptionInsulinGain');
  assert.match(insulin, /\| `0\.1` \|/);
  assert.doesNotMatch(insulin, /默认(?:为)?[零0]/);
  assert.match(insulin, /取零.*无贡献/);
  assert.match(insulin, /胰腺未加载.*基线.*已加载.*报错/);
  assert.match(rowFor(markdown, 'smallIntestine.carbAbsorptionGradientGain'), /葡萄糖隔室未加载.*基线.*已加载.*报错/);
});

test('共享源文件的消费入口按参数键区分自身 heartbeat 和只调用释放判据的入口', (t) => {
  const { get, put, addEntries, run } = fixture(t);
  const owner = 'organs/human-organs/sexual-response';
  const caller = `${dir}/release-use.ts`;
  put(`${owner}/README.md`, '# 性反应\n');
  put(`${owner}/response.ts`, `
    const p = loadParameters(new URL('./response.parameters.json', import.meta.url));
    const halfTime = requireParameter(p, 'sexualResponse.arousalHalfTimeMin');
    const threshold = requireParameter(p, 'sexualResponse.orgasmAllowedMm');
    export function evaluateSexualRelease(reading) { return reading >= threshold; }
    export function heartbeat() { return halfTime; }
  `);
  put(`${owner}/response.parameters.json`, JSON.stringify({ schemaVersion: 1, owner: 'sexualResponse', parameters: [
    { id: 'sexualResponse.arousalHalfTimeMin', value: 5, unit: 'min', status: 'design' },
    { id: 'sexualResponse.orgasmAllowedMm', value: 70, unit: 'mm', status: 'design' },
  ]}));
  put(caller, `
    import { evaluateSexualRelease } from '../sexual-response/response.ts';
    export function heartbeat(io) { return evaluateSexualRelease(io.read('sexualResponse').arousalMm); }
  `);
  addEntries(`${owner}/response.ts`, caller);
  const result = run('--write');
  assert.equal(result.status, 0, result.stderr);
  const ownPage = get(`${owner}/README.md`);
  const halfTime = rowFor(ownPage, 'sexualResponse.arousalHalfTimeMin');
  const threshold = rowFor(ownPage, 'sexualResponse.orgasmAllowedMm');
  assert.match(halfTime, /消费入口：.*\]\(response\.ts\)/);
  assert.doesNotMatch(halfTime, /release-use\.ts/);
  assert.match(threshold, /消费入口：.*\]\(response\.ts\).*\]\(\.\.\/demo\/release-use\.ts\)/);
  const callerPage = get(readme);
  assert.match(callerPage, /`sexualResponse\.orgasmAllowedMm`/);
  assert.doesNotMatch(callerPage, /`sexualResponse\.arousalHalfTimeMin`/);
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
