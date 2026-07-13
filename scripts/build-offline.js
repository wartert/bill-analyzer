const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', '钱都去哪了-离线版.html');
const nonce = 'qian-offline-v1';

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const escapeScript = (source) => source.replace(/<\/script/giu, '<\\/script');
const escapeHtml = (source) => source
  .replace(/&/gu, '&amp;')
  .replace(/</gu, '&lt;')
  .replace(/>/gu, '&gt;');
const svgDataUri = (relativePath) => (
  `data:image/svg+xml;base64,${fs.readFileSync(path.join(root, relativePath)).toString('base64')}`
);

const brands = {
  'assets/brands/alipay.svg': svgDataUri('assets/brands/alipay.svg'),
  'assets/brands/wechatpay.svg': svgDataUri('assets/brands/wechatpay.svg'),
};

const replaceBrandPaths = (source) => Object.entries(brands).reduce(
  (result, [assetPath, dataUri]) => result.replaceAll(assetPath, () => dataUri),
  source,
);

const workerBase64 = fs.readFileSync(path.join(root, 'vendor/pdf.worker.min.mjs')).toString('base64');
const workerPrelude = `
(function configureEmbeddedPdfWorker() {
  'use strict';
  window.__BILL_ANALYZER_PDF_WORKER_URL__ = '';
  window.__BILL_ANALYZER_PDF_WORKER_PORT__ = null;
  try {
    const encoded = '${workerBase64}';
    const binary = window.atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const workerUrl = URL.createObjectURL(
      new Blob([bytes], { type: 'text/javascript' }),
    );
    window.__BILL_ANALYZER_PDF_WORKER_URL__ = workerUrl;
    window.__BILL_ANALYZER_PDF_WORKER_PORT__ = new Worker(workerUrl, { type: 'module' });
  } catch (_) {
    window.__BILL_ANALYZER_PDF_WORKER_PORT__ = null;
  }
}());`;

const scriptSources = [
  read('vendor/echarts.min.js'),
  read('vendor/papaparse.min.js'),
  read('vendor/xlsx.full.min.js'),
  read('vendor/pdf.bundle.min.js'),
  workerPrelude,
  read('src/core.js'),
  read('src/insights.js'),
  read('src/budget.js'),
  read('src/exporter.js'),
  replaceBrandPaths(read('src/app.js')),
];

const offlineCss = `
.offline-note { margin: 0 auto; max-width: 1200px; padding: 12px 24px; color: #285548; background: #edf8f3; border: 1px solid #cce9dc; border-radius: 16px; }
.offline-note strong { margin-right: 8px; }
@media (max-width: 767px) { .offline-note { margin: 0 16px; padding: 11px 14px; font-size: 13px; } }
`;
const offlineGuidance = '电脑端请先保存文件，再使用 Safari、Chrome 或 Edge 打开，这是推荐且更可靠的方式。移动端能否运行本地 HTML 取决于操作系统和接收应用；Android 可尝试支持本地 HTML 的浏览器或 HTML 查看器，iPhone/iPad 的“文件”或聊天预览不一定会执行 JavaScript。若只能预览或控件无法使用，请改用支持本地 HTML 的浏览器或 HTML 查看器；没有兼容应用时，请在电脑上打开。账单只在当前浏览器本地处理，不会上传。';

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
html = html.replace(
  '<link rel="stylesheet" href="styles.css">',
  () => `<style nonce="${nonce}">\n${read('styles.css')}\n${offlineCss}\n</style>`,
);
html = html.replace(/\s*<script defer src="[^"]+"><\/script>/gu, '');
html = html.replace('<body>', '<body data-build="offline">');
html = html.replace('PERSONAL MONEY MAP · 本地优先', 'PERSONAL MONEY MAP · 完整离线版');
html = replaceBrandPaths(html);
html = html.replace(
  '<main id="main-content">',
  `<noscript><p class="offline-note">${offlineGuidance}</p></noscript>
  <aside class="offline-note" aria-label="离线版打开提示"><strong>完整离线版</strong>${offlineGuidance}</aside>

  <main id="main-content">`,
);

const embeddedScripts = scriptSources
  .map((source) => `<script nonce="${nonce}">\n${escapeScript(source)}\n</script>`)
  .join('\n');
const licenseTemplate = `<template id="third-party-notices" hidden>\n<pre>${escapeHtml(notices)}</pre>\n</template>`;
html = html.replace('</body>', () => `${licenseTemplate}\n${embeddedScripts}\n</body>`);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html, 'utf8');
console.log(`Built ${path.basename(output)} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB)`);
