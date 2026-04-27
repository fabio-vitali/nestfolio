function handler(event) {
  var request = event.request;
  // Strip /mfe/<key> prefix so S3 sees the actual object key.
  // /mfe/investor/remoteEntry.json → /remoteEntry.json
  // /mfe/dashboard/chunk-X.js     → /chunk-X.js
  // Bare /mfe/<key>                → /
  request.uri = request.uri.replace(/^\/mfe\/[^/]+/, '');
  if (request.uri === '') {
    request.uri = '/';
  }
  return request;
}
