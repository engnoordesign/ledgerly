/* Verifies the Arabic dictionary covers every string the app can show.
   node tools/check-i18n.js          -> report missing / unused / placeholder mismatches (exit 1 on problems)
   node tools/check-i18n.js --dump   -> print the English keys that still need translating */
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); } })(path.join(root, 'js'));

const used = new Map();
const re = /\bt\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g;
for (const f of files) {
  if (f.endsWith('lang-ar.js') || f.endsWith('i18n.js')) continue;
  const src = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = re.exec(src))) {
    let s; try { s = vm.runInNewContext(m[1]); } catch (e) { continue; }
    if (!used.has(s)) used.set(s, path.relative(root, f));
  }
}
// strings that are looked up dynamically through t(variable)
const ctx = { localStorage: { getItem() { return null; } }, navigator: { language: 'en' }, document: { documentElement: { removeAttribute() {}, dataset: {} }, addEventListener() {} }, window: { addEventListener() {} }, Intl, Date, Math, JSON, Number, String, Array, Object, Map, Set };
vm.createContext(ctx);
for (const f of ['util.js', 'i18n.js', 'store.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), ctx);
const dyn = JSON.parse(vm.runInContext(`JSON.stringify([
  ...Object.values(K.ACCOUNT_TYPES).map(v => v.label), ...Object.values(K.FREQ), ...Object.values(K.BUCKETS), ...U.CURRENCIES.map(c => c[1])])`, ctx));
dyn.forEach(s => used.has(s) || used.set(s, 'dynamic'));
// built-in category names are translated on display
const seed = fs.readFileSync(path.join(root, 'js', 'seed.js'), 'utf8');
for (const m of seed.matchAll(/\['(?:[a-z]+)', '([^']+)', '(?:expense|income)'/g)) used.has(m[1]) || used.set(m[1], 'category');

let dict = {};
const arPath = path.join(root, 'js', 'lang-ar.js');
if (fs.existsSync(arPath)) {
  const c2 = { I18N: { dicts: {} } };
  vm.createContext(c2);
  vm.runInContext(fs.readFileSync(arPath, 'utf8'), c2);
  dict = c2.I18N.dicts.ar || {};
}
const missing = [...used.keys()].filter(k => !(k in dict));
if (process.argv.includes('--dump')) { console.log(JSON.stringify(missing.sort(), null, 1)); process.exit(0); }
const unused = Object.keys(dict).filter(k => !used.has(k));
const ph = s => (s.match(/\{\w+\}/g) || []).sort().join();
const badPh = Object.keys(dict).filter(k => used.has(k) && ph(k) !== ph(dict[k]));
console.log(`${used.size} strings in use, ${Object.keys(dict).length} translated.`);
if (missing.length) { console.log(`\nMISSING (${missing.length}):`); missing.sort().forEach(k => console.log('  ' + JSON.stringify(k) + '   <- ' + used.get(k))); }
if (badPh.length) { console.log(`\nPLACEHOLDER MISMATCH (${badPh.length}):`); badPh.forEach(k => console.log('  ' + JSON.stringify(k) + ' => ' + JSON.stringify(dict[k]))); }
if (unused.length) console.log(`\n(${unused.length} dictionary entries are not referenced; harmless)` + (process.argv.includes('--unused') ? '\n  ' + unused.join('\n  ') : ''));
process.exit(missing.length || badPh.length ? 1 : 0);
