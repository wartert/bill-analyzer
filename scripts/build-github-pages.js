const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const staticOutput = path.join(root, 'dist');
const pagesOutput = path.join(root, 'publish', 'github-pages');
const workflowOutput = path.join(pagesOutput, '.github', 'workflows', 'pages.yml');

childProcess.execFileSync(process.execPath, [path.join(__dirname, 'build-static.js')], {
  cwd: root,
  stdio: 'inherit',
});

fs.rmSync(pagesOutput, { recursive: true, force: true });
fs.mkdirSync(path.dirname(workflowOutput), { recursive: true });
fs.cpSync(staticOutput, pagesOutput, { recursive: true });
fs.writeFileSync(path.join(pagesOutput, '.nojekyll'), '');
fs.copyFileSync(path.join(root, 'deployment', 'github-pages.yml'), workflowOutput);

console.log(`Built GitHub Pages package in ${pagesOutput}`);
