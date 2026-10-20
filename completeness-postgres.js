const { Pool } = require('pg');
const fs = require('fs');

// Separate PGPORT from PORT: PORT already controls the Express HTTP listener.
function createQuestionnairePool(env = process.env) {
  const host = env.PGHOST || env.PG_HOST || env.RDSHOST;
  if (!host) return null;
  const ssl = { rejectUnauthorized: true };
  const caPath = env.PGSSLROOTCERT || (env.LAMBDA_TASK_ROOT && host.endsWith('.rds.amazonaws.com') ? '/var/runtime/ca-cert.pem' : null);
  if (caPath) ssl.ca = fs.readFileSync(caPath, 'utf8');
  const pool = new Pool({
    host,
    port: Number(env.PGPORT || 5432),
    database: env.PGDATABASE || 'reset_clinical_test',
    user: env.PGUSER || env.USERNAME,
    password: env.PGPASSWORD || env.PASSWORD,
    ssl,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
    query_timeout: 6000,
    options: '-c default_transaction_read_only=on',
    allowExitOnIdle: true,
  });
  pool.on('error', () => console.error('Questionnaire database connection unavailable.'));
  return pool;
}
module.exports = { createQuestionnairePool };
