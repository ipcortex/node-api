var fs = require('fs');
var vm = require('vm');

var _global = global || GLOBAL;
_global.XMLHttpRequest = require('xmlhttprequest-cookie').XMLHttpRequest;
_global.Promise = require('es6-promise-polyfill').Promise;
_global.WebSocket = require('websocket').w3cwebsocket;

var apiFile	= __dirname + '/api.js';

module.exports = (function() {
	if(!fs.existsSync(apiFile)) {
		if(!fs.existsSync(__dirname + '/../../api.js')) {
			throw new Error('api.js does not exist! (Have you downloaded it using updateAPI.js?)');
		}
		else {
			apiFile = __dirname + '/../../api.js';
		}
	}
	var api = fs.readFileSync(apiFile, 'utf8');
	vm.runInThisContext(api, { filename: apiFile });
	IPCortex.PBX.httpStopReuse();
	return IPCortex;
}());
