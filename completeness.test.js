const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeId, checkCompleteness } = require('./completeness-service');
const config = { bucket: 'example-bucket', sources: { '1a.golden_form': { prefix: '{res_id}/year1/visit1a/golden_form/', suffix: '.pdf' } } };
test('IDs are normalized; query objects and path characters are rejected', () => {
  assert.equal(normalizeId(' res5216 '), 'RES5216');
  for (const value of [{ $ne: 'x' }, ['RES1'], '', 'RES1/other', 'RES1.*', 'not-an-id']) assert.equal(normalizeId(value), null);
});
test('unconfigured sources remain unknown without querying storage', async () => {
  const result = await checkCompleteness({ send() { throw Error('must not call'); } }, {}, 'RES1');
  assert.deepEqual(result.counts, { total: 22, found: 0, missing: 0, unknown: 22 });
  assert.equal(result.visits.length, 6);
});
test('scoped file presence is found and no file metadata is exposed', async () => {
  const result = await checkCompleteness({ async send(command) {
    assert.equal(command.input.Prefix, 'RES1/year1/visit1a/golden_form/');
    return { Contents: [{ Key: 'RES1/year1/visit1a/golden_form/report.pdf', Size: 100 }] };
  } }, config, 'RES1');
  assert.equal(result.counts.found, 1);
  assert.equal(result.counts.unknown, 21);
  assert.equal(JSON.stringify(result).includes('report.pdf'), false);
});
test('empty sources, directory markers, empty files and wrong extensions are missing', async () => {
  for (const contents of [[], [{ Key: 'folder/', Size: 1 }], [{ Key: 'empty.pdf', Size: 0 }], [{ Key: 'file.txt', Size: 2 }]]) {
    const result = await checkCompleteness({ async send() { return { Contents: contents }; } }, config, 'RES1');
    assert.equal(result.counts.missing, 1);
  }
});
test('access denied remains unknown, never missing', async () => {
  const result = await checkCompleteness({ async send() { throw Error('AccessDenied secret'); } }, config, 'RES1');
  assert.equal(result.counts.missing, 0);
  assert.equal(result.counts.unknown, 22);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('pagination finds a report after directory markers', async () => {
  let calls = 0;
  const result = await checkCompleteness({ async send(command) {
    if (!calls++) return { Contents: [], IsTruncated: true, NextContinuationToken: 'page2' };
    assert.equal(command.input.ContinuationToken, 'page2');
    return { Contents: [{ Key: 'report.pdf', Size: 42 }] };
  } }, config, 'RES1');
  assert.equal(result.counts.found, 1);
});
test('incomplete pagination remains unknown', async () => {
  const result = await checkCompleteness({ async send() { return { IsTruncated: true }; } }, config, 'RES1');
  assert.equal(result.counts.unknown, 22);
});
test('prefixes must include participant ID and directory boundary', async () => {
  for (const prefix of ['all-participants/', '{res_id}']) {
    const result = await checkCompleteness({ async send() { assert.fail('unsafe prefix'); } }, { bucket: 'example', sources: { '1a.golden_form': { prefix } } }, 'RES1');
    assert.equal(result.counts.unknown, 22);
  }
});
test('flat report key uses metadata only and the exact participant filename', async () => {
  const result = await checkCompleteness({ async send(command) {
    assert.equal(command.constructor.name, 'HeadObjectCommand');
    assert.equal(command.input.Key, 'Biochemistry_1B/RES0003.pdf');
    return { ContentLength: 123 };
  } }, { bucket: 'example', sources: { '1b.biochem': { key: 'Biochemistry_1B/{res_id}.pdf' } } }, 'RES0003');
  assert.equal(result.counts.found, 1);
});
test('exact-key absence differs from denied access and service errors', async () => {
  for (const [status, expected] of [[404, 'missing'], [403, 'unknown'], [500, 'unknown']]) {
    const result = await checkCompleteness({ async send() { throw { $metadata: { httpStatusCode: status } }; } }, { bucket: 'example', sources: { '1b.biochem': { key: 'Biochemistry_1B/{res_id}.pdf' } } }, 'RES1');
    assert.equal(result.visits[1].reports[0].status, expected);
  }
});

const actualConfig = require('./completeness-config.json');
const { patternMatcher, VISITS } = require('./completeness-service');
test('schedule has 22 reports and collections across three years and excludes ECG', () => {
  assert.equal(VISITS.flatMap(visit => visit[2]).length, 22);
  assert.equal(VISITS.flatMap(visit => visit[2]).includes('ecg'), false);
  assert.equal(VISITS.some(visit => visit[0] === 3), true);
  assert.deepEqual(VISITS.filter(visit => visit[0] === 3), [[3, '3a', ['medical_history', 'biochem', 'selfq', 'biobank']]]);
});
test('DEXA matches dated participant folders without matching neighboring IDs or nested unrelated files', () => {
  const matcher = patternMatcher(actualConfig.sources['1b.dexa'].pattern, 'RES0721');
  assert.equal(matcher.prefix, 'DEXA/');
  assert.equal(matcher.matches('DEXA/02 April 2025/RES0721/Hip.pdf'), true);
  for (const key of ['DEXA/02 April 2025/RES07210/Hip.pdf', 'DEXA/02 April 2025/RES0721/HipXpdf', 'DEXA/02 April 2025/RES0721/other/Hip.pdf']) assert.equal(matcher.matches(key), false);
});
test('confirmed exact S3 paths preserve report suffixes', async () => {
  const keys = [];
  await checkCompleteness({ async send(command) {
    if (command.input.Key) keys.push(command.input.Key);
    return { ContentLength: 50, Contents: [] };
  } }, actualConfig, 'RES0425');
  assert.ok(keys.includes('Liver Fibroscan/1B/RES0425.pdf'));
  assert.ok(keys.includes('Liver Fibroscan/2A/RES0425.pdf'));
  assert.ok(!keys.includes('Liver Fibroscan/RES0425.pdf'));
  assert.ok(keys.includes('ECHO/RES0425_E.pdf'));
});
test('DEXA scan continues after unrelated participants and finds the requested participant', async () => {
  let count = 0;
  const result = await checkCompleteness({ async send(command) {
    assert.equal(command.input.Prefix, 'DEXA/');
    if (!count++) return { Contents: [{ Key: 'DEXA/date/RES07210/Hip.pdf', Size: 1 }], IsTruncated: true, NextContinuationToken: 'next' };
    return { Contents: [{ Key: 'DEXA/02 April 2025/RES0721/Hip.pdf', Size: 1 }] };
  } }, { bucket: actualConfig.bucket, sources: { '1b.dexa': actualConfig.sources['1b.dexa'] } }, 'RES0721');
  assert.equal(result.visits[1].reports.find(report => report.name === 'DEXA').status, 'found');
});
test('PostgreSQL checks parameterize IDs and normalize visit labels without reading clinical fields', async () => {
  const queries = [];
  const result = await checkCompleteness({ async send() { return { ContentLength: 1, Contents: [{ Key: 'Vascular scans/RES0001.pdf', Size: 1 }] }; } }, actualConfig, 'RES0001', { async query(query) {
    queries.push(query);
    assert.ok(query.text.startsWith('SELECT EXISTS'));
    assert.ok(!query.text.includes('RES0001'));
    assert.equal(query.values[0], 'RES0001');
    assert.ok(query.text.includes('regexp_replace'));
    return { rows: [{ found: query.values[1] === '1A' }] };
  } });
  assert.equal(queries.length, 11);
  const reports = result.visits.flatMap(visit => visit.reports);
  assert.equal(reports.find(report => report.id === '1a.selfq').status, 'found');
  assert.equal(reports.find(report => report.id === '2a.selfq').status, 'missing');
  assert.equal(reports.some(report => report.id.startsWith('3a.')), true);
  assert.ok(queries.some(query => query.text.includes('"public"."pe_test"') && query.values[1] === '1B'));
});
test('PostgreSQL errors and missing connections remain unknown', async () => {
  const config = { sources: { '1a.selfq': actualConfig.sources['1a.selfq'] } };
  for (const pool of [null, { async query() { throw Error('connection denied'); } }]) {
    const result = await checkCompleteness({}, config, 'RES1', pool);
    assert.equal(result.counts.unknown, 22);
  }
});
test('PostgreSQL rejects unscoped or invalid table mappings before querying', async () => {
  for (const change of [{ table: 'selfq; DROP TABLE selfq' }, { visitColumn: null }]) {
    const config = { sources: { '1a.selfq': { ...actualConfig.sources['1a.selfq'], ...change } } };
    const result = await checkCompleteness({}, config, 'RES1', { query() { assert.fail('Unsafe query'); } });
    assert.equal(result.counts.unknown, 22);
  }
});
test('PostgreSQL pool is optional, uses the requested database, and does not reuse HTTP PORT', async () => {
  const { createQuestionnairePool } = require('./completeness-postgres');
  assert.equal(createQuestionnairePool({}), null);
  const pool = createQuestionnairePool({ PGHOST: 'offline.invalid', PGUSER: 'test', PORT: '3000' });
  assert.equal(pool.options.database, 'reset_clinical_test');
  assert.equal(pool.options.port, 5432);
  assert.equal(pool.options.ssl.rejectUnauthorized, true);
  assert.equal(pool.options.options, '-c default_transaction_read_only=on');
  await pool.end();
});

async function checkFilename(reportId, participant, keys) {
  const requests = [];
  const result = await checkCompleteness({ async send(command) {
    requests.push(command.input.Prefix);
    return { Contents: keys.filter(file => file.Key.startsWith(command.input.Prefix)) };
  } }, { bucket: actualConfig.bucket, sources: { [reportId]: actualConfig.sources[reportId] } }, participant);
  return { report: result.visits.flatMap(v => v.reports).find(r => r.id === reportId), requests };
}
test('Biochem 1B finds RES1051 suffixed reports and retains plain and hyphen filenames', async () => {
  for (const key of [
    'Biochemistry_1B/RES1051_V1B_-RES1051V1B-31_26-2418094.pdf',
    'Biochemistry_1B/RES1051.pdf',
    'Biochemistry_1B/RES1051-V1B_report.PDF',
  ]) {
    const result = await checkFilename('1b.biochem', 'RES1051', [{ Key: key, Size: 100 }]);
    assert.equal(result.report.status, 'found');
    assert.deepEqual(result.requests, ['Biochemistry_1B/RES1051']);
  }
});
test('Biochem 1B continues through pages and keeps incomplete or denied checks unknown', async () => {
  const config = { bucket: actualConfig.bucket, sources: { '1b.biochem': actualConfig.sources['1b.biochem'] } };
  for (const scenario of ['found', 'missing', 'incomplete', 'denied']) {
    let calls = 0;
    const result = await checkCompleteness({ async send(command) {
      assert.equal(command.constructor.name, 'ListObjectsV2Command');
      assert.equal(command.input.Prefix, 'Biochemistry_1B/RES1051');
      if (scenario === 'denied') throw { $metadata: { httpStatusCode: 403 } };
      if (!calls++) return { Contents: [{ Key: 'Biochemistry_1B/RES10510.pdf', Size: 100 }], IsTruncated: true, NextContinuationToken: 'page2' };
      assert.equal(command.input.ContinuationToken, 'page2');
      if (scenario === 'found') return { Contents: [{ Key: 'Biochemistry_1B/RES1051_V1B_-RES1051V1B-31_26-2418094.pdf', Size: 100 }] };
      return scenario === 'incomplete' ? { IsTruncated: true } : { Contents: [] };
    } }, config, 'RES1051');
    const report = result.visits.flatMap(v => v.reports).find(r => r.id === '1b.biochem');
    assert.equal(report.status, ['incomplete', 'denied'].includes(scenario) ? 'unknown' : scenario);
  }
});
test('RES0049: underscore Biochem and Latin/Cyrillic MoCA filenames are found', async () => {
  for (const [report, key] of [
    ['2a.biochem', 'Biochemistry_2A/RES0049_V2A_-RES0049V2A-31_26-2418089.pdf'],
    ['1a.moca', 'MoCA_1A/0. MoCA/RES0049_MOCA.pdf'],
    ['2a.moca', 'MoCA_2A/V2A MoCA/RES0049_МоСА_V2A.pdf'],
  ]) {
    const result = await checkFilename(report, 'RES0049', [{ Key: key, Size: 100 }]);
    assert.equal(result.report.status, 'found');
    assert.ok(result.requests.every(prefix => prefix.endsWith('RES0049')));
  }
});
test('previous hyphen Biochem, spaced MoCA and reordered MoCA paths remain supported', async () => {
  for (const [report, participant, key] of [
    ['2a.biochem', 'RES0001', 'Biochemistry_2A/RES0001-V2A_-RES0001-V2A-31_25-2287939.pdf'],
    ['1a.moca', 'RES0425', 'MoCA_1A/0. MoCA/ RES0425_MoCA.pdf'],
    ['2a.moca', 'RES0001', 'MoCA_2A/V2A MoCA/RES0001_V2A_MoCA.pdf'],
  ]) assert.equal((await checkFilename(report, participant, [{ Key: key, Size: 100 }])).report.status, 'found');
});
test('participant matching rejects neighboring IDs, nested files, wrong extensions and empty PDFs', async () => {
  for (const report of ['1a.moca', '2a.moca', '1b.biochem', '2a.biochem', '3a.biochem']) {
    const folder = actualConfig.sources[report].participantFolder;
    const files = ['RES00490_MOCA.pdf', 'RES0049A_MOCA.pdf', 'RES0049/sub/report.pdf', 'RES0049_MOCA.txt', 'RES0049_MOCA.pdf.backup'].map(key => ({ Key: folder + key, Size: 100 }));
    files.push({ Key: folder + 'RES0049_MOCA.pdf', Size: 0 });
    assert.equal((await checkFilename(report, 'RES0049', files)).report.status, 'missing');
  }
});
test('participant file matching handles pagination and incomplete listings', async () => {
  for (const incomplete of [false, true]) {
    let calls = 0;
    const result = await checkCompleteness({ async send() {
      if (!calls++) return { Contents: [], IsTruncated: true, NextContinuationToken: 'next' };
      return incomplete ? { IsTruncated: true } : { Contents: [{ Key: 'Biochemistry_2A/RES0049_report.PDF', Size: 10 }] };
    } }, { bucket: actualConfig.bucket, sources: { '2a.biochem': actualConfig.sources['2a.biochem'] } }, 'RES0049');
    assert.equal(result.visits.flatMap(v => v.reports).find(r => r.id === '2a.biochem').status, incomplete ? 'unknown' : 'found');
  }
});
test('vascular detects PDFs with and without suffix without querying PostgreSQL', async () => {
  for (const name of ['RES0001.pdf', 'RES0001_V.pdf']) {
    let queried = false;
    const result = await checkCompleteness({ async send() { return { Contents: [{ Key: 'Vascular scans/' + name, Size: 100 }] }; } },
      { bucket: actualConfig.bucket, sources: { '1c.vascular': actualConfig.sources['1c.vascular'] } }, 'RES0001',
      { async query() { queried = true; return { rows: [{ found: false }] }; } });
    assert.equal(result.visits[2].reports[1].status, 'found');
    assert.equal(queried, false);
  }
});
test('Echo and Vascular use participant/visit-scoped database fallback when PDF absent', async () => {
  for (const id of ['1c.echo', '1c.vascular']) {
    let query;
    const result = await checkCompleteness({ async send() { throw { $metadata: { httpStatusCode: 404 } }; } },
      { bucket: actualConfig.bucket, sources: { [id]: actualConfig.sources[id] } }, 'RES0001',
      { async query(q) { query = q; return { rows: [{ found: true }] }; } });
    const report = result.visits[2].reports.find(r => r.id === id);
    assert.equal(report.status, 'found');
    assert.equal(report.source, 'postgres');
    assert.deepEqual(query.values, ['RES0001', '1C']);
    assert.ok(query.text.includes(actualConfig.sources[id].fallback.table));
  }
});
test('fallback only reports missing when both sources confirm absence', async () => {
  for (const [primaryError, dbFound, expected] of [[404, false, 'missing'], [403, false, 'unknown'], [403, true, 'found']]) {
    const result = await checkCompleteness({ async send() { throw { $metadata: { httpStatusCode: primaryError } }; } },
      { bucket: actualConfig.bucket, sources: { '1c.echo': actualConfig.sources['1c.echo'] } }, 'RES0001',
      { async query() { return { rows: [{ found: dbFound }] }; } });
    assert.equal(result.visits[2].reports[0].status, expected);
  }
});
test('missing PDF with unavailable database remains unknown', async () => {
  const result = await checkCompleteness({ async send() { return { Contents: [] }; } },
    { bucket: actualConfig.bucket, sources: { '1c.vascular': actualConfig.sources['1c.vascular'] } }, 'RES0001');
  assert.equal(result.visits[2].reports[1].status, 'unknown');
});
test('MongoDB connection retries after a failure and reuses a successful connection', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync('server.js', 'utf8');
  const start = source.indexOf('async function connectMongo()');
  const end = source.indexOf("if (!process.env.LAMBDA_TASK_ROOT)", start);
  let attempts = 0;
  const database = {};
  const context = vm.createContext({ client: {
    async connect() { if (++attempts === 1) throw new Error('temporary connection failure'); },
    db() { return database; },
  }, mongoDb: 'test', console: { log() {} } });
  vm.runInContext('let db; let connecting = null;\n' + source.slice(start, end), context);
  await assert.rejects(context.connectMongo(), /temporary connection failure/);
  assert.equal(await context.connectMongo(), database);
  assert.equal(await context.connectMongo(), database);
  assert.equal(attempts, 2);
});

test('biobank availability uses the participant and visit_code independently for 1B, 2A and 3A', async () => {
  const sources = Object.fromEntries(['1b.biobank', '2a.biobank', '3a.biobank'].map(id => [id, actualConfig.sources[id]]));
  const queries = [];
  const result = await checkCompleteness({}, { sources }, 'RES0001', { async query(query) {
    queries.push(query);
    assert.ok(query.text.includes('"public"."biobank_tube_observations"'));
    assert.ok(query.text.includes('"res_id" = $1'));
    assert.ok(query.text.includes('trim("visit_code")'));
    assert.ok(!query.text.includes('collection_date'));
    assert.ok(!query.text.includes('RES0001'));
    assert.equal(query.values[0], 'RES0001');
    return { rows: [{ found: query.values[1] === '1B' }] };
  } });
  assert.deepEqual(queries.map(q => q.values[1]), ['1B', '2A', '3A']);
  const reports = result.visits.flatMap(v => v.reports).filter(r => r.id.endsWith('.biobank'));
  assert.deepEqual(reports.map(r => [r.id, r.name, r.status]), [
    ['1b.biobank', 'Biobank collection', 'found'],
    ['2a.biobank', 'Biobank collection', 'missing'],
    ['3a.biobank', 'Biobank collection', 'missing'],
  ]);
  assert.deepEqual(result.counts, { total: 22, found: 1, missing: 2, unknown: 19 });
});

test('biobank connection failures remain unknown rather than missing', async () => {
  const sources = Object.fromEntries(['1b.biobank', '2a.biobank', '3a.biobank'].map(id => [id, actualConfig.sources[id]]));
  for (const pool of [null, { async query() { throw Error('connection unavailable'); } }]) {
    const result = await checkCompleteness({}, { sources }, 'RES0001', pool);
    const reports = result.visits.flatMap(v => v.reports).filter(r => r.id.endsWith('.biobank'));
    assert.ok(reports.every(r => r.status === 'unknown'));
    assert.equal(result.counts.missing, 0);
  }
});

test('liver checks isolate each visit folder and distinguish missing files from access failures', async () => {
  const sources = Object.fromEntries(['1b.liver', '2a.liver'].map(id => [id, actualConfig.sources[id]]));
  for (const absentStatus of [404, 403]) {
    for (const foundVisit of ['1B', '2A']) {
      const keys = [];
      const result = await checkCompleteness({ async send(command) {
        assert.equal(command.constructor.name, 'HeadObjectCommand');
        assert.equal(command.input.Bucket, actualConfig.bucket);
        keys.push(command.input.Key);
        if (command.input.Key === `Liver Fibroscan/${foundVisit}/RES0224.pdf`) return { ContentLength: 100 };
        throw { $metadata: { httpStatusCode: absentStatus } };
      } }, { bucket: actualConfig.bucket, sources }, 'RES0224');
      assert.deepEqual(keys, ['Liver Fibroscan/1B/RES0224.pdf', 'Liver Fibroscan/2A/RES0224.pdf']);
      const reports = result.visits.flatMap(v => v.reports).filter(r => r.id.endsWith('.liver'));
      assert.equal(reports.length, 2);
      for (const report of reports) {
        assert.equal(report.status, report.id.startsWith(foundVisit.toLowerCase()) ? 'found' : absentStatus === 404 ? 'missing' : 'unknown');
      }
    }
  }
});

test('Visit 3A checks only its own questionnaire, biobank and biochemistry sources', async () => {
  const sources = Object.fromEntries(Object.entries(actualConfig.sources).filter(([id]) => id.startsWith('3a.')));
  const queries = [];
  const result = await checkCompleteness({ async send(command) {
    assert.equal(command.input.Prefix, 'Biochemistry_3A/RES0009');
    assert.equal(command.input.Bucket, actualConfig.bucket);
    return { Contents: [{ Key: 'Biochemistry_3A/RES0009_V3A_report.pdf', Size: 100 }] };
  } }, { bucket: actualConfig.bucket, sources }, 'RES0009', { async query(query) {
    queries.push(query);
    assert.deepEqual(query.values, ['RES0009', '3A']);
    assert.ok(query.text.includes('"res_id" = $1'));
    return { rows: [{ found: !query.text.includes('"selfq"') }] };
  } });
  const visit = result.visits.find(v => v.id === '3a');
  assert.equal(visit.year, 3);
  assert.equal(visit.name, 'Visit 3A');
  assert.deepEqual(visit.reports.map(r => [r.id, r.status]), [
    ['3a.medical_history', 'found'], ['3a.biochem', 'found'],
    ['3a.selfq', 'missing'], ['3a.biobank', 'found'],
  ]);
  assert.equal(queries.length, 3);
  assert.ok(queries.some(q => q.text.includes('"medical_history"') && q.text.includes('trim("visit")')));
  assert.ok(queries.some(q => q.text.includes('"selfq"') && q.text.includes('trim("visit")')));
  assert.ok(queries.some(q => q.text.includes('"biobank_tube_observations"') && q.text.includes('trim("visit_code")')));
  assert.deepEqual(result.counts, { total: 22, found: 3, missing: 1, unknown: 18 });
});

test('Visit 3A does not inherit Year 2 files and keeps unavailable sources unknown', async () => {
  const sources = Object.fromEntries(Object.entries(actualConfig.sources).filter(([id]) => id.startsWith('3a.')));
  for (const unavailable of [false, true]) {
    const result = await checkCompleteness({ async send() {
      if (unavailable) throw { $metadata: { httpStatusCode: 403 } };
      return { Contents: [{ Key: 'Biochemistry_2A/RES0009.pdf', Size: 100 }] };
    } }, { bucket: actualConfig.bucket, sources }, 'RES0009', { async query(query) {
      if (unavailable) throw Error('unavailable');
      return { rows: [{ found: query.values[1] === '2A' }] };
    } });
    const visit = result.visits.find(v => v.id === '3a');
    assert.ok(visit.reports.every(r => r.status === (unavailable ? 'unknown' : 'missing')));
  }
});
