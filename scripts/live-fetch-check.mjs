// Live parity check: the fetch transport against the Connection transport, on one real org.
// Not CI. Needs an External Client App with a certificate on the org. Read-only: the only
// non-GET request is the OAuth token exchange. Prints PASS/FAIL lines with counts, never the
// token, the key or record contents.
//
//   SF_CLIENT_ID=... SF_USERNAME=... SF_LOGIN_URL=https://login.salesforce.com \
//   SF_PRIVATE_KEY_FILE=/path/to/server.key [SF_ALIAS=devedition] \
//   node scripts/live-fetch-check.mjs        (after `pnpm run build`)
import { isDeepStrictEqual } from 'node:util';

const REQUIRED = ['SF_CLIENT_ID', 'SF_USERNAME', 'SF_LOGIN_URL', 'SF_PRIVATE_KEY_FILE'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(2);
}

const API_VERSION = '64.0';
const AUDIT_SOQL =
  'SELECT Id, Action, CreatedDate FROM SetupAuditTrail WHERE CreatedDate = LAST_N_DAYS:180 ORDER BY CreatedDate, Id';
const BAD_SOQL = 'SELECT NoSuchField FROM Organization';

const { readFileSync } = await import('node:fs');
const { Org } = await import('@salesforce/core');
const lib = await import('../lib/index.js');
const fetchLib = await import('../lib/fetch.js');

const org = await Org.create({ aliasOrUsername: process.env.SF_ALIAS || 'devedition' });
const conn = org.getConnection(API_VERSION);
const conn$ = {
  soql: new lib.SoqlClientImpl(conn),
  rest: new lib.RestClientImpl(conn),
};
const fetched = fetchLib.createFetchClients({
  apiVersion: API_VERSION,
  auth: {
    clientId: process.env.SF_CLIENT_ID,
    username: process.env.SF_USERNAME,
    loginUrl: process.env.SF_LOGIN_URL,
    sign: fetchLib.pemSigner(readFileSync(process.env.SF_PRIVATE_KEY_FILE, 'utf8')),
  },
});

let failed = 0;
const report = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const attempt = async (name, fn) => {
  try {
    await fn();
  } catch (err) {
    // Only the error code, never the message: messages can echo record or query content.
    report(name, false, `threw ${err && err.errorCode ? err.errorCode : 'an error'}`);
  }
};
const thrown = async (fn) => {
  try {
    await fn();
    return undefined;
  } catch (err) {
    return err;
  }
};

await attempt('1 query Organization', async () => {
  const [a, b] = await Promise.all([
    conn$.soql.query('SELECT Id FROM Organization LIMIT 1'),
    fetched.soql.query('SELECT Id FROM Organization LIMIT 1'),
  ]);
  report('1 query Organization', isDeepStrictEqual(a, b), `${a.records.length} vs ${b.records.length} records`);
});

await attempt('2 queryAll SetupAuditTrail', async () => {
  const [a, b] = await Promise.all([conn$.soql.queryAll(AUDIT_SOQL), fetched.soql.queryAll(AUDIT_SOQL)]);
  report('2 queryAll SetupAuditTrail', isDeepStrictEqual(a, b), `${a.length} vs ${b.length} records`);
});

await attempt('3 GET limits key sets', async () => {
  const [a, b] = await Promise.all([conn$.rest.get('/limits'), fetched.rest.get('/limits')]);
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  report('3 GET limits key sets', isDeepStrictEqual(ka, kb), `${ka.length} vs ${kb.length} keys`);
});

await attempt('4 INVALID_FIELD error', async () => {
  const [ea, eb] = await Promise.all([
    thrown(() => conn$.soql.queryAll(BAD_SOQL)),
    thrown(() => fetched.soql.queryAll(BAD_SOQL)),
  ]);
  const codes = [ea?.errorCode, eb?.errorCode];
  const ok =
    ea !== undefined &&
    eb !== undefined &&
    isDeepStrictEqual(codes[0], codes[1]) &&
    lib.isApiError(ea) &&
    lib.isApiError(eb);
  report('4 INVALID_FIELD error', ok, `connection ${codes[0]}, fetch ${codes[1]}`);
});

await attempt('5 serverDate within 5 s', async () => {
  const skewMs = Math.abs((await fetched.transport.serverDate()).getTime() - Date.now());
  report('5 serverDate within 5 s', skewMs <= 5000, `skew ${skewMs} ms`);
});

process.exit(failed > 0 ? 1 : 0);
