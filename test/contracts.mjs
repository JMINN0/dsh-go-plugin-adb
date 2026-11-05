/**
 * contracts.mjs — 工具定义校验。
 * 跑法：node test/contracts.mjs
 *
 * 为什么需要：工具定义写错（比如 description 写成数组）不会让插件加载失败，
 * 但会让**所有对话一发送就报错**，用户被迫进安全模式——这个坑真踩过。
 * 所以发布前必须用宿主自己的 defineTool 编译一遍，光"能 import"不算数。
 */
import { existsSync } from 'node:fs';

const SPEC_FILES = ['devicesSpec', 'reconnectSpec', 'shellSpec', 'installSpec', 'logcatSpec', 'screencapSpec'];
let bad = 0;
const fail = (msg) => { console.log(`FAIL  ${msg}`); bad += 1; };

const spec = await import('../src/tool-spec.js');

// ① 基本字段校验（不依赖宿主也能跑）
for (const name of SPEC_FILES) {
  const fn = spec[name];
  if (typeof fn !== 'function') { fail(`${name} 不存在`); continue; }
  const s = fn();
  if (typeof s.name !== 'string' || !s.name) fail(`${name}.name 必须是字符串`);
  if (typeof s.description !== 'string') fail(`${name}.description 必须是字符串（数组会让对话发送报错）`);
  if (!s.parameters || typeof s.parameters !== 'object') fail(`${name}.parameters 必须是对象`);
  for (const [k, v] of Object.entries(s.parameters || {})) {
    if (!v || typeof v !== 'object') fail(`${name}.parameters.${k} 必须是对象`);
    if (v.type && !['string', 'number', 'integer', 'boolean', 'null', 'array', 'object', 'json', 'oneOf'].includes(v.type)) {
      fail(`${name}.parameters.${k}.type 不支持：${v.type}`);
    }
  }
  if (!s.output?.schema || typeof s.output.schema !== 'object') fail(`${name}.output.schema 必须是对象`);
  if (typeof s.output?.render !== 'function') fail(`${name}.output.render 必须是函数`);
}

// ② 用宿主真实 defineTool 编译（有的话）；没有就跳过并说明
const CANDIDATES = [
  process.env.DSH_TOOLS_PATH,
  '/opt/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
];
let compiled = 0;
for (const c of CANDIDATES.filter(Boolean)) {
  if (!existsSync(c)) continue;
  try {
    const mod = await import(c);
    const defineTool = mod.defineTool;
    if (typeof defineTool !== 'function') continue;
    for (const name of SPEC_FILES) {
      const s = spec[name]();
      defineTool({ ...s, execute: async () => ({ text: 'x' }) });
      compiled += 1;
    }
    break;
  } catch (e) {
    fail(`宿主 defineTool 编译失败：${e.message}`);
  }
}

console.log(`\n工具定义 ${SPEC_FILES.length} 个，宿主编译 ${compiled} 个，异常 ${bad} 条`);
if (compiled === 0) {
  console.log('⚠ 未找到宿主 defineTool：只做了基础字段校验，没有真正编译。');
  console.log('  生产环境应该能找到 /opt/dsh/node_modules/@deepseek-ai/dsh-tools；');
  console.log('  找不到时说明这份判定不完整，别当成"已通过"发布。');
}
process.exit(bad ? 1 : 0);
