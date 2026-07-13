# 「钱都去哪了」专业化重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有单文件个人账单工具重构为可离线运行、分析口径可信、视觉专业且有自动化测试的「钱都去哪了」。

**Architecture:** 保留静态网页和本地浏览器解析体验，将业务规则抽到可同时供浏览器和 Node 测试使用的 UMD 核心模块；应用层只处理文件读取、DOM 和图表。所有第三方库与品牌图标本地化，Python 旧入口仅做兼容与隐私去硬编码。

**Tech Stack:** HTML5、CSS3、原生 JavaScript、Node.js 内置 `node:test`、ECharts、Papa Parse、SheetJS、PDF.js、Python 3。

---

项目当前不是 Git 仓库，因此不初始化仓库、不提交，也不执行会影响用户外部历史的版本控制操作；每个任务以测试和文件快照验证替代提交点。

## 文件结构

```text
index.html                         主入口与语义结构
styles.css                        品牌视觉、布局、响应式、打印和无障碍
src/core.js                       分类、资金流、去重、统计、建议、安全工具
src/app.js                        文件解析、界面状态、图表和明细渲染
assets/brands/alipay.svg          支付宝品牌图标
assets/brands/wechatpay.svg       微信支付品牌图标
assets/icons/sprite.svg           统一线性功能图标
vendor/                           固定版本第三方浏览器构建与许可证说明
tests/core.test.js                核心财务口径与去重测试
tests/parsers.test.js             三平台标准行归一化测试
tests/structure.test.js           品牌、离线依赖、语义与安全结构测试
README.md                         使用、隐私、数据口径和验证说明
.gitignore                        真实账单、报告和临时文件保护
share_bill_analyzer.html          兼容跳转入口
analyze_all.py                    去除真实身份/密码/路径硬编码
parse_zhongyuan.py                去除默认密码和固定临时文件名
```

### Task 1: 建立测试入口与结构红灯

**Files:**
- Create: `package.json`
- Create: `tests/structure.test.js`
- Test: `tests/structure.test.js`

- [ ] **Step 1: 写品牌、离线和语义结构的失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('main page uses the new brand and local runtime assets', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /钱都去哪了/);
  assert.match(html, /name="author" content="tphu"/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /<main[^>]+id="main-content"/);
  assert.match(html, /aria-live="polite"/);
});

test('legacy author name is absent from product sources', () => {
  const files = ['index.html', 'styles.css', 'src/app.js', 'src/core.js'];
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /LEGACY_AUTHOR/);
});
```

- [ ] **Step 2: 创建测试脚本并确认测试因缺少新入口而失败**

```json
{
  "name": "money-where",
  "private": true,
  "scripts": {
    "test": "node --test tests/*.test.js",
    "test:core": "node --test tests/core.test.js tests/parsers.test.js",
    "test:structure": "node --test tests/structure.test.js"
  }
}
```

Run: `npm test`  
Expected: FAIL，原因是 `index.html` 或新模块尚不存在。

### Task 2: 资金流分类核心

**Files:**
- Create: `tests/core.test.js`
- Create: `src/core.js`
- Test: `tests/core.test.js`

- [ ] **Step 1: 写六类资金流和必要/可选消费测试**

```js
const { classifyTransaction } = require('../src/core.js');

test('investment purchase is an asset flow rather than consumption', () => {
  const tx = classifyTransaction({ direction: 'expense', searchText: '基金申购 肯特瑞' });
  assert.equal(tx.flowType, 'asset');
});

test('credit repayment is debt flow and refund offsets consumption', () => {
  assert.equal(classifyTransaction({ direction: 'neutral', searchText: '花呗还款' }).flowType, 'debt');
  assert.equal(classifyTransaction({ direction: 'income', searchText: '商品退款' }).flowType, 'refund');
});

