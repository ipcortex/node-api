const fs = require('fs');
const vm = require('vm');

const XMLHttpRequest = require('xmlhttprequest-cookie').XMLHttpRequest;
const WebSocket = require('websocket').w3cwebsocket;

var apiFile	= __dirname + '/api.js';

module.exports = (function() {
	const context = {
		XMLHttpRequest,
		WebSocket,
		setInterval,
		setTimeout,
		clearTimeout,
		clearInterval,
		console
	};
	if(!fs.existsSync(apiFile)) {
		if(!fs.existsSync(__dirname + '/../../api.js')) {
			throw new Error('api.js does not exist! (Have you downloaded it using updateAPI.js?)');
		}
		else {
			apiFile = __dirname + '/../../api.js';
		}
	}
	const api = fs.readFileSync(apiFile, 'utf8');
	const script = new vm.Script(api);
	vm.createContext(context);
	script.runInContext(context);
	const IPCortex = context.IPCortex;
	IPCortex.PBX.httpStopReuse();
	return IPCortex;
}());
