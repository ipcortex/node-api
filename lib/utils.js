//
// (c) 2005-2014 IP Cortex Ltd.
// All rights reserved.  Unauthorised copying is not permitted.
//

var Request		= require('request');
var HTTPAgent	= require('agentkeepalive');
var HTTPSAgent	= require('agentkeepalive').HttpsAgent;
//var agent = new Agent();

module.exports		= (function(){

	var cookieJar	= Request.jar();

	var agent	= new HTTPAgent({
		keepAliveMsecs:		30000
	});

	var sAgent	= new HTTPSAgent({
		keepAliveMsecs:		30000
	});

	var request		= Request.defaults({
		jar: cookieJar,
		rejectUnauthorized: false,
		agent: agent
	});

	var HTTPSRequest	= Request.defaults({
		jar: cookieJar,
		rejectUnauthorized: false,
		agent: sAgent
	});

	var util		= {};

	util.httpPost = function(url, params, callback, useGet) {
		var requester = (url.substr(0, 5) == 'https') ? HTTPSRequest : request;
		var resCallback = function(err, httpRes, body) {
			if(err) {
				console.log('httpPost error:', err);
				console.trace(err);
			}
			if (typeof(callback) == 'function' ) {
				process.nextTick(function() {
					callback(body);
				});
			}
		};
		if( ! useGet ) {
			return requester.post({ url: url, form: params }, resCallback);
		} else {
			return requester.get(url + '?' + params, resCallback);
		}
	};

	util.waitForHttpPost = function(time, callback) {
		/*var _start = (new Date()).getTime();
		function check() {
			var _count = 0;
			for ( var p = 0; p < 10 ; p++ )
				if ( _xmlHttp[p].readyState < 1 || _xmlHttp[p].readyState == 4 )
					_count++;
			if ( _count == 10 )
				callback(true);
			else if( (new Date()).getTime() - _start > (time || 5) * 1000 )
				callback(false);
			else
				setTimeout(check, 500);
		}
		check();*/
		console.error('*** WAITING FOR HTTP POST ***');
	};

	util.isEmpty = function(obj) {
		if ( obj == null )
			return true;
		if ( typeof(obj) == 'number' )
			return false;
		else if ( typeof(obj) == 'string' ) {
			if ( obj != '' )
				return false;
		} else if ( obj instanceof Array ) {
			if ( obj.length > 0 )
				return false;
		} else if ( typeof(obj) == 'object' ) {
			for ( var prop in obj ) {
				if ( obj.hasOwnProperty(prop) )
					return false;
			}
		}
		return true;
	};

	util.doDecodeState = function(s) {
		if ( s && s.length ) {
			return (decodeURIComponent(s));
		}
		return s;
	};

	util.isEmail = function(value) {
		return ( value.search(/^[a-zA-Z0-9!#\$%&'\*\+\-_`\{\}\|~\.]+@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)+$/) != -1 );
	};

	util.serialise = function(obj) {
		var hexDigits = '0123456789ABCDEF';
		function toHex(d) {
			return hexDigits[d >> 8] + hexDigits[d & 0x0F];
		}
		function toEscape(string) {
			return string.replace(/[\x00-\x1F'\\]/g,
				function (x) {
					if (x == "'" || x == '\\') return '\\' + x;
					return '\\x' + toHex(x.charCodeAt(0));
				})
		}
		return getObject(obj).replace(/,$/, '');
		function getObject(obj) {
			if ( typeof obj == 'string' ) {
				return "'" + toEscape(obj) + "',";
			}
			if ( obj instanceof Array ) {
				result = '[';
				for ( var i = 0; i < obj.length; i++ ) {
					result += getObject(obj[i]);
				}
				result = result.replace(/,$/, '') + '],';
				return result;
			}
			var result = '';
			if ( typeof obj == 'object' ) {
				result += '{';
				for ( var property in obj ) {
					result += "'" + toEscape(property) + "':" + getObject(obj[property]);
				}
				result += '},';
			} else {
				result += obj + ',';
			}
			return result.replace(/,(\n?\s*)([\]}])/g, "$1$2");
		}
	};

	util.doClone = function(from, to) {
		for ( var i in from ) {
			if ( typeof(from[i]) == 'object' ) {
				if ( from[i].constructor == Array )
					to[i] = [];
				else
					to[i] = {};
				util.doClone(from[i], to[i]);
			} else
				to[i] = from[i];
		}
	};

	util.isInArray = function(list, item) {
		if ( ! (list instanceof Array) )
			return false;
		var i = list.length;
		if ( typeof item == 'object' ) {
			while ( i-- ) {
				if ( list[i] === item )
					return true;
			}
		} else {
			while ( i-- ) {
				if ( list[i] == item )
					return true;
			}
		}
		return false;
	};

	util.extractNumber = function(value) {
		var n = parseInt(value);
		return n == null || isNaN(n) ? 0 : n;
	};

	util.formatTime = function(secs) {
		function twoDigits(n) {
			if ( n < 10 )
				return '0' + n;
			return n;
		}
		if ( secs < 3600 )
			return twoDigits(Math.floor((secs % 3600) / 60)) + ':' + twoDigits((secs % 60));
		else
			return twoDigits(Math.floor(secs / 3600)) + ':' + twoDigits(Math.floor((secs % 3600) / 60));
	};

	util.isArray = function(arr) {
		if(!Array.isArray) {
			return (arr instanceof Array); // Works in most, but not all, scenarios
		}
		return Array.isArray(arr);
	};

	/**
	 * This object is used to serialize requests to tmpld.pl.
	 */
	util.XHR = (function() {
		// Globals
		var _res_lock = 0;
		var _results = [];

		return {
			results:		_results,
			xmlHttpReady:	function() {
				if( _res_lock ) {
					console.log('Resource locked!');
					return;
				}
				_res_lock++;
				while ( _results.length ) {
					var r = _results.shift();
					this.xmlHttpRun(r);
				}
				_res_lock--;
			},
			ready:			this.xmlHttpReady
		};
	})();

	return util;

})();
