// CloudFront Function (viewer-request). Rewrites any request under
// /api/copilotkit* to the AgentCore runtime invocation path. The literal
// string `__RUNTIME_ARN__` is substituted at deploy time via `Fn.sub` in
// services/investor/investor-web/src/service.stack.ts.
function handler(event) {
  var req = event.request;
  req.uri = '/runtimes/' + encodeURIComponent('__RUNTIME_ARN__') + '/invocations';
  req.querystring = { qualifier: { value: 'DEFAULT' } };
  return req;
}
