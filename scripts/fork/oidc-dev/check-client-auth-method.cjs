// Checks how openid-client sends the client secret for each shape of
// token_endpoint_auth_methods_supported. Exits non-zero on a mismatch.
// Run from the repo root: node scripts/fork/oidc-dev/check-client-auth-method.cjs
const http = require('http');
const { Issuer } = require('openid-client');

const CASES = [
  { supportedMethods: undefined, expected: 'client_secret_basic' },
  { supportedMethods: [], expected: 'client_secret_basic' },
  {
    supportedMethods: ['client_secret_basic'],
    expected: 'client_secret_basic',
  },
  { supportedMethods: ['client_secret_post'], expected: 'client_secret_post' },
  {
    supportedMethods: ['client_secret_basic', 'client_secret_post'],
    expected: 'client_secret_basic',
  },
];

const requestTokenFromLocalIdp = async (supportedMethods) => {
  let received;

  const server = http.createServer((request, response) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      received = { authorization: request.headers.authorization, body };
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({ access_token: 'token', token_type: 'Bearer' }),
      );
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const issuer = new Issuer({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      jwks_uri: `${baseUrl}/jwks`,
      ...(supportedMethods !== undefined && {
        token_endpoint_auth_methods_supported: supportedMethods,
      }),
    });
    const client = new issuer.Client({
      client_id: 'client-id',
      client_secret: 'client-secret',
      redirect_uris: [`${baseUrl}/callback`],
      response_types: ['code'],
    });

    await client.grant({ grant_type: 'client_credentials' });
  } finally {
    server.close();
  }

  const hasHeader = received.authorization !== undefined;
  const hasBodySecret = received.body.includes('client_secret=client-secret');

  if (hasHeader && !hasBodySecret) return 'client_secret_basic';
  if (!hasHeader && hasBodySecret) return 'client_secret_post';

  return 'unknown';
};

(async () => {
  let failures = 0;

  for (const { supportedMethods, expected } of CASES) {
    const actual = await requestTokenFromLocalIdp(supportedMethods);
    const verdict = actual === expected ? 'PASS' : 'FAIL';

    if (actual !== expected) failures += 1;
    console.log(`${verdict}  ${JSON.stringify(supportedMethods)} -> ${actual}`);
  }

  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
