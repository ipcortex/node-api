var request = require('request');
var fs = require('fs');

/**
 * Gets api.js from a remote PABX.
 * @param host The hostname of the PABX, including the protocol. (e.g. https://pabx/)
 * @param [callback]
 */
function getAPI(host, callback) {
	request.get(host + '/api/api.js', function (err, res, body) {
		if (err) {
			//console.error('Failed to get api.js!');
			//console.error('Request error:', err);
			if(typeof callback == 'function') {
				callback(err);
			}
			return;
		}
		try {
			fs.writeFileSync(__dirname + '/lib/api.js', body);
			//console.log('Successfully written api.js');
			if(typeof callback == 'function') {
				callback(null);
			}
		}
		catch (e) {
			//console.error('Failed to write api.js!');
			//console.error('FS error:', e);
			if(typeof callback == 'function') {
				callback(e);
			}
		}
	});
}

if(module.parent) {
	module.exports = getAPI;
}
else {
	var host = process.argv[2];
	if(!host) {
		console.log('Usage: updateAPI.js HOST');
		process.exit(1);
	}
	console.log('Getting api.js from ' + host);
	getAPI(host, function(err){
		if(err) {
			console.error('Error occured loading api.js!');
			return;
		}
		console.log('Successfully written api.js');
	});
}
