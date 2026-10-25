// Opens one spike page in a fresh Chrome and records the peak memory footprint of its processes (macOS).
// usage: node run.mjs URL OUT.json [--headful]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const [url, out] = process.argv.slice(2);
const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: !process.argv.includes('--headful'),
    args: ['--enable-unsafe-webgpu', '--no-first-run'],
    protocolTimeout: 0,
});

function chromeProcesses() {
    const root = browser.process().pid;
    const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command=']).toString().trim().split('\n')
        .map((row) => row.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).map(([, pid, ppid, command]) => ({ pid: +pid, ppid: +ppid, command }));
    const tree = new Set([root]);
    for (let grew = true; grew;) {
        grew = false;
        for (const row of rows) if (tree.has(row.ppid) && !tree.has(row.pid)) { tree.add(row.pid); grew = true; }
    }
    return rows.filter((row) => tree.has(row.pid)).map((row) => ({ pid: row.pid, type: row.command.match(/--type=([\w-]+)/)?.[1] ?? 'browser' }));
}

function footprints(processes) {
    const args = ['-f', 'bytes', '--noCategories', ...processes.flatMap((p) => ['-p', String(p.pid)])];
    const text = execFileSync('footprint', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return new Map([...text.matchAll(/\[(\d+)\].*?Footprint: (\d+) B/g)].map(([, pid, bytes]) => [+pid, +bytes]));
}

const peak = { renderer: 0, gpu: 0, total: 0 };
let sampling = true;
const sampler = (async () => {
    while (sampling) {
        try {
            const processes = chromeProcesses();
            const sizes = footprints(processes);
            const sum = (type) => Math.max(0, ...processes.filter((p) => p.type === type).map((p) => sizes.get(p.pid) ?? 0));
            peak.renderer = Math.max(peak.renderer, sum('renderer'));
            peak.gpu = Math.max(peak.gpu, sum('gpu-process'));
            peak.total = Math.max(peak.total, [...sizes.values()].reduce((a, b) => a + b, 0));
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
})();

const page = await browser.newPage();
page.on('console', (message) => console.log('[page]', message.text()));
page.on('pageerror', (error) => console.log('[pageerror]', error.message));
await page.goto(url);
const isolated = await page.evaluate(() => crossOriginIsolated);
const result = await page.evaluate(() => window.result);
sampling = false;
await sampler;
await browser.close();

const mb = (bytes) => Math.round(bytes / 2 ** 20);
const report = { url, isolated, peak_mb: { renderer: mb(peak.renderer), gpu: mb(peak.gpu), all_chrome: mb(peak.total) }, ...result };
writeFileSync(out, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ isolated, peak_mb: report.peak_mb, load: result.load, error: result.error }));
