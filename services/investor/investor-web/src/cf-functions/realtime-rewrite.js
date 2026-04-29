function handler(event) {
  var request = event.request;
  // HTTP queries/mutations hit `/graphql/<domain>` — strip the domain segment
  // so the AppSync API host receives `/graphql`. <domain> is captured but
  // not used (kept for future per-domain routing). Bare `/graphql` is not
  // matched, so this function is idempotent on already-rewritten URIs.
  //
  // WSS subscriptions are NOT handled by CloudFront: the browser connects
  // direct to AppSync because aws-appsync-subscription-link includes the
  // URL host in the connection_init auth payload, and AppSync rejects any
  // host that does not map to one of its APIs. See service.stack.ts for
  // the full rationale.
  var m = request.uri.match(/^\/graphql\/([^/]+)\/?$/);
  if (m) {
    request.uri = '/graphql';
  }
  return request;
}
