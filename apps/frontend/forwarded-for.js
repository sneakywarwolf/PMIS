// Preloaded into the production Next server (NODE_OPTIONS=--require). Next's /api proxy forwards the browser's own
// X-Forwarded-For untouched and adds none, so without this the backend could not tell a real client address from a forged
// one. Like any proxy, append the address of the TCP peer that actually connected; the backend (TRUST_PROXY_HOPS) then
// reads the client address from the right-hand end of the chain, where only trusted hops write.
const http = require('http');
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req) {
  if (event === 'request' && req && req.socket && req.socket.remoteAddress) {
    const peer = req.socket.remoteAddress;
    const prev = req.headers['x-forwarded-for'];
    req.headers['x-forwarded-for'] = prev ? `${prev}, ${peer}` : peer;
  }
  return emit.apply(this, arguments);
};
