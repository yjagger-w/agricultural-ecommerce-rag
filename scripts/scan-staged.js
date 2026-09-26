'use strict';
const { execFileSync } = require('node:child_process');
function scanEntries(entries) {
  const findings = [];
  for (const { filename, content } of entries) {
    if (/^(?:data\/)/.test(filename) && !['data/catalog/.gitkeep', 'data/knowledge/.gitkeep'].includes(filename)) findings.push(filename + ': operational data');
    if (/(?:^|\/)(?:\.env(?:\..*)?|logs?|exports?|private|secrets)(?:\/|$)|\.(?:sqlite(?:-.*)?|db(?:-.*)?|log|pem|key)$/i.test(filename) && filename !== '.env.example') findings.push(filename + ': private file');
    if (/(?:[a-z]:[\\/](?:users|personal)[\\/]|\/Users\/|\/home\/[a-z])/i.test(content)) findings.push(filename + ': absolute user path');
    if (/\bsk-[a-zA-Z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp|github_pat)_[a-zA-Z0-9_]{20,}/.test(content)) findings.push(filename + ': credential pattern');
    if (/C:\\GKB|v[2-7]-(?:core|work|academic|current|reference|english)-approved|manual-context\.md/i.test(content)) findings.push(filename + ': personal knowledge reference');
    if (filename.startsWith('test/fixtures/') && filename.endsWith('.json')) {
      try { if (JSON.parse(content).fictional !== true) findings.push(filename + ': fixture not declared fictional'); }
      catch { findings.push(filename + ': invalid fixture JSON'); }
    }
  }
  return findings;
}
function scanStaged() {
  const git = (...args) => execFileSync('git', args, { cwd: require('node:path').join(__dirname, '..') });
  const files = git('diff', '--cached', '--name-only', '-z', '--diff-filter=ACM').toString().split('\0').filter(Boolean);
  if (!files.length) throw new Error('No staged files to scan');
  const entries = files.map(filename => ({ filename, content: git('show', ':' + filename).toString('utf8') }));
  const findings = scanEntries(entries);
  if (findings.length) { console.error(findings.join('\n')); process.exitCode = 1; }
  else console.log(`Scanned ${files.length} staged files: no configured path, credential, personal-knowledge or data-boundary findings. Human business-data review is still required.`);
  return { fileCount: files.length, findings };
}
if (require.main === module) scanStaged();
module.exports = { scanEntries, scanStaged };
