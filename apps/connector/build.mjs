import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
const out = new URL('./dist/', import.meta.url);
await mkdir(out, { recursive: true });
await build({ entryPoints: ['src/popup.tsx'], outfile: 'dist/popup.js', bundle: true, format: 'iife', jsx: 'automatic', platform: 'browser', target: 'chrome120', minify: true });
await build({ entryPoints: ['src/worker.ts'], outfile: 'dist/worker.js', bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', minify: true });
await copyFile(new URL('../../assets/logo/png/reader-logo-256.png', import.meta.url), new URL('icon.png', out));
await copyFile(new URL('src/popup.html', import.meta.url), new URL('popup.html', out));
await copyFile(new URL('src/popup.css', import.meta.url), new URL('popup.css', out));
await writeFile(new URL('manifest.json', out), JSON.stringify({
  manifest_version: 3,
  name: 'Reader Connector', version: '0.1.0',
  description: '将网页中的 PDF 论文收录到本机 Reader',
  icons: {128:'icon.png'},
  action: {default_popup:'popup.html', default_icon:'icon.png'},
  background: {service_worker:'worker.js'},
  permissions: ['activeTab','scripting','storage'],
  host_permissions: ['http://127.0.0.1:17841/*'],
  optional_host_permissions: ['https://*/*','http://*/*']
}, null, 2));
