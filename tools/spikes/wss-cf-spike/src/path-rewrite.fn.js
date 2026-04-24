function handler(event) {
  var request = event.request;
  // Match /realtime/<domain>; rewrite to /graphql.
  // <domain> is captured but not currently used — kept for future per-domain routing.
  var match = request.uri.match(/^\/realtime\/([^/]+)\/?$/);
  if (match) {
    request.uri = '/graphql';
  }
  return request;
}
