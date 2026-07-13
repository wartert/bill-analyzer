const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assertDesktopFirstOfflineGuidance(copy) {
  assert.match(copy, /电脑[^。]*(?:推荐|可靠)/u);
  assert.match(copy, /Safari[^。]*Chrome[^。]*Edge/u);
  assert.match(copy, /移动端[^。]*本地 HTML[^。]*取决于[^。]*(?:操作系统|系统)[^。]*(?:接收应用|应用)/u);
  assert.match(copy, /(?:只能预览|控件[^。]*(?:无法使用|不能使用|不工作))/u);
  assert.match(copy, /支持本地 HTML[^。]*(?:浏览器|HTML 查看器)/u);
  assert.match(copy, /(?:没有兼容应用|否则)[^。]*电脑/u);
}

test('main page uses the new brand and local runtime assets', () => {
  const html = read('index.html');

  assert.match(html, /<title>钱都去哪了/);
  assert.match(html, /name="author" content="tphu"/);
  assert.match(html, /<main[^>]+id="main-content"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//);
  assert.doesNotMatch(html, /<link[^>]+href="https?:\/\//);
});

test('upload flow is semantic and exposes payment brand icons with names', () => {
  const html = read('index.html');

  assert.match(html, /<input[^>]+id="bank-file"/);
  assert.match(html, /<label[^>]+for="bank-file"/);
  assert.match(html, /<input[^>]+id="wechat-file"/);
  assert.match(html, /<label[^>]+for="wechat-file"/);
  assert.match(html, /<input[^>]+id="alipay-file"/);
  assert.match(html, /<label[^>]+for="alipay-file"/);
  assert.match(html, /assets\/brands\/wechatpay\.svg/);
  assert.match(html, /assets\/brands\/alipay\.svg/);
  assert.match(html, /<button[^>]+id="analyze-button"/);
});

test('main page includes accessibility and privacy essentials', () => {
  const html = read('index.html');
  const css = read('styles.css');

  assert.match(html, /class="skip-link"/);
  assert.match(html, /id="chart-summary"/);
  assert.match(html, /仅用于个人记账参考/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media \(max-width: 767px\)/);
});

test('V3 page exposes fresh report navigation and product actions', () => {
  const html = read('index.html');

  assert.match(html, /id="theme-button"/);
  assert.match(html, /id="export-button"/);
  assert.match(html, /id="report-tabs"/);
  assert.match(html, /data-report-tab="overview"/);
  assert.match(html, /data-report-tab="portrait"/);
  assert.match(html, /data-report-tab="details"/);
  assert.match(html, /id="budget-form"/);
  assert.match(html, /id="budget-categories"/);
  assert.match(html, /id="time-heatmap"/);
  assert.match(html, /id="merchant-ranking"/);
  assert.match(html, /id="profile-advice"/);
  assert.match(html, /<input[^>]+type="file"[^>]+multiple/u);
});

test('V3 runtime modules load before the application in every build', () => {
  const html = read('index.html');
  const expected = ['src/core.js', 'src/insights.js', 'src/budget.js', 'src/exporter.js', 'src/app.js'];
  const positions = expected.map((file) => html.indexOf(file));

  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, positions.slice().sort((left, right) => left - right));

  const staticBuilder = read('scripts/build-static.js');
  const offlineBuilder = read('scripts/build-offline.js');
  expected.forEach((file) => {
    assert.match(staticBuilder, new RegExp(file.replace('.', '\\.')));
    assert.match(offlineBuilder, new RegExp(file.replace('.', '\\.')));
  });
});

test('V3 styles provide fresh light and dark responsive hooks', () => {
  const css = read('styles.css');

  assert.match(css, /color-scheme:\s*light/);
  assert.match(css, /\[data-theme="dark"\]/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.mobile-transactions/);
});

test('legacy author name is absent from active product sources', () => {
  const files = ['index.html', 'styles.css', 'src/app.js', 'src/core.js'];

  for (const file of files) {
    assert.doesNotMatch(read(file), /带她去看海/);
  }
});

test('compatibility entry, launcher and privacy documentation are present', () => {
  const compatibility = read('share_bill_analyzer.html');
  const readme = read('README.md');
  const launcher = read('tools/start.py');
  const ignores = read('.gitignore');

  assert.match(compatibility, /钱都去哪了/);
  assert.match(compatibility, /url=index\.html/);
  assert.doesNotMatch(compatibility, /带她去看海/);
  assert.match(readme, /所有账单内容只在浏览器内存中处理/);
  assert.match(readme, /钱都去哪了-离线版\.html/);
  assertDesktopFirstOfflineGuidance(readme);
  assert.match(readme, /iPhone\/iPad[^。]*(?:文件|聊天)[^。]*(?:不一定|无法可靠|不能可靠)/u);
  assert.match(launcher, /127\.0\.0\.1/);
  assert.doesNotMatch(launcher, /https?:\/\/(?!127\.0\.0\.1)/);
  assert.match(ignores, /\*\.pdf/);
  assert.match(ignores, /\*\.xlsx/);
  assert.match(ignores, /output\/analysis_data\.json/);
});

test('active Python tools contain no identity, password or private file defaults', () => {
  const source = ['tools/analyze_all.py', 'tools/parse_zhongyuan.py'].map(read).join('\n');

  assert.doesNotMatch(source, /126913/);
  assert.doesNotMatch(source, /胡天鹏/);
  assert.doesNotMatch(source, /申请单号/);
  assert.doesNotMatch(source, /20260101-20260710/);
  assert.match(source, /--pdf-password/);
});

test('report is visible before charts are initialized', () => {
  const app = read('src/app.js');
  const showReport = app.match(/function showReport\(analysis, options = \{\}\) \{([\s\S]*?)\n  \}/)[1];

  assert.ok(showReport.indexOf('elements.report.hidden = false') < showReport.indexOf('renderCategoryChart(analysis)'));
});

test('public deployment bundle is allowlisted and excludes financial files', () => {
  assert.equal(fs.existsSync('scripts/build-static.js'), true);
  childProcess.execFileSync(process.execPath, ['scripts/build-static.js']);

  const files = [];
  const visit = (directory) => fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else files.push(path.relative('dist', target));
  });
  visit('dist');

  assert.ok(files.includes('index.html'));
  assert.ok(files.includes('_headers'));
  assert.ok(files.includes('src/app.js'));
  assert.ok(files.includes('assets/brands/alipay.svg'));
  assert.ok(files.includes('assets/brands/wechatpay.svg'));
  assert.equal(files.some((file) => /\.(?:csv|xlsx?|pdf|py|json)$/iu.test(file)), false);
  assert.match(read('dist/_headers'), /Content-Security-Policy:/);
  assert.match(read('dist/_headers'), /connect-src 'none'/);
});

