// Prints a Markdown table and the transcripts from the JSON files run-all.sh wrote.
// usage: node summarize.mjs RESULTS_DIR
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const reports = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ name: f.replace('.json', ''), ...JSON.parse(readFileSync(join(dir, f))) }));
const s = (ms) => (ms / 1000).toFixed(1);
const find = (r, clip, run) => r.results.find((x) => x.clip === clip && x.run === run);

console.log('| Configuration | Load s | German 1st / 2nd s | s per audio minute | English 2nd s | Peak renderer / GPU MB |');
console.log('|---|---|---|---|---|---|');
for (const r of reports) {
    const [g1, g2, e2] = [find(r, 'german', 1), find(r, 'german', 2), find(r, 'english', 2)];
    console.log(`| ${r.name} | ${s(r.load.total_ms)} | ${s(g1.ms)} / ${s(g2.ms)} | ${s(g2.ms / g2.audio_s * 60)} | ${s(e2.ms)} | ${r.peak_mb.renderer} / ${r.peak_mb.gpu} |`);
}
for (const r of reports) {
    console.log(`\n${r.name}${r.gpu ? ` (${r.gpu.vendor} ${r.gpu.architecture})` : ''}`);
    for (const clip of ['english', 'german']) console.log(find(r, clip, 2).lines.map((l) => l.text).join('\n'));
    const refits = r.results.flatMap((x) => x.lines).filter((l) => l.passes?.length > 1).length;
    if (refits) console.log(`${refits} lines decoded again in full`);
}
