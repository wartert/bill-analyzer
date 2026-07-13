# Single HTML Offline Edition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify one shareable `钱都去哪了-离线版.html` that retains bank PDF, WeChat XLSX, and Alipay CSV analysis without network access.

**Architecture:** Keep the maintainable multi-file source unchanged, then generate the deliverable with one deterministic Node build script. The builder inlines CSS, JavaScript, payment icons, third-party notices, and a base64-encoded PDF.js Worker; `src/app.js` accepts the generated Blob Worker URL while retaining the relative Worker URL for the normal web build.

**Tech Stack:** HTML5, CSS, browser JavaScript, Node.js built-ins, Apache ECharts 6.1.0, Papa Parse 5.5.4, SheetJS CE 0.20.3, PDF.js 6.1.200, Node test runner, browser smoke testing.

**Repository note:** The project root is not a Git repository. Do not initialize one or copy private bill files into the nested hosting repository. Use test-green checkpoints instead of commits for this implementation.

---

## File map

- Create `scripts/build-offline.js`: the only component that assembles the single-file artifact.
- Modify `src/app.js`: prefer an injected offline PDF Worker Blob URL, then fall back to the normal relative Worker file.
- Modify `scripts/build-static.js`: include the PDF Worker in ordinary web deployments as well.
- Modify `tests/structure.test.js`: enforce the offline artifact, privacy allowlist, CSP, embedding, and Worker contracts.
- Modify `package.json`: expose `npm run build:offline`.
- Modify `.gitignore`: ignore only the generated root artifact.
- Modify `README.md`: document recipient opening instructions and maintainer rebuild instructions.
- Generate `钱都去哪了-离线版.html`: the single deliverable; never hand-edit it.

### Task 1: Lock the offline artifact contract with failing tests

**Files:**
- Modify: `tests/structure.test.js`
- Test: `tests/structure.test.js`

- [ ] **Step 1: Add the build and privacy contract test**

Append this test:

```js
test('offline build emits one self-contained privacy-safe HTML file', () => {
  const output = '钱都去哪了-离线版.html';
  const pkg = JSON.parse(read('package.json'));

  assert.equal(fs.existsSync('scripts/build-offline.js'), true);
  assert.match(pkg.scripts['build:offline'], /build-offline\.js/);
  childProcess.execFileSync(process.execPath, ['scripts/build-offline.js']);

  const html = read(output);
  const size = fs.statSync(output).size;
  assert.match(html, /<title>钱都去哪了 · 完整离线版<\/title>/);
  assert.match(html, /data-build="offline"/);
  assert.match(html, /完整离线版/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /worker-src blob:/);
  assert.match(html, /window\.__BILL_ANALYZER_PDF_WORKER_URL__/);
  assert.match(html, /data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(html, /<script[^>]+src=/iu);
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/iu);
  assert.doesNotMatch(html, /(?:src|href)=["'](?:assets|vendor|src)\//iu);
  assert.doesNotMatch(html, /\/Users\/apple|胡天鹏|126913/u);
  assert.ok(size > 3 * 1024 * 1024 && size < 8 * 1024 * 1024);
});
```

- [ ] **Step 2: Add the Worker preference and web bundle test**

Append this test:

```js
test('PDF worker supports both offline Blob and regular web deployment', () => {
  const app = read('src/app.js');
  const configure = app.match(/function configurePdfWorker\(\) \{([\s\S]*?)\n  \}/)[1];

  assert.ok(configure.indexOf('__BILL_ANALYZER_PDF_WORKER_URL__') < configure.indexOf("new URL('vendor/pdf.worker.min.mjs'"));

  childProcess.execFileSync(process.execPath, ['scripts/build-static.js']);
  assert.equal(fs.existsSync('dist/vendor/pdf.worker.min.mjs'), true);
});
```

- [ ] **Step 3: Run the tests and verify the expected failure**

Run:

```bash
node --test tests/structure.test.js
```

Expected: the new offline test fails because `scripts/build-offline.js` is absent, and the Worker test fails because `src/app.js` does not yet prefer the injected URL.

### Task 2: Build the deterministic single HTML artifact

**Files:**
- Create: `scripts/build-offline.js`
- Modify: `package.json`
- Modify: `.gitignore`
- Test: `tests/structure.test.js`

- [ ] **Step 1: Create the offline builder**

Create `scripts/build-offline.js` with this implementation:

