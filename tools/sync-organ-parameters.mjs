import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative as localRelative, sep } from 'node:path';
import { basename, dirname, join as fromDir, relative } from 'node:path/posix';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const start = '<!-- organ-parameters:start -->';
const end = '<!-- organ-parameters:end -->';
const sectionTitle = '个体可自定义参数与默认值';
const sectionHeading = new RegExp(
  `^ {0,3}(?:#{1,6}[ \\t]+${sectionTitle}(?:[ \\t]+#+)?|${sectionTitle}[ \\t]*\\r?\\n {0,3}(?:=+|-+))[ \\t]*\\r?$`, 'm',
);
const manifests = new Map([
  ['body-modules.json', '默认'],
  ['body-modules.female.json', '女性'],
  ['body-modules.male.json', '男性'],
]);
const optionalEntries = {
  'brain/hypothalamus-adh-di-central.ts': '可选中枢 DI 样入口，替换正常 ADH 模块，配套肾变体；独立清单和存档',
  'kidney/urine-production-di-central.ts': '可选中枢 DI 样入口，替换正常产尿，配套中枢 DI 样 ADH；独立清单和存档',
  'kidney/urine-production-di-nephrogenic.ts': '可选肾性 DI 样入口，替换正常产尿，不读 ADH；独立清单和存档',
  'skeletal-muscle/glucose-uptake.no-limbs.ts': '可选缺四肢入口，替换普通聚合器，与移除 `regions/limbs.ts` 配套',
  'stomach/motility.ts': '可选旧入口，替换水链胃，不跟踪水或碳水转移',
};
const reserved = {
  'heart.catecholamineGain': '保留：读取并要求非空，但丢弃该值，不参与心率计算。',
  'ovaries.lutealLengthDays': '保留：读取并要求非空，但不参与周期或分期；不能独立调黄体期。',
};
const rowNotes = {
  'blood.referenceMaxCardiacOutputMlMin': '播种供氧上限；正常优先使用 `heart.maxCardiacOutputMlMin`。仅心脏未加载或该字段缺失时回退，字段存在但非法则报错；不设定心脏输出。',
  'calcium.referenceMgDl': '血钙种子，只用于新建或 `mgDl` 缺失/非有限的回退；不覆盖已有有效值，不是运行设定点。',
  'calcium.boneStoreInitialG': '骨钙库种子，只用于新建或 `boneStoreG` 缺失/非有限的回退；不覆盖已有有效量。',
  'calcium.referencePthPgMl': '有有效 `parathyroid.pthPgMl` 时作比例分母；未加载甲状旁腺时用相对基线 1，此键不参与该回退。',
  'glucose.distributionVolumeDlPerKg': '是每 kg 的系数；与模型参考质量相乘，形成分布容积。',
  'interoception.thirst.fallbackMm': '用于初值及上游口渴缺失或非有限时的回退；正常优先使用 `hypothalamusThirst.thirst`，不是慢渴模型的调节项。',
  'interoception.bowelUrgency.referenceStoolG': '仅在 `colon.bowelUrgencyMm` 缺失或非有限时，用 `colon.stoolG` 换算便意；正常优先使用结肠给出的有限便意读数。',
  'liver.initialGlycogenG': '补种子或缺失值，不用此值覆盖已存肝糖原。',
  'muscleGlucose.glycogenUseRateGPerMin': '由分区 core 在活动时按区域份额和强度取用，不控制聚合器的摄糖。',
  'ovaries.startCycleDay': '补初值，不重置已有的周期日。',
  'sexualResponse.arousalHalfTimeMin': '目标高于当前唤起值时使用；旧档剩余活动仍可能驱动此路径。',
  'sexualResponse.resolutionHalfTimeMin': '目标不高于当前值时使用，关闭门控后仍影响已有唤起的回落。',
  'sexualResponse.orgasmAllowedMm': '主动释放要求门控开启；该阈值也参与旧的尝试阻断标记处理。',
  'sexualResponse.orgasmForcedMm': '自动释放要求门控开启且未处于不应期。',
  'sexualResponse.orgasmDurationMin': '按已保留的释放时点判定阶段，不会因关闭门控抹去该时点。',
  'sexualResponse.femalePostOrgasmPauseMin': '有卵巢且无睾丸时的停顿分支。',
  'sexualResponse.refractoryMin': '其余清单分支的不应期基线，另有 PRL 影响。',
  'sexualResponse.afterglowHalfTimeMin': '无新释放时衰减已存余韵，关闭门控也不停止衰减。',
  'smallIntestine.carbAbsorptionInsulinGain': '兼容键，参与工程代理；取零时胰岛素项无贡献。胰腺未加载时用相对基线 1；已加载时 `insulinPmolL` 缺失、非有限数值或为负均报错，即使增益为零。',
  'smallIntestine.carbAbsorptionGradientGain': '碳水吸收的浓度梯度代理。葡萄糖隔室未加载时用模型血糖基线；已加载时 `concentrationMgDl` 缺失、非有限数值或为负均报错。',
  'uterus.orgasmContractionPeakMm': '仅性反应门控开启时参与。',
  'uterus.contractionHalfTimeMin': '仅性反应门控开启时参与。',
  'uterus.congestionHalfTimeMin': '仅性反应门控开启时参与，且仅用于回落。',
};
const fileNotes = {
  'autonomic.parameters.json': '交感/副交感另有睡眠、活动等路径；性反应相关路径受 `nsfw` 门控。',
  'glucose.parameters.json': '普通与女性的入口使用同一 core 和同一份参数；女性清单追加乳糖结算，不独立覆盖葡萄糖参数。',
  'interoception.parameters.json': '一般体感继续运行；`nsfw: false` 将性唤起和性欲读数置零，并屏蔽放松评分中的余韵输入，不清除性反应部位的存档状态。',
  'milk.parameters.json': '女性清单加载；`nsfw: false`（Gateway 缺省）关闭泌乳产出。开启后仍看泌乳状态和动作，`profile.lactating` 可为新部位播种，不重置已保存状态。',
  'menstrual-cycle.parameters.json': '慢性高 PRL 与哺乳是不同抑制输入；`nsfw: false` 关哺乳支路，不关闭普通周期或慢性高 PRL 支路。',
  'motility.parameters.json': '胃动力入口共用核心；`ghrelin.ts` 在导入核心时加载此文件，但只借用摄入解析，排空参数不直接调饥饿素。',
  'notify.parameters.json': '通知策略，不是生理阈值；普通通知、睡眠阈值和紧急路径不同，NSFW 信号另受 `nsfw` 门控。',
  'pituitary.parameters.json': '普通轴仍运行；哺乳/性反应相关的 PRL、催产素调节支路受 `nsfw` 门控。',
  'response.parameters.json': '`nsfw: false` 时 Gateway 拒绝新 `sex` / `orgasm` 动作，模块不发生主动或自动释放。下游 `body_state` 的性反应文案与内感受的相关输入也受门控；这不清除存档。`response.ts` 仍推进已有活动计时、唤起与阶段，并衰减已有余韵。参数覆盖不打开门控。',
  'reward.parameters.json': '一般奖赏仍运行，性相关信号路径受 `nsfw` 门控。',
  'uterus.parameters.json': '月经请求/痛经依赖卵巢周期输入；月经不随 `nsfw` 关闭，性反应收缩和充血路径则关闭。',
  'water.parameters.json': '普通与女性的入口使用同一 core 和同一份参数；女性清单追加月经与乳汁水出口。',
};
const examples = {
  adrenal: ['adrenal.referenceCortisolNmolL', 185],
  bladder: ['bladder.voiding.postVoidResidualMl', 20],
  blood: ['blood.referenceBloodVolumeMl', 5100],
  'blood-oxygen': ['bloodOxygen.basalMlMin', 260],
  'body-water': ['bodyFluid.referenceVolumeMl', 32000],
  brain: ['hypothalamusAdh.timeConstantMin', 12],
  calcium: ['calcium.referencePthPgMl', 32, '有有效的甲状旁腺 PTH 输入时，此示例可改变已有存档后续的钙平衡计算，不重置血钙或骨钙库。'],
  colon: ['colon.reclamationRatePerMin', 0.012],
  duodenum: ['duodenum.exposure.timeConstantMin', 12],
  epididymis: ['epididymis.recoveryMlPerMin', 0.0025],
  esophagus: ['esophagus.bolusTransitMin', 0.3],
  glucose: ['glucose.residualDisposalHalfTimeMin', 65],
  heart: ['heart.restingHeartRatePerMin', 72],
  kidney: ['kidney.urine.baselineRateMlPerMin', 1.1],
  liver: ['liver.basalOutputRateGPerMin', 0.1],
  lungs: ['lungsVentilation.restingTidalVolumeMl', 510],
  'mammary-glands': ['mammaryGlands.basalMilkRateMlPerMin', 0.55],
  ovaries: ['ovaries.cycleLengthDays', 30],
  pancreas: ['pancreasEndocrine.referenceGlucoseMgDl', 92],
  parathyroid: ['parathyroid.referenceCalciumMgDl', 9.6],
  pineal: ['pineal.melatoninBaseRelative', 1.1],
  regions: ['muscleGlucose.glycogenUseRateGPerMin', 0.6],
  'salivary-glands': ['salivaryGlands.basalRateMlPerMin', 0.6],
  'sexual-response': ['sexualResponse.arousalHalfTimeMin', 6],
  'skeletal-muscle': ['muscleGlucose.maxUptakeRateGPerMin', 0.6],
  skin: ['skin.sweat.ambientTemperatureC', 26],
  'small-intestine': ['smallIntestine.absorption.halfTimeMin', 25],
  stomach: ['stomach.emptying.halfTimeMin', 15],
  testes: ['testes.baselineRelative', 1.05],
  thyroid: ['thyroid.thyroxineHalfTimeMin', 1500],
  uterus: ['uterus.mensesDays', 5],
};

