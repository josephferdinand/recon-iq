// One leased guide component preview only; no application/global build.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '../..');
const CANDIDATE = './LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928';
const OUT = path.join(ROOT, 'output/playwright/leibniz-inapp-guide-preview-20261004');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/evidence/FVI_IN_APP_KNOWLEDGE_GUIDE_GENERATION_2026-10-04.json'), 'utf8'));
const images = Object.fromEntries(manifest.captures.map(c => [`../assets/application-guide/${c.asset}`, `guide-assets/${c.asset}`]));
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Guide from ${JSON.stringify(path.join(CANDIDATE, 'src/components/application-user-guide.tsx'))};createRoot(document.getElementById('guide')).render(React.createElement(Guide,{scope:'workspace'}));`, resolveDir: CANDIDATE, loader: 'tsx' },
    bundle: true, platform: 'browser', format: 'iife', outfile: path.join(OUT, 'guide-preview.js'), jsx: 'automatic',
    nodePaths: [path.join(ROOT, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'leased-guide-media-preview', setup(build) {
      build.onResolve({ filter: /^@\// }, args => ({ path: path.join(CANDIDATE, 'src', args.path.slice(2)) + '.ts' }));
      build.onLoad({ filter: /application-user-guide\.tsx$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8').replace(/const media = import\.meta\.glob<string>\([^\n]+\);/, `const media = ${JSON.stringify(images)};`), loader: 'tsx', resolveDir: path.dirname(args.path) }));
    }}] });
  const bundle = fs.readFileSync(path.join(OUT, 'guide-preview.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  fs.writeFileSync(path.join(OUT, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Knowledge guide component preview — NOT DEPLOYED</title><link rel="stylesheet" href="current-theme.css"><link rel="stylesheet" href="guide-preview.css"></head><body style="margin:0;background:#f7f9fb;color:#142845"><p style="margin:0;padding:12px 24px;background:#142845;color:white;font:600 14px Arial">COMPONENT PREVIEW — NOT DEPLOYED. Embedded application images retain their actual capture/version labels.</p><main id="guide" style="max-width:1440px;margin:24px auto;padding:0 20px"></main><script>' + bundle + '</script></body></html>');
  console.log('Isolated Knowledge component preview prepared; not application deployment/build acceptance.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