test('Cloudflare deployment serves only the generated static bundle', () => {
  const config = JSON.parse(read('wrangler.jsonc'));
  const pkg = JSON.parse(read('package.json'));

  assert.equal(config.name, 'qian-dou-qu-na-le');
  assert.equal(config.assets.directory, './dist');
  assert.equal(Object.hasOwn(config, 'main'), false);
  assert.match(pkg.scripts['deploy:cloudflare'], /wrangler deploy/);
  assert.match(pkg.scripts['deploy:temporary'], /--temporary/);
});

test('GitHub Pages package is reproducible and contains only public site files', () => {
  assert.equal(fs.existsSync('scripts/build-github-pages.js'), true);
  assert.equal(fs.existsSync('deployment/github-pages.yml'), true);
  childProcess.execFileSync(process.execPath, ['scripts/build-github-pages.js']);

  const output = path.join('publish', 'github-pages');
  const files = [];
  const visit = (directory) => fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else files.push(path.relative(output, target));
  });
  visit(output);

  assert.ok(files.includes('index.html'));
  assert.ok(files.includes('.nojekyll'));
  assert.ok(files.includes('.github/workflows/pages.yml'));
  assert.equal(files.some((file) => /\.(?:csv|xlsx?|pdf|py|json)$/iu.test(file)), false);

  const workflow = read(path.join(output, '.github/workflows/pages.yml'));
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /actions\/configure-pages@v5/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.doesNotMatch(workflow, /enablement:\s*true/);
  assert.doesNotMatch(workflow, /^\s*(?:token|secret|password):/imu);
});