```js
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '钱都去哪了-离线版.html');
const nonce = 'qian-offline-v1';

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const escapeScript = (source) => source.replace(/<\/script/giu, '<\\/script');
const escapeHtml = (source) => source
  .replace(/&/gu, '&amp;')
  .replace(/</gu, '&lt;')
  .replace(/>/gu, '&gt;');
const svgDataUri = (relativePath) => `data:image/svg+xml;base64,${Buffer.from(read(relativePath)).toString('base64')}`;

const brands = {
  'assets/brands/alipay.svg': svgDataUri('assets/brands/alipay.svg'),
  'assets/brands/wechatpay.svg': svgDataUri('assets/brands/wechatpay.svg'),
};

const replaceBrandPaths = (source) => Object.entries(brands).reduce(
  (result, [assetPath, dataUri]) => result.replaceAll(assetPath, dataUri),
  source,
);

const workerBase64 = fs.readFileSync(path.join(root, 'vendor/pdf.worker.min.mjs')).toString('base64');
const workerPrelude = `
(function configureEmbeddedPdfWorker() {
  'use strict';
  try {
    const encoded = '${workerBase64}';
    const binary = window.atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    window.__BILL_ANALYZER_PDF_WORKER_URL__ = URL.createObjectURL(
      new Blob([bytes], { type: 'text/javascript' }),
    );
  } catch (_) {
    window.__BILL_ANALYZER_PDF_WORKER_URL__ = '';
  }
}());`;

const scriptSources = [
  read('vendor/echarts.min.js'),
  read('vendor/papaparse.min.js'),
  read('vendor/xlsx.full.min.js'),
  read('vendor/pdf.bundle.min.js'),
  workerPrelude,
  read('src/core.js'),
  replaceBrandPaths(read('src/app.js')),
];

const offlineCss = `
.offline-note { margin: 0 auto; max-width: 1200px; padding: 12px 24px; color: #285548; background: #edf8f3; border: 1px solid #cce9dc; border-radius: 16px; }
.offline-note strong { margin-right: 8px; }
@media (max-width: 767px) { .offline-note { margin: 0 16px; padding: 11px 14px; font-size: 13px; } }
`;

const notices = fs.readdirSync(path.join(root, 'vendor/licenses'))
  .sort()
  .map((name) => `===== ${name} =====\n${read(path.join('vendor/licenses', name))}`)
  .join('\n\n');

let html = read('index.html');
html = html.replace(
  /<meta http-equiv="Content-Security-Policy" content="[^"]+">/u,
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`,
);
html = html.replace('<title>钱都去哪了 · 本地账单分析</title>', '<title>钱都去哪了 · 完整离线版</title>');
html = html.replace('<link rel="stylesheet" href="styles.css">', `<style nonce="${nonce}">\n${read('styles.css')}\n${offlineCss}\n</style>`);
html = html.replace(/\s*<script defer src="[^"]+"><\/script>/gu, '');
html = html.replace('<body>', '<body data-build="offline">');
html = html.replace('PERSONAL MONEY MAP · 本地优先', 'PERSONAL MONEY MAP · 完整离线版');
html = replaceBrandPaths(html);
html = html.replace(
  '<main id="main-content">',
  `<noscript><p class="offline-note">此文件需要 JavaScript。请保存后使用 Safari、Chrome 或 Edge 打开。</p></noscript>\n  <aside class="offline-note" aria-label="离线版打开提示"><strong>完整离线版</strong>若微信、QQ 或系统预览器无法运行，请先保存文件，再选择 Safari、Chrome 或 Edge 打开。</aside>\n\n  <main id="main-content">`,
);

const embeddedScripts = scriptSources
  .map((source) => `<script nonce="${nonce}">\n${escapeScript(source)}\n</script>`)
  .join('\n');
const licenseTemplate = `<template id="third-party-notices">\n<pre>${escapeHtml(notices)}</pre>\n</template>`;
html = html.replace('</body>', `${licenseTemplate}\n${embeddedScripts}\n</body>`);

