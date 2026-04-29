function handler(event) {
  var request = event.request;
  // The AppSync native realtime API host accepts arbitrary URIs on WSS
  // upgrade — the API ID is encoded in the Host header. Forward
  // `/realtime/*` paths unchanged. (Spike kept for reference parity.)
  return request;
}
