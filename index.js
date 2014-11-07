var fs = require('fs');
var vm = require('vm');
var nodeUtil = require('util');

var self = this;

var Class	= require('./lib/class.js');
var Utils	= require('./lib/utils.js');

var apiFile	= __dirname + '/lib/api.js';

/**
 * This wraps api.js so it's compatible with the node environment. You should be able to use the api.js from your PABX's
 * software version.
 * @param locationHost {string}
 * @param locationProto {string}
 * @returns {IPCortex}
 */
module.exports = function(locationHost, locationProto) {
	var location = {
		protocol: locationProto + ':',
		host: locationHost
	};
	if(!fs.existsSync(apiFile)) {
		throw new Error('api.js does not exist! (Have you downloaded it using updateAPI.js?)');
	}
	var IPCortex = {};
	IPCortex.Utils = Utils;
	IPCortex.XHR = Utils.XHR;
	var contextVars = nodeUtil._extend(GLOBAL, {
		location:	location,
		Class:		Class,
		Utils:		Utils,
		console:	console,
		IPCortex:	IPCortex
	});
	var context = vm.createContext(contextVars);
	var api = fs.readFileSync(apiFile, 'utf8');
	vm.runInContext(api, context, apiFile);
	IPCortex.PBX.Auth.setHost(locationHost);
	return IPCortex;
};