fs.writeFileSync(output, html);
console.log(`Built ${path.basename(output)} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB)`);
```

- [ ] **Step 2: Expose the build command and ignore the generated artifact**

Add this package script:

```json
"build:offline": "node scripts/build-offline.js"
```

Add this exact line to `.gitignore`:

```gitignore
/钱都去哪了-离线版.html
```

- [ ] **Step 3: Run the builder contract test**

Run:

```bash
node --test tests/structure.test.js
```

Expected: the offline artifact contract passes; the Worker preference test still fails until Task 3.

### Task 3: Make PDF parsing work in both offline and web builds

**Files:**
- Modify: `src/app.js`
- Modify: `scripts/build-static.js`
- Test: `tests/structure.test.js`

- [ ] **Step 1: Prefer the injected Worker Blob URL**

Replace `configurePdfWorker()` with:

```js
function configurePdfWorker() {
  if (!window.pdfjsLib || !window.pdfjsLib.GlobalWorkerOptions) return;
  if (window.__BILL_ANALYZER_PDF_WORKER_URL__) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = window.__BILL_ANALYZER_PDF_WORKER_URL__;
    return;
  }
  try {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', window.location.href).href;
  } catch (_) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';
  }
}
```

- [ ] **Step 2: Add the Worker file to the regular static allowlist**

Add this entry immediately after `vendor/pdf.bundle.min.js` in `scripts/build-static.js`:

```js
'vendor/pdf.worker.min.mjs',
```

- [ ] **Step 3: Run structure tests**

Run:

```bash
node --test tests/structure.test.js
```

Expected: all structure tests pass, `dist/vendor/pdf.worker.min.mjs` exists, and the root offline HTML is rebuilt.

### Task 4: Document the recipient workflow

**Files:**
- Modify: `README.md`
- Test: `tests/structure.test.js`

- [ ] **Step 1: Add the offline sharing instructions**

Add this section near the top of `README.md`:

```markdown
## 最简单的分享方式：单 HTML 离线版

维护者运行 `npm run build:offline`，即可在项目根目录生成 `钱都去哪了-离线版.html`。

把这一个文件发送给好友即可。好友不需要安装程序或运行脚本：

1. 在手机或电脑上保存该 HTML 文件；
2. 使用 Safari、Chrome 或 Edge 打开；
3. 选择自己的银行卡 PDF、微信 XLSX 或支付宝 CSV 并开始分析。

部分聊天软件只预览 HTML 而不执行 JavaScript。遇到这种情况，请先保存文件，再选择“用其他应用打开”并选用浏览器。账单内容仍只在好友自己的浏览器内存中处理，不会上传。
```

- [ ] **Step 2: Add a documentation assertion**

In the existing compatibility/documentation structure test, add:

```js
assert.match(readme, /钱都去哪了-离线版\.html/);
assert.match(readme, /Safari、Chrome 或 Edge/);
```

- [ ] **Step 3: Run the complete Node suite**

Run:

```bash
npm test
```

Expected: all tests pass with no skipped or failed tests.

### Task 5: Browser, privacy, and real-data verification

**Files:**
- Verify: `钱都去哪了-离线版.html`
- Verify: existing private Alipay CSV in the project workspace without copying it
- Verify: a sanitized PDF fixture or the PDF.js Worker load path

- [ ] **Step 1: Verify the artifact contains no external resource attributes**

Run:

```bash
rg -n '<script[^>]+src=|<link[^>]+rel="stylesheet"|(?:src|href)=["'"'](?:assets|vendor|src)/' 钱都去哪了-离线版.html
```

Expected: no matches.

- [ ] **Step 2: Open the exact artifact with a real browser**

Open the root HTML through a `file://` URL. Record all browser requests from initial load through sample analysis.

Expected: the page title is `钱都去哪了 · 完整离线版`; the only navigation is the local HTML; no HTTP or HTTPS request is made; clicking `查看脱敏示例` reveals the report.

- [ ] **Step 3: Verify responsive layout at 375 × 812 and desktop width**

At each viewport, click `查看脱敏示例` and measure:

```js
({
  viewport: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
  categoryWidth: document.getElementById('category-chart').getBoundingClientRect().width,
  trendWidth: document.getElementById('trend-chart').getBoundingClientRect().width,
})
```

Expected: `scrollWidth <= viewport`; both chart widths are greater than 250px at 375px viewport; no cards, filters, or chart labels overlap in screenshots.

- [ ] **Step 4: Re-run parser and real Alipay regressions**

Run:

```bash
npm test
```

Then import the existing private Alipay CSV and WeChat XLSX into the offline page without copying either file into the output.

Expected: 675 valid Alipay records are extracted and the WeChat workbook produces valid records; no private merchant, account, name, or transaction text appears inside `钱都去哪了-离线版.html` before or after the test.

- [ ] **Step 5: Verify PDF Worker startup**

Import a sanitized text PDF from the browser test fixture. If the fixture has no recognized transaction row, the accepted result is the normal “没有识别到交易行” message; Worker/CORS/module errors are not accepted.

Expected: PDF.js opens the document through the Blob Worker and returns parsed page text or the normal row-recognition message, never a missing Worker or CORS error.

- [ ] **Step 6: Final privacy scan and checksum**

Run:

```bash
rg -n '/Users/|胡天鹏|126913|申请单号|20260101-20260710' 钱都去哪了-离线版.html
shasum -a 256 钱都去哪了-离线版.html
```

Expected: the privacy scan has no matches; the checksum command prints one SHA-256 line for the final deliverable.
