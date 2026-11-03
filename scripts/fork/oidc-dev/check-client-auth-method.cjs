// Shows how openid-client sends the client secret for each shape of token_endpoint_auth_methods_supported.
// Run from the repo root: node scripts/fork/oidc-dev/check-client-auth-method.cjs
const http = require('http');
const { Issuer } = require('openid-client');
const run = async (methods) => {
  let seen;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = { authorization: req.headers.authorization ?? null, body };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ access_token: 'a', token_type: 'Bearer' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const meta = { issuer: base, authorization_endpoint: base + '/a', token_endpoint: base + '/t', jwks_uri: base + '/j' };
  if (methods) meta.token_endpoint_auth_methods_supported = methods;
  const client = new (new Issuer(meta).Client)({ client_id: 'cid', client_secret: 'sec', redirect_uris: [base + '/cb'], response_types: ['code'] });
  await client.grant({ grant_type: 'client_credentials' });
  server.close();
  console.log(JSON.stringify(methods), '->', seen.authorization ? 'Authorization header (basic)' : 'form body: ' + seen.body);
};
(async () => {
  await run(undefined);
  await run(['client_secret_basic']);
  await run(['client_secret_post']);
  await run(['client_secret_basic', 'client_secret_post']);
  await run(['private_key_jwt']);
})();
