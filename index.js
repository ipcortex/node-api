var fs = require('fs');
var vm = require('vm');

GLOBAL.XMLHttpRequest = require('xmlhttprequest-cookie').XMLHttpRequest;
GLOBAL.Promise = require('es6-promise-polyfill').Promise;
GLOBAL.WebSocket = require('websocket').w3cwebsocket;

var apiFile	= __dirname + '/lib/api.js';

module.exports = (function() {
	if(!fs.existsSync(apiFile)) {
		if(!fs.existsSync(__dirname + '/../../lib/api.js')) {
			throw new Error('api.js does not exist! (Have you downloaded it using updateAPI.js?)');
		}
		else {
			apiFile = __dirname + '/../../lib/api.js';
		}
	}
	var api = fs.readFileSync(apiFile, 'utf8');
	vm.runInThisContext(api, { filename: apiFile });
	IPCortex.PBX.httpStopReuse();
	return IPCortex;
}());