test('upload budgets protect mobile memory and parse selected files sequentially', () => {
  const app = read('src/app.js');
  const validate = app.match(/function validateFile\(source, file\) \{([\s\S]*?)\n  \}/)[1];
  const runUploadedAnalysis = app.match(/async function runUploadedAnalysis\(\) \{([\s\S]*?)\n  \}\n\n  function runSampleAnalysis/)[1];

  assert.match(app, /const FILE_SIZE_LIMIT_MIB = \{[\s\S]*csv:\s*15[\s\S]*xls:\s*20[\s\S]*xlsx:\s*20[\s\S]*pdf:\s*30[\s\S]*\};/u);
  assert.match(app, /const TOTAL_SELECTED_FILE_LIMIT_MIB = 40;/u);
  assert.match(validate, /FILE_SIZE_LIMIT_MIB\[extension\]/u);
  assert.match(validate, /\$\{limitMiB\} MiB/u);
  assert.match(validate, /更短[^。]*日期范围/u);
  assert.match(runUploadedAnalysis, /TOTAL_SELECTED_FILE_LIMIT_MIB/u);
  assert.match(runUploadedAnalysis, /更短[^。]*日期范围/u);
  assert.ok(runUploadedAnalysis.indexOf('TOTAL_SELECTED_FILE_LIMIT_MIB') < runUploadedAnalysis.indexOf('parseSourceFile'));
  assert.match(app, /function selectedEntries\(\)/u);
  assert.match(runUploadedAnalysis, /for \(const entry of selected\)/u);
  assert.match(runUploadedAnalysis, /updateFileProgress\(entry/u);
  assert.doesNotMatch(runUploadedAnalysis, /Promise\.all/u);
});

test('offline build emits one self-contained privacy-safe HTML file', () => {
  const output = 'output/钱都去哪了-离线版.html';
  const pkg = JSON.parse(read('package.json'));
  const builder = read('scripts/build-offline.js');

  assert.equal(fs.existsSync('scripts/build-offline.js'), true);
  assert.match(pkg.scripts['build:offline'], /build-offline\.js/);
  childProcess.execFileSync(process.execPath, ['scripts/build-offline.js']);

  const html = read(output);
  const size = fs.statSync(output).size;
  const inlineScripts = [...html.matchAll(/<script nonce="[^"]+">\n([\s\S]*?)\n<\/script>/gu)]
    .map((match) => match[1]);
  const noscriptGuidance = html.match(/<noscript><p class="offline-note">([\s\S]*?)<\/p><\/noscript>/u)?.[1];
  const visibleGuidance = html.match(/<aside class="offline-note"[^>]*><strong>完整离线版<\/strong>([\s\S]*?)<\/aside>/u)?.[1];

  assert.equal((html.match(/<!doctype html>/giu) || []).length, 1);
  assert.equal((html.match(/^<html lang="zh-CN">$/gmu) || []).length, 1);
  assert.equal((html.match(/^<\/html>$/gmu) || []).length, 1);
  assert.equal(inlineScripts.length, 10);
  inlineScripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `offline-inline-${index}.js` }));
  });
  assert.match(html, /<title>钱都去哪了 · 完整离线版<\/title>/);
  assert.match(html, /data-build="offline"/);
  assert.match(html, /完整离线版/);
  assert.ok(noscriptGuidance);
  assert.equal(visibleGuidance, noscriptGuidance);
  assertDesktopFirstOfflineGuidance(noscriptGuidance);
  assertDesktopFirstOfflineGuidance(visibleGuidance);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /worker-src blob:/);
  assert.match(html, /script-src 'nonce-qian-offline-v1';/);
  assert.doesNotMatch(html, /script-src[^;]*(?:'unsafe-inline'|blob:)/u);
  assert.match(html, /window\.__BILL_ANALYZER_PDF_WORKER_URL__/);
  assert.match(html, /window\.__BILL_ANALYZER_PDF_WORKER_PORT__/);
  assert.match(html, /new Worker\(workerUrl, \{ type: 'module' \}\)/u);
  assert.match(builder, /window\.__BILL_ANALYZER_PDF_WORKER_PORT__/u);
  assert.match(builder, /new Worker\(workerUrl, \{ type: 'module' \}\)/u);
  assert.match(html, /data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(html, /<script[^>]+src=/iu);
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/iu);
  assert.doesNotMatch(html, /(?:src|href)=["'](?:assets|vendor|src)\//iu);
  assert.doesNotMatch(html, /\/Users\/apple|胡天鹏|126913/u);
  assert.ok(size > 3 * 1024 * 1024 && size < 8 * 1024 * 1024);
});

test('PDF worker supports both offline Blob and regular web deployment', () => {
  const app = read('src/app.js');
  const configure = app.match(/function configurePdfWorker\(\) \{([\s\S]*?)\n  \}/)[1];
  const offlineWorkerPortIndex = configure.indexOf('__BILL_ANALYZER_PDF_WORKER_PORT__');
  const offlineWorkerIndex = configure.indexOf('__BILL_ANALYZER_PDF_WORKER_URL__');
  const fallbackWorkerIndex = configure.indexOf("new URL('vendor/pdf.worker.min.mjs'");

  assert.ok(offlineWorkerPortIndex >= 0);
  assert.ok(offlineWorkerIndex >= 0);
  assert.ok(fallbackWorkerIndex >= 0);
  assert.ok(offlineWorkerPortIndex < offlineWorkerIndex);
  assert.ok(offlineWorkerIndex < fallbackWorkerIndex);
  assert.match(configure, /workerPort = window\.__BILL_ANALYZER_PDF_WORKER_PORT__/u);

  childProcess.execFileSync(process.execPath, ['scripts/build-static.js']);
  assert.equal(fs.existsSync('dist/vendor/pdf.worker.min.mjs'), true);
});
