function handler(event) {
  var request = event.request;
  // Match /realtime/<domain> or /graphql/<domain>; rewrite to /graphql.
  // <domain> is captured but not used — kept for future per-domain routing.
  // Bare /graphql (no <domain>) is intentionally NOT matched, so this function
  // is idempotent on already-rewritten URIs.
  var match = request.uri.match(/^\/(?:realtime|graphql)\/([^/]+)\/?$/);
  if (match) {
    request.uri = '/graphql';
  }
  return request;
}
