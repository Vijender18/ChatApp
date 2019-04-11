var WebSocketServer = require('ws').Server;
var wss = new WebSocketServer({host: '0.0.0.0', port: 8082});
module.exports = wss;