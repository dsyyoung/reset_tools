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
  assert.deepEqual(result.counts, { total: 15, found: 0, missing: 0, unknown: 15 });
  assert.equal(result.visits.length, 5);
});
test('scoped file presence is found and no file metadata is exposed', async () => {
  const result = await checkCompleteness({ async send(command) {
    assert.equal(command.input.Prefix, 'RES1/year1/visit1a/golden_form/');
    return { Contents: [{ Key: 'RES1/year1/visit1a/golden_form/report.pdf', Size: 100 }] };
  } }, config, 'RES1');
  assert.equal(result.counts.found, 1);
  assert.equal(result.counts.unknown, 14);
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
  assert.equal(result.counts.unknown, 15);
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
  assert.equal(result.counts.unknown, 15);
});
test('prefixes must include participant ID and directory boundary', async () => {
  for (const prefix of ['all-participants/', '{res_id}']) {
    const result = await checkCompleteness({ async send() { assert.fail('unsafe prefix'); } }, { bucket: 'example', sources: { '1a.golden_form': { prefix } } }, 'RES1');
    assert.equal(result.counts.unknown, 15);
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
test('schedule has 15 reports and excludes ECG and Year 3', () => {
  assert.equal(VISITS.flatMap(visit => visit[2]).length, 15);
  assert.equal(VISITS.flatMap(visit => visit[2]).includes('ecg'), false);
  assert.equal(VISITS.some(visit => visit[0] === 3), false);
});
test('DEXA matches dated participant folders without matching neighboring IDs or nested unrelated files', () => {
  const matcher = patternMatcher(actualConfig.sources['1b.dexa'].pattern, 'RES0721');
  assert.equal(matcher.prefix, 'DEXA/');
  assert.equal(matcher.matches('DEXA/02 April 2025/RES0721/Hip.pdf'), true);
  for (const key of ['DEXA/02 April 2025/RES07210/Hip.pdf', 'DEXA/02 April 2025/RES0721/HipXpdf', 'DEXA/02 April 2025/RES0721/other/Hip.pdf']) assert.equal(matcher.matches(key), false);
});
test('Biochem 2A matches the supplied variable suffix with the participant boundary', () => {
  const matcher = patternMatcher(actualConfig.sources['2a.biochem'].pattern, 'RES0001');
  assert.equal(matcher.matches('Biochemistry_2A/RES0001-V2A_-RES0001-V2A-31_25-2287939.pdf'), true);
  assert.equal(matcher.matches('Biochemistry_2A/RES00010-V2A_report.pdf'), false);
});
test('confirmed exact S3 paths preserve MoCA whitespace and report suffixes', async () => {
  const keys = [];
  await checkCompleteness({ async send(command) {
    if (command.input.Key) keys.push(command.input.Key);
    return { ContentLength: 50, Contents: [] };
  } }, actualConfig, 'RES0425');
  assert.ok(keys.includes('MoCA_1A/0. MoCA/ RES0425_MoCA.pdf'));
  assert.ok(keys.includes('MoCA_2A/V2A MoCA/RES0425_V2A_MoCA.pdf'));
  assert.ok(keys.includes('Liver Fibroscan/RES0425.pdf'));
  assert.ok(keys.includes('ECHO/RES0425_E.pdf'));
  assert.ok(keys.includes('Vascular scans/RES0425_V.pdf'));
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
  const result = await checkCompleteness({ async send() { return { ContentLength: 1, Contents: [] }; } }, actualConfig, 'RES0001', { async query(query) {
    queries.push(query);
    assert.ok(query.text.startsWith('SELECT EXISTS'));
    assert.ok(!query.text.includes('RES0001'));
    assert.equal(query.values[0], 'RES0001');
    assert.ok(query.text.includes('regexp_replace'));
    return { rows: [{ found: query.values[1] === '1A' }] };
  } });
  assert.equal(queries.length, 6);
  const reports = result.visits.flatMap(visit => visit.reports);
  assert.equal(reports.find(report => report.id === '1a.selfq').status, 'found');
  assert.equal(reports.find(report => report.id === '2a.selfq').status, 'missing');
  assert.equal(reports.some(report => report.id.startsWith('3a.')), false);
  assert.ok(queries.some(query => query.text.includes('"public"."pe_test"') && query.values[1] === '1B'));
});
test('PostgreSQL errors and missing connections remain unknown', async () => {
  const config = { sources: { '1a.selfq': actualConfig.sources['1a.selfq'] } };
  for (const pool of [null, { async query() { throw Error('connection denied'); } }]) {
    const result = await checkCompleteness({}, config, 'RES1', pool);
    assert.equal(result.counts.unknown, 15);
  }
});
test('PostgreSQL rejects unscoped or invalid table mappings before querying', async () => {
  for (const change of [{ table: 'selfq; DROP TABLE selfq' }, { visitColumn: null }]) {
    const config = { sources: { '1a.selfq': { ...actualConfig.sources['1a.selfq'], ...change } } };
    const result = await checkCompleteness({}, config, 'RES1', { query() { assert.fail('Unsafe query'); } });
    assert.equal(result.counts.unknown, 15);
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
