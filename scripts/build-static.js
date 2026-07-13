const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const publicFiles = [
  'index.html',
  'styles.css',
  '_headers',
  'src/app.js',
  'src/core.js',
  'assets/brands/alipay.svg',
  'assets/brands/wechatpay.svg',
  'vendor/echarts.min.js',
  'vendor/papaparse.min.js',
  'vendor/pdf.bundle.min.js',
  'vendor/pdf.worker.min.mjs',
  'vendor/xlsx.full.min.js',
  'vendor/README.md',
];

fs.rmSync(output, { recursive: true, force: true });

for (const relativePath of publicFiles) {
  const source = path.join(root, relativePath);
  const destination = path.join(output, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

fs.cpSync(path.join(root, 'vendor/licenses'), path.join(output, 'vendor/licenses'), { recursive: true });

const countFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).reduce(
  (count, entry) => count + (entry.isDirectory() ? countFiles(path.join(directory, entry.name)) : 1),
  0,
);

console.log(`Built ${countFiles(output)} public files in ${output}`);