test('food is essential consumption with traceable rule metadata', () => {
  const tx = classifyTransaction({ direction: 'expense', searchText: '美团外卖 午餐' });
  assert.equal(tx.flowType, 'expense');
  assert.equal(tx.needType, 'essential');
  assert.equal(tx.categoryId, 'food');
  assert.ok(tx.ruleId);
  assert.ok(tx.confidence >= 0.8);
});
```

- [ ] **Step 2: 运行单测确认缺少实现而失败**

Run: `node --test tests/core.test.js`  
Expected: FAIL with module/function missing.

- [ ] **Step 3: 实现稳定分类 ID、展示名、优先级和置信度**

核心 API：

```js
function classifyTransaction(input) {
  const tx = normalizeTransaction(input);
  const text = tx.searchText.toLowerCase();
  const matched = FLOW_RULES.find((rule) => rule.pattern.test(text) && rule.when(tx));
  return matched ? applyRule(tx, matched) : applyFallback(tx);
}
```

规则优先级固定为：退款 → 内部流转 → 债务偿还 → 资产变动 → 真实收入 → 消费分类 → 待确认，避免“还款”“基金”被普通关键词抢先命中。

- [ ] **Step 4: 运行核心测试确认通过**

Run: `node --test tests/core.test.js`  
Expected: PASS，所有分类行为为绿色。

### Task 3: 跨来源匹配与安全去重

**Files:**
- Modify: `tests/core.test.js`
- Modify: `src/core.js`

- [ ] **Step 1: 写真实重复保留、唯一跨源合并、歧义保留测试**

```js
test('same-source repeated purchases are preserved', () => {
  const rows = [fixture({ id: 'w1' }), fixture({ id: 'w2' })];
  const result = reconcileTransactions(rows);
  assert.equal(result.transactions.length, 2);
});

test('unique bank and payment-app views are linked once', () => {
  const result = reconcileTransactions([
    fixture({ id: 'b1', source: 'bank', channel: '财付通', time: '10:00:01' }),
    fixture({ id: 'w1', source: 'wechat', time: '10:00:03' })
  ]);
  assert.equal(result.transactions.length, 1);
  assert.equal(result.quality.matchedPairs, 1);
});

test('ambiguous candidates remain and emit a warning', () => {
  const result = reconcileTransactions([bankFixture(), wechatFixture('w1'), wechatFixture('w2')]);
  assert.equal(result.transactions.length, 3);
  assert.equal(result.quality.ambiguousMatches, 1);
});
```

- [ ] **Step 2: 运行测试确认现有实现尚不能满足规则**

Run: `node --test tests/core.test.js`  
Expected: FAIL on reconciliation assertions.

- [ ] **Step 3: 实现只跨来源、渠道兼容、时间可解释的匹配**

```js
function reconcileTransactions(records) {
  const bank = records.filter((item) => item.source === 'bank' && isPaymentRail(item));
  const detail = records.filter((item) => item.source === 'wechat' || item.source === 'alipay');
  return linkUniqueCandidates(records, bank, indexByDateAmount(detail));
}
```

同源记录只按平台交易单号的精确重复去重；没有交易单号则全部保留。缺失时间时只有一个渠道相符候选才允许关联。

- [ ] **Step 4: 运行测试确认全部通过**

Run: `node --test tests/core.test.js`  
Expected: PASS.

### Task 4: 平台行归一化与状态过滤

**Files:**
- Create: `tests/parsers.test.js`
- Modify: `src/core.js`

- [ ] **Step 1: 写支付宝引号逗号、微信状态和银行方向测试**

```js
test('closed or failed rows are ignored with a quality reason', () => {
  const result = normalizeWechatRow({ '交易状态': '支付失败', '金额(元)': '¥20.00' });
  assert.equal(result.ignoredReason, 'invalid-status');
});

test('refunded platform rows become refund flows', () => {
  const result = classifyTransaction(normalizeAlipayRow({
    '收/支': '收入', '金额': '88.00', '商品说明': '订单退款', '交易状态': '交易成功'
  }).transaction);
  assert.equal(result.flowType, 'refund');
});
```

- [ ] **Step 2: 运行测试确认归一化 API 缺失**

Run: `node --test tests/parsers.test.js`  
Expected: FAIL with missing exports.

- [ ] **Step 3: 实现别名表、状态策略、日期金额标准化和警告**

```js
function normalizePlatformRow(source, row) {
  const schema = PLATFORM_SCHEMAS[source];
  const status = pick(row, schema.status);
  if (schema.invalidStatus.test(status)) return { ignoredReason: 'invalid-status' };
  return { transaction: normalizeTransaction(mapFields(row, schema)) };
}
```

- [ ] **Step 4: 运行解析与核心测试**

Run: `npm run test:core`  
Expected: PASS.

### Task 5: 专业统计与建议引擎

**Files:**
- Modify: `tests/core.test.js`
- Modify: `src/core.js`

- [ ] **Step 1: 写净消费、退款、资产/债务排除、首尾日和建议边界测试**

```js
test('net spending excludes transfers, assets and debt and subtracts refunds', () => {
  const result = analyzeTransactions(financeFixture());
  assert.equal(result.summary.totalIncome, 10000);
  assert.equal(result.summary.grossExpense, 3000);
  assert.equal(result.summary.refunds, 500);
  assert.equal(result.summary.netExpense, 2500);
  assert.equal(result.summary.cashBalance, 7500);
});