const read = (path) => readFileSync(join(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const tick = (text) => `\`${text}\``;
const link = (dir, file, label = basename(file)) => `[${tick(label)}](${relative(dir, file)})`;
const unique = (items) => [...new Set(items)];
const sourcePattern = /\.[cm]?[jt]s$/;
const sourcePaths = (text) => [...text.matchAll(/\b(?:from|import)\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1]);

function scanSource(file, parameters, ids) {
  // 只识别项目使用的静态相对 import、loadParameters(new URL(...)) 和字面量 ID，不运行仿真脚本。
  const text = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/gm, '');
  const bindings = new Map([...text.matchAll(/\bconst\s+(\w+)\s*=\s*loadParameters\(\s*new URL\(\s*['"]([^'"]+)['"]/g)]
    .map(([, name, path]) => [name, fromDir(dirname(file), path)]));
  const scaled = new Set([...text.matchAll(/\bscaleByBodyWeight\(\s*(?:requireParameter\([^)]*\)|[^,()]+),\s*['"]([^'"]+)['"]/g)]
    .map(([, id]) => id));
  const uses = new Map();
  for (const [, required, requiredId, indexed, indexedId] of text.matchAll(/\brequireParameter\(\s*(\w+)\s*,\s*['"]([^'"]+)['"]|\b(\w+)\s*\[\s*['"]([^'"]+)['"]\s*\]/g)) {
    const path = bindings.get(required ?? indexed);
    const id = requiredId ?? indexedId;
    if (!path) continue;
    if (!parameters.get(path)?.parameters.some((p) => p.id === id)) throw new Error(`${file}：${path} 未登记 ${id}`);
    uses.set(id, { id, path, file, scaled: scaled.has(id) });
  }
  for (const [, id, rest] of text.matchAll(/\bget(?:Numeric)?ParameterOverride\(\s*['"]([^'"]+)['"]\s*\)([^;]*)/g)) {
    if (!ids.has(id)) throw new Error(`${file}：未找到直接读取的覆盖 ${id} 的参数 JSON`);
    uses.set(id, { id, path: ids.get(id), file, scaled: /\bscaleByBodyWeight\(/.test(rest), external: true });
  }
  return { uses: [...uses.values()], deps: sourcePaths(text).map((p) => fromDir(dirname(file), p)).filter((p) => sourcePattern.test(p)) };
}

function inventory() {
  const files = readdirSync(join(root, 'organs'), { recursive: true, withFileTypes: true })
    .filter((file) => file.isFile())
    .map((file) => localRelative(root, join(file.parentPath, file.name)).split(sep).join('/')).sort();
  const readmes = new Map();
  const docs = (dir) => {
    if (!files.includes(`${dir}/README.md`)) throw new Error(`${dir}/README.md 缺失，请先为该部位写 README`);
    if (!readmes.has(dir)) readmes.set(dir, { entries: [], groups: new Map() });
    return readmes.get(dir);
  };
  const group = (dir, path) => {
    const { groups } = docs(dir);
    if (!groups.has(path)) groups.set(path, []);
    return groups.get(path);
  };
  const params = new Map();
  const ids = new Map();
  for (const path of files.filter((f) => f.endsWith('.parameters.json'))) {
    const data = json(path);
    params.set(path, data);
    group(dirname(path), path);
    for (const p of data.parameters) {
      if (ids.has(p.id)) throw new Error(`${path}：重复的参数 ID ${p.id}`);
      ids.set(p.id, path);
    }
  }
  const entries = new Map();
  const addEntry = (file, label) => {
    if (!files.includes(file)) throw new Error(`未找到清单入口 ${file}`);
    if (!entries.has(file)) entries.set(file, []);
    entries.get(file).push(label);
  };
  for (const path of files.filter((f) => f.startsWith('organs/presets/') && f.endsWith('/body-modules.json'))) {
    manifests.set(path, `可选清单 ${basename(dirname(path))}`);
  }
  for (const [path, label] of manifests) {
    for (const script of json(path).scripts) {
      const file = fromDir(dirname(path), script);
      if (file.startsWith('organs/')) addEntry(file, { label, path });
    }
  }
  for (const [p, label] of Object.entries(optionalEntries)) {
    const file = `organs/human-organs/${p}`;
    if (files.includes(file)) addEntry(file, { label });
  }
  const scans = new Map();
  const active = new Set();
  for (const entry of entries.keys()) {
    const dir = dirname(entry);
    docs(dir).entries.push(entry);
    const seen = new Set();
    const visit = (file) => {
      if (seen.has(file) || !files.includes(file)) return;
      seen.add(file);
      if (!scans.has(file)) scans.set(file, scanSource(file, params, ids));
      const { uses, deps } = scans.get(file);
      for (const use of uses) {
        // 跨器官只复用释放判据，不运行 response 的 heartbeat 或唤起/回落模型。
        if (basename(file) === 'response.ts' && dirname(file) !== dir
            && !/^sexualResponse\.(orgasmAllowedMm|orgasmForcedMm|refractoryMin|femalePostOrgasmPauseMin)$/.test(use.id)) continue;
        const applied = { ...use, entry };
        group(dir, use.path).push(applied);
        if (dirname(use.path) !== dir && !use.external) group(dirname(use.path), use.path).push(applied);
        if (!Object.hasOwn(reserved, use.id)) active.add(use.id);
      }
      for (const dep of deps) {
        // ghrelin 只借用摄入解析，不用胃动力参数。
        if (basename(file) !== 'ghrelin.ts' || basename(dep) !== 'motility-core.ts') visit(dep);
      }
    };
    visit(entry);
  }
  for (const path of files.filter((f) => f.endsWith('/README.md') && !readmes.has(dirname(f)))) {
    const text = read(path);
    if (!text.includes(start) && !text.includes(end)) continue;
    const visible = maskFencedCode(path, text);
    if (visible.includes(start) || visible.includes(end)) throw new Error(`${path}：已无清单入口或参数文件，请人工核对并移除旧标记块。`);
  }
  return { readmes, params, ids, active, entries };
}

function render(dir, doc, { params, entries, ids }) {
  const entryList = (paths) => unique(paths).map((file) => {
    const labels = entries.get(file).map(({ label, path }) => path ? `[${label}](${relative(dir, path)})` : label);
    return `${link(dir, file)}（${labels.join(' / ')}）`;
  }).join('；');
  const scriptList = (paths) => unique(paths).map((file) => link(dir, file)).join('、');
  const exampleGuide = `${relative(dir, 'CONTRIBUTING.md')}#个体参数覆盖示例`;
  const out = [start, `## ${sectionTitle}`, '',
    `先停止 Gateway，备份该身体实际的 \`body-state.json\`，将要改的 ID 合并到存档顶层 \`parameters\`（[稀疏覆盖示例](${exampleGuide})），随后重启。没有覆盖的键沿用参数 JSON 的基础默认（直接覆盖读取例外见下）；不要为个体修改仓库 JSON。覆盖在模块加载时生效，已有存量、周期等不会因此自动重置。`, '',
    '表中“体重缩放”指参数值是否在对应脚本按 `profile.weightKg / 75` 缩放；带参数 ID 的缩放遇到显式数值覆盖时不重复缩放。“无”不表示整个公式与体重或其他模块无关。`status` 是 JSON 的证据标签；`range` 是元数据，模块并不统一强制校验。不要把输出字段、保留键或诊断代理当成独立临床调节项。', ''];
  const example = examples[basename(dir)];
  if (example && [...doc.groups.values()].some((uses) => uses.some(({ id, external, entry }) => id === example[0] && !external && dirname(entry) === dir))) {
    out.push('示例（只合并这一小段，数值仅用于演示）：', '', '```json',
      `{ "parameters": { "${example[0]}": ${example[1]} } }`, '```', '');
    if (example[2]) out.push(example[2], '');
  }
  if (![...doc.groups.keys()].some((path) => dirname(path) === dir)) {
    out.push('此目录无独立参数 JSON。若下文列有共享 ID，只覆盖原 ID，不能给这个部位另造一套参数键。', '',
      `入口：${entryList(doc.entries)}。`, '');
  } else {
    const unconfigured = doc.entries.filter((entry) => ![...doc.groups].some(([path, uses]) => dirname(path) === dir && uses.some((u) => u.entry === entry)));
    if (unconfigured.length) out.push(`无本地参数文件的入口：${entryList(unconfigured)}；输出字段和脚本内常量不是可覆盖 ID。`, '');
  }
  const fold = doc.groups.size > 4 || [...doc.groups.keys()].reduce((n, path) => n + params.get(path).parameters.length, 0) > 30;
  for (const [path, uses] of doc.groups) {
    const local = dirname(path) === dir;
    const data = params.get(path);
    const byId = Map.groupBy(uses, (u) => u.id);
    const rows = local ? data.parameters : data.parameters.filter(({ id }) => byId.has(id));
    const groupEntries = unique(uses.map((u) => u.entry));
    const readers = unique(uses.map((u) => u.file));
    const entrySubsets = [...byId.values()].some((used) => unique(used.map((u) => u.entry)).length < groupEntries.length);
    const caption = `${basename(path)}${local ? '' : '（共享）'}`;
    if (fold) out.push('<details>', `<summary>${caption}</summary>`, '');
    else out.push(`### ${caption}`, '');
    const modules = uses.length ? `入口及清单：${entryList(groupEntries)}。读取脚本：${scriptList(readers)}。` : '正式清单和已登记可选入口没有读取这个文件。';
    out.push(`参数文件：${link(dir, path)}。${modules}`, '');
    if (fileNotes[basename(path)]) out.push(fileNotes[basename(path)], '');
    if (uses.some((u) => u.external)) out.push('直接读取覆盖的脚本不加载此参数文件；未覆盖时用其代码内的基线或缺省路径。下表基础默认仍来自原参数 JSON。', '');
    if (entrySubsets) out.push('共享脚本各入口消费的键不完全相同，以逐行标出的消费入口为准。', '');
    out.push('| 完整参数 ID | 基础默认 | 单位 | status | 体重缩放 | 使用条件或限制 |',
      '| --- | ---: | --- | --- | --- | --- |');
    for (const { id, value, unit, status } of rows) {
      const used = byId.get(id) ?? [];
      const scaling = used.some((u) => u.scaled) ? '`weightKg / 75`' : '无';
      const limits = [reserved[id] ?? (!used.length ? '只登记；无读取，不作有效覆盖。' : rowNotes[id])];
      if (used.some((u) => u.external)) limits.push('含直接覆盖读取。');
      if (value === null) limits.push('未设值，不是 0。');
      if (readers.length > 1 && used.length) limits.push(`读取：${unique(used.map((u) => u.file)).map((f) => tick(basename(f))).join('、')}。`);
      if (entrySubsets && used.length && !Object.hasOwn(reserved, id)) limits.push(`消费入口：${scriptList(used.map((u) => u.entry))}。`);
      out.push(`| ${tick(id)} | ${tick(JSON.stringify(value))} | ${tick(unit.replaceAll('|', '\\|'))} | ${tick(status)} | ${scaling} | ${limits.filter(Boolean).join('') || '—'} |`);
    }
    out.push('');
    if (fold) out.push('</details>', '');
    if (local) {
      for (const { id } of data.consumerParameters ?? []) {
        const source = ids.get(id);
        const actual = source ? `；实际默认见 ${link(dir, source)}` : '';
        out.push(`本文件额外登记的 ${tick(id)} 不在 \`parameters\` 数组内，不由本器官读取${actual}。`, '');
      }
    }
  }
  return [...out, end].join('\n');
}

function maskFencedCode(path, text) {
  let opening = '';
  const visible = text.replace(/^[^\r\n]+/gm, (line) => {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening) {
      if (match && match[1][0] === opening[0] && match[1].length >= opening.length && /^[ \t]*$/.test(match[2])) opening = '';
    } else {
      if (/^(?:[ \t]|>|(?:[-+*]|\d{1,9}[.)])[ \t])+(?:`{3,}|~{3,})/.test(line)) {
        throw new Error(`${path}：缩进或容器中的代码围栏无法安全判定目录边界；请先手工核对。`);
      }
      if (!match || (match[1][0] === '`' && match[2].includes('`'))) return line;
      opening = match[1];
    }
    return ' '.repeat(line.length);
  });
  if (opening) throw new Error(`${path}：代码围栏未闭合，无法安全同步目录；请先手工核对。`);
  return visible;
}

function replaceBlock(path, text, block) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  block = block.replaceAll('\n', newline);
  const visible = maskFencedCode(path, text);
  const first = visible.indexOf(start);
  const last = visible.indexOf(end);
  const hasMarkers = first !== -1 || last !== -1;
  if (hasMarkers && (first < 0 || last < first || visible.indexOf(start, first + start.length) !== -1 || visible.indexOf(end, last + end.length) !== -1
    || (first > 0 && text[first - 1] !== '\n') || text[last - 1] !== '\n'
    || !text.startsWith(newline, first + start.length)
    || (last + end.length < text.length && !text.startsWith(newline, last + end.length)))) {
    throw new Error(`${path}：标记块不成对、重复或不在独立行；请先手工核对。`);
  }
  const before = hasMarkers ? visible.slice(0, first) : visible;
  const after = hasMarkers ? visible.slice(last + end.length) : '';
  if (sectionHeading.test(before) || sectionHeading.test(after)) {
    throw new Error(`${path}：成对标记之外已有同名节「${sectionTitle}」。请人工核对：只为确认的旧生成块恢复标记并确保仅一份；同名手写节保留正文并改名。`);
  }
  if (hasMarkers) return text.slice(0, first) + block + text.slice(last + end.length);
  const heading = visible.search(/^## /m);
  if (heading >= 0) return text.slice(0, heading) + block + newline + newline + text.slice(heading);
  const gap = text.endsWith(newline + newline) ? '' : text.endsWith(newline) ? newline : newline + newline;
  return text + gap + block + newline;
}

function main(args) {
  const [mode = '--check'] = args;
  if (args.length > 1 || !['--check', '--write'].includes(mode)) throw new Error('用法：node tools/sync-organ-parameters.mjs [--check|--write]');
  const catalog = inventory();
  const changes = [];
  for (const [dir, doc] of [...catalog.readmes].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const path = `${dir}/README.md`;
    const original = read(path);
    const updated = replaceBlock(path, original, render(dir, doc, catalog));
    if (updated !== original) changes.push([path, updated]);
  }
  if (mode === '--check' && changes.length) {
    console.error(`参数目录需要同步（运行 node tools/sync-organ-parameters.mjs --write）：\n${changes.map(([p]) => p).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  for (const [path, updated] of changes) writeFileSync(join(root, path), updated, 'utf8');
  console.log(`${catalog.readmes.size} 份 README，${catalog.params.size} 个参数文件，${catalog.ids.size} 个唯一 ID（${catalog.active.size} 个存在消费路径，含可选和条件）；${mode === '--write' ? `更新 ${changes.length} 份` : '已同步'}。`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
