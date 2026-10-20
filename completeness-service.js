const { ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
const VISITS = [
  [1, '1a', ['golden_form', 'selfq', 'moca']],
  [1, '1b', ['biochem', 'liver', 'dexa', 'pe']],
  [1, '1c', ['echo', 'vascular']],
  [2, '2a', ['medical_history', 'selfq', 'moca', 'biochem', 'pe']],
  [2, '2b', ['ctca']],
];
const LABELS = { golden_form: 'Golden Form', medical_history: 'Medical History', selfq: 'SelfQ', moca: 'MoCA', biochem: 'Biochem', liver: 'Liver', dexa: 'DEXA', pe: 'PE', echo: 'Echo', vascular: 'Vascular', ctca: 'CTCA' };
function normalizeId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().toUpperCase();
  return /^RES[0-9]{1,12}$/.test(id) ? id : null;
}
function patternMatcher(template, id) {
  if (typeof template !== 'string' || !template.includes('{res_id}')) return null;
  // Each wildcard is confined to a single path segment. All other characters are literal.
  const key = template.replaceAll('{res_id}', id);
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('^' + key.split('*').map(escape).join('[^/]*') + '$');
  return { prefix: key.split('*')[0], matches: value => regex.test(value) };
}
async function checkPostgres(pool, source, id, report) {
  const identifier = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
  const filters = source.filters || {};
  if (!pool || ![source.schema, source.table, source.idColumn].every(identifier) ||
      (!Object.keys(filters).length && !source.visitColumn && source.visitSpecificTable !== true)) {
    return { ...report, status: 'unknown', reason: 'Questionnaire source not configured' };
  }
  const values = [id];
  const conditions = [`"${source.idColumn}" = $1`];
  for (const [column, value] of Object.entries(filters)) {
    if (!identifier(column) || !['string', 'number', 'boolean'].includes(typeof value)) {
      return { ...report, status: 'unknown', reason: 'Questionnaire source not configured' };
    }
    values.push(value);
    conditions.push(`"${column}" = $${values.length}`);
  }
  if (source.visitColumn) {
    if (!identifier(source.visitColumn) || !/^\d+[A-Z]$/.test(source.visit || '')) {
      return { ...report, status: 'unknown', reason: 'Questionnaire source not configured' };
    }
    values.push(source.visit);
    conditions.push(`regexp_replace(upper(trim("${source.visitColumn}")), '^VISIT[ _-]*', '') = $${values.length}`);
  }
  const result = await pool.query({
    text: `SELECT EXISTS (SELECT 1 FROM "${source.schema}"."${source.table}" WHERE ${conditions.join(' AND ')}) AS found`,
    values,
  });
  if (typeof result.rows?.[0]?.found !== 'boolean') throw new Error('Invalid availability response');
  return { ...report, status: result.rows[0].found ? 'found' : 'missing' };
}
async function checkReport(s3, config, id, report, postgres) {
  const source = config.sources?.[report.id];
  if (source?.type === 'postgres') return checkPostgres(postgres, source, id, report);
  if (config.bucket && typeof source?.key === 'string' && source.key.includes('{res_id}')) {
    try {
      const object = await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: source.key.replaceAll('{res_id}', id) }));
      return { ...report, status: object.ContentLength > 0 ? 'found' : 'missing' };
    } catch (error) {
      if (error.$metadata?.httpStatusCode === 404) return { ...report, status: 'missing' };
      throw error;
    }
  }
  const pattern = patternMatcher(source?.pattern, id);
  if (!config.bucket || (!pattern && (!source?.prefix || !source.prefix.includes('{res_id}') || !source.prefix.endsWith('/')))) {
    return { ...report, status: 'unknown', reason: 'Source not configured' };
  }
  const prefix = pattern ? pattern.prefix : source.prefix.replaceAll('{res_id}', id);
  // Folder markers are not reports. Paginate until a nonempty file is found.
  let token;
  for (let page = 0; page < 20; page++) {
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: config.bucket, Prefix: prefix, MaxKeys: 1000,
      ...(token ? { ContinuationToken: token } : {}),
    }));
    const found = (response.Contents || []).some(file => file.Size > 0 && !file.Key.endsWith('/') &&
      (!pattern || pattern.matches(file.Key)) && (!source.suffix || file.Key.endsWith(source.suffix)));
    if (found) return { ...report, status: 'found' };
    if (!response.IsTruncated) return { ...report, status: 'missing' };
    if (!response.NextContinuationToken || response.NextContinuationToken === token) break;
    token = response.NextContinuationToken;
  }
  return { ...report, status: 'unknown', reason: 'Source could not be fully checked' };
}
async function checkCompleteness(s3, config, resId, postgres = null) {
  const visits = [];
  // Bound concurrency to the number of reports in one visit (at most five).
  for (const [year, visit, names] of VISITS) {
    const reports = await Promise.all(names.map(async name => {
      const report = { id: `${visit}.${name}`, name: LABELS[name] };
      try { return await checkReport(s3, config, resId, report, postgres); }
      catch (error) {
        const safeCode = value => typeof value === 'string' && /^[A-Za-z0-9_]+$/.test(value) ? value : 'Unknown';
        console.warn('Completeness source check failed', JSON.stringify({
          report: report.id, code: safeCode(error.code), name: safeCode(error.name),
          httpStatus: Number(error.$metadata?.httpStatusCode) || undefined,
        }));
        return { ...report, status: 'unknown', reason: 'Source temporarily unavailable' };
      }
    }));
    visits.push({ year, id: visit, name: `Visit ${visit.toUpperCase()}`, reports });
  }
  const reports = visits.flatMap(visit => visit.reports);
  const counts = { total: reports.length, found: 0, missing: 0, unknown: 0 };
  reports.forEach(report => counts[report.status]++);
  return { res_id: resId, checked_at: new Date().toISOString(), counts, visits };
}
module.exports = { normalizeId, checkCompleteness, VISITS, LABELS, patternMatcher };