test('recommendations cite evidence and contain no product pitch', () => {
  const recommendations = buildRecommendations(analyzeTransactions(financeFixture()));
  const text = JSON.stringify(recommendations);
  assert.doesNotMatch(text, /指数基金|余额宝|花呗额度|年化收益|50%稳健/);
  assert.ok(recommendations.every((item) => item.evidence && item.action));
});
```

- [ ] **Step 2: 运行测试确认新指标尚未实现**

Run: `node --test tests/core.test.js`  
Expected: FAIL on summary and recommendation assertions.

- [ ] **Step 3: 实现质量、概览、分类、月度、变化、商户、周期性和异常统计**

核心返回结构：

```js
return {
  quality,
  summary,
  categories,
  needStructure,
  monthly,
  changeDrivers,
  merchants,
  recurringCandidates,
  anomalies,
  recommendations,
  transactions
};
```

- [ ] **Step 4: 运行所有核心测试**

Run: `npm run test:core`  
Expected: PASS with no warnings.

### Task 6: 本地依赖与品牌资产

**Files:**
- Create: `vendor/README.md`
- Create: `vendor/echarts.min.js`
- Create: `vendor/papaparse.min.js`
- Create: `vendor/xlsx.full.min.js`
- Create: `vendor/pdf.min.js`
- Create: `vendor/pdf.worker.min.js`
- Create: `assets/brands/alipay.svg`
- Create: `assets/brands/wechatpay.svg`
- Create: `assets/icons/sprite.svg`

- [ ] **Step 1: 从官方包下载固定版本浏览器构建并记录许可证**

使用依赖研究确认的官方版本与包内路径。下载后执行：

Run: `shasum -a 256 vendor/*.js assets/brands/*.svg`  
Expected: 每个文件均生成非空 SHA-256。

- [ ] **Step 2: 校验页面资源中不存在远程 URL**

Run: `rg -n 'https?://' index.html src styles.css`  
Expected: no matches.

### Task 7: 语义化首页与现代账本视觉

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Modify: `tests/structure.test.js`

- [ ] **Step 1: 扩展结构测试覆盖原生上传、标签、品牌图标和无障碍**

```js
test('upload flow is semantic and exposes brand icons with names', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /<input[^>]+id="wechat-file"/);
  assert.match(html, /<label[^>]+for="wechat-file"/);
  assert.match(html, /assets\/brands\/wechatpay\.svg/);
  assert.match(html, /assets\/brands\/alipay\.svg/);
  assert.match(html, /<button[^>]+id="analyze-button"/);
});
```

- [ ] **Step 2: 运行结构测试确认页面结构尚未满足**

Run: `npm run test:structure`  
Expected: FAIL on semantic assertions.

- [ ] **Step 3: 实现首页和报告语义骨架**

页面必须包含 `skip-link`、`header`、`main`、带可见标签的上传区、`aria-live` 进度、报告区、图表文字替代、重新分析按钮和参考免责声明。

- [ ] **Step 4: 实现设计令牌和四档响应式布局**

```css
:root {
  --paper: #f3f0e8;
  --surface: #fffdf8;
  --ink: #17211c;
  --muted: #59645e;
  --forest: #0f6b4f;
  --amber: #b86b24;
  --line: #d8d4c8;
}
```

实现 375、768、1024、1440 宽度布局、44 像素触控目标、`focus-visible`、打印样式和 `prefers-reduced-motion`。

- [ ] **Step 5: 运行结构测试确认通过**

Run: `npm run test:structure`  
Expected: PASS.

### Task 8: 文件解析、报告渲染与 HTML 安全

**Files:**
- Create: `src/app.js`
- Modify: `src/core.js`
- Modify: `tests/core.test.js`

- [ ] **Step 1: 写安全转义和恶意账单文本测试**

```js
test('escapeHtml neutralizes markup from imported statements', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('</script>'), '&lt;/script&gt;');
});
```

- [ ] **Step 2: 运行测试确认安全工具缺失或行为不完整**

Run: `node --test tests/core.test.js`  
Expected: FAIL on `escapeHtml`.

- [ ] **Step 3: 实现平台解析协调与界面状态机**

`src/app.js` 负责：文件扩展名/大小校验、PDF 密码错误、Papa Parse CSV、SheetJS XLSX、PDF.js PDF、解析质量汇总、开始/失败/完成状态和重新分析。

- [ ] **Step 4: 使用安全 DOM 构建报告**

所有账单字段通过 `textContent` 写入；固定模板允许静态 `innerHTML`，但不得把导入字段拼入其中。ECharts 数据使用字符串值，不启用 HTML tooltip formatter。

- [ ] **Step 5: 渲染分类横条、月度趋势、必要/可选结构和证据型建议**

图表旁同步提供金额/占比列表，来源卡使用本地支付宝、微信支付图标，移动端交易列表保留日期、商户、金额和分类四个核心字段。

- [ ] **Step 6: 运行完整单测**

Run: `npm test`  
Expected: PASS.

### Task 9: 兼容入口、Python 隐私硬化与文档

**Files:**
- Modify: `share_bill_analyzer.html`
- Modify: `analyze_all.py`
- Modify: `parse_zhongyuan.py`
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: 将旧分享页改为无数据的兼容跳转**

`share_bill_analyzer.html` 只保留新品牌、`index.html` 链接和自动跳转，不嵌入交易或旧逻辑。

- [ ] **Step 2: 用 argparse 替代固定账单路径、姓名和密码**

```python
parser.add_argument('--bank', type=Path)
parser.add_argument('--wechat', type=Path)
parser.add_argument('--alipay', type=Path)
parser.add_argument('--pdf-password')
parser.add_argument('--self-name', action='append', default=[])
parser.add_argument('--output', type=Path, default=Path('report_complete.html'))
```

没有密码时不尝试任何默认值；本人姓名只来自重复 `--self-name` 参数。

- [ ] **Step 3: 添加隐私忽略规则与使用说明**

`.gitignore` 屏蔽 PDF/XLS/XLSX、原始账单 CSV、分析 JSON、生成报告和临时解密文件，但保留 `sample_data.csv` 与 `tests/fixtures/`。README 解释入口、格式、口径、隐私边界、测试命令和分享注意事项。

- [ ] **Step 4: 运行敏感硬编码扫描和 Python 语法检查**

Run: `rg -n 'LEGACY_PASSWORD|LEGACY_IDENTITY|LEGACY_AUTHOR' --glob '!*.csv' --glob '!*.json' --glob '!report*.html' --glob '!docs/**' .`  
Expected: no matches in active source.

Run: `python3 -m py_compile analyze_all.py parse_zhongyuan.py analyze.py`  
Expected: exit 0.

### Task 10: 浏览器验收与最终回归

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: 启动本地静态服务器**

Run: `python3 -m http.server 8765`  
Expected: server listens on `http://127.0.0.1:8765/`.

- [ ] **Step 2: 在 1440、1024、768、375 宽度检查首页与示例分析**

检查：无横向溢出、上传可键盘使用、品牌图标清晰、金额排版稳定、图表和文字替代一致、重新分析可用、控制台无错误。

- [ ] **Step 3: 运行最终验证**

Run: `npm test`  
Expected: all tests PASS.

Run: `python3 -m py_compile analyze_all.py parse_zhongyuan.py analyze.py`  
Expected: exit 0.

Run: `rg -n 'https?://' index.html src styles.css`  
Expected: no matches.

Run: `rg -n 'LEGACY_AUTHOR|LEGACY_PASSWORD|LEGACY_IDENTITY' index.html styles.css src README.md analyze_all.py parse_zhongyuan.py`  
Expected: no matches.

- [ ] **Step 4: 对照设计验收清单逐项核对**

必须确认：品牌、图标、六类资金流、净消费口径、去重歧义、证据型建议、隐私说明、桌面/手机响应式和兼容入口均已实现。
