import { writeFile } from 'node:fs/promises';

const endpoint = process.argv[2] || 'http://127.0.0.1:9222';
const output = process.argv[3] || 'manual-ui-check.png';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let pages;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try { pages = await fetch(`${endpoint}/json`).then((response) => response.json()); break; } catch { await wait(250); }
}
const page = pages?.find((item) => item.type === 'page');
if (!page) throw new Error('Chrome page was not found');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
socket.onmessage = ({ data }) => { const message = JSON.parse(data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const callId = ++id; pending.set(callId, resolve); socket.send(JSON.stringify({ id: callId, method, params })); });
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
await send('Page.reload', { ignoreCache: true });
await wait(1800);
await send('Runtime.evaluate', { expression: `document.querySelector('.manual-entry-trigger')?.click()` });
await wait(400);
if (process.argv[4] === 'quality') {
  await send('Runtime.evaluate', { expression: `document.querySelector('.entry-setup-modal .ui-date-input')?.click()` });
  await wait(200);
  await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.ui-calendar-days button')].find(b=>b.textContent.trim()==='4'&&!b.classList.contains('adjacent'))?.click()` });
  await wait(200);
}
await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Перейти к заполнению'))?.click()` });
await wait(1800);
if (process.argv[4] === 'quality') {
  await send('Runtime.evaluate', { expression: `document.querySelector('.v4-status.warn')?.click()` });
  await wait(500);
}
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile(output, Buffer.from(shot.result.data, 'base64'));
socket.close();
