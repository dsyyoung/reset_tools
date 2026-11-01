const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { getBiobankDetails } = require('./biobank-service');
const { normalizeId } = require('./completeness-service');

test('biobank details query the exact participant, preserve dates and repeated observations across visits', async () => {
  const rows = [
    { visit_code: '1B', collection_date: '2025-01-01', sample_type: 'plasma_edta', repeated_position_across_submissions: true },
    { visit_code: '1B', collection_date: '2025-01-01', sample_type: 'plasma_edta', repeated_position_across_submissions: true },
    { visit_code: '3A', collection_date: null, sample_type: 'saliva', repeated_position_across_submissions: false },
  ];
  const result = await getBiobankDetails({ async query(query) {
    assert.deepEqual(query.values, ['RES1051']);
    assert.match(query.text, /WHERE res_id = \$1/);
    assert.match(query.text, /collection_date::text/);
    assert.match(query.text, /LIMIT 5001/);
    assert.ok(!query.text.includes('RES1051'));
    assert.ok(!query.text.includes('DISTINCT'));
    return { rows };
  } }, 'RES1051');
  assert.deepEqual(result.data, rows);
  assert.equal(result.meta.count, 3);
  assert.equal(result.meta.res_id, 'RES1051');
});

test('no biobank records differs from unavailable or oversized results', async () => {
  const empty = await getBiobankDetails({ async query() { return { rows: [] }; } }, 'RES1');
  assert.deepEqual(empty.data, []);
  await assert.rejects(getBiobankDetails(null, 'RES1'));
  await assert.rejects(getBiobankDetails({ async query() { throw Error('connection failed'); } }, 'RES1'));
  await assert.rejects(getBiobankDetails({ async query() { return { rows: Array(5001).fill({}) }; } }, 'RES1'), /too large/);
});

test('biobank route validates IDs and handles errors before MongoDB middleware', async () => {
  const source = fs.readFileSync('server.js', 'utf8');
  const start = source.indexOf("app.get('/api/biobank'");
  const end = source.indexOf('// Middleware to ensure DB connection', start);
  assert.ok(start > 0 && end > start);
  let handler, queried = [];
  const context = vm.createContext({ app: { get(path, fn) { handler = fn; } }, normalizeId,
    questionnairePool: {}, getBiobankDetails: async (_, id) => { queried.push(id); return { data: [], meta: { res_id: id } }; } });
  vm.runInContext(source.slice(start, end), context);
  const response = () => ({ code: 200, set(key, value) { this[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } });
  for (const id of ['', undefined, ['RES1'], { $ne: '' }, 'RES1;DROP TABLE']) {
    const res = response(); await handler({ query: { res_id: id } }, res);
    assert.equal(res.code, 400);
  }
  assert.equal(queried.length, 0);
  const good = response(); await handler({ query: { res_id: ' res1051 ' } }, good);
  assert.deepEqual(queried, ['RES1051']);
  assert.equal(good['Cache-Control'], 'no-store');
  context.getBiobankDetails = async () => { throw Error('secret database details'); };
  const failed = response(); await handler({ query: { res_id: 'RES1' } }, failed);
  assert.equal(failed.code, 503);
  assert.ok(!JSON.stringify(failed.body).includes('secret'));
});

function viewer(fetch) {
  function node() {
    return { children: [], textContent: '', value: '', events: {}, attrs: {}, classList: { add() {}, remove() {} },
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren(...children) { this.children = children; },
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, v) { this.events[k] = v; } };
  }
  const elements = new Map();
  const context = vm.createContext({ document: { getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }, createElement: node, createDocumentFragment: node },
    location: { hostname: 'localhost', protocol: 'http:' }, ENV: { LOCAL_URL: 'http://localhost' }, fetch, console: { error() {} } });
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  const allText = node => [node.textContent, ...node.children.map(allText)].join(' ');
  return { context, elements, text: () => allText(elements.get('results')) };
}

test('viewer routes biobank searches separately and renders visit details safely', async () => {
  let requested;
  const payload = { meta: { field: 'biobank_collection', res_id: 'RES1051' }, data: [
    { visit_code: '1B', collection_date: '2025-01-01', sample_type: 'plasma_edta', box_id: '<script>test</script>', box_position: 'A1', sample_location: null, repeated_position_across_submissions: false },
    { visit_code: '3A', collection_date: null, sample_type: 'urine', repeated_position_across_submissions: true },
  ] };
  const page = viewer(async url => { requested = url; return { ok: true, json: async () => payload }; });
  await page.context.fetchData('RES1051', 'biobank_collection');
  assert.match(requested, /\/api\/biobank\?res_id=RES1051/);
  for (const value of ['Visit 1B', 'Visit 3A', 'plasma_edta', '2025-01-01', 'Not recorded', 'Yes', 'No', '<script>test</script>']) assert.ok(page.text().includes(value));
  assert.equal(page.elements.get('results').innerHTML, undefined);
  page.context.renderData({ data: [], meta: payload.meta });
  assert.match(page.text(), /No biobank collection records/);
  assert.ok(!page.text().includes('plasma_edta'));
});

test('late participant results cannot overwrite a newer search', async () => {
  const pending = [];
  const page = viewer(url => new Promise(resolve => pending.push({ url, resolve })));
  const first = page.context.fetchData('RES1', 'biobank_collection');
  const second = page.context.fetchData('RES2', 'biobank_collection');
  pending[1].resolve({ ok: true, json: async () => ({ data: [], meta: { field: 'biobank_collection', res_id: 'RES2' } }) });
  await second;
  pending[0].resolve({ ok: true, json: async () => ({ data: [], meta: { field: 'biobank_collection', res_id: 'RES1' } }) });
  await first;
  assert.match(page.text(), /RES2/);
  assert.ok(!page.text().includes('RES1'));
});

test('existing drug and medical history lookups keep their original API', async () => {
  const urls = [];
  const page = viewer(async url => { urls.push(url); return { ok: true, json: async () => ({ data: [], meta: {} }) }; });
  for (const field of ['drug_info', 'medical_history']) await page.context.fetchData('RES1', field);
  assert.ok(urls.every(url => url.includes('/api/data?')));
});
