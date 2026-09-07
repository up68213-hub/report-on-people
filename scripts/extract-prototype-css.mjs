import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const prototype = fs.readFileSync(path.join(root, 'Отчет_по_людям_V9.html'), 'utf8');
const match = prototype.match(/<style>([\s\S]*?)<\/style>/i);
if (!match) throw new Error('CSS block not found in prototype');
const target = path.join(root, 'apps/web/src/styles/prototype.css');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, match[1].trimStart(), 'utf8');
console.log(`Extracted prototype CSS to ${target}`);
