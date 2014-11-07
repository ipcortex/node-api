/*
 * @copyright  (c) 2005-2014 IP Cortex Ltd. All rights reserved. Unauthorised copying is not permitted.
 */

/**
 * @fileOverview Interface to IPCortex PABX
 */

/**
 * @namespace Callback
 * @description Container for all callbacks - These are implemented by the front-end app., so are purely documentation.
 */
/** @namespace IPCortex.PBX */
var IPCortex = IPCortex || {};
IPCortex.XHR = IPCortex.XHR || {};
IPCortex.PBX = (function() {
	var gHid = 1;
	var mbFreq = 0;
	var errorCB = null;
	var intervalID = null;
	var mediaStream = null;
	var startPollCalled = null;
	var handles = {};
	var cidToExt = {};
	var devToCid = {};
	var devToExt = {};
	var extToDev = {};
	var extByExt = {};
	var macToPhn = {};
	var devToMac = {};
	var loadCache = {};
	var hidStruct = {};
	var webrtcPass = {};
	var deviceHooks = {};

	var live = {
		hdCID:		null,
		origSID:	'',
		md5Hash:	{},
		extToCid:	{},
		extToDDI:	{},
		origURI:	location.protocol == 'https:' ? 'https://' : 'http://',
		origHost:	location.host,
		origHostPort:	location.host,
		scriptPort:	location.protocol == 'https:' ? '84' : '82',
		userData:	{},
		cidToUsr:	{},
		cidToPhn:	{},
		xmppRoster:	{},
		addressBook:	{},
		hotdesk_owner:	{},
		hotdesked_to:	{}
	};

	var flags = {
			loading:	true,
			parsing:	{livefeed: false, lines: false, address: false, roster: false},
			initialHD:	false
	};

	var counters = {
			hdSequence:	null,
			xmppSequence:	null
	};

	var callbacks = {};

	var lookUp = {
			hid:		{},
			dev:		{},
			que:		{},
			mbx:		{},
			cnt:		{},
			xmpp:		{},
			room:		{},
			addr:		{},
			qcall:		{}
	};

	var aF = {
			max:		0,
			maxMb:		0,
			count:		0,
			inuse:		0,
			fail:		0,
			queue:		[]
	};

	var cH = {
			count:		0,
			enabled:	0,
			initial:	0,
			xmpp:		null,
			roomCB: 	null,
			presenceCB:	null,
			online:		null,
			newOnline:	null,
			rooms:		[],
			seen:		{}
	};

	var hI = {
			enabled:	0,
			timeout:	null,
			saved:		(new Date()).getTime(),
			updated:	(new Date()).getTime(),
			cb:		null,
			cache:		{},
			history:	[]
	};

	var specialFeatures = {
			handlers:	{},
			callbacks:	{},
			transports:	{}
	};

	var translate = [
		{a:	'stamp',	s:	'sp'},
		{a:	'start',	s:	'st'},
		{a:	'end',		s:	'ed'},
		{a:	'party',	s:	'pt'},
		{a:	'id',		s:	'id'},
		{a:	'info',		s:	'if'},
		{a:	'note',		s:	'no'},
		{a:	'number',	s:	'nr'},
		{a:	'extension',	s:	'ex'},
		{a:	'extname',	s:	'en'},
		{a:	'name',		s:	'ne'},
		{a:	'device',	s:	'dv'},
		{a:	'inq',		s:	'iq'},
		{a:	'outq',		s:	'oq'},
		{a:	'devname',	s:	'dn'}
	];

	if ( typeof navigator != 'undefined' ) {
		if ( navigator.mozGetUserMedia )
			mediaStream = MediaStream || LocalMediaStream;
		else if ( navigator.webkitGetUserMedia )
			mediaStream = webkitMediaStream;
	}

	if ( ! Array.isArray ) {
		Array.isArray = function(a) { return (a instanceof Array); };
	}

	var Utils = {};
	for ( var x in IPCortex.Utils ) {
		Utils[x] = IPCortex.Utils[x];
	}

	/** 
	 * Periodically polled at 1000ms to fetch data from tmpld.pl 
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function checkInterval() {
		if ( aF.fail > 20 || aF.inuse < 0 ) {
			aF.inuse = 0;
			aF.queue = [];
		}
		if ( aF.inuse > 0 ) {
			aF.fail++;
			return;
		}
		aF.fail = 0;

		/* Poll for the regular user data */
		scriptAf(live.origURI + live.origHost + ':' + live.scriptPort + '/' + ((new Date()).getTime()) + '/?maxdata=' + aF.max +
				'&alldata=14' +
				'&searchq=1' +
				'&searchmb=0' +
				'&finish=2' +
				'&chat=' + cH.enabled +
				(flags.initialHD ? '&initial=1' : ''));

		/* After a hotdesk event we need to grab a load of additional device data */
		while ( Array.isArray(flags.refreshData) && flags.refreshData.length > 0 ) {
			var _getlist = flags.refreshData.slice(0, 5);
			flags.refreshData = flags.refreshData.slice(5);
			scriptAf(live.origURI + live.origHost + ':' + live.scriptPort + '/' + ((new Date()).getTime()) + '/?devlist=' + (_getlist.join(',')) +
				'&maxdata=0' +
				'&alldata=14' +
				'&searchq=0' +
				'&searchmb=0');
		}
 
		if( mbFreq > 4 ) {
			var _mbList = [];
			for ( var x in lookUp.mbx )
				_mbList.push(x);
			scriptAf(live.origURI + live.origHost + ':' + live.scriptPort + '/' + ((new Date()).getTime()) + '/?maxdata=' + aF.maxMb +
					'&devlist=' + _mbList.join(',') +
					'&alldata=0' +
					'&searchq=0' +
					'&searchdev=0' +
					'&searchmb=1' +
					'&finish=0');
			mbFreq = 0;
		}
		mbFreq++;

		/* If history is enabled, auto-save every 15 minutes */
		if ( hI.enabled && ((new Date()).getTime() - hI.saved) > 900000 )
			saveHistory();
	}

	/**
	 * Add a URL to the queue of tmpld.pl requests to make.
	 * @param {String} scurl Full URL to add.
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function scriptAf(scurl) {
		if ( ! Utils.isEmpty(scurl) )
			aF.queue.push(scurl);
		if ( aF.inuse > 0 || aF.queue.length <= 0 )
			return;
		scurl = aF.queue.shift();

		function callback(res) {
			IPCortex.XHR.results.push(res);
			IPCortex.XHR.xmlHttpReady();
			scriptAf();
		}

		Utils.httpPost(scurl.split('?')[0], scurl.split('?')[1], callback);

		aF.inuse++;
		aF.count++;
	}

	/**
	 * Receive and parse a line of data from tmpld.pl - Phone related
	 * @param {Object} response A javascript Object to be parsed
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function parseAf(response) {
		for ( var _key in response ) {
			if ( _key.search(/^\d+@/) != -1 ) {
				if ( ! lookUp.mbx[_key] )
					lookUp.mbx[_key] = mailbox.create(_key);
				lookUp.mbx[_key].update(response[_key]);
/* TODO work out how to expire old mailboxes */
			} else if ( _key.search(/^Queue\/q_.+$/) != -1 ) {
				if ( ! lookUp.que[_key] )
					lookUp.que[_key] = queue.create(_key);
				lookUp.que[_key].update(response[_key]);
			} else if ( _key == 'Queue/default' ) {
				/* No-Op we really do want to ignore this */
			} else if ( _key.search(/^Custom\//) == -1 ) {
				if ( ! lookUp.dev[_key] )
					lookUp.dev[_key] = device.create(_key);
				lookUp.dev[_key].status(_key, response[_key]);
				if ( response[_key].device ) {
					if ( response[_key].device.calls )
						lookUp.dev[_key].update(response[_key].device.calls);
					if ( response[_key].device.mailbox ) {
						var _mbx = response[_key].device.mailbox;
						if ( _mbx.search(/^\d+@/) != -1 && ! lookUp.mbx[_mbx] )
							lookUp.mbx[_mbx] = mailbox.create(_mbx);
					}
				}
				deviceHooks[_key] = lookUp.dev[_key];
				/* If hotdesked on, trigger either the hotdesker's phone, or contact as appropriate */
				if ( live.hotdesked_to[_key] ) {
					if ( lookUp.dev[live.hotdesked_to[_key]] )
						deviceHooks[live.hotdesked_to[_key]] = lookUp.dev[live.hotdesked_to[_key]];
					else if ( live.hotdesked_to[_key].substr(0,8) == 'Hotdesk/' ) {
						var _cid = live.hotdesked_to[_key].substr(8);
						if ( lookUp.cnt[_cid] )
							deviceHooks[live.hotdesked_to[_key]] = lookUp.cnt[_cid];
					}
				}
			} else if ( _key.search(/^Custom\/\d+$/) != -1 || _key.search(/^Custom\/.+@.+$/) != -1 ) {
				if ( ! lookUp.xmpp[_key] ) {
					lookUp.xmpp[_key] = xmpp.create(_key);
					if ( live.userData.id && _key == 'Custom/' + live.userData.id )
						cH.xmpp = lookUp.xmpp[_key];
				}
				if ( response[_key].customData && response[_key].customData.eXxmpp )
					lookUp.xmpp[_key].status(response[_key].customData.eXxmpp, response[_key].customData.xmpp);
				else
					lookUp.xmpp[_key].status();
				deviceHooks[_key] = lookUp.xmpp[_key];
//			} else if ( ! response[_key].blf && _key.search(/^Custom\//) == -1 ) {
//				if ( response[_key].company && response[_key].company == live.userData.home )
//					console.log('Error dropped parseAf for ' + _key + ' (no BLF) but its in our company ' + response[_key].company + ' != ' + live.userData.home);
			} else
				console.log('Error dropped parseAf for ' + _key);

			if ( _key.search(/^\d+@/) != -1 && response[_key].sequence > aF.maxMb )
				aF.maxMb = response[_key].sequence;
			else if ( response[_key].sequence > aF.max )
				aF.max = response[_key].sequence;
		}
	}

	/**
	 * Receive and parse a line of data from tmpld.pl - Chat related
	 * @param {Object} response A javascript Object to be parsed
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function parseCh(response) {
		if ( ! cH.enabled )	/* Should never happen, but... */
			return;
		cH.count = 0;
		var _time = Math.floor(new Date().getTime() / 1000);
		RESPONSE:
		for ( var _room in response ) {
			var _linkNo = 0; 
			var _linkID = null;
			var _online = false;
			var _linked = response[_room].linked;
			var _joined = response[_room].joined;
			if ( _joined.length == 0 && (! cH.initial || _linked.length < 2) )
				continue;
			cH.seen[_room] = true;
			if ( response[_room].roomName.search(/_\d+_/) != -1 ) {
				if ( _joined.length == 1 && _joined[0] == live.userData.id ) {
					_online = true;
					_linkID = live.userData.id;
				} else
					continue;
			} else {
				var _rName = response[_room].roomName.split('|');
				if ( _rName[_linkNo] == live.userData.id )
					_linkNo = 2;
				_linkID = _rName[_linkNo];
				for ( var i = 0; i < _joined.length; i++ ) {
					if ( live.userData.id != _joined[i] )
						continue;
					if ( _rName[(_linkNo == 0 ? 3 : 1)] == '' )
						break;
					// Joined with non OCM resource.
					if ( _rName[(_linkNo == 0 ? 3 : 1)] != ('ocm' + live.userData.id) ) {
						if ( lookUp.room[_room] ) {
							lookUp.room[_room].set('state', 'dead');
							lookUp.room[_room].run();
						}
						continue RESPONSE;
					}
					break;
				}
			}
			if ( ! _linkID )
				continue;
			if ( ! lookUp.room[_room] )
				lookUp.room[_room] = room.create(_linkID, _room);
			lookUp.room[_room].set(null, {roomName: response[_room].roomName, update: _time, linked: _linked, joined: _joined});
			if ( response[_room].key )
				lookUp.room[_room].set('key', response[_room].key);
			else
				lookUp.room[_room].set('key', null);
			if ( _online )
				cH.newOnline = lookUp.room[_room];
			if ( ! response[_room].poll )
				continue;
			var _msgInfo = null;
			try {
				_msgInfo = eval(response[_room].poll);
			} catch(e) {
				continue;
			}
			if ( typeof(_msgInfo) != 'object' || ! (Array.isArray(_msgInfo.messages)) )
				continue;
			var _msgs = _msgInfo.messages;
			_msgs.sort(function(a, b) { return (a.msgID > b.msgID) ? 1 : ( a.msgID < b.msgID ? -1 : 0 ); });
			for ( var i = 0; i < _msgs.length; i++ )
				lookUp.room[_room].push({
					cID:	_msgs[i].cID,
					cN:	_msgs[i].cN,
					msg:	decodeURIComponent(_msgs[i].msg),
					msgID:	_msgs[i].msgID,
					time:	_msgs[i].time
				});
		}
	}

	/**
	 * Receive and parse a line of data from tmpld.pl - Mostly hotdesking related
	 * @param {Object} response A javascript Object to be parsed
	 * @param {Number} sequence Sequence number that indicates when HD changes have occurred
	 * @param {String} xmpp_seq Sequence id that indicates when XMPP changes have occurred
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function parseHd(response, sequence, xmpp_seq) {
		if ( sequence != null && (counters.hdSequence == null || sequence > counters.hdSequence) ) {
			flags.initialHD = true;
			if ( counters.hdSequence != null ) {
				refreshLines();		/* Only need to refresh usrToPhn, and when done, re-call getLines callback !!! */
			}
			counters.hdSequence = sequence;
		}
		if ( xmpp_seq && counters.xmppSequence != xmpp_seq ) {
			counters.xmppSequence = xmpp_seq;
			function check() {
				if ( flags.parsing.roster ) {
					setTimeout(check, 250)
					return;
				}
				return _addressReady(); /* Push roster changes withour reloading addresses or users. */
			}
			if ( ! flags.parsing.roster ) {
				getRoster();
			}
			check();
		}
		if ( response == null )
			return;
		flags.initialHD = false;

		/* Cause all hotdesk devices to be updated. Just in case. */
		for ( var x in live.hotdesk_owner )
			deviceHooks[x] = lookUp.dev[x];
		for ( var x in live.hotdesked_to )
			deviceHooks[x] = lookUp.dev[x];

		/* Record all of the new HD response data */
		var _last_hotdesk_owner = live.hotdesk_owner;
		var _last_hotdesk_to = live.hotdesked_to;
		var _want_data = {};
		live.hotdesk_owner = {};
		live.hotdesked_to = {};
		for ( var x in response ) {
			if ( _last_hotdesk_owner[x] == null || _last_hotdesk_owner[x] != response[x] )		// New entry, or changed... add it
				_want_data[x] = true;
			if ( _last_hotdesk_to[response[x]] == null || _last_hotdesk_to[response[x]] != x )	// New entry, or changed... add it
				_want_data[response[x]] = true;

			live.hotdesk_owner[x] = response[x];
			live.hotdesked_to[response[x]] = x;
		}
		_last_hotdesk_owner = _last_hotdesk_to = null;

		/* All of the changes to HD since the last update need a maxdata = 0 fetch */
		if ( ! (Array.isArray(flags.refreshData)) )
			flags.refreshData = [];
		for ( var x in _want_data )
			flags.refreshData.push(x);
	}

	/**
	 * Receive and parse a line of data from tmpld.pl - Indicates end of a response
	 * @param {Number} [code] Returns the code number from the original request
	 * @param {Number} [connection] True (1) if this is a new connection/thread in tmpld.pl
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function finishAf(code, connection) {
		aF.inuse--;
		var _chatHooks = {};
		if ( flags.loading && code == 2 )
			flags.loading = false;
		for ( var k in deviceHooks ) {
			var _device = deviceHooks[k];
			delete deviceHooks[k];
			if ( _device == null )
				continue;
			if ( _device instanceof contact && typeof(_device.update) == 'function' )
				_device.update();
			if ( typeof(_device.run) == 'function' )
				_device.run();
			var _calls = _device.get('calls');
			for ( var _call in _calls ) {
				var _tmp = _calls[_call];
				if ( _tmp.get('state') == 'dead' )
					_tmp.get('device').remove(_tmp);
			}
		}
		if ( code == 2 && cH.enabled ) {
			/* Rooms we got an update for */
			for ( var _room in lookUp.room ) {
				if ( lookUp.room[_room].update() )
					_chatHooks[_room] = true;
			}
			if ( ! cH.count ) {
				cH.online = cH.newOnline;
				cH.newOnline = null;
			}
			/* Rooms that we got NO update for but should have??? */
			var _oId = 0;
			if ( cH.online && cH.online.attr && cH.online.attr.id )
				_oId = cH.online.attr.roomID;
			if ( cH.seen[_oId] ) {
				cH.initial = 0;
				for ( var _room in lookUp.room ) {
					if( _oId == _room )
						continue;
					if ( !cH.seen[_room] && document.cookie.indexOf("tmpld_chat_" + _room + "=") != -1 ) {
						lookUp.room[_room].set('state', 'dead');
						_chatHooks[_room] = true;
					}
				}
			}
			for ( var x in _chatHooks ) {
				var _room = lookUp.room[x];
				if ( typeof(_room.run) == 'function' )
					_room.run();
			}
			if ( ! _oId || ! cH.seen[_oId] ) { /* Chat enabled but no online room */
				/* Go online - someone probably killed our room */
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm',
									'cmd=create&type=room' +
									'&name=_' + live.userData.id + '_' +
									'&id=' + live.userData.id + 
									'&autoclean=5');
			}
			if ( cH.count > 9 ) {
				cH.count = 0;
				cH.online = null;
				cH.newOnline = null;
			}
			cH.count++;
		}
		cH.seen = {};
	}

	/**
	 * Receive and parse a line of data from tmpld.pl - Indicates an error condition.
	 *       1 - Template error. Just keep trying?
	 *       2 - Auth error. Drop to login screen?
	 *       3 - Asterix is reconnecting. Keep trying.
	 * @param {Number} code The error number
	 * @param {String} text Text describing the error
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function tmplErr(code, text) {
		aF.inuse--;
		clearInterval(intervalID);
		intervalID = null;
		if ( typeof errorCB == 'function' )
			errorCB(code, text);
	}

	/**
	 * Get client clock time drift.
	 * @return {Object} An object containing clientTime, serverTime and driftTime in seconds.
	 * @memberOf IPCortex.PBX
	 */
	function getTimeDelta(cb) {
		Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=gettime', parseTime);
		function parseTime(xml) {
			var now = (new Date()).getTime() / 1000;
			if ( xml.search(/success/) == -1 )
				server = now;
			else {
				xml = xml.split('\n')[1];
				server = xml.replace(/^.*time="(.*?)".*$/m, "$1");
			}
			cb({clientTime: now, serverTime: server, driftTime: Math.round((now - server) * 1000) / 1000});
		}
	}


	/**
	 * Request that any 'maxdata' state is cleared. This causes state for all devices to be updated.
	 * Do NOT use this function lightly as it will add significant load to the PABX.
	 * @memberOf IPCortex.PBX
	 */
	function clearMaxData() {
		/* TODO: Restrict to max once per minute call */
		aF.cleared = aF.cleared || 0;
		if ( ((new Date()).getTime() - aF.cleared) < 60000 )	/* High load operation. allowed every 60 seconds max */
			return false;
		aF.cleared = (new Date()).getTime();

		aF.max = 0;
		aF.maxMb = 0;
		for ( var _room in lookUp.room )
			lookUp.room[_room].clear();
	}

	/**
	 * Parse and act on a response from a call to api.whtm, making response data available.
	 * @param script A javascript Object to be parsed
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function parseAPI(script) {
		var _tmp = {};
		var _newData = {};
		var _order = ['livefeed', 'lines', 'users', 'address', 'roster'];
		var _check = {
				livefeed: {
					list: {
						origSID:  function(x) { if ( typeof(x) == 'string' ) { _newData.origSID = x; return true; } return false; },
						origHost: function(x) { if ( typeof(x) == 'string' ) { _newData.origHost = x; return true; } return false; },
						userData: function(x) { if ( typeof(x) == 'object' ) { _newData.userData = x; return true; } return false; },
						cidToUsr: function(x) { if ( typeof(x) == 'object' ) { _newData.cidToUsr = x; return true; } return false; },
						cidToPhn: function(x) { if ( typeof(x) == 'object' ) { _newData.cidToPhn = x; return true; } return false; },
						companies:function(x) { if ( typeof(x) == 'object' ) { _newData.companies = x; return true; } return false; },
						extToCid: function(x) { if ( typeof(x) == 'object' ) { _newData.extToCid = x; return true; } return false; },
						extToDDI: function(x) { if ( typeof(x) == 'object' ) { _newData.extToDDI = x; return true; } return false; },
						adminID:  function(x) { if ( typeof(x) == 'number' ) { _newData.adminID = x; return true; } return false; },
						hdCID:    function(x) { if ( typeof(x) == 'string' ) { _newData.hdCID = x; return true; } return false; }
					},
					pass: false,
					run: feedMangle
				},
				lines: {
					list: {
						cidToPhn: function(x) { if ( typeof(x) == 'object' ) { _newData.cidToPhn = x; return true; } return false; },
						companies:function(x) { if ( typeof(x) == 'object' ) { _newData.companies = x; return true; } return false; }
					},
					pass: false,
					run: feedMangle
				},
				users: {
					list: {
						cidToUsr: function(x) { if ( typeof(x) == 'object' ) { _newData.cidToUsr = x; return true; } return false; },
						companies:function(x) { if ( typeof(x) == 'object' ) { _newData.companies = x; return true; } return false; }
					},
					pass: false,
					run: feedMangle
				},
				address: {
					list: {
						addressBook: function(x) { if ( typeof(x) == 'object' ) { _newData.addressBook = x; return true; } return false; },
						md5Hash:     function(x) { if ( typeof(x) == 'object' ) { _newData.md5Hash = x; return true; } return false; }
					},
					pass: false
				},
				roster: {
					list: {
						xmppRoster: function(x) { if ( typeof(x) == 'object' ) { _newData.xmppRoster = x; return true; } return false; }
					},
					pass: false,
					run: parseRoster
				}
		};
		if ( (_tmp = script.match(/^<response result="fail" cmd="(.*?)" data="(.*?)"/)) != null ) {
			if ( _tmp[1] == 'refresh' && (_tmp[2] == 'livefeed' || _tmp[2] == 'roster') )
				flags.parsing[_tmp[2]] = false;
			return;
		} else {
			try {
				_tmp = eval(script);
			} catch(e) {
				flags.parsing = {}; /* NASTY! Hope this never happens! */
				return;
			}
		}
		ORDER:
		for ( var i = 0; i < _order.length; i++ ) {
/* Not currently used - dependency code.
			if ( Array.isArray(_check[_order[i]].required) ) {
				var _required = _check[_order[i]].required;
				for ( var x = 0; x < _required.length; x++ ) {
					if ( ! _check[_required[x]].pass )
						continue ORDER;
				}
			}
*/
			var _list = _check[_order[i]].list;
			/* First check we have everything... */
			for ( var _key in _list ) {
				if ( typeof(_list[_key]) != 'function' || ! _list[_key](_tmp[_key]) )
					continue ORDER;
			}
			/* ...then move it in */
			for ( var _key in _list ) {
				if ( _key == 'userData' ) {  /* Special case to retain permissions where appropriate */
					if ( live[_key].id == _newData[_key].id )
						_newData[_key].perms = live[_key].perms || {};
					else
						_newData[_key].perms = {};
				}
				live[_key] = _newData[_key];
				delete _newData[_key];
				delete _tmp[_key];	/* Don't process twice */
			}
			if ( typeof(_check[_order[i]].run) == 'function' )
				_check[_order[i]].run();
			_check[_order[i]].pass = true;
			flags.parsing[_order[i]] = false;
			if ( _order[i] == 'livefeed' && flags.loading && startPollCalled )
				initAPI();
		}
	}

	/**
	 * Make a request for PABX configuration data to prime the IPCortex.PBX internal data. startPoll() will
	 * normally be used to prime this data.
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function refreshAPI(startpoll) {
		if ( ! flags.parsing.livefeed ) {
			flags.parsing.livefeed = true;
			Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=refresh&data=livefeed', parseAPI);
		}
		if ( ! flags.parsing.roster ) {
			flags.parsing.roster = true;
			Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=refresh&data=roster', parseAPI);
		}
	}

	/**
	 * Make an refresh just a subset of the PABX configuration data to update displayed lines. This will
	 * normally occur automatically.
	 * @memberOf IPCortex.PBX
	 */
	function refreshLines() {
		if ( flags.parsing.lines || flags.parsing.livefeed || flags.loading )
			return;
		flags.parsing.lines = true;
		Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=refresh&data=lines', parseAPI);
	}

	/**
	 * startPoll callback for setup complete
	 * @callback Callback~startPollCB
	 */
	/**
	 * startPoll callback for error condition eg. logged out.
	 * @callback Callback~errorCB
	 * @param {Number} code A code number referencing the error type
	 * @param {String} message An error message
	 */
	/**
	 * Request to initialise the IPCortex.PBX - When complete polling routines are triggered for event updates.
	 * @param {Callback~startPollCB} [callback] Function to be called when initialisation is complete.
	 * @param {Callback~errorCB} [error] Function to be called If an error occurs.
	 * @memberOf IPCortex.PBX
	 */
	function startPoll(callback, error) { return checkReady(callback, error); }
	/** @private */
	function checkReady(callback, error) {
		refreshAPI();
		errorCB = error || errorCB;
		function ready() {
			if ( flags.loading ) {
				if ( startPollCalled )
					setTimeout(ready, 500)
				return;
			}
			if ( typeof(callback) == 'function' )
				callback();
		}
		if ( ! startPollCalled ) {
			startPollCalled = true;
			ready();
		}
	}
	/**
	 * Request to initialise the IPCortex.PBX - Does not start realtime polling as per startPoll().
	 * @param {Callback~startPollCB} [callback] Function to be called when initialisation is complete.
	 * @param {Callback~errorCB} [error] Function to be called If an error occurs.
	 * @memberOf IPCortex.PBX
	 */
	function fetchData(callback, error) {
		refreshAPI();
		errorCB = errorCB || error;
		function ready() {
			if ( flags.loading ) {
				setTimeout(ready, 500)
				return;
			}
			if ( typeof(callback) == 'function' )
				callback();
		}
		ready();
	}

	/**
	 * Polling will eventually stop with an error if the user logs out. This process actively requests that polling stops
	 * and attempts to release the HTTP connection resource.
	 * @memberOf IPCortex.PBX
	 */
	function stopPoll() {
		startPollCalled = null;
		aF.queue = [];
		clearInterval(intervalID);
		intervalID = null;

		function done() {
			aF.cleared = 0; /* Internal override of 60-second limit */
			clearMaxData();
			for ( var x in lookUp.xmpp ) {
				lookUp.xmpp[x].destroy();
				delete lookUp.xmpp[x];
			}
			for ( var x in lookUp.dev ) {
				lookUp.dev[x].destroy();
				delete lookUp.dev[x];
			}
			for ( var x in lookUp.que ) {
				lookUp.que[x].destroy();
				delete lookUp.que[x];
			}
			for ( var x in lookUp.qcall ) {
				lookUp.qcall[x].destroy();
				delete lookUp.qcall[x];
			}
			for ( var x in lookUp.mbx ) {
				lookUp.mbx[x].destroy();
				delete lookUp.mbx[x];
			}
			for ( var x in lookUp.cnt ) {
				lookUp.cnt[x].destroy();
				delete lookUp.cnt[x];
			}
			/* lookUp.room done in disableChat() */
			/* lookup.addr done in flushAddressbook() */
		}
		Utils.httpPost(live.origURI + live.origHost + ':' + live.scriptPort + '/' + ((new Date()).getTime()), 'closeconnection=1', done, true);
		flags.loading = true;
	}

	/**
	 * Build a device to extension map from loaded initial data in IPCortex.PBX.devToExt
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function deviceToExtension() {
		devToExt = {};
		function _allocPhones(_cid, _ext) {
			var _p = live.cidToPhn[_cid] || [];
			for ( var i = 0; i < _p.length; i++ ) {
				var _h = _p[i];
				var _owned = 0;
				if ( _h.o || _h.d == 'webrtc' + _cid ) _owned++;
				var _ox = (live.cidToUsr[_cid]||{}).x || (live.cidToUsr[_cid]||{}).extension;  /* Owned ext for _cid */
				if ( live.extToCid[_ox + '_' + live.userData.home] )
					_ox += '_' + live.userData.home;
				if ( live.cidToUsr[_cid] && _ox == _ext ) _owned++;
				var _c = live.extToCid[_ext] || {o: false, p: 19, t: '', x: false};

				var _prio = _c.p;
				/* Ext ring_type of A/H/Q treated normally */
				if ( _c.t.search(/[XIFCVPOo]/) != -1 )
					continue;
				if ( _c.t == 'T' )
					_prio = 19;
				if ( _h.l == 'hotdesk' )
					_prio = 39 + _owned;
				if ( _h.l == 'fork' || _h.l == 'deflect' )
					_prio = 19;
				/* Create a key that defines the sort order for allocation */
				_alloc.push({	key: _h.m + '' + _prio + _c.p + _ext + _owned,
					ext: _c,
					phn: _h,
					l: _h.l,
					o: _owned,
					x: _ox == _ext,
					c: _cid,
					p: _prio - 20 });
			}

		}

		/* Calculate order of allocation for all extensions */
		var _alloc = [];
		for ( var _ext in live.extToCid ) {
			var _l = live.extToCid[_ext].l;
			for ( var j = 0; j < _l.length; j++ ) {
				var _cid = _l[j].i;
				_allocPhones(_cid, _ext);
			}
		}
		if ( live.cidToPhn[0] )
			_allocPhones(0, 0);
		_alloc.sort(function(a, b) { return 'x'+a.key > 'x'+b.key ? 1 : ('x'+a.key < 'x'+b.key ? -1 : 0); });

		/* FIRST: Allocate extensions as if we have infinite numbers of lines. */
		var _d2e = {};
		var _allocDone = {};
		while ( _alloc.length ) {
			var _a = _alloc.shift();
			var _h = _a.phn.d;
			if ( _allocDone[_a.ext.e + ',' + _h] )
				continue;
			if ( _d2e[_h] == null )
				_d2e[_h] = [{p:_a.phn, l:[]}];

			if ( ! _a.c )		/* Orphan phones need no more processing */
				continue;

			if ( _a.o == 2 || _a.l == 'hotdesk' ) {		/* Items that get put onto line 1, owner/hotdesk */
				_d2e[_h][0].e = _a.ext.e;
				_d2e[_h][0].n = _a.ext.n;
				_d2e[_h][0].i = _a.l == 'hotdesk' ? 'H' : 1;
				_d2e[_h][0].l.unshift({	e: _a.ext.e,
					n: _a.ext.n,
					t: _a.ext.t,
					o: _a.x,
					p: _a.phn.o,
					l: _a.phn.l
				});
			} else if ( _a.p == -1 ) {			/* Items that just call line 1, fwd/deflect/unassigned */
				_d2e[_h][0].l.push({	e: _a.ext.e,
					n: _a.ext.n,
					t: _a.ext.t,
					o: _a.x,
					p: _a.phn.o,
					l: _a.phn.l
				});
			} else {					/* Other line users. */
				var _o = {	e: _a.ext.e,
						n: _a.ext.n,
						l: [{	e: _a.ext.e,
							n: _a.ext.n,
							t: _a.ext.t,
							o: _a.x,
							p: _a.phn.o,
							l: _a.phn.l
						}]
				};
				_d2e[_h].push(_o);
			}
			_allocDone[_a.ext.e + ',' + _h] = true;
		}
		for ( var _h in _d2e ) {
			/* SECOND: Shift-up or placeholder devices with line 1 unused. */
			if ( _d2e[_h][0].i == null ) {
				if ( _d2e[_h][0].p.h ) { /* Hotdesk placeholder */
					_d2e[_h][0].e = (Utils.isEmpty(live.hdCID) ? 'Hotdesk' : live.hdCID);
					_d2e[_h][0].n = 'Hotdesk';
					_d2e[_h][0].i = 1;
					_d2e[_h][0].h = true;
				} else {		/* Shift lines up */
					if ( _d2e[_h][1] == null )
						_d2e[_h][1] = {l:[]}
					_d2e[_h][1].p = _d2e[_h][0].p;
					_d2e[_h][1].l = _d2e[_h][0].l.concat(_d2e[_h][1].l);
					_d2e[_h].shift();
				}
			}
			/* THIRD: Roll any overflow lines into the last "Various" line. */
			var _lines = _d2e[_h][0].p.n || 1;
			while ( _d2e[_h].length > _lines ) {
				if ( _lines > 1 ) {
					_d2e[_h][_lines - 1].n = 'Various';
					_d2e[_h][_lines - 1].e = _d2e[_h][_lines - 1].l[0].e;
				}
				_d2e[_h][_lines - 1].l = _d2e[_h][_lines - 1].l.concat(_d2e[_h][_lines].l);
				_d2e[_h].splice(_lines, 1);
			}
			/* FOURTH: Fill "Spare" lines */
			if ( ! _d2e[_h][0].e && ! _d2e[_h][0].n ) {
				_d2e[_h][0].e = 'Spare';
				_d2e[_h][0].n = 'Spare';
			}
			while ( _d2e[_h].length < _lines ) {
				_d2e[_h].push({ e: _d2e[_h][0].e, n: 'Spare', l: [] });
			}

			/* FIFTH: Move the result into devToExt */
			delete _d2e[_h][0].p;
			for ( var i = 0; i < _lines; i++ ) {
				var _l = 'SIP/' + _h;
				if ( i ) _l += '_' + (i + 1);
				devToExt[_l] = _d2e[_h][i];
				devToExt[_l].i = devToExt[_l].i || (i + 1);
			}
			delete _d2e[_h];
		}
	}

	/**
	 * Returns a list of DDI's accociated with an extension.
	 * @param {String} ext Extension number
	 * @return {String[]} List of DDI numbers
	 * @memberOf IPCortex.PBX
	 */
	function listDDIByExtension(ext) {
		if ( ! (Array.isArray(live.extToDDI[ext])) )
			return [];
		var _list = [];
		for ( var i = 0; i < live.extToDDI[ext].length; i++ )
			_list.push(devToExt[dev][i].c + '' + devToExt[dev][i].n);
		return _list;
	}

	/**
	 * Returns a list of Extensions associated with a (SIP) device/registration.
	 * @param {String} dev Device name
	 * @return {String[]} List of Extension numbers
	 * @memberOf IPCortex.PBX
	 */
	function listExtensionByDevice(dev) {
		if ( typeof(devToExt[dev]) != 'object' || ! (Array.isArray(devToExt[dev].l)) )
			return [];
		var _list = [];
		for ( var i = 0; i < devToExt[dev].l.length; i++ )
			_list.push(devToExt[dev].l[i].e);
		return _list;
	}

	/**
	 * Structure describing an extension
	 * @typedef {Object} IPCortex.PBX~compactExtension
	 * @property {String} e Primary extension number
	 * @property {String} n Primary name
	 * @property {Number|String} i Line number 1 or higher, 'H' for hotdesk
	 * @property {Bool} h true: is a hotdesk line
	 * @property {Array.<IPCortex.PBX~detailExtension>} l Ordered list of all extensions calling the device
	 * @private
	 */
	/**
	 * Structure describing an extension
	 * @typedef {Object} IPCortex.PBX~detailExtension
	 * @property {String} e Extension number
	 * @property {String} n Extension name
	 * @property {String} t Extension type (Single letter)
	 * @property {Bool} o Extension is owned in this context
	 * @property {Bool} p Phone is owned in this context
	 * @property {String} l Link type (link|fork|deflect|hotdesk)
	 * @private
	 */
	/**
	 * Returns List of Extensions and metadata accociated with a (SIP) device/registration.
	 * @param {String} dev Device name
	 * @return {IPCortex.PBX~compactExtension} Details of extension(s) calling the device.
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function _getExtensionByDevice(dev) {
		if ( typeof(devToExt[dev]) != 'object' )
			return {};
		return devToExt[dev];
	}

	/**
	 * Returns a list of ContactIDs accociated with an extension.
	 * 
	 * Contact ID is a unique identifier per user on the PABX. It can be retrieved
	 * for the logged-in user using IPCortex.PBX.Auth.getUserInfo.
	 * 
	 * @param {String} ext Extension number
	 * @return {String[]} List of ContactIDs
	 * @memberOf IPCortex.PBX
	 */
	function listCIDByExtension(ext) {
		if ( ! (Array.isArray(live.extToCid[ext].l)) )
			return [];
		var _list = [];
		for ( var i = 0; i < live.extToCid[ext].l.length; i++ )
			_list.push(live.extToCid[ext].l[i].i);
		return _list;
	}

	/**
	 * 
	 * Return array of mac+port strings for contact_id. mac is the MAC address
	 * of the device and port is usually '0', but increments for multi-port
	 * devices such as ATAs
	 *
	 * @param {Number} cid Contact ID of user
	 * @param {Bool} owned If 'true' return only owned or Hotdesk device
	 * 
	 * If false returns all devices associated with the user
	 * 
	 * @return {String[]} List of MAC+Ports
	 * @memberOf IPCortex.PBX
	 */
	function listMACByCID(cid, owned) {
		if ( ! (Array.isArray(live.cidToPhn[cid])) )
			return [];
		var _list = []
		for ( var i = 0; i < live.cidToPhn[cid].length; i++ ) {
			if ( ! owned || live.cidToPhn[cid][i].o || live.cidToPhn[cid][i].l == 'hotdesk' || (live.cidToPhn[cid][i].d == 'webrtc' + cid && haveJsSIP()))
				_list.push(live.cidToPhn[cid][i].m + '' + live.cidToPhn[cid][i].p);
		}
		return _list;
	}

	/**
	 * Returns a list of all extensions.
	 * @param {String} [type] The type of extension to return
	 * __null__: (default) All extensions
	 * __A__: Ring-all extensions
	 * __H__: Hunt extensions
	 * __Q__: Queue extensions
	 * __I__: IVR extensions
	 * __F__: Fax extensions
	 * __C__: Conference extensions
	 * __V__: Voicemail extensions
	 * __P__: External Voicemail extensions
	 * @return {String[]} List of extensions
	 * @memberOf IPCortex.PBX
	 */
	function listExtension(type) {
		if( type != null && type.search(/^[AHQIFCVP]$/) == -1 )
			return [];
		if ( typeof(extByExt) != 'object' )
			return [];
		var _list = []
		for ( var i in extByExt ) {
			if( type == null || extByExt[i].type == type )
				_list.push(i);
		}
		_list.sort();
		return _list;
	}

	/**
	 * Structure describing an extension
	 * @typedef {Object} IPCortex.PBX~Extension
	 * @property {String} company Extension company.
	 * @property {String} name Extension name e.g. Support.
	 * @property {Number|Bool} owner Owner contact ID or false.
	 * @property {String} priority Priority for line allocation (Has 20 added)
	 * @property {String} type A: Ring all, H: Hunt dial, etc
	 * @property {String} voicemail Voicemail box.
	 */
	/**
	 * Fetch either an Object containing extension objects keyed on extension if ext is null
	 * or a specific extension object.
	 * @param {String} [ext] Optonal extension number to get
	 * @param {Bool} [clone] if true, return copies of objects, not refs.
	 * @return {Object.<String, IPCortex.PBX~Extension>}|{IPCortex.PBX~Extension} Extension or list of extensions
	 * @memberOf IPCortex.PBX
	 */
	function getExtension(ext, clone) {
		return getInfo('extension', ext, clone);
	}

	/**
	 * Structure describing a user
	 * @typedef {Object} IPCortex.PBX~User
	 * @property {Number} cid Contact ID
	 * @property {String} email Email address
	 * @property {String} [extension] Owned extension.
	 * @property {String} name User name.
	 * @property {String} [phone] MAC of owned phone.
	 * @property {String} [port] Port of owned phone.
	 * @property {String} uname Unique name (login name) 
	 */
	// Think these are possibly part of it???
	// * @property {String} xmpp Xmpp device.
	// * @property {Api.call} call A call object for doing things to this contact (eg. contact.transfer(call), contact.hook(cb))
	/**
	 * Fetch either an Object containing user objects keyed on contact ID if cid is null
	 * or a specific user object.
	 * @param {Number} [cid] Optonal contact ID to get
	 * @param {Bool} [clone] if true, return copies of objects, not refs.
	 * @return {Object.<Number, IPCortex.PBX~User>|IPCortex.PBX~User} User or list of users
	 * @memberOf IPCortex.PBX
	 */
	function getUser(cid, clone) {
		return getInfo('user', cid, clone);
	}

	/**
	 * Structure describing a phone. A phone is a top level thing that is made up of Lines/Devices.
	 * @typedef {Object} IPCortex.PBX~Phone
	 * @property {String[]} devices Array of devices.
	 * @property {String} name Device name.
	 * @property {String} features eg. 'answer,hold,talk'
	 * @property {String|Bool} owner Owner contact ID or false.
	 * @property {String} port Device port (redundant really)
	 * @property {String} type Link type: link, hotdesk, fork, deflect. (meaningless, is one of many possible links)
	 */
	/**
	 * Fetch either an Object containing phone objects keyed on MAC+Port if mac is null
	 * or a specific phone object.
	 * @param {String} [mac] Optonal MAC+Port to get
	 * @param {Bool} [clone] if true, return copies of objects, not refs.
	 * @return {Object.<String, IPCortex.PBX~Phone>|IPCortex.PBX~Phone} Phone or list of phones
	 * @memberOf IPCortex.PBX
	 */
	function getPhone(mac, clone) {
		return getInfo('phone', mac, clone);
	}

	/**
	 * Structure describing a device Hook's creation.
	 * Object keyed on Device containing an array of matching device filter objects
	 * @typedef {Object.<Device, Object[]>} IPCortex.PBX~HookInfo
	 * @property {String} extension Extension number for this filter
	 * @property {String} cid Contact ID for this filter
	 * @property {String} phone MAC+Port for this filter
	 * @property {String} device Device name for this filter
	 */
	/**
	 * Fetch either an Object containing HID Info (Hook ID based info) objects keyed on HID if hid is null,
	 * otherwise returns a specific HID Info object.
	 * @param {String} [hid] Optonal HID to get
	 * @param {Bool} [clone] if true, return copies of objects, not refs.
	 * @return {Object} Object or Object-of-objects
	 * @memberOf IPCortex.PBX
	 */
	function getHIDInfo(hid, clone) {
		return getInfo('hid', hid, clone);
	}

	/**
	 * Wrapper to allow fetching and possibly cloning of internal data
	 * @param {String} type One of 'extension', 'phone', 'user' or 'hid' for type of data to return
	 * @param {String} [key] Specific item to return or null for all.
	 * @param {Bool} [clone] If 'true' clone the returned data
	 * @return {Object[]|Object|Bool} Object, list of objects or 'false' for an empty result.
	 * @memberOf IPCortex.PBX
	 * @private
	 */ 
	function getInfo(type, key, clone) {
		var _result = {};
		var _typeLookup = {
			hid:		hidStruct,
			user:		live.cidToUsr,
			phone:		macToPhn,
			extension:	extByExt
		};
		if ( ! _typeLookup[type] )
			return false;
		var _tmp = _typeLookup[type];
		if ( key )
			_tmp = _typeLookup[type][key];
		if ( clone )
			Utils.doClone(_tmp, _result);
		else
			_result = _tmp;
		if ( ! Utils.isEmpty(_tmp) )
			return _result;
		return false; 
	}

	/**
	 * Addressbook callback. This will be called once per new, changed or deleted addressbook
	 * entry. This callback will be cached and re-used for future updates.
	 * @callback Callback~addressbookCB
	 * @param {IPCortex.PBX.address[]} address A list of address book entry/instances. If called repeatedly, 
	 * this parameter contains a list of new or updated entries
	 * @param {String[]} deleted A list of addressbook entry keys that have been deleted since the last call.
	 */
	/**
	 * Addressbook finished callback
	 * @callback Callback~addressbookFinish
	 */
	/**
	 * Request an addressbook, supplies a callback function which is called 
	 * when data is ready. The callback will be called with updates if an addresbook refresh occurs.
	 * 
	 * address.compare(otheraddress) returns a boolean and can be used to compare 2 entries
	 * for equality to determine how the list has changed.
	 * 
	 * @param {Callback~addressbookCB} callback Called once per address entry
	 * @memberOf IPCortex.PBX
	 * @todo Activate the "delete" addressbook callback.
	 */
	function getAddressbook(callback) {
		/* Retrieve cached callback functions if not provided */
		callback = callbacks.getAddressbook = callback || callbacks.getAddressbook;

		if ( flags.parsing.address || flags.parsing.users || typeof(callback) != 'function' )
			return;
		flags.parsing.address = flags.parsing.users = true;
		Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=refresh&data=users', parseAPI);
		Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=refresh&data=address', parseAPI);
		_addressReady();
	}
	/** @private */
	function _addressReady() {
		if ( flags.parsing.address || flags.parsing.roster || flags.parsing.users ) {
			setTimeout(_addressReady, 100)
			return;
		}
		callback = callbacks.getAddressbook;
		/* First do actual addressbook entries */
		var _newList = {};
		var _res = [];
		for ( var _group in live.addressBook ) {
			for ( var b = 0; b < live.addressBook[_group].length; b++ ) {
				var _tmp = address.create(_group, live.addressBook[_group][b]);
				var _key = _tmp.get('key');
				_newList[_key] = true;
				if ( lookUp.addr[_key] == null || ! _tmp.compare(lookUp.addr[_key]) ) {
					if( lookUp.addr[_key] ) {
						lookUp.addr[_key].merge(_tmp);
						_tmp.destroy();
					} else
						lookUp.addr[_key] = _tmp;
					_res.push(lookUp.addr[_key])	/* New or changed */
				}
			}
		}
		/* First do actual addressbook entries */
		/* TODO: Allow XMPP addresses to be tagged against above entries for de-dupe */
		if ( ! (Array.isArray(flags.refreshData)) )
			flags.refreshData = [];
		for ( var _key in live.xmppRoster ) {
			var _x = live.xmppRoster[_key];
			if ( _x.d.search(/^.+@.+$/) == -1 || _x.f == 0 )
				continue;
			var _tmp = address.create('personal', {d: 'Custom/' + _x.d, n: _x.n || _x.d});
			var _key = _tmp.get('key');
			_newList[_key] = true;
			if ( _x.f & 1 )
				flags.refreshData.push('Custom/' + _x.d);       /* Ensure we have latest XMPP state */
			if ( lookUp.addr[_key] == null || ! _tmp.compare(lookUp.addr[_key]) ) {
				if( lookUp.addr[_key] ) {
					lookUp.addr[_key].merge(_tmp);
					_tmp.destroy();
				} else
					lookUp.addr[_key] = _tmp;
				_res.push(lookUp.addr[_key])	/* New or changed */
			}
		}
		/* Call clear remaining hooks and delete on anything that has vanished */
		var _old = [];
		for ( var x in lookUp.addr ) {
			if ( ! _newList[x] ) {
				lookUp.addr[x].destroy();    /* This should auto-protect any referenced subclasses */
				delete lookUp.addr[x];
				_old.push(x);
			}
		}
		callback(_res, _old);
		_newList = _res = _old = null;
	}

	/**
	 * Clear addressbook state, eg. as part of a logout.
	 */
	function flushAddressbook() {
		callbacks.getAddressbook = null;

		for ( var x in lookUp.addr ) {
			lookUp.addr[x].destroy();
			delete lookUp.addr[x];
		}
	}

	/**
	 * Lines callback. This callback will be cached, and called with an updated
	 * array if a hotdesk event changes the list of lines.
	 * @callback Callback~linesCB
	 * @param {Array.<IPCortex.PBX.device>} lines Array of Line (device) objects
	 */
	/**
	 * Requests a list of all lines (devices), and takes a callback function which is invoked 
	 * when data is ready. 
	 * 
	 * The callback will be called with updates if hotdesk events change the result set.
	 * device.compare(otherdev) can be used to either sort or compare lines to determine how
	 * the list has changed.
	 * 
	 * Fetch list of all (or owned) called devices for current user.
	 * @param {Callback~linesCB} callback
	 * @param {Bool} [owned] If true, only return lines for owned device
	 * 
	 * Setting owned falsed will hook __all__ lines associated with the current user. This is
	 * potentially large. 
	 * 
	 * Setting owned to true lists only lines for the user's owned phone
	 * and a hotdesk line of there is one.
	 *
	 * @todo This function makes no effort to refresh live data. This may be the right behaviour.
	 * @memberOf IPCortex.PBX
	 */
	function getLines(callback, owned) {
		/* Retrieve cached callback function if not provided */
		if ( callback == null ) {
			callback = callbacks.getLines;
			owned = callbacks.getLinesOwned;
		} else {
			callbacks.getLines = callback;
			callbacks.getLinesOwned = owned;
		}

		if ( typeof(callback) != 'function' || isNaN(live.userData.id) || flags.loading )
			return;
		var _lines = [];
		var _phoneList = listMACByCID(live.userData.id, owned);
		for ( var p = 0; p < _phoneList.length; p++ ) {
			var _deviceList = getPhone(_phoneList[p]).devices;
			for ( var d = 0; d < _deviceList.length; d++ ) {
				if ( ! lookUp.dev[_deviceList[d]] )
					continue;
				if ( owned && d > 0 && macToPhn[_phoneList[p]].owner != live.userData.id ) /* WebRTC device? */
					break;
				_lines.push(lookUp.dev[_deviceList[d]]);
			}
		}
		_lines.sort(function(a,b){return a.compare(b);});
		function initialCB() {
			callback(_lines);
		}
		setTimeout(initialCB, 1);
	}

	/**
	 * Roster update callback. This callback is cached, and may be called if roster
	 * updates occur internally.
	 * @callback Callback~rosterCB
	 * @todo This should proabbly return the requested data.
	 */
	/**
	 * Request a refresh of the XMPP roster for current user. No data returned, but
	 * global datastore is refreshed.
	 * @param {Callback~rosterCD} [callback] Called when the update is complete.
	 *
	 * @todo Probably be nice if this did return a clone of the data to "userspace"
	 * @memberOf IPCortex.PBX
	 */
	function getRoster(callback) {
		/* Retrieve cached callback functions if not provided */
		callback = callbacks.getRoster = callback || callbacks.getRoster;

		if ( flags.parsing.roster )
			return;
		function ready() {
			if ( flags.parsing.roster ) {
				setTimeout(ready, 500)
				return;
			}
			if ( typeof(callback) == 'function' )
				callback(live.xmppRoster);
		}
		flags.parsing.roster = true;
		Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=refresh&data=roster', parseAPI);
		if ( typeof(callback) == 'function' )
			ready();
	}

	/**
	 * Create a new addressbook entry in an OCM reserved dataset.
	 * 
	 * If initialised, the addressbook refresh callback will be used to refresh the
	 * client with any resultant updates.
	 *
	 * @param {String} name Contact name
	 * @param {String} number Contact number
	 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
	 * @memberOf IPCortex.PBX
	 */
	function createAddress(name, number, callback) {
		var _callback = callback;
		function parseResult(content) {
			if ( ! typeof content == 'string' || content.search(/<response.*result="success"/) != -1 ) {
				if ( _callback && typeof _callback == 'function' )
					_callback(true, content);
				getAddressbook();
			} else if ( _callback && typeof _callback == 'function' )
				_callback(false, content);
		}
		name = name || '';
		number = number || '';
		if ( number.length == 0 && name.length == 0 )
			return PBXError.ADDR_MISSING_NUMNAME;
		if ( number.length == 0 )
			return PBXError.ADDR_MISSING_NUM;
		if ( name.length == 0 )
			return PBXError.ADDR_MISSING_NAME;
		number = number.replace(/ /g, '');
		if ( number.search(/[^0-9\#\*]/) != -1 )
			return PBXError.ADDR_ILLEGAL_NUM;
		if ( name.search(/[^a-zA-Z0-9\.\s\,\'\/\\\-_]/) != -1 )
			return PBXError.ADDR_ILLEGAL_NAME;
		Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=create&type=address&name=' + name + '&number=' + number , parseResult);
		return PBXError.OK;
	}

	/**
	 * Create a new XMPP entry and request access.
	 * 
	 * If initialised, the addressbook refresh callback will be used to refresh the
	 * client with any resultant updates.
	 *
	 * @param {String} name Contact name or nickname
	 * @param {String} xmppid Contact XMPP-ID
	 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
	 * @memberOf IPCortex.PBX
	 */
	function createXmpp(name, xmppid, callback) {
		var _callback = callback;
		function parseResult(content) {
			if ( ! typeof content == 'string' || content.search(/<response.*result="success"/) != -1 ) {
				if ( _callback && typeof _callback == 'function' )
					_callback(true, content);
				getAddressbook();
			} else if ( _callback && typeof _callback == 'function' )
				_callback(false, content);
		}
		name = name || '';
		xmppid = xmppid || '';
		xmppid = xmppid.replace(/ /g, '');
		if ( xmppid.length == 0 && name.length == 0 )
			return PBXError.ADDR_MISSING_XMPPNAM;
		if ( xmppid.length == 0 )
			return PBXError.ADDR_MISSING_XMPP;
		if ( name.length == 0 )
			return PBXError.ADDR_MISSING_NAME;
		if ( xmppid.search(/^[a-zA-Z0-9!#\$%&\'\*\+\-_`\{\}\|~\.]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9]+)+$/) == -1 )
			return PBXError.ADDR_ILLEGAL_XMPP;
		if ( name.search(/[^a-zA-Z0-9\.\s\,\'\/\\\-_]/) != -1 )
			return PBXError.ADDR_ILLEGAL_NAME;
		Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=connectext&name=' + name + '&jid=' + xmppid , parseResult);
		return PBXError.OK;
	}

	/**
	 * History callback. This callback is cached, and is called for all subsequent
	 * history events. When called initially, any existing history will be announced via this
	 * callback.
	 * @callback Callback~historyCB
	 * @param {IPCortex.PBX.history} history History object representing an ended call
	 * @param {Bool} saved true: This is a saved history item, false: this is a new history item.
	 */
	/**
	 * Enable history subsystem. Immediately calls back with all existing history, and whenever a call ends.
	 * @param {Callback~historyCB} callback Called for each history item received.
	 * @return {Bool} false If the callback is missing or history is already enabled.
	 * @memberOf IPCortex.PBX
	 */
	function enableHistory(callback) {
		if ( hI.enabled )
			return false;
		if ( typeof(callback) != 'function' )
			return false;
		hI.enabled = 1;
		hI.cb = callback;
		if ( ! loadCache.rawhistory ) {
			loadData('rawhistory', parseHistory);
			hI.saved = (new Date()).getTime();
		}
		saveHistory();
		return true;
	}

	/**
	 * Parse and act on a response from a call to api.whtm for history. Called by
	 * parseAPI() which does most of the work.
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function parseHistory(type, str) {
		if ( ! hI.enabled || type != 'rawhistory' )
			return;
		_history = JSON.parse(str);
		if ( ! (Array.isArray(_history)) )
			_history = [];
		for ( var i = 0; i < _history.length; i++ ) {
			var _record = {};
			for ( var x = 0; x < translate.length; x++ ) {
				if ( _history[i][translate[x].s] )
					_record[translate[x].a] = _history[i][translate[x].s];
			}
			if ( lookUp.dev[_record.device] && ! history.is_dupe(_record) ) {
				if ( lookUp.dev[_record.device].get('history') ) 
					history.create(_record);
				else {
					if ( ! hI.cache[_record.device] )
						hI.cache[_record.device] = [_record];
					else
						hI.cache[_record.device].push(_record);
				}
			}
		}
	}

	/**
	 * Save history. History is saved occasionally, this forces a save (eg. before exit).
	 * It may not be called unless history is enabled.
	 * @todo Probably ought to write this and export it
	 * @memberOf IPCortex.PBX
	 */
	function _getHistory() {
		if ( ! loadCache.rawhistory || ! hI.enabled )
			return false;
		var _histData = [];
		/* Sort and trim to 100 records */
		hI.history.sort(function(a,b){ return a.attr.end < b.attr.end ? -1 : (a.attr.end > b.attr.end ? 1 : 0); });
		while ( hI.history.length > 50 )
			hI.history.shift().destroy();
		for ( var i = 0; i < hI.history.length; i++ ) {
			var _record = {};
			for ( var x = 0; x < translate.length; x++ )
				_record[translate[x].s] = (hI.history[i].get(translate[x].a) || '')
			_histData.push(_record);
		}
		return base64encode(JSON.stringify(_histData));
	}

	/**
	 * Save history. History is saved occasionally, this forces a save (eg. before exit).
	 * It may not be called unless history is enabled.
	 * @todo Probably ought to write this and export it
	 * @memberOf IPCortex.PBX
	 */
	function saveHistory() {
		function save() {
			if ( hI.timeout )
				clearTimeout(hI.timeout);
			Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=save&type=history&data=' + _getHistory());
			hI.saved = (new Date()).getTime();
			hI.timeout = null;
		}
		if ( ! loadCache.rawhistory || ! hI.enabled )
			return false;
		if ( hI.updated <= hI.saved ) {
			hI.saved = (new Date()).getTime();
			return true;	
		}
		if ( hI.timeout )
			return true;
		if ( ((new Date()).getTime() - hI.saved) < 30000 )	/* High load operation. allowed every 30 seconds max */
			hI.timeout = setTimeout(save, 31000);
		else
			save();
		return true;
	}

	/**
	 * Disable history subsystem. History is flushed an no further callbacks are possible.
	 * @todo Probably ought to write this and export it
	 * @memberOf IPCortex.PBX
	 */
	function disableHistory() {
		if ( hI.timeout )
			clearTimeout(hI.timeout);
		while ( hI.history.length )
			hI.history.shift().destroy();
		hI = {
			enabled:	0,
			timeout:	null,
			saved:		(new Date()).getTime(),
			updated:	(new Date()).getTime(),
			cb:		null,
			cache:		{},
			history:	[]
		};
		loadCache.rawhistory = null;
		return true;
	}

	/**
	 * Parse and act on a response from a call to api.whtm for roster. Called by
	 * parseAPI() which does most of the work.
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function parseRoster() {
		if ( live.xmppRoster && live.xmppRoster.seq != null ) {
			counters.xmppSequence = live.xmppRoster.seq;
			delete live.xmppRoster.seq;
		}
		if ( ! (Array.isArray(flags.refreshData)) )
			flags.refreshData = [];
		for ( var i in live.xmppRoster ) {
			/* All of the changes to Roster since the last update need a maxdata = 0 fetch
			 * that is hard, so do whole roster. */
			flags.refreshData.push('Custom/' + live.xmppRoster[i].d);
		}
	}

	/**
	 * Chat room callback. This callback is cached, and is called for all subsequent
	 * chat events. When called initially, any existing rooms will be announced via this
	 * callback.
	 * @callback Callback~chatCB
	 * @param {IPCortex.PBX.room} room Room object for room that has been created, or updated.
	 */
	/**
	 * Presence callback. This callback is cached, and is called for all subsequent
	 * presence updates events. When called initially, any existing presence data will be announced via this
	 * callback.
	 * @callback Callback~chatCB
	 * @param {IPCortex.PBX.room} room Room object for room that has been created, or updated.
	 */
	/**
	 * Enable chat subsystem. Logs user on to chat. Immediately calls back with all existing rooms, and whenever a new room appears.
	 * @param {Callback~chatCB} roomCB Called for each chat event received.
	 * @param {Callback~presenceCB} presenceCB Called for each chat event received.
	 * @return {Bool} false if the callback is missing.
	 * @memberOf IPCortex.PBX
	 */
	function enableChat(roomCB, presenceCB) {
		if ( typeof(roomCB) != 'function' )
			return false;
		cH.enabled = 1;
		cH.initial = 1;		/* We clear this once we're up and running */
		cH.roomCB = roomCB || cH.roomCB;
		cH.presenceCB = presenceCB || cH.presenceCB;
		while ( cH.rooms.length )
			roomCB(cH.rooms.pop(), cH.initial == 1);
		Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm',
				'cmd=create&type=room' +
				'&name=_' + live.userData.id + '_' +
				'&id=' + live.userData.id + 
				'&autoclean=5');
		cH.hookid = hookContact(live.userData.id, function() {}); /* Hook self to be sure presence updates happen */
		setStatus('online');
		return true;
	}

	/**
	 * Disable chat subsystem. No further callbacks will occur. User will be indicated as logged-off.
	 * @memberOf IPCortex.PBX
	 */
	function disableChat(callback) {
		cH.enabled = 0;
		cH.initial = 0;
		setStatus('offline');
		if ( cH.online )
			cH.online.leave();
		unHook(cH.hookid);
		for ( var _r in lookUp.room ) {
			lookUp.room[_r].unjoin();
			lookUp.room[_r].destroy();
			delete lookUp.room[_r];
		}
		cH.online = null;
		cH.hookid = null;
		cH.roomCB = null;
		return true;
	}

	/**
	 * Set chat status
	 * @param {String} show (online|away|xa|dnd)
	 * @param {String} status Free text status description
	 * @memberOf IPCortex.PBX
	 */
	function setStatus(show, status) {
		if ( cH.xmpp )
			cH.xmpp.setStatus(show, status);
	} 

	function base64decode(base64) {
		var i = 0;
		var str = '';
		var chr1, chr2, chr3 = '';
		var enc1, enc2, enc3, enc4 = '';
		base64 = base64.replace(/[^A-Za-z0-9\+\/\=]/g, '');
		var b64array = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
		do {
			enc1 = b64array.indexOf(base64.charAt(i++));
			enc2 = b64array.indexOf(base64.charAt(i++));
			enc3 = b64array.indexOf(base64.charAt(i++));
			enc4 = b64array.indexOf(base64.charAt(i++));

			chr1 = (enc1 << 2) | (enc2 >> 4);
			chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
			chr3 = ((enc3 & 3) << 6) | enc4;

			str = str + String.fromCharCode(chr1);
			if ( enc3 != 64 )
				str = str + String.fromCharCode(chr2);
			if ( enc4 != 64 )
				str = str + String.fromCharCode(chr3);

			chr1 = chr2 = chr3 = '';
			enc1 = enc2 = enc3 = enc4 = '';
		} while ( i < base64.length );

		return str;
	}

	function base64encode(str) {
		var i = 0;
		var base64 = '';
		var chr1, chr2, chr3 = '';
		var enc1, enc2, enc3, enc4 = '';
		var b64array = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
		do {
			chr1 = str.charCodeAt(i++);
			chr2 = str.charCodeAt(i++);
			chr3 = str.charCodeAt(i++);

			enc1 = chr1 >> 2;
			enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
			enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
			enc4 = chr3 & 63;

			if ( isNaN(chr2) )
				enc3 = enc4 = 64;
			else if ( isNaN(chr3) )
				enc4 = 64;

			base64 += b64array.charAt(enc1) +
				b64array.charAt(enc2) +
				b64array.charAt(enc3) +
				b64array.charAt(enc4);
			chr1 = chr2 = chr3 = '';
			enc1 = enc2 = enc3 = enc4 = '';
		} while ( i < str.length );

		return base64;
	}

	function randomString(length) {
		var _string = '';
		while((_string += parseInt(Math.random()*1000000000).toString(36)).length < length);
  		return _string.slice(0, length);
	}

	/**
	 * Callback from a data load.
	 * @callback Callback~loadCB
	 * @param {String} type Type of data requested (qpoll|qsent|qhide|qview|ocm1flags|ocm1config|ocm2config|history)
	 * @param {String} data The raw data.
	 */
	/**
	 * Load contact data of selected type for the logged-in user.
	 * @param {String} type (qpoll|qsent|qhide|qview|ocm1flags|ocm1config|ocm2config|rawhistory)
	 * @param {Callback~loadCB} callback Will be called with type and raw data.
	 * @memberOf IPCortex.PBX
	 */
	function loadData(type, callback) {
		function decode(xml) {
			var _s = xml.split('\n');
			if ( _s[0] != '<response result="success">' && _s[1] != '<data name="' + type + '">' )
				callback(type, null);
			var _string = base64decode(_s[2]);
			loadCache[type] = _string;
			callback(type, _string);
		}
		Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=load&type=' + type, decode);
	}

	/**
	 * Save contact data of selected type for the logged-in user.
	 * @param {String} type (qpoll|qsent|qhide|qview|ocm1flags|ocm1config|ocm2config|rawhistory|ocmversion)
	 * @param {String} data data to be saved
	 * @memberOf IPCortex.PBX
	 */
	function saveData(type, data) {
		if ( typeof data == 'number' )
			data = new String(data);
		else if ( typeof data == 'object' )
			data = JSON.stringify(data);
		if ( loadCache[type] == data )
			return;

		function updateCache(content) {
			if ( ! typeof content == 'string' )
				return;
			if ( content.search(/<response.*result="success"/) != -1 )
				loadCache[type] = data;
		}
		var _base64 = base64encode(data);
		Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=save&type=' + type + '&data=' + _base64, updateCache);
	}

	/**
	 * Callback from a device hook. Device callbacks are cached on a per-hook basis.
	 * @callback Callback~deviceCB
	 * @param {Object} filter The filter that was used for this hook
	 * @param {Number} hid The hook ID of the hook that is firing
	 * @param {IPCortex.PBX.device} device The device instance that has a state change
	 */
	/**
	 * Hook a device or devices based on search criteria
	 * @param {String[]} [extensions] List of extensions to include in the hook
	 * @param {Number[]} [cids] List of contact IDs to include in the hook
	 * @param {String[]} [phones] List of phones to include in the hook
	 * @param {String[]} [devices] List of devices to include in the hook
	 * @param {Bool} [owned] Only include owned devices in the hook
	 * @param {Callback~deviceCB} callback Called for each device event received.
	 * @return {Number} Hook ID that identifies this hook request, or error code (< 0).
	 * @memberOf IPCortex.PBX
	 */
	function hookDevice(extensions, cids, phones, devices, owned, callback) {
		if ( cids ) cids = [].concat(cids);
		if ( phones ) phones = [].concat(phones);
		if ( devices ) devices = [].concat(devices);
		if ( extensions ) extensions = [].concat(extensions);
		if ( typeof(callback) != 'function' )
			return PBXError.HOOK_BAD_CALLBACK;
		var _filter = {};
		var _struct = {};
		var _deviceUsed = {};
		var _deviceSpare = {};
		var _extensions = getExtension();
		function buildFilter(filter) {
			if ( ! (Array.isArray(_filter[filter.device])) )
				_filter[filter.device] = [];
			_filter[filter.device].push(filter);
			var _tmp = _struct;
			var _tmpLast = null;
			var _attrs = ['extension', 'cid', 'phone', 'device'];
			for ( var x = 0; x < _attrs.length; x++ ) {
				var _attr = filter[_attrs[x]];
				if ( (x + 1) == _attrs.length && _tmpLast ) {
					_tmpLast.o[_tmpLast.a] = _attr;
					break;
				}
				if ( ! _tmp[_attr] )
					_tmp[_attr] = {};
				_tmpLast = {o: _tmp, a: _attr};
				_tmp = _tmp[_attr];
			}
		}
		for ( var _ext in _extensions ) {
			if ( Array.isArray(extensions) && ! Utils.isInArray(extensions, _ext) )
				continue;
			var _userList = listCIDByExtension(_ext);
			for ( var u = 0; u < _userList.length; u++ ) {
				if ( Array.isArray(cids) && ! Utils.isInArray(cids, _userList[u]) )
					continue;
				var _phoneList = listMACByCID(_userList[u]);
				for ( var p = 0; p < _phoneList.length; p++ ) {
					if ( Array.isArray(phones) && ! Utils.isInArray(phones, _phoneList[p]) )
						continue;
					var _phone = getPhone(_phoneList[p]);
					if ( owned && _phone.owner != _userList[u] && _phoneList[p] != '_WEBRTC_____' + _userList[u] ) /* WebRTC device? */
						continue;
					var _deviceList = _phone.devices;
					for ( var d = 0; d < _deviceList.length; d++ ) {
						var _extensionList = listExtensionByDevice(_deviceList[d]);
						if ( Utils.isInArray(devices, _deviceList[d]) ) {
							if ( Utils.isInArray(_extensionList, _ext) ) {
								buildFilter({extension: _ext, cid: _userList[u], phone: _phoneList[p], device: _deviceList[d]});
								_deviceUsed[_deviceList[d]] = true;
							} else
								_deviceSpare[_deviceList[d]] = {extension: '', cid: _userList[u], phone: _phoneList[p], device: _deviceList[d]};
						} else if ( ! (Array.isArray(devices)) ) {
							if ( Utils.isInArray(_extensionList, _ext) ) {
								buildFilter({extension: _ext, cid: _userList[u], phone: _phoneList[p], device: _deviceList[d]});
								_deviceUsed[_deviceList[d]] = true;
							} else
								_deviceSpare[_deviceList[d]] = {extension: '', cid: _userList[u], phone: _phoneList[p], device: _deviceList[d]};
						}
					}
				}
			}
		}
		if ( Array.isArray(cids) || Array.isArray(phones) || Array.isArray(devices) ) {
			for ( var _device in _deviceSpare ) {
				if ( _deviceUsed[_device] )
					continue;
				buildFilter(_deviceSpare[_device]);
			}
		}
		if ( Utils.isEmpty(_filter) )
			return PBXError.HOOK_NO_DEVICE;
		gHid++;
		lookUp.hid[gHid] = [];
		hidStruct[gHid] = _struct;
		for ( var _device in _filter ) {
			if ( lookUp.dev[_device] ) {
				lookUp.dev[_device].hook(callback, _filter[_device], gHid);
				lookUp.hid[gHid].push(lookUp.dev[_device]);
			}
		}
		return gHid;
	}

	/**
	 * Callback from a park hook. Park callbacks are cached on a per-hook basis.
	 * A park orbit hook is a special case of a device callback.
	 * @callback Callback~parkCB
	 * @param {Object} filter The filter that was used for this hook
	 * @param {Number} hid The hook ID of the hook that is firing
	 * @param {IPCortex.PBX.device} device The park object that has a state change
	 */
	/**
	 * Hook a park orbit based on the Pick/nnn device name. Used internally by
	 * {@link IPCortex.PBX.address}
	 * @param {String[]} dev The device name of the park orbit. ("Park/nnn")
	 * @param {Callback~parkCB} callback Called for each device event received.
	 * @return {Number} Hook ID that identifies this hook request, or error code (< 0).
	 * @memberOf IPCortex.PBX
	 */
	function hookPark(dev, callback) {
		if ( typeof(callback) != 'function' )
			return PBXError.HOOK_BAD_CALLBACK;
		if ( dev.search(/^Park\/\d+$/) == -1 )
			return PBXError.HOOK_NOT_PARK;
		if ( ! lookUp.dev[dev] )
			lookUp.dev[dev] = device.create(dev);

		gHid++;
		lookUp.dev[dev].hook(callback, {device: dev}, gHid);
		lookUp.hid[gHid] = [lookUp.dev[dev]];
		return gHid;
	}

	/**
	 * Callback from a mailbox hook. Mailbox callbacks are cached on a per-hook basis.
	 * @callback Callback~mailboxCB
	 * @param {Object} filter The filter that was used for this hook
	 * @param {Number} hid The hook ID of the hook that is firing
	 * @param {IPCortex.PBX.mailbox} mailbox The mailbox object that has a state change
	 */
	/**
	 * Hook mailbox(es) based on the mailbox id
	 * @param {String[]} mboxs The mailbox IDs as an array, or NULL for all.
	 * @param {Callback~mailboxCB} callback Called for each mailbox event received.
	 * @return {Number} Hook ID that identifies this hook request, or error code (< 0).
	 * @memberOf IPCortex.PBX
	 */
	function hookMailbox(mboxs, callback) {
		if ( typeof(callback) != 'function' )
			return PBXError.HOOK_BAD_CALLBACK;

		mboxs = [].concat(mboxs);
		var _match = [];
		for ( var x in lookUp.mbx ) {
			if( mboxs == null || Utils.isInArray(mboxs, x) )
				_match.push(x);
		}
		if ( _match.length == 0 )
			return PBXError.HOOK_NO_MBOX;

		gHid++;
		lookUp.hid[gHid] = [];
		for ( var i = 0; i < _match.length; i++ ) {
			lookUp.mbx[_match[i]].hook(callback, {mboxs: _match}, gHid);
			lookUp.hid[gHid].push(lookUp.lookUp.mbx[_match[i]]);
		}
		return gHid;
	}

	/**
	 * Callback from a queue hook. Queue callbacks are stored on a per-hook basis.
	 * @callback Callback~queueCB
	 * @param {Object} filter The filter that was used for this hook
	 * @param {Number} hid The hook ID of the hook that is firing
	 * @param {IPCortex.PBX.queue} queue The mailbox object that has a state change
	 */
	/**
	 * Hook queue(s) based on the queue id
	 * @param {String[]} queues The queue IDs or extensions as an array, or NULL for all.
	 * A queue ID is of the form 'Queue/q_nnn' but can be shortened to 'nnn' if preferred.
	 * 'nnn' will be the same as the Queue's extension number. Use listExtension('Q') to
	 * obtain a list of queues.
	 * @param {Callback~queueCB} callback Called for each queue event received.
	 * @return {Number} Hook ID that identifies this hook request, or error code (< 0).
	 * @memberOf IPCortex.PBX
	 */
	function hookQueue(queues, callback) {
		if ( typeof(callback) != 'function' )
			return PBXError.HOOK_BAD_CALLBACK;

		queues = [].concat(queues);
		var _match = [];
		for ( var i = 0; queues != null && i < queues.length; i++ ) {
			if ( lookUp.que[queues[i]] )
				 _match.push(queues[i]);
			else if ( lookUp.que['Queue/q_' + queues[i]] )
				 _match.push('Queue/q_' + queues[i]);
		}
		if ( _match.length == 0 )
			return PBXError.HOOK_NO_QUEUE;

		gHid++;
		lookUp.hid[gHid] = [];
		for ( var i = 0; i < _match.length; i++ ) {
			lookUp.que[_match[i]].hook(callback, {queues: _match}, gHid);
			lookUp.hid[gHid].push(lookUp.que[_match[i]]);
		}
		return gHid;
	}

	/**
	 * Callback from an XMPP hook
	 * @callback Callback~xmppCB
	 * @param {Object} filter The filter that was used for this hook
	 * @param {Number} hid The hook ID of the hook that is firing
	 * @param {IPCortex.PBX.xmpp} device The XMPP instance that has a state change
	 */
	/**
	 * Hook a contact's XMPP events (State changes)
	 * @param {Number|String} cid Contact ID to hook, or XMPP ID,
	 *  this can be fetched using address.get('xmppid') or room..get('xmppid')
	 * @param {Callback~xmppCB} callback Called for each xmpp event received.
	 * @return {Number} Hook ID that identifies this hook request, or error code (< 0).
	 * @memberOf IPCortex.PBX
	 */
	function hookXmpp(cid, callback) {
		if ( ! cid || typeof(callback) != 'function' )
			return PBXError.HOOK_BAD_CALLBACK;
		var _device = cid;
		if ( isNaN(cid) ) {
			if ( _device.substr(0, 7) != 'Custom/' )
				_device = 'Custom/' + _device;
			if ( _device.search(/^Custom\/.+@.+$/) == -1 )
				return PBXError.HOOK_BAD_XMPP;
			cid = null;
		} else {
			var _user = getUser(cid);
			if ( ! _user || ! _user.cid )
				return PBXError.HOOK_BAD_XMPP;
			_device = 'Custom/' + _user.cid;
		}
		if ( ! lookUp.xmpp[_device] ) {
			lookUp.xmpp[_device] = xmpp.create(_device);
			if ( live.userData.id && _device == 'Custom/' + live.userData.id )
				cH.xmpp = lookUp.xmpp[_device];
		}
		gHid++;
		lookUp.xmpp[_device].hook(callback, {cid: cid, xmpp: _device}, gHid);
		lookUp.hid[gHid] = [lookUp.xmpp[_device]];
		return gHid;
	}

	/**
	 * Callback from an Contact hook
	 * @callback Callback~contactCB
	 * @param {Object} filter The filter that was used for this hook
	 * @param {Number} hid The hook ID of the hook that is firing
	 * @param {IPCortex.PBX.contact} device The Contact instance that has a state change
	 */
	/**
	 * Hook a contact's events (eg. BLF). Used internally by {@link IPCortex.PBX.address}
	 * @param {Number} cid Contact ID to hook
	 * @param {Callback~contactCB} callback Called for each contact event received.
	 * @return {Number|IPCortex.PBX.errors} Hook ID that identifies this hook request, or error code (< 0).
	 * @memberOf IPCortex.PBX
	 */
	function hookContact(cid, callback) {
		if ( ! cid || typeof(callback) != 'function' )
			return PBXError.HOOK_BAD_CALLBACK;
		var _user = getUser(cid);
		if ( ! _user || ! _user.name )
			return PBXError.HOOK_NO_CONTACT;
		if ( ! lookUp.cnt[cid] )
			lookUp.cnt[cid] = contact.create(cid);
		gHid++;
		lookUp.cnt[cid].hook(callback, {cid: cid, name: _user.name}, gHid);
		lookUp.hid[gHid] = [lookUp.cnt[cid]];
		return gHid;
	}

	/**
	 * Callback from a room hook
	 * @callback Callback~roomCB
	 * @param {Object} filter The filter that was used for this hook
	 * @param {Number} hid The hook ID of the hook that is firing
	 * @param {IPCortex.PBX.room} device The room instance that has a state change
	 */
	/**
	 * Hook a chat room's events - Typically new messages
	 * @param {Number} roomid Room ID to hook
	 * @param {Callback~roomCB} callback Called for each room event received.
	 * @return {Number|IPCortex.PBX.errors} Hook ID that identifies this hook request, or error code (< 0).
	 * @memberOf IPCortex.PBX
	 */
	function hookRoom(roomid, callback) {
		if ( typeof(callback) != 'function' )
			return PBXError.HOOK_BAD_CALLBACK;
		if ( ! lookUp.room[roomid] )
			return PBXError.HOOK_NO_ROOM;
		gHid++;
		lookUp.room[roomid].hook(callback, {roomID: roomid}, gHid);
		lookUp.hid[gHid] = [lookUp.room[roomid]];
		return gHid;
	}

	/**
	 * Destroy an existing hook
	 * @param {Number} Hook ID that identifies the hook
	 * @memberOf IPCortex.PBX
	 */
	function unHook(uhid) {
		if ( ! lookUp.hid[uhid] )
			return;
		var _hook = lookUp.hid[uhid];
		lookUp.hid[uhid] = null;
		delete lookUp.hid[uhid];
		delete hidStruct[uhid];

		if ( !_hook || !(Array.isArray(_hook)) )
			return;

		while( _hook.length ) {
			var _h = _hook.shift();
			if ( typeof _h.unhook == 'function' )
				_h.unhook(uhid);
		}
	}

	/**
	 * @return Bool is JsSIP loaded, and are we using HTTPS
	 * @private
	 */
	function haveJsSIP() {
		return (typeof JsSIP == 'object' && live.origURI.substr(0,8) == 'https://' && typeof RTCPeerConnection == 'function' );
	}

	function validateMessage(msg) {
		if ( ! msg.id || ! msg.type ) {
			console.log('malformed special message', msg);
			return false;
		}
		if ( typeof specialFeatures.handlers[msg.type] != 'function' ) {
			console.log('unhandled message type ', msg);
			return false;
		}
		if ( typeof specialFeatures.callbacks[msg.type] != 'function' ) {
			console.log('message type not enabled ', msg);
			return false;
		}
		if ( ! Utils.isInArray(specialFeatures.transports[msg.type], 'chat') ) {
			console.log('message type not enabled for this transport', msg);
			return false;
		}
		return true;
	}

	function enableFeature(feature, callback, tlist) {
		if ( typeof specialFeatures.handlers[feature] != 'function' ) {
			console.log('cannot enable unsupported feature ' + feature);
			return null;
		}
		if ( typeof callback != 'function' ) {
			console.log('cannot enable ' + feature + ' with illegal callback', callback);
			return null;
		}
		if ( ! (Array.isArray(tlist)) ) {
			console.log('cannot enable ' + feature + ' with illegal transport list', tlist);
			return null;
		}
		var allowed = [];
		tlist.forEach(function(v) {
			if ( specialFeatures.handlers[feature]._transports[v] )
				allowed.push(v);
		});
		if ( allowed.length ) {
console.log('ENABLING: "' + feature + '" for transports "' + allowed.join('", "') + '"');
			specialFeatures.callbacks[feature] = callback;
			specialFeatures.transports[feature] = [].concat(allowed);
			return allowed;
		}
		return null;
	}

	function disableFeature(feature) {

	}

	/** @constructs Api */
	var Api = new Class( /** @lends Api.prototype */ {
			_private:
			{
				uid:	1
			},
			/**
			 * Generic class destructor - Must be called manually in JS.
			 * @private
			 */
			destroy: function() {
				var _this = this;
				var _clear = [
					{o: lookUp.dev,		i: device,	k: 'device'},
					{o: lookUp.xmpp,	i: xmpp,	k: 'device'},
					{o: lookUp.room,	i: room,	k: 'roomID'}
				];
				if ( typeof this.pre_destroy == 'function' ) {
					this.pre_destroy();
				}
				/* Unhook all */
				this.unhookall();
				/* Attempt to remove this item from the lookup object */
				for ( var i = 0; i < _clear.length; i++ ) {
					if ( ! (this instanceof _clear[i].i) )
						continue;
					if ( ! this.attr[_clear[i].k] )
						continue;
					if ( _clear[i].o[this.attr[_clear[i].k]] !== this )
						continue;
					_clear[i].o[this.attr[_clear[i].k]] = null;
					delete _clear[i].o[this.attr[_clear[i].k]];
				}
				/* Recursively remove - Do not descend into another classes reference. */
				function remove(object) {
					for ( var _key in object ) {
						if ( ! object[_key] || _key.search(/^_/) != -1 )
							continue;
						if ( typeof(object[_key]) == 'object' && ! object[_key].constructor._isClass && ! object[_key].nodeName )
							remove(object[_key]);
						object[_key] = null;
						delete object[_key];
					}
				}
				remove(this);
			},
			/**
			 * Special unhook-all method for pre-object destruction.
			 * 
			 * @private
			 */
			unhookall: function() {
				while ( this.hooks && this.hooks.length )
					unHook(this.hooks.shift().hid);
				this.hooks = [];
			},
			/**
			 * Generic base-class getter
			 * @param {String|Number} attr Key for data to get.
			 * @returns {*} Attribute value
			 */
			get:	function(attr) {
				if ( ! this.attr )
					return null;
				return this.attr[attr];
			},
			/**
			 * Generic base-class setter
			 * @param {String|Number} attr Key for data to store.
			 * @param value Value to store
			 */
			set:	function(attr, value) {
				if ( ! attr && typeof(value) == 'object' ) {
					for ( var key in value )
						this.attr[key] = value[key];
				} else if ( attr )
					this.attr[attr] = value;
			},
			/**
			 * Generic Hook method.
			 * @param {function} hook The callback function for running this hook
			 * @param {Object} filter Describes the filter used to generate this hook {roomID: roomID}
			 * @param {Number} hid Hook ID number, passed to hook as 2nd parameter
			 */
			hook:	function(callback, filter, hid) {
				if ( ! hid ) {
					gHid++;
					lookUp.hid[gHid] = [this];
					hid = gHid;
				}
				if ( ! filter )
					filter = {};

				if ( Array.isArray(this.hooks) )
					this.hooks.push({run: callback, filter: filter, hid: hid});

				var _this = this;
				function initialCB() {
					callback(filter, hid, _this);
				}
				setTimeout(initialCB, 1);

				return hid;
			},
			/**
			 * Generic unhook method.
			 * @param {Number} hid Hook ID number to remove
			 * @private
			 */
			unhook:	function(hid) {
				if ( Array.isArray(this.hooks) ) {
					for ( var i = this.hooks.length - 1; i >= 0; i-- ) {
						if ( this.hooks[i].hid == hid )
							this.hooks.splice(i, 1);
					}
				}
			},
			_result: function(callback, content) {
				if ( ! callback || ! typeof content == 'string' )
					return;
				if ( content.search(/<response.*result="success"/) != -1 )
					callback(true, content);
				else
					callback(false, content);
			}
		});

	var pc = Api.extend({
		_config:
			{
				timeout:	3500,
				chunkSize:	1000,
			},
		construct:
			function(handler, features, callback) {
				if ( typeof(callback) != 'function' )
					return null;
				var _ice = [];
				var _this = this;
				var _iceTimer = null;
				function state(e) {
					if ( _this._closed() )
						return;
					if ( e.target.iceConnectionState.search(/^(connected|completed)$/) == -1 )
						return;
					callback('connected');
				}
				function ice(e) {
					if ( ! e.candidate )
						return;
					function send() {
						handler.post({type: 'candidates', ice: _ice}, 'transport/signal');
						_iceTimer = null;
						_ice = [];
					}
					_ice.push({
						sdpMLineIndex:	e.candidate.sdpMLineIndex,
						candidate:	e.candidate.candidate
					});
					if ( ! _iceTimer )
						_iceTimer = setTimeout(send, 1000);
				}
				this.attr = {
					pc:		null,
					datacb:		null,
					destroy:	null,
					timeout:	null,
					schannel:	null,
					rchannel:	null,
					complete:	false,
					size:		features.size || null,
					handler:	handler,
					callback:	callback,
					features:	features
				};
				var _pc = new RTCPeerConnection(
					{iceServers: [{url: 'stun:stun.l.google.com:19302'}]},
					{optional: [
						{DtlsSrtpKeyAgreement: true}
					]}
				);
				_pc.oniceconnectionstatechange = state;
				_pc.onicecandidate = ice;
				this.attr.pc = _pc;
				if ( features.audio || features.video ) {
					function media(e) {
						if ( _this._closed() )
							return;
						if ( ! e.stream )
							return;
						callback('remoteMedia', e.stream);
					}
					_pc.onremovestream = media;
					_pc.onaddstream = media;
				}
				if ( features.data ) {
					var _chunks = [];
					var _received = 0;
					var _timeout = null;
					function open() {
						if ( _this._closed() )
							return;
						if ( typeof(_this.attr.datacb) == 'function' )
							_this.attr.datacb();
						_this.attr.datacb = null;
					}
					function close() {
						if ( _this._closed() || _this.attr.complete )
							return;
						_this._error('Data channel closed unexpectedly!');
					}
					function error(e) {
						if ( _this._closed() )
							return;
						_this._error(e.message);
					}
					function timeout() {
						_chunks = [];
						if ( _this._closed() && _received == _this.attr.size )
							return;
						_this._error('Timed out while receiving data!');
					}
					function message(e) {
						if ( _timeout )
							clearTimeout(_timeout);
						if ( _this._closed() ) {
							_chunks = [];
							return;
						}
						_chunks.push(e.data);
						if ( e.data instanceof ArrayBuffer )
							_received += e.data.byteLength;
						else
							_received += e.data.length;
						if ( _received == _this.attr.size ) {
							if ( e.data instanceof ArrayBuffer )
								callback('complete', _chunks);
							else
								callback('complete', _chunks.join(''));
							_this.attr.complete = true;
							_chunks = [];
							return;
						}
						_timeout = setTimeout(timeout, pc._config.timeout);
						callback('transferring', _received);
					}
					function data(e) {
						if ( _this._closed() )
							return;
						_this.attr.rchannel = e.channel;	
						e.channel.onmessage = message;
						e.channel.onerror = error;
						e.channel.onclose = close;
					}
					var _sChannel = _pc.createDataChannel('sendDataChannel', {reliable: true});
					this.attr.schannel = _sChannel;
					_sChannel.onmessage = message;
					_sChannel.onerror = error;
					_sChannel.onclose = close;
					_sChannel.onopen = open;
					_pc.ondatachannel = data;
				}
			},
		pre_destroy:
			function() {
				this.attr.schannel = null;
				this.attr.rchannel = null;
				this.attr.pc = null;
			},
		_closed:
			function() {
				if ( this.attr.pc.iceConnectionState.search(/^(closed|disconnected)$/) == -1 )
					return false;
				var _this = this;
				function destroy() {
					_this.destroy();
				}
				if ( this.attr.timeout )
					clearTimeout(this.attr.timeout);
				if ( this.attr.destroy )
					clearTimeout(this.attr.destroy);
				if ( ! this.attr.complete )
					this.attr.callback('closed', 'Connection closed!');
				this.attr.destroy = setTimeout(destroy, 1000);
				return true;
			},
		_error:	function(msg) {
				if ( this.attr.timeout )
					clearTimeout(this.attr.timeout);
				this.attr.callback('error', msg);
			},
		_setTimeout:
			function(ms) {
				if ( this.attr.timeout )
					return;
				var _this = this;
				function close() {
					_this.error('Timed out waiting for response!');
					_this.close();
				}
				this.attr.timeout = setTimeout(close, ms);
			},
		_clearTimeout:
			function() {
				if ( this.attr.timeout )
					clearTimeout(this.attr.timeout);
			},
		_sendSdp:
			function(sd) {
				this.attr.callback('connecting', sd.sdp);
				this.attr.pc.setLocalDescription(sd);
				this.attr.handler.post(sd, 'transport/signal');
			},
		_setRemoteSdp:
			function(sd) {
				var _this = this;
				function error(e) {
					_this._error(e.message);
				}
				this.attr.pc.setRemoteDescription(new RTCSessionDescription(sd), function() {}, error);
			},
		_candidates:
			function(ice) {
				var _this = this;
				ice = [].concat(ice);
				function error(e) {
					_this._error(e.message);
				}
				while ( ice.length ) {
					var candidate = new RTCIceCandidate(ice.pop());
					this.attr.pc.addIceCandidate(candidate, function() {}, error);
				}
			},
		offer:	function() {
				var _this = this;
				function send(sd) {
					_this._sendSdp(sd);
				}
				function error(e) {
					_this._error(e.message);
				}
				this.attr.pc.createOffer(send, error);
				this._setTimeout(pc._config.timeout);
			},
		_answer:
			function() {
				var _this = this;
				function send(sd) {
					_this._sendSdp(sd);
				}
				function error(e) {
					_this._error(e.message);
				}
				this.attr.pc.createAnswer(send, error);
				this._setTimeout(pc._config.timeout);
			},
		handle:	function(msg) {
				if ( typeof(msg) != 'object' || ! msg.type )
					return;
				switch ( msg.type ) {
					case 'offer':
						this._setRemoteSdp(msg);
						this._answer();
						break;
					case 'answer':
						this._setRemoteSdp(msg);
						this._clearTimeout();
						break;
					case 'candidates':
						this._candidates(msg.ice);
						this._clearTimeout();
						break;
				}
			},
		sendData:
			function(data) {
				if ( typeof(data) != 'string' && ! (data instanceof File) ) {
					this._error('Invalid data type!');
					return;
				}
				var _this = this;
				function send() {
					if ( _this._closed() )
						return;
					var _sent = 0;
					var _tries = 0;
					var _offset = 0;
					var _reader = null;
					var _timeout = null;
					function done() {
						if ( _this._closed() ) {
							if ( _timeout )
								clearTimeout(_timeout);
							return;
						}
						try {
							_this.attr.schannel.send(_reader.result);
						} catch(e) {
							if ( _tries > 9 ) {
								_this._error('Timed out while sending data!');
								return;
							}
							_timeout = setTimeout(done, Math.round(pc._config.timeout / 10));
							_tries++;
							return;
						}
						if ( _reader.result instanceof ArrayBuffer )
							_sent += _reader.result.byteLength;
						else
							_sent += _reader.result.length;
						if ( _sent == _this.attr.size ) {
							if ( _timeout )
								clearTimeout(_timeout);
							_this.attr.callback('complete');
							_this.attr.complete = true;
							return;
						}
						_offset = (_offset + pc._config.chunkSize);
						var _blob = data.slice(_offset, _offset + pc._config.chunkSize);
						if ( data instanceof File )
							_reader.readAsArrayBuffer(_blob);
						else {
							_reader.result = _blob;
							done();
						}
						_this.attr.callback('transferring', _sent);
						_tries = 0;
					}
					var _blob = data.slice(_offset, _offset + pc._config.chunkSize);
					if ( data instanceof File ) {
						_reader = new FileReader();
						_reader.onloadend = done;
						_reader.readAsArrayBuffer(_blob);
					} else {
						_reader.result = _blob;
						done();
					}
				}
				if ( this.attr.schannel && this.attr.schannel.readyState == 'open' )
					send();
				else {
					this.attr.datacb = send;
					this.offer();
				}
			},
		addStream:
			function(stream) {
				try {
					this.attr.pc.addStream(stream);
				} catch ( e ) { 
					_this.attr.callback('error', e.message);
					return false;
				}
				/* Short cut when adding stream if already connected! */
				if ( this.attr.pc.iceConnectionState.search(/^(connected|completed)$/) != -1 )
					this.offer();
				return true;
			},
		removeStream:
			function(stream) {
				try {
					this.attr.pc.removeStream(stream);
				} catch ( e ) {
					_this.attr.callback('error', e.message);
					return false;
				}
				/* Short cut when removing stream if already connected! */
				if ( this.attr.pc.iceConnectionState.search(/^(connected|completed)$/) != -1 )
					this.offer();
				return true;
			},
		close:	function() {
				if ( this.attr.rchannel ) {
					try {
						this.attr.rchannel.close();
					} catch ( e ) {
						console.log(e.message);
					}
				}
				if ( this.attr.schannel ) {
					try {
						this.attr.schannel.close();
					} catch ( e ) {
						console.log(e.message);
					}
				}
				if ( this.attr.pc ) {
					try {
						this.attr.pc.close();
					} catch ( e ) {
						console.log(e.message);
					}
				}
			}
	});
	
	var feature = Api.extend({
		hook:	function(callback, filter, hid) {
				if ( ! hid ) {
					gHid++;
					lookUp.hid[gHid] = [this];
					hid = gHid;
				}
				if ( ! filter )
					filter = {};
				if ( Array.isArray(this.hooks) )
					this.hooks.push({run: callback, filter: filter, hid: hid});
				return hid;
			},
		run:	function() {
				var _hooks = this.hooks;
				for ( var i = 0; i < _hooks.length; i++ )
					_hooks[i].run(_hooks[i].filter, _hooks[i].hid, this);
			},
		_setTimeout:
			function(ms) {
				if ( this.attr.timeout )
					return;
				var _this = this;
				function timeout() {
					_this.update('error', 'Timed out waiting for response!');
					_this.run();
				}
				this.attr.timeout = setTimeout(timeout, ms);
			},
		_clearTimeout:
			function() {
				if ( this.attr.timeout )
					clearTimeout(this.attr.timeout);
			},
		accept:	function(stream) {
				if ( this._setup(stream) ) {
					this.post({command: 'accept'}, this.attr.mime);
					this._setTimeout(pc._config.timeout);
					this.attr.status = 'accepted';
				} else
					this.reject();
			},
		reject:	function() {
				if ( this.attr.status == 'complete' )
					return;
				if ( this.attr.transport ) {
					this.post({command: 'cancel'}, this.attr.mime);
					this.attr.status = 'cancelled';
					this.attr.transport.close();
				} else {
					this.post({command: 'reject'}, this.attr.mime);
					this.attr.status = 'rejected';
				}
				this.run();
			}
	});

	/* Currently specific to PeerConnection and DataChannel */
	var file = specialFeatures.handlers.file = feature.extend({
		_transports:
			{
				chat:	pc /* Array here for multiple transports? */
			},
		construct:
			function(signalling, object, initial) {
				if ( initial )
					throw new Error('Cannot construct file on replayed message!');
				if ( ! (object instanceof File) && (typeof(object) != 'object' || ! object.id) )
					throw new Error('Bad file object!');
				this.attr = {
					id:		object.id || (new Date).getTime(),
					error:		'',
					status:		'unknown',
					mime:		'file/signal',
					progress:	0,
					timeout:	null,
					transport:	null,
					name:		object.name,
					type:		null,
					size:		null,
					file:		null,
					party:		'receive',
					signalling:	signalling
				};
				this.hooks = [];
				/* VALIDATE transport._transport against _transports, else reject! */
				if ( ! file._transports[signalling._transport] )
					throw new Error('Bad file transport!');
				if ( object instanceof File ) {
					this.attr.type = object.type;
					this.attr.size = object.size;
					this.attr.party = 'send';
					this.attr.file = object;
					this.offer();
				}
			},
		update:	function(status, data) {
				if ( this.attr.status.search(/^(rejected|cancelled|complete)$/) != -1 )
					return;
				var _update = true;
				switch ( status ) {
					case 'transferring':
						var _progress = Math.round((data / this.attr.size) * 100);
						if ( _progress > this.attr.progress )
							this.attr.progress = _progress;
						else
							_update = false;
						break;
					case 'complete':
						this.attr.progress = 100;
						if ( data && this.attr.party == 'receive' ) {
							this.attr.file = new Blob(data, {type: this.attr.type});
							this.post({command: 'complete'}, this.attr.mime);
						}
						break;
					case 'error':
						if ( this.attr.transport )
							this.attr.transport.close();
						this.attr.error = data;
						break;
				}
				this.attr.status = status;
				if ( _update )
					this.run();
			},
		_setup:	function() {
				var _this = this;
				function update(status, data) {
					_this.update(status, data);
				}
				if ( ! this.attr.transport ) {
					try {
						this.attr.transport = new file._transports[this.attr.signalling._transport](this, {data: true, size: this.attr.size}, update); 
					} catch ( e ) {
						this.update('error', e.message);
						return false;
					}
				}
				if ( this.attr.file instanceof File )
					this.attr.transport.sendData(this.attr.file);
				return true;
			},
		post:	function(data, mime) {
				this.attr.signalling.post({
					data:	data,
					mime:	mime,
					type:	'file',
					id:	this.attr.id,
					name:	this.attr.name
				});
			},
		offer:	function() {
				this.post({command: 'offer', size: this.attr.size, type: this.attr.type}, this.attr.mime);
			},
		handle:	function(msg, initial) {
				if ( ! msg.mime || ! msg.data )
					return;
				if ( this.attr.status.search(/^(rejected|cancelled|complete)$/) != -1 )
					return;
				var _status = this.attr.status;
				if ( msg.cid == live.userData.id ) {
					if ( msg.data.command && msg.data.command == 'accept' ) {
						if ( this.attr.status == 'accepted' )
							return;
						if ( this.attr.transport )
							this.attr.transport.close();
						this.attr.status = 'cancelled';
					}
				} else if ( msg.mime == this.attr.mime ) {
					switch ( msg.data.command ) {
						case 'offer':
							this.attr.size = msg.data.size;
							this.attr.type = msg.data.type;
							this.attr.status = 'requested';
							break;
						case 'accept':
							if ( ! this._setup() )
								this.reject();
							break;
						case 'complete':
							if ( this.attr.transport )
								this.attr.transport.close();
							break;
						case 'reject':
							this.attr.status = 'rejected';
							break;
						case 'cancel':
							if ( this.attr.transport )
								this.attr.transport.close();
							this.attr.status = 'cancelled';
							break;
					}
				} else if ( this.attr.transport &&  msg.mime == 'transport/signal' ) {
					this.attr.transport.handle(msg.data);
					this._clearTimeout();
				}
				if ( _status != this.attr.status )
					this.run(initial);
			}
	});

	var video = specialFeatures.handlers.video = feature.extend({
		_config:
			{
				timeout:	60000
			},
		_transports:
			{
				chat:	pc /* Array here for multiple transports? */
			},
		construct:
			function(signalling, object, initial) {
				if ( initial )
					throw new Error('Cannot construct video on replayed message!');
				if ( ! (object instanceof mediaStream) ) {
					if ( typeof(object) != 'object' || ! object.id || ! object.data )
						throw new Error('Bad offer object!');
					if ( ! object.data.command || object.data.command != 'offer' )
						throw new Error('Cannot construct video using command: ' + object.data.command + '!');
				}
				this.attr = {
					id:		object.id,
					error:		'',
					action:		'',
					party:		'callee',
					status:		'unknown',
					mime:		'video/webm',
					timeout:	null,
					transport:	null,
					localMedia:	{},
					remoteMedia:	{},
					signalling:	signalling
				};
				this.hooks = [];
				if ( ! video._transports[signalling._transport] )
					throw new Error('Bad video transport!');
				if ( object instanceof mediaStream ) {
					this.attr.localMedia[object.id] = object;
					this.attr.id = (new Date).getTime();
					this.attr.party = 'caller';
					this.offer();
				}
			},
		pre_destroy:
			function() {
				this.stop({audio: true, video: true});
				this._clearTimeout();
			},
		update:	function(status, data) {
				if ( this.attr.status.search(/^(rejected|cancelled)$/) != -1 )
					return;
				switch ( status ) {
					case 'remoteMedia':
						if ( ! data.id )
							data.id = randomString(32);
						if ( ! data.ended && ! this.attr.remoteMedia[data.id] )
							this.attr.remoteMedia[data.id] = data;
						break;
					case 'error':
						if ( this.attr.transport )
							this.attr.transport.close();
						this.attr.error = data;
						break;
				}
				if ( status.search(/^(remote|local)Media$/) == -1 )
					this.attr.status = status;
				this.run();
				switch ( status ) { 
					case 'remoteMedia':
						if ( data.ended && this.attr.remoteMedia[data.id] ) {
							this.attr.remoteMedia[data.id] = null;
							delete this.attr.remoteMedia[data.id];
						}
						break;
					case 'closed':
						this.destroy();
						break;
				}
			},
		_setup:	function(stream) {
				var _this = this;
				function update(status, data) {
					_this.update(status, data);
				}
				if ( ! this.attr.transport ) {
					try {
						this.attr.transport = new video._transports[this.attr.signalling._transport](this, {audio: true, video: true}, update); 
					} catch ( e ) {
						this.update('error', e.message);
						return false;
					}
				}
				var _localMedia = this.attr.localMedia;
				if ( ! stream || ! Utils.isEmpty(_localMedia) ) {
					for ( var _id in _localMedia )
						this.attr.transport.addStream(_localMedia[_id]);
					this.attr.transport.offer();
				} else if ( stream instanceof mediaStream ) {
					this.attr.transport.addStream(stream);
					_localMedia[stream.id] = stream;
				}
				return true;
			},
		addStream:
			function(stream) {
				var _this = this;
				function ended(e) {
					_this.update('localMedia');
					if ( _this.attr.transport && e.target.ended )
						_this.removeStream(e.target.id);
				}
				if ( ! (stream instanceof mediaStream) )
					return false;
				if ( ! stream.id )
					stream.id = randomString(32);
				var _localMedia = this.attr.localMedia;
				if ( this.attr.transport && ! _localMedia[stream.id] ) {
					if ( this.attr.transport.addStream(stream) ) {
						_localMedia[stream.id] = stream;
						stream.onended = ended;
						return true;
					}
				}
				return false;
			},
		removeStream:
			function(id) {
				var _localMedia = this.attr.localMedia;
				if ( this.attr.transport && _localMedia[id] ) {
					if ( this.attr.transport.removeStream(_localMedia[id]) ) {
						_localMedia[id] = null;
						delete _localMedia[id];
						return true;
					}
				}
				return false;
			},
		mediaControl:
			function(tracks, id, action) {
				var _media = {};
				if ( id && ! this.attr.localMedia[id] )
					return false;
				else if ( id && this.attr.localMedia[id] )
					_media[id] = this.attr.localMedia[id];
				else
					_media = this.attr.localMedia;
				for ( var _id in _media ) {
					if ( tracks.audio === true || tracks.audio === false ) {
						var _audio = _media[_id].getAudioTracks();
						for ( var i = 0; i < _audio.length; i++ ) {
							if ( action == 'stop' && tracks.audio )
								_audio[i].stop();
							else if ( action == 'mute' )
								_audio[i].enabled = !tracks.audio;
						}
					}
					if ( tracks.video === true || tracks.video === false ) {
						var _video = _media[_id].getVideoTracks();
						for ( var i = 0; i < _video.length; i++ ) {
							if ( action == 'stop' && tracks.video )
								_video[i].stop();
							else if ( action == 'mute' )
								_video[i].enabled = !tracks.video;
						}
					}
				}
				return true;
			},
		mute:	function(tracks, id) {
				return this.mediaControl(tracks, id, 'mute');
			},
		stop:	function(tracks, id) {
				return this.mediaControl(tracks, id, 'stop');
			},
		post:	function(data, mime) {
				this.attr.signalling.post({
					data:	data,
					mime:	mime,
					type:	'video',
					id:	this.attr.id
				});
			},
		offer:	function() {
				this.post({command: 'offer'}, this.attr.mime);
				this._setTimeout(video._config.timeout);
			},
		handle:	function(msg, initial) {
				if ( ! msg.mime || ! msg.data )
					return;
				if ( this.attr.status.search(/^(rejected|cancelled)$/) != -1 )
					return;
				var _status = this.attr.status;
				if ( msg.cid == live.userData.id ) {
					if ( msg.data.command && msg.data.command == 'accept' ) {
						if ( this.attr.status == 'accepted' )
							return;
						if ( this.attr.transport )
							this.attr.transport.close();
						this.attr.status = 'cancelled';
					}
				} else if ( msg.mime == this.attr.mime ) {
					switch ( msg.data.command ) {
						case 'offer':
							this.attr.status = 'requested';
							break;
						case 'accept':
							if ( ! this._setup() )
								this.reject();
							this._clearTimeout();
							break;
						case 'reject':
							this.attr.status = 'rejected';
							break;
						case 'cancel':
							if ( this.attr.transport )
								this.attr.transport.close();
							this.attr.status = 'cancelled';
							break;
					}
				} else if ( this.attr.transport &&  msg.mime == 'transport/signal' ) {
					this.attr.transport.handle(msg.data);
					this._clearTimeout();
				}
				if ( _status != this.attr.status )
					this.run(initial);
			},
		close:	function() {
				if ( ! this.attr.transport ) {
					this.reject();
					this.update('closed');
				} else
					this.attr.transport.close();
			}
	});

	var room = Api.extend( /** @lends IPCortex.PBX.room.prototype */ {
			_transport: 'chat',
			/**
			 * Create a new room when notified via tmpld.pl
			 * @constructs IPCortex.PBX.room
			 * @augments Api
			 * @param {Number} id Contact ID to talk to.
			 * @param {Number} roomid Id number of room for this chat.
			 * @protected
			 */
			construct:
				function(id, roomid) {
					this.attr = {
							id:		id,
							key:		null,
							state:		'new',
							msgs:		[],
							linked:		[],
							joined:		[],
							handles:	{},
							roomID:		roomid,
							roomName:	null,
							name:		null,
							xmppid:		null,
							pushed:		0,
							seen:		0
					};
					this.hooks = [];
					if ( id < 0 && live.xmppRoster[-id] ) {
						this.attr.name = live.xmppRoster[-id].n || live.xmppRoster[-id].d;
						this.attr.xmppid = live.xmppRoster[-id].d;
					} else if ( id > 0 ) {
						this.attr.name = getUser(id).name;
						this.attr.xmppid = id;
					} else
						console.log('ERROR: Got a room with no identifiable name!');
				},
			/**
			 * Request a new chat room be created.
			 * If successful, notification arrives through the {@link Callback~chatCB} callback.
			 * Both the local user and the remote party are 'link'ed to the new room
			 * The local user is 'join'ed to the new room.
			 * This method is accessed via IPCortex.PBX.contact.chat()
			 * @param {Number} cid Contact ID to start communicating with
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 * @private
			 * @static
			 */
			requestNew:	function(cid, callback) {
				var _name = '';
				var _callback = callback;
				function result(txt) {
					Api._result(_callback, txt)
				}
				if ( cid < live.userData.id )
					_name = cid + '||' + live.userData.id + '|ocm' + live.userData.id;
				else
					_name = live.userData.id + '|ocm' + live.userData.id + '|' + cid + '|';
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm',
						'cmd=create&type=room&name=' + _name + 
						'&id=' + (cid < 0 ? live.adminID : cid) + 
						'&autoclean=60', result);
				return PBXError.OK;
			},
			/**
			 * Getter for room data ( [remote contact]id, key, state, linked, joined, roomID, roomName, [remote contact]name, msgs)
			 * @param {String|Number} attr Key for data to get.
			 * @returns {*} Attribute value
			 */
			get:	function(attr) {
				if ( attr == 'msgs' ) {
					var _msgs = [];
					while ( this.attr.msgs.length ) {
						var _msg = this.attr.msgs.shift();
						if ( _msg.cN == 'SYSTEM' )
							continue;
						_msg.own = false;
						if ( _msg.cID == live.userData.id )
							_msg.own = true;
						if ( getUser(_msg.cID) )
							_msg.cN = getUser(_msg.cID).name;
						_msgs.push(_msg);
					}
					return _msgs;
				}
				return this.attr[attr];
			},
			/**
			 * Run all hooks for this room
			 * @private
			 */
			run:	function() {
				var _hooks = this.hooks;
				for ( var i = 0; i < _hooks.length; i++ )
					_hooks[i].run(_hooks[i].filter, _hooks[i].hid, this);
			},
			/**
			 * Add a new hook to this room
			 * @param {Callback~roomCB} hook The callback function for running this hook
			 * @param {Object} filter Describes the filter used to generate this hook {roomID: roomID}
			 * @param {Number} hid Hook ID number, passed to hook as 2nd parameter
			 * @private
			 */
			/**
			 * Remove a hook from this room
			 * @param {Number} hid Hook ID number to remove
			 * @private
			 */
			/**
			 * Called to query the state of the room for updates
			 * @return {Bool} true: Room changed or has msgs waiting, false: Room unchanged or state == dead.
			 * @private
			 */
			update:	function() {
				var _state = this.attr.state;
				var _rName = this.attr.roomName.split('|');
				var _time = Math.floor(new Date().getTime() / 1000);
				if ( _state == 'new' && _rName.length > 1 ) {
					if ( cH.roomCB )
						cH.roomCB(this, cH.initial == 1);
					else
						cH.rooms.push(this);
				}
				if ( this.attr.state != 'dead' ) {
					if ( (this.attr.update + 5) < _time )
						this.attr.state = 'dead';
					else if ( this.attr.linked.length > 1 && this.attr.joined.length < 2 && (this.attr.joined[0] == live.userData.id || this.attr.joined[1] == live.userData.id) )
						this.attr.state = 'invited';
					else if ( this.attr.linked.length < 2 )
						this.attr.state = 'closed';
					else if ( _rName[1] == '' || _rName[3] == '' )
						this.attr.state = 'inviting';
					else
						this.attr.state = 'open';
				}
				if ( this.attr.state == 'dead' && _state == 'dead' ) {
					this.destroy();
					return false;
				}
				if ( this.attr.state != _state || (this.attr.roomName.search(/^_\d+_$/) == -1 && this.attr.msgs.length) )
					return true;
				return false;
			},
			/**
			 * Post a message to the chat server
			 * @param {String} msg Message string
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 * This callback does not determine the success of the request, just that is was a valid request based on initial
			 * checks.
			 */
			post:	function(msg, callback) {
					if ( typeof msg != 'string' ) {
console.log('Handling special message in chat post');
						if ( ! validateMessage(msg) )
							return;
						var res = 'ipc-' + msg.type + ':' + live.userData.id + ':';
						res += (msg.mime || 'application/octet-stream') + ';base64,';
						res += base64encode(JSON.stringify({id: msg.id, data: msg.data, name: (msg.name || '')}));
						msg = res;
					}
					var _this = this;
					function result(txt) {
						if ( callback )
							_this._result(callback, txt)
					}
					this.link();	/* No-Op most of the time */
					this.join();	/* No-Op most of the time */
					Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 
							'cmd=post' + 
							'&key=' + this.attr.key +
							'&roomID=' + this.attr.roomID +
							'&msg=' + encodeURIComponent(msg), result);
				},
			sendfile:
				function(data) {
					var _handler = file.create(this, data);
					if ( _handler )
						this.attr.handles[_handler.get('id')] = _handler;
					return _handler;
				},
			videochat:
				function(stream) {
					var _handler = video.create(this, stream);
					if ( _handler )
						this.attr.handles[_handler.get('id')] = _handler;
					return _handler;
				},
			/**
			 * Link remote party to a room.
			 * @private
			 */
			link:	function() {
				if ( this.attr.linked[0] == this.attr.id || this.attr.linked[1] == this.attr.id )
					return PBXError.CHAT_ALREADY_LINKED;
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm',
						'cmd=link&type=room' +
						'&id=' + this.attr.id +
						'&roomID=' + this.attr.roomID);
				return PBXError.OK;
			},
			/**
			 * Join local user to a room. A user must be joined to a room before they can receive messages.
			 * It is how a request to chat is accepted.
			 */
			join:	function() {
				if ( this.attr.joined[0] == live.userData.id || this.attr.joined[1] == live.userData.id ) {
					var _resource = 'ocm' + live.userData.id;
					var _rName = this.attr.roomName.split('|');
					if ( _rName[1] == _resource || _rName[3] == _resource )
						return PBXError.CHAT_ALREADY_JOINED;
				}
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm',
						'cmd=join' +
						'&roomID=' + this.attr.roomID);
				return PBXError.OK;
			},
			/**
			 * Leave (un-join) local user from a room. But do not unlink
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 * This callback does not determine the success of the request, just that is was a valid request based on initial
			 * checks.
			 */
			unjoin:	function(callback) {
				var _callback = callback;
				var _this = this;
				function result(txt) {
					_this._result(_callback, txt)
				}
				var _leave = false;
				var _resource = 'ocm' + live.userData.id;
				var _rName = this.attr.roomName.split('|');
				if ( _rName[0] == live.userData.id && (_rName[1] == _resource || _rName[1] == '') )
					_leave = true;
				else if ( _rName[2] == live.userData.id && (_rName[3] == _resource || _rName[3] == '') )
					_leave = true;
				else if ( _rName[0] == '_' + live.userData.id + '_' )
					_leave = true;
				if ( _leave )
					Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm',
							'cmd=unjoin' +
							'&key=' + this.attr.key + 
							'&roomID=' + this.attr.roomID, result);
				else if ( typeof callback == 'function' )
					callback(false, '');
			},
			/**
			 * Leave (un-join) local user from a room. This also unlinks the user, effectively closing the room.
			 * It is how a chat room is closed.
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 * This callback does not determine the success of the request, just that is was a valid request based on initial
			 * checks.
			 */
			leave:	function(callback) {
				var _callback = callback;
				var _this = this;
				function result(txt) {
					if ( _this && _this.attr )
						_this.attr.pushed = 0;
					_this._result(_callback, txt)
				}
				var _leave = false;
				var _resource = 'ocm' + live.userData.id;
				var _rName = this.attr.roomName.split('|');
				if ( _rName[0] == live.userData.id && (_rName[1] == _resource || _rName[1] == '') )
					_leave = true;
				else if ( _rName[2] == live.userData.id && (_rName[3] == _resource || _rName[3] == '') )
					_leave = true;
				else if ( _rName[0] == '_' + live.userData.id + '_' )
					_leave = true;
				if ( _leave )
					Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm',
							'cmd=leave' +
							'&key=' + this.attr.key + 
							'&roomID=' + this.attr.roomID, result);
				else if ( typeof callback == 'function' )
					callback(false, '');
			},
			/**
			 * Add a message to the room's message queue (inbound from server)
			 * If it is a formatted message, hand it off to the right handler.
			 * @param {String} msg The message to add.
			 * @private
			 */
			push:	function(msg) {
				/* Dropping dupe message id */
				if ( msg.msgID <= this.attr.pushed )
					return;
				this.attr.pushed = msg.msgID;
				var _tmp = msg.msg.match(/^ipc-(\w+):([\d\-]+):([\w\-]+\/[\w\-]+);base64,(.*)$/);
				if ( Array.isArray(_tmp) ) {
					var _msg = {
						type:		_tmp[1],
						cid:		_tmp[2],
						mime:		_tmp[3],
						encoding:	'base64'
					};
					var _body = null;
					try {
						_body = JSON.parse(base64decode(_tmp[4]));
					} catch ( e ) {
						console.log('Error decoding special message:', e);
						return;
					}
					if ( ! _body || typeof(_body) != 'object' || ! _body.id ) {
						console.log('unhandled message content ', _tmp[4]);
						return;
					}
					_msg.id = _body.id;
					_msg.data = _body.data;
					_msg.name = _body.name;
					var _handler = this.attr.handles[_msg.id];
					if ( ! validateMessage(_msg) )
						return;
					if ( _handler ) {
						_handler.handle(_msg, cH.initial == 1);
						return;
					}
					try {
						_handler = specialFeatures.handlers[_msg.type].create(this, _msg, cH.initial == 1);
					} catch ( e ) {
						console.log(e.message);
						return;
					}
					_handler.handle(_msg, cH.initial == 1);
					/* Callback to enabler of feature to tell them */
					if ( typeof specialFeatures.callbacks[_msg.type] == 'function' ) 
						specialFeatures.callbacks[_msg.type](_handler, cH.initial == 1);
					this.attr.handles[_msg.id] = _handler;
					return;
				}
				this.attr.msgs.push(msg);
			},
			/**
			 * Flush the message queue for this room.
			 * @private
			 */
			clear:	function() {
				this.attr.msgs = [];
			}
		});


	var call = Api.extend( /** @lends IPCortex.PBX.call.prototype */ {
			/**
			 * Create a new call when notified via tmpld.pl
			 * @constructs IPCortex.PBX.call
			 * @augments Api
			 * @param {String} id Call unique asterisk id 
			 * @param {String} cid Call id, unique per device
			 * @param {IPCortex.PBX.device} device Device instance the call is on
			 * @param {String} callerid callerID for local end of the call
			 * @todo is the detail for callerid correct???
			 * @protected
			 */
			construct: function(id, cid, device, callerid) {
				this.attr = {
						start:		null,
						end:		null,
						inq:		null,
						outq:		null,
						dial:		null,
						state:		null,
						party:		null,
						session:	null,
						nrstate:	null,
						brstate:	null,
						stamp:		(new Date()).getTime(),
						id:		id,
						cid:		cid,
						brcid:		false,
						device:		device,
						extension:	'',
						extname:	'',
						number:		'',
						name:		'Calling...',
						uid:		new Number(Api._private.uid)
				};
				Api._private.uid++;
			},
			/**
			 * Fetch data about the call. Also allows 'features' to be fetched from the device this call is on.
			 * @param {String} [attr] Key for data to get.
			 * __id__: Unique call ID
			 * __stamp__: Call creation time
			 * __start__: Call start time
			 * __end__: Call end time
			 * __inq__: Queued call - time into Queue
			 * __outq__: Queued call - time out of Queue
			 * __name__: Caller name, or best we have so far
			 * __number__: Caller number, or best indication we have so far
			 * __extension__: The extension the call was originally sent to
			 * __extname__: The extension name the call was originally sent to
			 * __nrState__: Near end state, one of - null, 'down', 'dialing', 'ring', 'ringing', 'park', 'hold'
			 * __brState__: Bridge state, one of - null, 'down', 'dialing', 'ring', 'ringing', 'park', 'hold'
			 * __state__: Combination of nrState and brState, one of - 'down', 'dial', 'call', 'ring', 'up', 'park', 'hold'
			 * __party__: 'caller' or 'callee'
			 * __device__: Reference to the parent device for this call
			 * __features__: Indication of supported device features (answer|hold|talk) as a comma separated list.
			 * @returns {*} Attribute value
			 */
			get:	function(attr) {
				if ( attr == 'features' )
					return this.attr.device.get('features');
				return this.attr[attr];
			},
			/**
			 * Bridge two calls in an attended transfer. One call is "this" call, the other is as described by the paramaters.
			 * @param {String} cid Destination Call id, unique per device
			 * @param {String} device Device that cid is found on.
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 * This callback does not determine the success of the request, just that is was a valid request based on initial
			 * checks.
			 */
			atxfer:	function(cid, device, callback) {
				var _callback = callback;
				var _this = this;
				function result(txt) {
					_this._result(_callback, txt)
				}
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 
						'cmd=attended' + 
						'&attended=' + this.attr.cid +
						'&device=' + this.attr.device.get('device') +
						'&dest=' + cid +
						'&ddevice=' + device, result);
			},
			/**
			 * Blind transfer this call to a number
			 * @param {String} number Destination number for blind transfer
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 * This callback does not determine the success of the request, just that is was a valid request based on initial
			 * checks.
			 */
			xfer:	function(number, callback) {
				var _callback = callback;
				var _this = this;
				function result(txt) {
					_this._result(_callback, txt)
				}
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 
						'cmd=transfer' + 
						'&transfer=' + this.attr.cid +
						'&number=' + number +
						'&device=' + this.attr.device.get('device'), result);
			},
			/**
			 * Hangup this call
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 * This callback does not determine the success of the request, just that is was a valid request based on initial
			 * checks.
			 */
			hangup:	function(callback) {
				var _this = this;
				var _callback = callback;
				function result(txt) {
					_this._result(_callback, txt)
				}
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 
						'cmd=hangup' + 
						'&hangup=' + this.attr.cid +
						'&device=' + this.attr.device.get('device'), result);
			},
			/**
			 * Un-hold (if held) or answer (if ringing) this call
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 * This callback does not determine the success of the request, just that is was a valid request based on initial
			 * checks.
			 */
			talk:	function(callback) {
					var _this = this;
					function result(txt) {
						_this._result(callback, txt)
					}
					if ( this.attr.session ) {
						if ( this.attr.nrstate == 'ringing' ) 
							this.attr.session.answer({mediaConstraints: {audio: true, video: false}});
						else if ( typeof(this.attr.session.unhold) == 'function' )
							this.attr.session.unhold();
					} else {
						Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm',
								'cmd=talkhold' +
								'&hold=talk' +
								'&call=' + this.attr.cid + 
								'&device=' + this.attr.device.get('device'), result);
					}
				},
			/**
			 * Put this call on hold.
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 * This callback does not determine the success of the request, just that is was a valid request based on initial
			 * checks.
			 */
			hold:	function(callback) {
					var _this = this;
					function result(txt) {
						_this._result(callback, txt)
					}
					if ( this.attr.session ) {
						if ( typeof(this.attr.session.hold) == 'function' )
							this.attr.session.hold();
					} else {
						Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm',
								'cmd=talkhold' +
								'&hold=hold' +
								'&call=' + this.attr.cid + 
								'&device=' + this.attr.device.get('device'), result);
					}
				},
			mute:	function(mute) {
					if ( typeof(callback) != 'function' )
						return;
					if ( ! this.attr.session )
						return callback(PBXError.MUTE_NO_SESSION); 
					if ( typeof(mute) != 'boolean' )
						return callback(PBXError.MUTE_INVALID_REQUEST);
					if ( mute )
						this.attr.session.mute();
					else
						this.attr.session.unmute();
				},
			dtmf:	function(tone, callback) {
					if ( typeof(callback) != 'function' )
						return;
					if ( ! this.attr.session )
						return callback(PBXError.DTMF_NO_SESSION); 
					if ( tone.length > 1 )
						return callback(PBXError.DTMF_MANY_DIGITS);
					var _options = {
						eventHandlers: {
							failed:	function () {
									callback(PBXError.DTMF_SEND_FAIL);
								}
						}
					};
					var _dtmf = new JsSIP.RTCSession.DTMF(this.attr.session);
					_dtmf.send(tone, _options);
				}
		});

	var xmpp = Api.extend( /** @lends IPCortex.PBX.xmpp.prototype */ {
			_show:	{
				online:	{score: 4, desc: 'Online'},
				away:	{score: 3, desc: 'Away'},
				xa:	{score: 2, desc: 'Not Available'},
				dnd:	{score: 1, desc: 'Do not Disturb'}
			},
			/**
			 * Create a new XMPP entity when notified via tmpld.pl.
			 * XMPP entities can be local to the PABX, or remote contacts also.
			 * @constructs IPCortex.PBX.xmpp
			 * @augments Api
			 * @param {String} device The 'Custom/' node that refers to the entity.
			 * @protected
			 */
			construct: function(device, loggedin) {
				this.attr = {
						blf:		0,
						show:		'',
						desc:		'',
						xmpp:		{},
						eXxmpp:		{},
						online:		false,
						phone:		false,
						device:		device
				};
				this.hooks = [];
			},
			/**
			 * XMPP Getter
			 * @param {String|Number} attr Key for data to get.
			 *
			 * 'show': returns String - Selected online status ( '' | 'online' | 'dnd' | 'away')
			 *  
			 * 'xmpp': returns Object containing 'show' and 'status' values for XMPP state that has been set via the API.
			 * 
			 * 'states': returns Object keyed on XMPP resource containing 'show', 'status' and 'desc' for each. It will
			 * include the values from 'xmpp' above after a short processing delay.
			 *
			 * 'device': an internal device reference for this XMPP object.
			 *
			 * 'blf': Always 0 - Placeholder in case BLF is expected.
			 *
			 * 'phone': Always false - Placeholder in case handset state is expected.
			 *
			 * 'roster': null if invalid, else an object with the following attributes set if true:
			 * _RECEIVING_ (Can receive presence), _SENDING_ (Am sending presence), _CHAT_ (Sending and Receiving. Can chat),
			 * _SEND_REQ_ (Remote has requested us to send), _RECV_REQ_ (Local has request to receive), _conn_ (connection ID)
			 *
			 * @returns {*} Attribute value
			 */
			get:	function(attr) {
				var _id = this.attr.device.substr(7);
				if ( attr == 'xmppid' ) {
					/* We now return cid, not uname */
					// if ( getUser(_id) )
					// 	_id = getUser(_id).uname;
					return _id;
				}
				if ( attr == 'email' && ! getUser(_id) ) {
					return _id;
				}
				if ( attr == 'states' )
					return this.attr.eXxmpp;
				if ( attr == 'roster' )
					return xmpp._makeroster(_id);
				return this.attr[attr];
			},
			/**
			 * Turn the numeric roster value into something better.
			 * @private
			 */
			_makeroster:	function(id) {
				var flags = 0;
				var conn = null;
				if ( ! isNaN( id ) && ( id == live.userData.id || ! getUser(id) ) )
					flags = 15;
				for ( var i in live.xmppRoster ) {
					if ( live.xmppRoster[i].d == id ) {
						flags = live.xmppRoster[i].f;
						conn = i;
						break;
					}
				}
				var _r = [
					/* 0 */ {NONE: true},
					/* 1 */ {RECEIVING: true},
					/* 2 */ {SENDING: true},
					/* 3 */ {RECEIVING: true, SENDING: true, CHAT: true},
					/* 4 */ {SEND_REQ: true},
					/* 5 */ {RECEIVING: true, SEND_REQ: true},
					/* 6 */ null,
					/* 7 */ null,
					/* 8 */ {RECV_REQ: true},
					/* 9 */ null,
					/* 10 */ {SENDING: true, RECV_REQ: true},
					/* 11 */ null,
					/* 12 */ {SEND_REQ: true, RECV_REQ: true},
					/* 13 */ null,
					/* 14 */ null,
					/* 15 */ null
					][flags];
				if ( _r )
					_r.flags = flags;
				if ( _r && conn )
					_r.connId = conn;
				return _r;
			},
			/**
			 * Request permission to receive far end's state.
			 */
			xmppReq:	function(_r) {
				var _this = this;
				_r = _r || this.get('roster');
				if ( ! _r )
					return PBXError.XMPP_NOT_XMPP;
				if ( _r.RECEIVING )
					return PBXError.XMPP_ALREADY_RECV;

				function done() {
					var _count = 4;
					function check() {
						if ( flags.parsing.roster ) {
							setTimeout(check, 250);
							return;
						}
						_count--;
						_r = _this.get('roster');
						if ( _r && (_r.RECV_REQ || _r.RECEIVING) )
							return _addressReady();	/* Push roster changes withour reloading addresses or users. */
						if ( ! _r || _count < 1 )
							return;
						getRoster();
						setTimeout(check, 750);
					}
					check();
				}
				if ( ! _r.connId && ! isNaN( this.attr.device.substr(7) ) )
					Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=connect&cid=' + this.attr.device.substr(7), done);
				else if ( ! _r.connId )
					Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=connectext&jid=' + this.attr.device.substr(7), done);
				else
					Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=request&id=' + _r.connId, done);
				return PBXError.OK;
			},
			/**
			 * Auth far end to see my state.
			 */
			xmppAuth:	function(_r) {
				var _this = this;
				_r = _r || this.get('roster');
				if ( ! _r )
					return PBXError.XMPP_NOT_XMPP;
				if ( _r.SENDING )
					return PBXError.XMPP_ALREADY_AUTHED;
				if ( ! _r.connId )
					return PBXError.XMPP_NO_CONN;

				function done() {
					/* Auth implies request if needed */
					if ( ! _r.RECEIVING && ! _r.RECV_REQ )
						return _this.xmppReq(_r);
					var _count = 4;
					function check() {
						if ( flags.parsing.roster ) {
							setTimeout(check, 250)
							return;
						}
						_count--;
						_r = _this.get('roster');
						if ( _r && _r.SENDING )
							return _addressReady();	/* Push roster changes withour reloading addresses or users. */
						if ( ! _r || _count < 1 )
							return;
						getRoster();
						setTimeout(check, 750);
					}
					check();
				}
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=accept&id=' + _r.connId, done);
				return PBXError.OK;
			},
			/**
			 * De-Auth far end to see my state and delete association.
			 */
			xmppDel:	function(_r) {
				var _this = this;
				_r = _r || this.get('roster');
				if ( ! _r )
					return PBXError.XMPP_NOT_XMPP;
				if ( ! _r.connId )
					return PBXError.XMPP_NO_CONN;

				function done() {
					var _count = 4;
					function check() {
						if ( flags.parsing.roster ) {
							setTimeout(check, 250)
							return;
						}
						_count--;
						var _r = _this.get('roster');
						if ( ! _r || _r.NONE )
							return _addressReady();	/* Push roster changes withour reloading addresses or users. */
						if ( _count < 1 )
							return _addressReady(); /* Perhaps undo assumption about successful deletion */
						getRoster();
						setTimeout(check, 1500);
					}
					check();
				}
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=disconnect&id=' + _r.connId, done);

				/* Pre-emptive assumption of success */
				delete live.xmppRoster[_r.connId];
				_addressReady();

				return PBXError.OK;
			},
			/**
			 * Run all hooks on this XMPP entity.
			 * @private
			 */
			run:	function() {
				var _hooks = this.hooks;
				var _device = this.attr.device;
				if ( typeof(cH.presenceCB) == 'function' ) {
					/* XMPP presence information for logged in person. */
					if ( live.userData.id && _device == 'Custom/' + live.userData.id )
						cH.presenceCB(this);
				}
				for ( var i = 0; i < _hooks.length; i++ )
					_hooks[i].run(_hooks[i].filter, _hooks[i].hid, this);
			},
			/**
			 * Add a new hook to this xmpp entity
			 * @param {Callback~xmppCB} hook The callback function for running this hook
			 * @param {Object} filter Describes the filter used to generate this hook {cid: contactID, xmpp: xmppDevice}
			 * @param {Number} hid Hook ID number, passed to hook as 2nd parameter
			 * @private
			 */
			/**
			 * Remove a hook from this room
			 * @param {Number} hid Hook ID number to remove
			 * @private
			 */
			/**
			 * Update this XMPP entity's headline presence information using the highest priority XMPP status.
			 * Also stores all received presence frames in a cache for later replay.
			 * @param {Object} presence The eXxmpp presence data from tmpld.pl
			 * @private
			 */
			status: function(eXxmpp, outboundXmpp) {
				eXxmpp = eXxmpp || {};
				var _priority = 0;
				this.attr.show = '';
				this.attr.desc = '';
				this.attr.eXxmpp = {};
				this.attr.online = false;
				if ( outboundXmpp )
					this.attr.xmpp = {show: outboundXmpp.show, status: outboundXmpp.status == 'undefined' ? null : Utils.doDecodeState(outboundXmpp.status)};
				for ( _resource in eXxmpp ) {
					this.attr.online = true;
					var _show = eXxmpp[_resource].s == '' ? 'online' : eXxmpp[_resource].s;
					var _status = Utils.doDecodeState(eXxmpp[_resource].t) == 'undefined' ? '' : Utils.doDecodeState(eXxmpp[_resource].t);
					if ( ! xmpp._show[_show] )
						continue;
					if ( xmpp._show[_show].score > _priority ) {
						this.attr.show = _show;
						_priority = xmpp._show[_show].score;
						this.attr.desc = xmpp._show[_show].desc;
					}
					this.attr.eXxmpp[_resource] = {show: _show, desc: xmpp._show[_show].desc, status: _status};
				}
				/* No run() needed here. The caller deals with that */
			},
			/**
			 * Update the state/status of the local user's XMPP entity. Called via {@link IPCortex.PBX.setStatus}
			 * @param {String} show (online|away|xa|dnd)
			 * @param {String} status Free text status description
			 * @private
			 */
			setStatus: function(show, status) {
				show = show || this.attr.xmpp.show || '';
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=status&show=' + show + '&status=' + (status || ''));
			},
			/**
			 * Create a new chat room with this contact
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 */
			chat:	function(callback) {
				if ( ! this.attr.online )
					return PBXError.CHAT_USER_OFFLINE;
				for ( var _key in live.xmppRoster ) {
					if ( live.xmppRoster[_key].d == this.attr.device.substr(7) )
						return room.requestNew(0 - _key, callback);
				}
				return PBXError.CHAT_NO_ROSTER;
			}
		});

	var device = Api.extend( /** @lends IPCortex.PBX.device.prototype */ {
			_callState:
			{
				'null':  {'null': 'down', down: 'down', dialing: 'dial', ring: 'ring', ringing: 'ring', up: 'ring', park: 'ring', hold: 'ring'},
				down:    {'null': 'down', down: 'down', dialing: 'dial', ring: 'ring', ringing: 'ring', up: 'ring', park: 'ring', hold: 'ring'},
				dialing: {'null': 'dial', down: 'dial', dialing: 'dial', ring: 'ring', ringing: 'ring', up: 'call', park: 'call', hold: 'call'},
				ring:    {'null': 'ring', down: 'ring', dialing: 'ring', ring: 'ring', ringing: 'ring', up: 'ring', park: 'ring', hold: 'ring'},
				ringing: {'null': 'ring', down: 'ring', dialing: 'ring', ring: 'ring', ringing: 'ring', up: 'ring', park: 'ring', hold: 'ring'},
				up:      {'null': 'ring', down: 'ring', dialing: 'call', ring: 'ring', ringing: 'ring', up: 'up',   park: 'up',   hold: 'up'},
				park:    {'null': 'park', down: 'park', dialing: 'park', ring: 'park', ringing: 'park', up: 'park', park: 'park', hold: 'park'},
				hold:    {'null': 'hold', down: 'hold', dialing: 'hold', ring: 'hold', ringing: 'hold', up: 'hold', park: 'hold', hold: 'hold'}
			},
			/**
			 * Create a new device when notified via tmpld.pl.
			 * @constructs IPCortex.PBX.device
			 * @augments Api
			 * @param {String} device Device name, eg. SIP/phone
			 * @protected
			 */
			construct: function(device) {
				this.attr = {
						blf:		0,
						park:		{name: '', number: ''},
						calls:		{},
						status:		{},
						sessions:	{},
						optout:		[],
						jssip:		null,
						rtcpwd:		null,
						mailbox:	null,
						opttimer:	null,
						agent:		'',
						contact:	'',
						mac:		devToMac[device],
						device:		device,
						history:	false,
						features:	'',	/* A backstop of 'no features' */
						webrtc:		(device.search(/^SIP\/webrtc\d+$/) != -1)
				};
				this.hooks = [];
				if ( this.attr.webrtc && haveJsSIP() ) {
					var _id = device.substr(10);
					this.attr.rtcpwd = webrtcPass['webrtc' + _id];
				}
			},
			/**
			 * Last chance cleanup before destroy runs.
			 * @private
			 */
			pre_destroy: function() {
				if ( this.attr.jssip ) {
					if ( this.attr.jssip.isRegistered() )
						this.attr.jssip.unregister();
					if ( this.attr.jssip.stop )
						this.attr.jssip.stop();
					this.attr.jssip = null;
				}
			},
			/**
			 * Fetch information about this device.
			 * attr of (line, extension, hotdesk, owner, name) fetches the 'primary' extension information for the device.
			 * attr of 'list' fetches the a list of extensions that call this device.
			 * If attr exists on {@link IPCortex.PBX~Phone} then return it otherwise return one of (blf, calls, status, device, mac)
			 * @param {String} attr Key for data to get.
			 * __list__: List of extension objects that call this device {name:, extension:, num:...}. __num__ is display number,
			 *           __extension__ may have _company appended for private extensions.
			 * __mailbox__: Mailbox ID for this device
			 * __line__: Line number for this device
			 * __name__: Primary extension name for this device
			 * __extension__: Primary extension for this device
			 * __scope__: Scope of primary extension if private
			 * __hotdesk__: ???
			 * __owner__: ???
			 * @todo TODO: More attrs here!
			 * @returns {*} Attribute value
			 */
			get: function(attr) {
				var _translate = {
						name:		'n',
						owner:		'o',
						hotdesk:	'h',
						extension:	'e',
						line:		'i',
						list:		'l'
				};
				var _translateList = {
						e:	'extension',
						l:	'link',
						n:	'name',
						o:	'owned',
						t:	'type',
				};
				var _extension = _getExtensionByDevice(this.attr.device);
				if ( attr == 'list' ) {
					var _list = [];
					if ( ! _extension || ! _extension.l )
						return _list;
					for ( var i = 0; i < _extension.l.length; i++ ) {
						var _tmp = {};
						for ( _key in _translateList )
							_tmp[_translateList[_key]] = _extension.l[i][_key];
						_tmp.canopt = extByExt[_tmp.extension].canopt;
						_tmp.num = _tmp.extension.split('_')[0];
						_list.push(_tmp);
					}
					return _list;
				}
				if ( attr == 'mailbox' ) {
					if( this.attr.mailbox && lookUp.mbx[this.attr.mailbox] )
						return lookUp.mbx[this.attr.mailbox];
					return null;
				}
				if ( attr == 'extension' ) {
					return _extension.e ? _extension.e.split('_')[0] : null;
				}
				if ( attr == 'scope' ) {
					return _extension.e ? _extension.e.split('_')[1] : null;
				}
				if ( _translate[attr] )
					return _extension[_translate[attr]];
				var _phone = getPhone(this.attr.mac);
				if ( _phone[attr] )
					return _phone[attr];
				return this.attr[attr];
			},
			/**
			 * Run all hooks on this device
			 * @private
			 */
			run:	function() {
				/* opt in/out queues a device.run() to be sure an update always occurs. */
				if ( this.attr.opttimer )
					clearTimeout(this.attr.opttimer);
				this.attr.opttimer = null;

				var _hooks = this.hooks;
/* TODO: This can filter by called extension if the filter contains an extension number
 * assuming this is even possible ??? Perhaps filter device.get('calls') on just filtered
 * extension.
 */
				for ( var i = 0; i < _hooks.length; i++ )
					_hooks[i].run(_hooks[i].filter, _hooks[i].hid, this);
			},
			/**
			 * Add a new hook to this device
			 * @param {Callback~xmppCB} hook The callback function for running this hook
			 * @param {Object} filter Describes the filter used to generate this hook {cid: contactID, xmpp: xmppDevice}
			 * @param {Number} hid Hook ID number, passed to hook as 2nd parameter
			 * @private
			 */
			/**
			 * Remove a hook from this device
			 * @param {Number} hid Hook ID number to remove
			 * @private
			 */
			/**
			 * Update the status, blf state and opt in/out data of a device from tmpld.pl data.
			 * @param {String} name Device name
			 * @param {Object} info Data from tmpld.pl on the above device
			 * @private
			 */
			status:	function(name, info) {
				/* Special case for park orbits which have no status */
				/* Not sure about the use/abuse of the park object! */
				if ( name.substr(0,5) == 'Park/' ) {
					this.attr.blf = info.blf;
					this.attr.status = {status: 'up', comment: 'Ok'};
					if ( info.device && ! Utils.isEmpty(info.device.parkedNum) )
						this.attr.park = {
							number:	info.device.parkedNum,
							name:	info.device.parkedName || '',
							start:	new Date()
						};
					else
						this.attr.park = {
							number:	'',
							name:	'',
							start:	null
						};
					return;
				}
				var _device = info.device;
				if ( !_device || ! info.device.status )
					return;
				this.attr.mailbox = _device.mailbox; /* We allow invalid values to be stored and .get() sorts it out */
				var _status = info.device.status;
				var _devStatus = {status: 'down', comment: 'Unknown'};
				if ( _status.search(/^ok/i) != -1 ) 
					_devStatus = {status: 'up', comment: 'Ok'};
				else if ( _status.search(/^unmon/i) != -1 ) {
					_devStatus = {status: 'unknown', comment: 'Unmonitored'};
					if ( name.substr(0,4) == 'SIP/' && _device.regExpires && _device.regExpires > 0 )
						_devStatus = {status: 'up', comment: 'Ok'};
					else if ( name.substr(0,4) != 'SIP/' && _device.ipport && _device.ipport > 0 )
						_devStatus = {status: 'up', comment: 'Ok'};
					else if ( _device.ipport && _device.ipport == 0 )
						_devStatus = {status: 'down', comment: 'Unknown'};
				} else if ( _status.search(/^unreg/i) != -1 )
					_devStatus = {status: 'unknown', comment: 'Unregistered'};
				else if ( _status.search(/^unkno/i) != -1 )
					_devStatus = {status: 'down', comment: 'Unknown'};
				else if ( _status.search(/^unrea/i) != -1 )
					_devStatus = {status: 'down', comment: 'Unreachable'};
				else if ( name.substr(0,4) == 'SIP/' && _device.ipport == 0 )
					_devStatus = {status: 'down', comment: 'Registration expired'};
				else
					_devStatus = {status: 'down', comment: 'Unknown'};
				if ( ! Utils.isEmpty(_device.contact) )
					this.attr.contact = _device.contact;
				if ( ! Utils.isEmpty(_device.agent) )
					this.attr.agent = _device.agent;
				this.attr.status = _devStatus.status;
				this.attr.blf = info.blf;
				if ( info.customData && info.customData.optout )
					this.attr.optout = info.customData.optout.split(',');
				else
					this.attr.optout = [];

				/* Opt in/out may refer to a private extension, if so, say so. */
				for( var i=0; i < this.attr.optout.length; i++ ) {
					if ( extByExt[this.attr.optout[i] + '_' + info.company] )
						this.attr.optout[i] += '_' + info.company;
				}
			},
			/**
			 * Update the calls for this device from tmpld.pl data.
			 * @param {Array} calls An array of call data passed from tmpld.pl
			 * @private
			 */
			update:	function(calls) {
				var _active = {};	// Active calls ignore a Replaces: header.
				for ( var i = 0; i < calls.length; i++ ) {
/* TODO (Perhaps) - Build secondary this.attr.blf_no_hd data for direct dialled, non hotdesk calls.
 * Only necessary on line 1. only necessary if hotdesked_on is set for this device
 * also assumes we even get calls for these devices! Un-hotdesk should reset to blf_no_hd null.
 * 
 * Not sure how useful this is because directed pickup is not accurate enough :(
 *
 * Should this actually be BLF per dialled extension? this.attr.blf[nnn]
 */
					if ( calls[i].party && calls[i].party.toLowerCase() != 'dead' )
						_active[calls[i].ID] = true;	// Active, so will not be Replace'd
				}
				for ( var i = 0; i < calls.length; i++ ) {
					var _call = null;
					if ( this.attr.calls[calls[i].replaces] && ! _active[calls[i].replaces] ) {
						_call = this.attr.calls[calls[i].replaces];
						_call.set(null, {id: calls[i].ID, cid: calls[i].callID});
						this.attr.calls[calls[i].ID] = _call;
						this.attr.calls[calls[i].replaces] = null;
						delete this.attr.calls[calls[i].replaces];
					} else if ( this.attr.calls[calls[i].ID] )
						_call = this.attr.calls[calls[i].ID];
					else if ( calls[i].party.toLowerCase() != 'dead' ) {
						_call = call.create(calls[i].ID, calls[i].callID, this, calls[i].dial || calls[i].callerID);
						this.attr.calls[calls[i].ID] = _call;
						/* Think this is right to capture dialled number for inbound */
						if ( calls[i].dial && calls[i].bridgedTo && calls[i].bridgedTo != '' ) {
							_call.set('extension', calls[i].dial);
							_call.set('extname', calls[i].dialName || '');
						}
					}
					if ( ! _call )
						continue;
					if ( calls[i].party.toLowerCase() == 'dead' ) {
						_call.set(null, {state: 'dead', nrstate: 'dead', brstate: 'dead', session: null, end: (new Date()).getTime()});
					} else {
						var _bridgeState = 'null';
						var _state = calls[i].state || 'null';
						if ( ! Utils.isEmpty(calls[i].party) )
							_call.set('party', calls[i].party.toLowerCase());
						if ( calls[i].bridgedObj ) {
							_bridgeState = calls[i].bridgedObj.state || 'null';
							var _callerID = calls[i].bridgedObj.callerID || '';
							var _callerName = calls[i].bridgedObj.callerName || '';
							if ( _callerName != '' && _callerName != _callerID )
								_call.set(null, {name: _callerName, number: _callerID, brcid: true});
							else if ( _callerID != '' )
								_call.set(null, {name: '', number: _callerID, brcid: true});
							else if ( ! _call.get('brcid') )
								_call.set(null, {name: '(CID Unknown)', number: ''});

							/* Fully bridged call, so default to 'callee' */
							if ( Utils.isEmpty(_call.get('party')) )
								_call.set('party', 'callee');

							/* If came via a queue, copy inq, outq data from bridge and
							 * change 'extension' of call if possible because it is only
							 * possible on a queue when it bridges. Also fix caller/callee
							 * for queue, which is reversed because of Queues */
							if ( ! _call.get('inq') && ! _call.get('outq') && calls[i].bridgedObj.q_time ) {
								_call.set('inq', calls[i].bridgedObj.q_time * 1000);
								_call.set('outq', (new Date()).getTime());
								_call.set('party', 'callee');
							} else if ( calls[i].q_time ) {
								_call.set('party', 'caller');
							} else if ( ! Utils.isEmpty(calls[i].party) && calls[i].party.toLowerCase() == 'callee' &&
								    ! Utils.isEmpty(calls[i].bridgedObj.party) && calls[i].bridgedObj.party.toLowerCase() == 'callee' && calls[i].bridgedObj.dial ) {
								/* Try to flip party on OCM dialled calls. */
								_call.set('party', 'caller');
							}

							/* If we can get a dialled name/number, save them */
							if ( calls[i].bridgedObj.dial && ! _call.get('extension') ) {
								_call.set('extension', calls[i].bridgedObj.dial);
								_call.set('extname', calls[i].bridgedObj.dialName || '');
							}
						} else if ( calls[i].bridgedTo ) {
							_bridgeState = 'up';
							var _bridgeInfo = calls[i].bridgedTo.split(':');
							if ( _bridgeInfo[0] == 'PLAYBACK' ) {
								if ( _call.get('brcid') )
									_call.set('name', 'Playback');
								else
									_call.set(null, {name: 'Playback', number: ''});
							} else if ( _bridgeInfo[0] == 'VOICEMAIL' ) {
								var _vmNum = _bridgeInfo[1].replace(/^[ub]/,'').split(/@/)[0];
								_call.set(null, {name: 'Voicemail', number: _vmNum});
							} else if ( _bridgeInfo[0] == 'MEETME' ) {
								_call.set('name', 'Conference');
								if ( ! _call.get('extension') && calls[i].colp ) {
									_call.set('extension', calls[i].colp);
									_call.set('extname', calls[i].colpName || '');
								}
							} else if ( _bridgeInfo[0] == 'QUEUE' ) {
								if ( calls[i].q_time )
									_call.set('party', 'caller');
								_call.set(null, {name: 'Queue', number: _bridgeInfo[1].substr(2)});
								if ( calls[i].colp )
									_call.set('number', calls[i].colp);
								if ( calls[i].colpName )
									_call.set('name', calls[i].colpName);

								if ( lookUp.qcall[_call.get('id')] != _bridgeInfo[1] ) {
									if ( lookUp.que['Queue/' + lookUp.qcall[_call.get('id')]] )
										lookUp.que['Queue/' + lookUp.qcall[_call.get('id')]].queuecall(_call, calls[i].bridgedTo);
									lookUp.qcall[_call.get('id')] = _bridgeInfo[1];
								}

								if ( ! _call.get('extension') && calls[i].colp ) {
									_call.set('extension', calls[i].colp);
									_call.set('extname', calls[i].colpName || '');
								}
							} else if ( _bridgeInfo[0] == 'CALL' ) {
								_bridgeState = _bridgeInfo[1];
								var _callerID = calls[i].colp || '';
								var _callerName = calls[i].colpName || '';
								if ( _callerName != '' && _callerName != _callerID )
									_call.set(null, {name: _callerName, number: _callerID, brcid: true});
								else if ( _callerID != '' )
									_call.set(null, {name: '', number: _callerID, brcid: true});
								else if ( ! _call.get('brcid') )
									_call.set(null, {name: '(CID Unknown)', number: ''});

								if ( ! _call.get('extension') && calls[i].colp ) {
									_call.set('extension', calls[i].colp);
									_call.set('extname', calls[i].colpName || '');
								}
							}

							/* Bridged to a 'special' node, so default to 'caller' */
							if ( Utils.isEmpty(_call.get('party')) )
								_call.set('party', 'caller');
						} else if ( calls[i].colp )
							_call.set(null, {name: calls[i].colpName, number: calls[i].colp});

						_call.set('nrstate', _state);
						var _stateTok = device._callState[_state][_bridgeState];
						if ( calls[i].holdState == 1 )
							_stateTok = device._callState.hold[_bridgeState];
						if ( ! _call.get('start') && _stateTok.search(/^(up|hold)$/) != -1 )
							_call.set('start', (new Date()).getTime());
						_call.set(null, {brstate: _bridgeState, state: _stateTok, dial: calls[i].dial});
					}
					if ( lookUp.qcall[_call.get('id')] && lookUp.que['Queue/' + lookUp.qcall[_call.get('id')]] )
						lookUp.que['Queue/' + lookUp.qcall[_call.get('id')]].queuecall(_call, calls[i].bridgedTo);
					if ( this.attr.sessions[_call.get('cid')] ) {
						if ( ! _call.get('session') )
							_call.set('session', this.attr.sessions[_call.get('cid')]);
						this.attr.sessions[_call.get('cid')] = null;
						delete this.attr.sessions[_call.get('cid')];
					}
				}
			},
			/**
			 * Enable or disable history callback for this device/line. Defaults to off.
			 * Global callback must be set before this becomes active, but callbacks will
			 * catch-up retrospectively.
			 * @param {Bool} enable true/false to enable/disable respectively
			 */
			history: function(enable) {
				if ( typeof(enable) != 'boolean' )
					return;
				/* Playback any loaded data for this line */
				if ( enable && ! this.attr.history && hI.cache[this.attr.device] ) {
					for ( var i = 0; i < hI.cache[this.attr.device].length; i++ ) {
						if ( ! history.is_dupe(hI.cache[this.attr.device][i]) )
							history.create(hI.cache[this.attr.device][i]);
					}
					hI.cache[this.attr.device] = null;
					delete hI.cache[this.attr.device];
				}
				this.attr.history = enable;
			},
			/**
			 * Remove and detach a call from this device.
			 * @param {IPCortex.PBX.call} call The call instance to remove from the list.
			 * @private
			 */
			remove: function(call) {
				if ( ! call )
					return;
				if ( this.attr.history )
					history.create(call);
				var _id = call.get('id');
				/* Backstop to avoid leaking queue call refs */
				if ( lookUp.qcall[_id] && lookUp.que['Queue/' + lookUp.qcall[_id]] )
					lookUp.que['Queue/' + lookUp.qcall[_id]].queuecall(call, 'dead');
				this.attr.calls[_id] = null;
				delete this.attr.calls[_id];
				/* Ensure any RTCsession objects for this call are cleaned up */
				this.attr.sessions[call.get('cid')] = null;
				call.set('session', null);
				call.destroy();
			},
			/**
			 * Save WebRTC session against the IPC-ID found in the 100 Trying headers
			 * @param {Object} session The session object from jsSIP
			 * @param {Object} headers SIP Headers from jsSIP
			 * @private
			 * @todo Store my X-Ipc-Id for cleanup if I'm destroyed before it's matched
			 */
			trying:
				function(session, headers) {
					var _xIpcId = headers['X-Ipc-Id'];
					var _sessions = this.attr.sessions;
					if ( _xIpcId && _xIpcId.length == 1 && ! _sessions[_xIpcId[0].raw] )
						_sessions[_xIpcId[0].raw.replace(/^-/,'')] = session;
				},
			/**
			 * Attempt to link stored session to call object if session has a remote stream
			 * and run hooks to update front-end.
			 * @param {Object} session The session object from jsSIP
			 * @private
			 */
			progress:
				function(session) {
					if ( session.getRemoteStreams().length == 0 )
						return;
					for ( var _uid in this.attr.calls ) {
						var _call = this.attr.calls[_uid];
						if ( this.attr.sessions[_call.get('cid')] ) {
							if ( ! _call.get('session') )
								_call.set('session', this.attr.sessions[_call.get('cid')]);
                                                	this.attr.sessions[_call.get('cid')] = null;
							delete this.attr.sessions[_call.get('cid')];
						}
                                        }
					this.run();
				},
			/**
			 * Dial a number from this device.
			 * @param {String} number The number to dial
			 * @param {Bool} autohold Request the autohold feature if the handset supports it
			 * @param {Bool} autoanswer Request the autoanswer feature if the handset supports it
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 * This callback does not determine the success of the request, just that is was a valid request based on initial
			 * checks.
			 * @memberOf IPCortex.PBX.device
			 * @instance
			 */
			dial:	function(number, autoanswer, autohold, callback) {
					var _this = this;
					var _callback = callback;
					function result(txt) {
						_this._result(_callback, txt)
					}
					function trying(e) {
						_this.trying(e.sender, e.data.response.headers);
					}
					function progress(e) {
						_this.progress(e.sender);
					}
					if ( haveJsSIP() && this.attr.jssip ) {
						var _options = {
							eventHandlers: {
								trying:		trying,
								progress:	progress,
								accepted:	function(e) { },
								confirmed:	progress,
								ended:		function(e) { },
								failed:		function(e) {
											/* Error callback?? */
										}
							},
							mediaConstraints: {
								audio:	true,
								video:	false
							}
						}
						this.attr.jssip.call('sip:' + number + '@' + live.origHost, _options);
					} else {
						Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm',
								'cmd=call' +
								'&number=' + number + 
								'&autohold=' + (autohold ? '1' : '0') +
								'&autoanswer=' + (autoanswer ? '1' : '0') +
								'&line=' + (this.get('line') || '') +
								'&mac=' + this.attr.mac, result);
					}
				},
			/**
			 * Opt in or out of an extension on this device.
			 * @param {String} extension The extension number to opt in/out of.
			 * @param {Bool} optin true: opt-in, false: opt-out
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 * This callback does not determine the success of the request, just that is was a valid request based on initial
			 * checks.
			 * @return {Bool} false if opt in/out is not allowed for this extension.
			 */
			opt:	function(extension, optin, callback) {
				var _this = this;
				var _callback = callback;
				function do_run() {
					_this.run();
				}
				function result(txt) {
					_this._result(_callback, txt)
				}
				if ( ! extByExt[extension].canopt )
					return false;
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm',
						'cmd=opt' +
						'&opt=' + (optin ? 'in' : 'out') + 
						'&exten=' + extension +
						'&mac=' + this.attr.mac, result);
				if ( ! this.attr.opttimer )
					this.attr.opttimer = setTimeout(do_run, 31000);
				return true;
			},
			/**
			 * Compare 2 devices, returns -1, 0, 1. usable as a sort function.
			 * @param {IPCortex.PBX.device} device The device to compare with
			 * @return {Bool} true: devices are the same.
			 */
			compare:
				function(device) {
					if ( ! device )
						return false;
					if ( this.get('device').substr(0, 10) == 'SIP/webrtc' && device.get('device').substr(0, 10) != 'SIP/webrtc' )
						return -1;
					if ( this.get('device').substr(0, 10) != 'SIP/webrtc' && device.get('device').substr(0, 10) == 'SIP/webrtc' )
						return 1;
					if ( this.get('line') == device.get('line') ) {
						if ( this.get('device') == device.get('device') )
							return 0;
						if ( this.get('device') < device.get('device') )
							return -1;
						return 1;
					}
					if ( this.get('line') == 'H' )
						return -1;
					if ( device.get('line') == 'H' )
						return 1;

					if ( this.get('device') == device.get('device') )
						return this.get('line') < device.get('line') ? -1 : (this.get('line') > device.get('line') ? 1 : 0);
					if ( this.get('device') < device.get('device') )
						return -1;
					return 1;
				},
			enablertc:
				function() {
					if ( ! live.origURI.substr(0,8) == 'https://' )
						return false;
					if ( ! haveJsSIP() )
						return false;
					if ( ! this.attr.rtcpwd )
						return false;
					var _this = this;
					function trying(e) {
						if ( e.data.originator != 'remote' )
							return;
						_this.trying(e.data.session, e.data.request.headers);
					}
					var _config = {
						ws_servers:	'wss://' + live.origHost + ':8089/ws',
						uri:		'sip:' + this.attr.device.substr(4) + '@' + live.origHost,
						password:	this.attr.rtcpwd
					};
					var _jsSip = new JsSIP.UA(_config);
					_jsSip.on('newRTCSession', trying); 
					this.attr.jssip = _jsSip;
					_jsSip.start();
				}
		});

	var history = Api.extend( /** @lends IPCortex.PBX.history.prototype */ {
			/**
			 * Construct a history object from either an old call or from an imported object.
			 * @constructs IPCortex.PBX.history
			 * @augments Api
			 * @param {Object|IPCortex.PBX.call} item The data for the history entry
			 * @protected
			 */
			construct: function(item) {
				var _this = this;
				this.attr = {
						id:		null,
						party:		null,
						start:		null,
						end:		null,
						inq:		null,
						outq:		null,
						note:		null,
						info:		null,
						number:		null,
						extension:	null,
						extname:	null,
						stamp:		null,
						name:		null,
						device:		null,
						devname:	null
				};
				var _initial = false;
				if ( item instanceof call ) {
					for ( var x in this.attr )
						this.attr[x] = item.get(x);
					this.attr.devname = this.attr.device.get('name');
					this.attr.device = this.attr.device.get('device');
					if ( !Utils.isEmpty(this.attr.party) && Utils.isEmpty(this.attr.start) ) {
						if ( this.attr.party == 'callee' )
							this.attr.party = 'missed';
						else
							this.attr.party = 'noanswer';
					}
				} else if ( item instanceof Object ) {
					for ( var x in this.attr )
						this.attr[x] = Utils.isEmpty(item[x]) ? null : item[x];
					_initial = true;
				}
				if ( Utils.isEmpty(this.attr.party) ) {
					/* Is this a bit harsh??? Seems okay so far. */
					this.destroy();
					return null;
				}
				hI.history.push(this);
				hI.updated = (new Date()).getTime();
				if ( hI.cb )
					hI.cb(this, _initial);
			},
			/**
			 * Getter for history
			 * @param {String} attr Key for data to get. Same data as can be fetched for a call.
			 * 
			 * Additionally __remote__ and __remotename__ fetch the name and number of the non-local
			 * call party regardless of call direction.
			 * @returns {*} Attribute value
			 */
			get:	function(attr) {
				if ( attr == 'remote' || attr == 'remotename' ) {
					var num_key = 'number';
					var name_key = 'name';
					if ( this.attr.party == 'caller' || this.attr.party == 'noanswer' ) {
						if ( this.attr.extension )
							num_key = 'extension';
						if ( this.attr.extname )
							name_key = 'extname';
					}
					if( attr == 'remote' )
						return this.attr[num_key];
					return this.attr[name_key];
				}
				return this.attr[attr];
			},
			/**
			 * Dupe-check a history source item. Return false if not a dupe. Returns true if a dupe.
			 * @param {Object} hist Object to dupe check
			 * @private
			 * @static
			 */
			is_dupe:	function(hist) {
				if ( ! hI || ! hI.history || typeof hI.history != 'object' )
					return false;
				var _device;
				if ( hist instanceof call && hist.get('device') )
					_device = hist.get('device').get('device');
				else
					_device = hist.device;
				for ( var i = 0; i < hI.history.length; i++ ) {
					_h = hI.history[i];
					if ( (hist.stamp || null) == _h.attr.stamp && (_device || null) == _h.attr.device &&
					     (hist.name || null) == _h.attr.name && (hist.extension || null) == _h.attr.extension &&
					     (hist.start || null) == _h.attr.start && (hist.end || null) == _h.attr.end &&
					     (hist.id || null) == _h.attr.id )
						return true;
				}
				return false;
			}
		});

	var mailbox = Api.extend( /** @lends IPCortex.PBX.mailbox.prototype */ {
			/**
			 * Construct a mailbox object.
			 * @constructs IPCortex.PBX.mailbox
			 * @augments Api
			 * @param {String} mailbox The data for the mailbox entry
			 * @protected
			 */
			construct: function(mailbox) {
				var _this = this;
				this.attr = {
						oldmsg:		0,
						newmsg:		0,
						device:		mailbox
				};
				this.hooks = [];
			},
			/* TODO: Document the local version of 'get' */
			/**
			 * Update the mailbox info.
			 * @param {Object} info Data from tmpld.pl on the mailbox
			 * @private
			 */
			update: function(info) {
				var _device = info.device;
				if ( !_device )
					return;
				var _prev = this.attr.oldmsg + ',' + this.attr.newmsg;
				if ( _device.oldMessages )
					this.attr.oldmsg = _device.oldMessages;
				if ( _device.newMessages )
					this.attr.newmsg = _device.newMessages;
				var _new = this.attr.oldmsg + ',' + this.attr.newmsg;
				if ( _prev != _new )
					this.run();
			},
			/**
			 * Run all hooks for this mailbox
			 * @private
			 */
			run:	function() {
				var _hooks = this.hooks;
				for ( var i = 0; i < _hooks.length; i++ )
					_hooks[i].run(_hooks[i].filter, _hooks[i].hid, this);
			}
		});

	var queue = Api.extend( /** @lends IPCortex.PBX.queue.prototype */ {
			/**
			 * Construct a queue object.
			 * @constructs IPCortex.PBX.queue
			 * @augments Api
			 * @param {String} queue The data for the queue entry
			 * @protected
			 */
			construct: function(queue) {
				var _this = this;
				this.attr = {
						depth:		0,
						completed:	0,
						abandoned:	0,
						lastcall:	0,
						members:	{},
						queued:		{},
						device:		queue
				};
				this.hooks = [];
			},
			stateStr: {
				0:	'unknown',
				1:	'idle',
				2:	'inuse',
				3:	'busy',
				4:	'unknown',	/* Actually illegal */
				5:	'unavailable',
				6:	'ring',
				7:	'ringinuse',    /* Both ring and inuse */
				8:	'hold'
			},
			/**
			 * Queue getter.
			 * @param {String} attr Key for data to get.
			 * One of the following String values:
			 * 
			 * 'device': returns the Queue device name of the form Queue/q_nnn
			 * 
			 * 'extension': returns the extension number for this queue
			 * 
			 * 'depth': The number of waiting calls
			 * 
			 * 'completed': Calls completed (cleared nightly)
			 * 
			 * 'abandoned': Calls abandoned (cleared nightly)
			 * 
			 * 'total': Same as q.get('completed') + q.get('abandoned')
			 * 
			 * 'members': An object containg members and their state.
			 * The members object is keyed on the device that is called (eg. SIP/queue_2)
			 * and has the following attributes:
			 *    __state__: Device state ('unknown','paused','idle','inuse','busy','unavailable','ring','ringinuse','hold')
			 *    __lastcall__: Timestamp of last call.
			 *    __numcalls__: Number of answered calls today (Total for this device across all queues)
			 *    __device__: Reference to the called device object. Use device.get('calls') to get calls.
			 * 
			 * 'calls': Calls waiting in the Queue.
			 * 
			 * 'queued': An object keyed on call-ID holding all queued calls.
			 *  
			 * @returns {*} Attribute value
			 */
			get:	function(attr) {
				if ( attr == 'extension' )
					return this.attr.device.split('_')[1];
				if ( attr == 'total' )
					return this.attr.completed + this.attr.abandoned;
				if ( this.attr[attr] )
					return this.attr[attr];
			},
			/**
			 * Update the queue info.
			 * @param {Object} info Data from tmpld.pl on the queue
			 * @private
			 */
			update: function(info) {
				var _device = info.device;
				if ( ! _device )
					return;
				this.attr.depth = _device.depth || 0;
				this.attr.completed = _device.complete || 0;
				this.attr.abandoned = _device.abandon || 0;
				this.attr.members = {};
				if ( _device.members ) {
					for ( var i = 0; i < _device.members.length; i++ ) {
						var _mem = _device.members[i];
						var _dev = _mem.location;
						this.attr.members[_dev] = {
									device:	lookUp.dev[_dev],
									state:	'unknown'
						};
						if ( _mem.paused )
							this.attr.members[_dev].state = 'paused';
						else
							this.attr.members[_dev].state = queue.stateStr[_mem.status] || 'unknown';
						if ( _mem.lastCall && _mem.lastCall > this.attr.lastcall )
							this.attr.lastcall = _mem.lastCall;
						this.attr.members[_dev].lastcall = _mem.lastCall || 0;
						this.attr.members[_dev].numcalls = _mem.callsTaken || 0;
/* No longer needed
						this.attr.members[_dev].calls = {};
						if ( lookUp.dev[_dev] ) {
							var _calls = lookUp.dev[_dev].get('calls');
							for ( var j in _calls ) {
								if( _calls[j].get('dial') == null || _calls[j].get('dial') == this.attr.device.substr(8) )
									this.attr.members[_dev].calls[j] = _calls[j];
							}
						}
*/
					}
				}
				this.run();
			},
			/**
			 * Add or remove a call on a queue
			 * @param {Object} call Data from tmpld.pl on the call
			 * @private
			 */
			queuecall: function(call, to) {
				var _id = call.get('id');
				if ( to == 'QUEUE:' + this.attr.device.substr(6) ) {
					this.attr.queued[_id] = call;
					call.attr.inq = call.attr.inq || (new Date()).getTime();
				} else {
					call.attr.outq = call.attr.outq || (new Date()).getTime();
					delete this.attr.queued[_id];
					delete lookUp.qcall[_id]
				}
				this.run();
			},
			/**
			 * Run all hooks for this mailbox
			 * @private
			 */
			run:	function() {
				var _hooks = this.hooks;
				for ( var i = 0; i < _hooks.length; i++ )
					_hooks[i].run(_hooks[i].filter, _hooks[i].hid, this);
			}
		});

	var address = Api.extend( /** @lends IPCortex.PBX.address.prototype */ {
			/**
			 * Construct an addressbook object from a number of sources.
			 * Sources can be eg.: Basic addressbook entry, a PABX contact, and XMPP user.
			 * @constructs IPCortex.PBX.address
			 * @augments Api
			 * @param {String} group The address book pane this is to be displayed under.
			 * @param {Object} item The data for the addressbook entry
			 * @protected
			 */
			construct: function(group, item) {
				var _this = this;
				this.attr = {
						group:		group,
						key:		null,
						canremove:	false,
						canedit:	false,
						isme:		false
				};
				this.hooks = [];
				this.contact = null;	/* Ref to contact object located with this.attr.cid */
				this.xmpp = null;	/* Ref to xmpp object located with this.attr.device */
				var _translate = {
						i:	'cid',
						n:	'name',
						x:	'extension',
						e:	'email',
						d:	'device',
						c:	'company',
						pa:	'pa',
						pi:	'pi'
				};
				if ( item.i ) {						/* Contact based */
					this.attr.key = item.i;
					if ( item.i == live.userData.id )
						this.attr.isme = true;
				} else if ( item.k ) {					/* CSV or personal upload */
					this.attr.key = 'a' + item.k;
					if ( group == 'personal' )
						this.attr.canremove = this.attr.canedit = true;
				} else if ( item.d && item.d.substr(0,6) == "Custom" )	/* Device based (XMPP) */
					this.attr.key = item.d;
				else if ( item.h ) {					/* Remote sync sourced */
					var _s = item.h.split('_');
					if ( live.md5Hash[_s[0]] && parseInt(_s[1]) )
						this.attr.key = live.md5Hash[_s[0]] + '_' + _s[1];
				} else if ( item.x )					/* Extension, no contact */
					this.attr.key = 'e' + item.x + '_' + (item.c || 'default');
				else if ( item.pa )					/* Park */
					this.attr.key = 'p' + item.pa + '_' + (item.c || 'default');
				else if ( item.pi )					/* Pickup */
					this.attr.key = 'p' + item.pi + '_' + (item.c || 'default');
				else {
					console.log("Addressbook item with no key!!! FIXME!");
					console.log(item);
				}
				if ( item.C && live.md5Hash[item.C] ) /* Additional company name info */
					this.attr.companyName = live.md5Hash[item.C];
				for ( var _key in item )
					if ( _translate[_key] )
						this.attr[_translate[_key]] = item[_key];

				/* Park and Pickup */
				if ( item.pa ) {
					this.attr.name = 'Park';
					this.attr.extension = item.pa;
				}
				if ( item.pi ) {
					this.attr.name = 'Pickup ' + item.pi;
					this.attr.device = 'Park/' + item.pi;
					this.attr.extension = item.pi;
				}

				/* We have a cid, so cache name/extension so we can detect changes */
				if( this.attr.cid && getUser(this.attr.cid) ) {
					this.attr.name = getUser(this.attr.cid)['name'] || null;
					this.attr.extension = getUser(this.attr.cid)['extension'] || null;
				}
				this._getRefs();
			},
			/**
			 * Ensure that this.xmpp and this.contact are up to date.
			 * @private
			 */
			_getRefs:	function() {
				if ( ! this.contact && ! isNaN(this.attr.cid) && lookUp.cnt[this.attr.cid] )
					this.contact = lookUp.cnt[this.attr.cid];
				if ( !this.xmpp && this.attr.device && this.attr.device.search(/^Custom\/.+@.+$/) != -1 )
					this.xmpp = lookUp.xmpp[this.attr.device];
			},
			/**
			 * Get attribute from address. This will fetch data from the underlying
			 * contact/contcat-xmpp/contact-device/xmpp/park-orbit.
			 * 
			 * @param {String} attr 
			 * One of the following String values:
			 * 
			 * 'blf': returns a number with one of the following Number values:
			 * __0__: idle
			 * __1__: busy
			 * __2__: ringing
			 * __3__: busy + ringing
			 * 
			 * 'phone' or 'cancall': returns Bool - Phone callable
			 * 
			 * 'online' or 'canchat': returns Bool - Chat online (chatable)
			 * 
			 * 'show': returns String - Selected online status ( '' | 'online' | 'dnd' | 'away')
			 *  
			 * 'xmpp': returns Object containing 'show' and 'status' values for XMPP state that has been set via the API.
			 * 
			 * 'states': returns Object keyed on XMPP resource containing 'show', 'status' and 'desc' for each. It will
			 * include the values from 'xmpp' above after a short processing delay.
			 * 
			 * 'canedit' and 'canremove': return Bool - Can this entry be removed or edited respectively.
			 * 
			 * @returns {*} Attribute value
			 */
			get:	function(attr) {
				var _value = null;
				var _default = {
						blf:	0,
						online: false,
						phone:	false,
						show:	''
				};
			/* Fake phone online status for Park / Non-accessible devices. */
				if ( attr == 'cancall' )
					attr = 'phone';
				if ( attr == 'canchat' )
					attr = 'online';
				if ( attr == 'phone' ) {
					if ( this.attr.pa || this.attr.pi )
						return true;	    /* Park/Pick, always online */
					if ( this.attr.extension ) {
						if ( ! this.attr.cid || ! getUser(this.attr.cid)['phone'] )
							return true;    /* Not associated with a user, always online */
					} else if ( this.attr.device && this.attr.device.search(/^Custom.*@/) != -1 )
							return false;	/* XMPP devices are non-callable */
					var _u = getUser(this.attr.cid);
					var _d = (macToPhn[_u.phone + '' + _u.port] || {devices:[]}).devices[0];
/* TODO: Hotdesk user's handset status ??? */
					if ( ! lookUp.dev[_d] )
						return true;	    /* Not a handset we can access, always online */
				}
			/* Special meanings for photo */
				if ( attr == 'photo' ) {
					_value = live.origURI + live.origHostPort + '/api/image.whtm/';
					if ( this.attr.cid )
						return _value + this.attr.cid + '/';
					else if ( this.attr.device && this.attr.device.search(/^Custom.*@/) != -1 )
						return _value + this.attr.device.substr(7) + '/';

				}
				if ( attr == 'companyName' && this.attr.companyName == null )
					return live.companies[this.get('company')] || ''
				if ( attr.search(/^(group|key|name|extension)$/) != -1 )
					if ( this.attr[attr] != null )
						return this.attr[attr];

				this._getRefs();
				if ( this.contact )
					_value = this.contact.get(attr);
				else if ( this.xmpp )
					_value = this.xmpp.get(attr);
				else if ( this.parkHid && lookUp.dev[this.attr.device] )
					_value = lookUp.dev[this.attr.device].get(attr);
				if ( _value == null ) {
					if( this.attr.cid && getUser(this.attr.cid) )
						_value = getUser(this.attr.cid)[attr];
					else
						_value = this.attr[attr];
				}
				_value = _value || this.attr[attr];
				return _value == null ? _default[attr] : _value;
			},
			/**
			 * Merge an updated copy of this entity into this version of myself.
			 * 
			 * At present, if there is no contact, return false.
			 * 
			 * @param {IPCortex.PBX.address} other The address object to merge.
			 * @private
			 */
			merge:	function(other) {
				var _merge = {
						'name':		true,
						'extension':	true,
						'email':	true,
						'device':	true,
						'company':	true,
						'companyName':	true,
						'pi':		true,
						'pa':		true
				};
				for ( var _key in other.attr )
					if ( _merge[_key] )
						this.attr[_key] = other.get(_key);

				/* Park and Pickup */
				if ( other.get('pa') ) {
					this.attr.name = 'Park';
					this.attr.extension = other.get('pa');
				}
				if ( other.get('pi') ) {
					this.attr.name = 'Pickup ' + other.get('pi');
					this.attr.device = 'Park/' + other.get('pi');
					this.attr.extension = other.get('pi');
				}
			},
			/**
			 * Add a new hook to this addressBook entity. This is a pseudo-hook that actually hooks the
			 * underlying contact entity. 
			 * 
			 * At present, if there is no contact, return false.
			 * 
			 * @param {Callback~addressbookCB} hook The callback function for running this hook
			 * @private
			 */
			hook:	function(callback) {
				var _this = this;
				function update(filter, hid, thing) {
					_this.run(filter, hid, _this);
				}

				/* This is a contact type addressbook entry */
				if ( ! this.contactHid && ! isNaN(this.attr.cid) ) {
					var _tmp = hookContact(this.attr.cid, update);
					if ( _tmp > 0 && lookUp.hid[_tmp] )
						this.contactHid = _tmp;
				}

				/* Handle non contact that is XMPP-able */
				if ( !this.xmppHid && this.attr.device && this.attr.device.search(/^Custom\/.+@.+$/) != -1 )
					this.xmppHid = hookXmpp(this.attr.device, update);

				/* Handle a Park orbit */
				if ( ! this.parkHid && this.attr.device && this.attr.device.search(/^Park\/\d+$/) != -1 ) {
					this.parkHid = hookPark(this.attr.device, update);
				}

				/* We already hooked stuff above, so just add this callback to our list
				 * need to create a new gHid for that */
				gHid++;
				lookUp.hid[gHid] = [this];
				this.hooks.push({run: callback, hid: gHid});

				var _fil = {};
				var _hid = gHid;
				function initialCB() {
					callback(_fil, _hid, _this);
				}
				setTimeout(initialCB, 1);
				return gHid;
			},
			/**
			 * Special unhook method for address entry
			 * @param {Number} hid Hook ID number to remove
			 * @private
			 */
			unhook:	function(hid) {
				if ( ! this.hooks )
					return;
				for ( var i = this.hooks.length - 1; i >= 0; i-- ) {
					if ( this.hooks[i].hid == hid )
						this.hooks.splice(i, 1);
				}
				if ( this.hooks.length == 0 ) {
					if ( this.contactHid )
						unHook( this.contactHid );
					if ( this.xmppHid )
						unHook( this.xmppHid );
					if ( this.parkHid )
						unHook( this.parkHid );
					this.contactHid = null;
					this.xmppHid = null;
					this.parkHid = null;
				}
			},
			/**
			 * Run all hooks on this addressBook entity.
			 * @param {Object} filter Describes the filter used to generate this hook eg. {cid: contactID, name: Name}
			 * @param {Number} hid Hook ID number, passed to hook as 2nd parameter
			 * @param {IPCortex.PBX.contact|*} thing Ref to class that fired the hook.
			 * @private
			 */
			run:	function(filter, hid, thing) {
				var _hooks = this.hooks;
				for ( var i = 0; i < _hooks.length; i++ )
					_hooks[i].run(filter, hid, this);
			},
			/**
			 * Compare this addressbook entry to the supplied one
			 * @param {IPCortex.PBX.address} b Address entry to compare
			 * @return {Bool} true if the items are the same.
			 * @private
			 */
			compare: function(b) {
				var a = this;
				if ( b == null )
					return false;
				if ( a.get('group') != b.get('group') ) 
					return false;
				if ( a.get('company') != b.get('company') )
					return false;
				if ( a.get('companyName') != b.get('companyName') )
					return false;
				if ( a.get('name') != b.get('name') )
					return false;
				if ( a.get('extension') != b.get('extension') )
					return false;
				if ( a.get('device') != b.get('device') )
					return false;
				if ( a.get('email') != b.get('email') )
					return false;
				return true;
			},
			/**
			 * Helper function for sorting addressbook entries.
			 * @param {IPCortex.PBX.address} b Address entry to compare
			 * @return {Number} -1, 0, 1 depending on the difference.
			 * @private
			 */
			sortFn: function(b) {
				var a = this;
				var _groups = {system: 1, company: 2, personal: 3, chat: 4};
				if ( b == null )
					return -1;
				if ( _groups[a.get('group')] < _groups[b.get('group')] ) 
					return -1;
				if ( _groups[a.get('group')] > _groups[b.get('group')] ) 
					return 1;
				if ( a.get('company') == _user.company && b.get('company') != _user.company )
					return -1;
				if ( a.get('company') != _user.company && b.get('company') == _user.company )
					return 1;
				if ( a.get('name') < b.get('name') )
					return -1;
				else if ( a.get('name') > b.get('name') )
					return 1;
				if ( a.get('extension') < b.get('extension') )
					return -1;
				else if ( a.get('extension') > b.get('extension') )
					return 1;
				return 0;
			},
			/**
			 * Request permission to receive far end's XMPP state.
			 */
			xmppReq:	function() {
				this._getRefs();
				if ( this.contact )
					return this.contact.xmppReq();
				else if ( this.xmpp )
					return this.xmpp.xmppReq();
				return PBXError.XMPP_NO_CONTACT;
			},
			/**
			 * Auth far end to see my XMPP state.
			 */
			xmppAuth:	function() {
				this._getRefs();
				if ( this.contact )
					return this.contact.xmppAuth();
				else if ( this.xmpp )
					return this.xmpp.xmppAuth();
				return PBXError.XMPP_NO_CONTACT;
			},
			/**
			 * De-Auth far end to see my XMPP state.
			 */
			xmppDel:	function() {
				this._getRefs();
				if ( this.contact )
					return this.contact.xmppDel();
				else if ( this.xmpp )
					return this.xmpp.xmppDel();
				return PBXError.XMPP_NO_CONTACT;
			},
			/**
			 * Start a chat between the logged in user and this addressbook contact.
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 */
			chat:	function(callback) {
				this._getRefs();
				if ( this.contact )
					return this.contact.chat(callback);
				else if ( this.xmpp )
					return this.xmpp.chat(callback);
				return PBXError.CHAT_NO_CONTACT;
			},
			/**
			 * Delete this address record. Only deletes CSV/personal entries. Triggers an address callback.
			 */
			remove:	function() {
				var _this = this;
				var _key = this.attr.key;
				if ( _key.search(/^a[0-9]+$/) == -1 ) {
					if ( this.get('roster') != null )
						return this.xmppDel();
					return PBXError.ADDR_CANNOT_DEL;
				}
				function parseResult(content) {
					if ( content.search(/<response.*result="success"/) != -1 ) {
						setTimeout( function() { if ( callbacks.getAddressbook ) callbacks.getAddressbook([], [_key]); }, 1 );
						delete lookUp.addr[_key];
						_this.destroy();    /* This should auto-protect any referenced subclasses */
					} else	/* Something out of sync - Recover... */
						getAddressbook();
				}
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=delete&type=address&key=' + _key.substr(1) , parseResult);
				return 0;
			},
			/**
			 * Edit this address record. Only edits CSV/personal entries. Triggers an address callback.
			 */
			edit:	function(name, number, photo) {
				var _this = this;
				var _key = this.attr.key;

				function parseResultPhoto(content) {
					if ( content.search(/<response.*result="success"/) != -1 ) {
						setTimeout( function() { if ( callbacks.getAddressbook ) callbacks.getAddressbook([_this], []); }, 1 );
					} else {
						/* Photo upload failed. What to do ?... */
					}
				}
				if ( photo ) {
					if ( !live.userData || live.userData.id != this.attr.key )
						return PBXError.ADDR_PHOTO_PERM;
					if ( typeof window.FormData == 'function' ) {
						if ( typeof photo != 'string' || photo.substr(0,5) != 'data:' )
							return PBXError.ADDR_PHOTO_BAD;
						if ( photo.substr(5,9) != 'image/png' && photo.substr(5,9) != 'image/gif' && photo.substr(5,9) != 'image/jpg' )
							return PBXError.ADDR_PHOTO_FMT;
						var FD = new FormData();
						FD.append('cmd', 'upload');
						FD.append('type', 'photo');
						FD.append('img', photo);
						Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', FD, parseResultPhoto);
					} else
						return PBXError.ADDR_PHOTO_NOSUPP;

					if ( !name && ! number )	/* Only a photo edit, so return OK */
						return 0;
				}

				/* 'canedit' determines whether name/number can be changed */
				if ( _key.search(/^a[0-9]+$/) == -1 || ! this.attr.canedit )
					return PBXError.ADDR_CANNOT_EDIT;

				function parseResult(content) {
					if ( content.search(/<response.*result="success"/) != -1 ) {
						_this.attr.name = _name;
						_this.attr.extension = _number;
						setTimeout( function() { if ( callbacks.getAddressbook ) callbacks.getAddressbook([_this], []); }, 1 );
					} else	/* Something out of sync - Recover... */
						getAddressbook();
				}
				var _name = name || '';
				var _number = number || '';
				if ( _number.length == 0 && _name.length == 0 )
					return PBXError.ADDR_EDIT_NUMNAME;
				if ( _number.length == 0 )
					return PBXError.ADDR_EDIT_NUM;
				if ( _name.length == 0 )
					return PBXError.ADDR_EDIT_NAME;
				_number = _number.replace(/ /g, '');
				if ( _number.search(/[^0-9\#\*]/) != -1 )
					return PBXError.ADDR_E_ILLEGAL_NUM;
				if ( _name.search(/[^a-zA-Z0-9\.\s\,\'\/\\\-_]/) != -1 )
					return PBXError.ADDR_E_ILLEGAL_NAME;

				/* If no change, do nothing but return OK */
				if ( _name == this.attr.name && _number == this.attr.extension )
					return 0;
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=edit&type=address&key=' + _key.substr(1) +
											'&name=' + _name +
											'&number=' + _number , parseResult);
				return 0;
			}
			
		});


	var contact = Api.extend( /** @lends IPCortex.PBX.contact.prototype */ {
			/**
			 * When you hook a contact or an addressbook entry that is a contact, a contact entity is created.
			 * 
			 * This contact entity auto-hooks XMPP and owned phone for updates
			 * 
			 * @constructs IPCortex.PBX.contact
			 * @augments Api
			 * @param {String} cid Contact ID
			 * @protected
			 */
			construct: function(cid) {
				var _this = this;
				function update() {
					_this.update();	
				}
				this.attr = {
						blf:		0,
						cid:		cid,
						phone:		false
				};
				this.xmpp = null;
				this.hooks = [];
				this.devices = [];
				this.hid = {
						xmpp: hookXmpp(cid, update),
						device: hookDevice(null, [cid], null, null, true, update),
				};
				if ( this.hid.xmpp > 0 )
					this.xmpp = lookUp.hid[this.hid.xmpp][0];
				else
					this.hid.xmpp = null;
				if ( this.hid.device > 0 ) {
					for ( var i = 0; i < lookUp.hid[this.hid.device].length; i++ )
						this.devices.push(lookUp.hid[this.hid.device][i]);
				}
				else
					this.hid.device = null;
			},
			/**
			 * Contact hook method - Same as normal hook but runs child hooks too.
			 * @param {function} hook The callback function for running this hook
			 * @param {Object} filter Describes the filter used to generate this hook {roomID: roomID}
			 * @param {Number} hid Hook ID number, passed to hook as 2nd parameter
			 */
			hook:	function(callback, filter, hid) {
				if ( ! hid ) {
					gHid++;
					lookUp.hid[gHid] = [this];
					hid = gHid;
				}
				if ( ! filter )
					filter = {};

				if ( Array.isArray(this.hooks) )
					this.hooks.push({run: callback, filter: filter, hid: hid});

				var _this = this;
				function initialCB() {
					if ( _this.xmpp )
						_this.xmpp.run();
					if ( _this.devices ) {
						for ( var i = 0; i < _this.devices.length; i++ )
							_this.devices[i].run();
					}
				}
				setTimeout(initialCB, 1);

				return hid;
			},
			/**
			 * Get attribute from contact. This will fetch data from the underlying
			 * contact/contcat-xmpp/contact-device.
			 * 
			 * @param {String} attr 
			 * One of the following String values:
			 * 
			 * 'cid': returns contact ID.
			 * 
			 * 'blf': returns a number with one of the following Number values:
			 * __0__: idle
			 * __1__: busy
			 * __2__: ringing
			 * __3__: busy + ringing
			 * 
			 * 'phone': returns Bool - Phone callable
			 * 
			 * 'online': returns Bool - Chat online (chatable)
			 * 
			 * 'show': returns String - Selected online status ( '' | 'online' | 'dnd' | 'away')
			 *  
			 * 'xmpp': returns Object containing 'show' and 'status' values for XMPP state that has been set via the API.
			 * 
			 * 'states': returns Object keyed on XMPP resource containing 'show', 'status' and 'desc' for each. It will
			 * include the values from 'xmpp' above after a short processing delay.
			 * 
			 * @returns {*} Attribute value
			 */
			get:	function(attr) {
				var _u = getUser(this.attr.cid);
				if ( attr == 'xmppid' && this.xmpp /* && _u */ )
					return this.attr.cid;		 /* was  _u.uname */
				if ( this.xmpp && attr.search(/(show|xmpp|online)/) != -1 )
					return this.xmpp.get(attr);
				if ( this.xmpp && (attr == 'states' || attr == 'roster') )
					return this.xmpp.get(attr);
				if ( this.attr[attr] != null )
					return this.attr[attr];
				if ( attr == 'companyName' )
					return live.companies[this.get('company')] || ''
				if ( _u )
					return _u[attr];
				return null;
			},
			/**
			 * Run all hooks on this contact entity
			 * @private
			 */
			run:	function() {
				var _hooks = this.hooks;
				for ( var i = 0; i < _hooks.length; i++ )
					_hooks[i].run(_hooks[i].filter, _hooks[i].hid, this);
			},
			/**
			 * An XMPP (state) or device (BLF) update has occurred.
			 * @private
			 * @todo Currently we do not check what called us... Can't be that hard!
			 */
			update:	function() {
				var _blf = 0;
				this.attr.phone = null;
				var up = {owned: null, hotdesk: false, webrtc: false}

				/* Roll in any hotdesk BLF state. */
				var _hdDev = null;
				var _usr = live.cidToUsr[this.attr.cid];
				if ( _usr.phone ) {
					var _macAndPort = _usr.phone + '' + _usr.port;
					if ( macToPhn[_macAndPort] && macToPhn[_macAndPort].devices ) {
						_hdDev = live.hotdesk_owner[macToPhn[_macAndPort].devices[0]];
						if ( _hdDev && lookUp.dev[_hdDev] )
							_blf |= lookUp.dev[_hdDev].get('blf');
					}
				} else if ( _usr.extension ) {
					_hdDev = live.hotdesk_owner['Hotdesk/' + _usr.extension];
					if ( _hdDev && lookUp.dev[_hdDev] )
						_blf |= lookUp.dev[_hdDev].get('blf');
				}
				/* Re-roll-up BLF for all devices to this contact
				 * Exclude any line that has been hotdesked over.
				 */
				for ( var i = 0; i < this.devices.length; i++ ) {
					/* We have at least one device so change starting assumption */
					if ( this.attr.phone == null )
						this.attr.phone = true;
					/*
					 * We are hotdesked over, regular blf data is not used for us
					 * instead use special-case blf for non-HD only BLF if available
					 */
					if ( ! live.hotdesked_to[this.devices[i].get('device')] )
						_blf |= this.devices[i].get('blf');
					else
						_blf |= this.devices[i].get('blf_no_hd') || 0;

					if ( this.devices[i].get('device').substr(0,10) == 'SIP/webrtc' )
						up.webrtc = (this.devices[i].get('status') == 'up');
					else if ( _hdDev && _hdDev == this.devices[i].get('device') )
						up.hotdesk = (this.devices[i].get('status') == 'up');
					else {
						if ( this.devices[i].get('status') != 'up' )
							up.owned = false;
						else if ( up.owned == null )
							up.owned = true;
					}
				}

				if ( this.attr.phone == null )
					this.attr.phone = false;
				else
					this.attr.phone = (up.webrtc || up.hotdesk || up.owned);
				this.attr.blf = _blf;

				this.run();
			},
			/**
			 * Request permission to receive far end's XMPP state.
			 */
			xmppReq:	function() {
				if ( this.xmpp )
					return this.xmpp.xmppReq();
				return PBXError.XMPP_NO_CONTACT;
			},
			/**
			 * Auth far end to see my XMPP state.
			 */
			xmppAuth:	function() {
				if ( this.xmpp )
					return this.xmpp.xmppAuth();
				return PBXError.XMPP_NO_CONTACT;
			},
			/**
			 * De-Auth far end to see my XMPP state.
			 */
			xmppDel:	function() {
				if ( this.xmpp )
					return this.xmpp.xmppDel();
				return PBXError.XMPP_NO_CONTACT;
			},
			/**
			 * Create a new chat room with this contact
			 * @param {Function} [callback] Optional callback called with true/false can be used to get immediate failure result.
			 */
			chat:	function(callback) {
				if ( this.attr.cid == live.userData.id )
					return PBXError.CHAT_SELF_REFUSED;
				if ( ! this.get('online') )
					return PBXError.CHAT_USER_OFFLINE;
				return room.requestNew(this.attr.cid, callback);
			}
		});

	/**
	 * Called when the first chunks of data are returned from api.whtm during initialisation.
	 * Carries out initial conversion of compacted data into useful structures.
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function feedMangle() {
		deviceToExtension();

		for ( var _ext in live.extToCid ) {
			var _num = _ext.split('_')[0];
			var _scope = _ext.split('_')[1];
			if ( ! extByExt[_ext] ) {
				extByExt[_ext] = {
						type:		live.extToCid[_ext].t,
						company:	live.extToCid[_ext].c,
						name:		live.extToCid[_ext].n,
						voicemail:	live.extToCid[_ext].v,
						priority:	live.extToCid[_ext].p,
						owner:		false,
						canopt:		(live.extToCid[_ext].t.search(/^[AHQ]$/) != -1)
				};
				var _cList = live.extToCid[_ext].l || [];
				for ( var i=0; i < _cList.length; i++ ) {
					if ( _cList[i].o ) {
						extByExt[_ext].owner = _cList[i].i;
						break;
					}
				}
			}
		}

		macToPhn = {};
		devToMac = {};
		webrtcPass = {};
		for ( var _cid in live.cidToPhn ) {
			var _pList = live.cidToPhn[_cid];
			for ( var i = 0; i < _pList.length; i++ ) {
				if ( _pList[i].w )
					webrtcPass[_pList[i].d] = _pList[i].w;
				var _macAndPort = _pList[i].m + '' + _pList[i].p;
				if ( ! macToPhn[_macAndPort] ) {
					macToPhn[_macAndPort] = {
							name:		_pList[i].d,
							features:	_pList[i].f,
							devices:	[],
							owner:		((_pList[i].o || (_pList[i].d == 'webrtc' + _cid && haveJsSIP())) ? _cid : false)
					};
					for ( var n = 0; n < _pList[i].n; n++ ) {
						macToPhn[_macAndPort].devices.push('SIP/' + _pList[i].d + ((n + 1) > 1 ? '_' + (n + 1) : ''));
						devToMac['SIP/' + _pList[i].d + ((n + 1) > 1 ? '_' + (n + 1) : '')] = _macAndPort;
					}
				} else if ( _pList[i].o )
					macToPhn[_macAndPort].owner = _cid;
			}
		}
		for ( var _cid in live.cidToUsr ) {
			var _translate = {
					i:	'cid',
					x:	'extension',
					m:	'phone',
					n:	'name',
					p:	'port',
					u:	'uname',
					e:	'email'
			};
			live.cidToUsr[_cid].company = live.cidToUsr[_cid].c || '';
			for ( var _key in _translate ) {
				if ( live.cidToUsr[_cid][_key] == null )
					continue;
				live.cidToUsr[_cid][_translate[_key]] = live.cidToUsr[_cid][_key];
				delete live.cidToUsr[_cid][_key];
			}
		}

		/* After mangling the data, call getLines() - If this is an update,
		  there will be a callback set and the UI will be called.
		*/
		getLines();
	}

	/**
	 * Called when the first chunks of data are returned from api.whtm during initialisation.
	 * and after feedMangle. Kicks off the once-per-second poll to tmpld.pl
	 * @memberOf IPCortex.PBX
	 * @private
	 */
	function initAPI() {
		aF.queue.push(live.origURI + live.origHost + ':' + live.scriptPort + '/' + ((new Date()).getTime()) + '/?closeconnection=1&clearchat=1');
		intervalID = setInterval(checkInterval, 1000);
	}


	/**
	 * @namespace IPCortex.PBX.Auth
	 * @description Container for all authentication operations
	 */
	var PBXAuth = {
		/**
		 * If the IPCortex.PBX is running on one host and the PABX is separate, the IPCortex.PBX must be told how to access the PABX.
		 * 99% of the time, this will happen automatically using the source of the original request for API files. In the exceptional
		 * case, this call can be used to override the target.
		 * 
		 * @param {String} host Fully qualified host name, or IP address of the PABX.
		 * May also optionally include http[s]:// prefix and :port suffix
		 * @memberOf IPCortex.PBX.Auth
		 * @example // Use pabx.mydomain.local for auth 
		 * IPCortex.Auth.setHost('pabx.mydomain.local');
		 * IPCortex.Auth.setHost('https://pabx.mydomain.local:1234');
		 */
		setHost: function(host) {
			var a = host.split(':');
			if ( a[0] == 'http' || a[0] == 'https' ) {
				live.origURI = a[0] + '://';
				live.scriptPort = (a[0] == 'https' ? '84' : '82');
				a.shift;
				a[0] = a[0].substr(2);	/* Remove raining '//' */
			}
			live.origHostPort = live.origHost = a[0];
			if ( a[1] )
				live.origHostPort += ':' + a[1];
		},
		/**
		 * Auth callback to indicate login complete or failed.
		 * @callback Callback~authCB
		 * @param {Bool} code true: Auth OK, false: Auth failed
		 */
		/**
		 * Attempt to login, the result is determined asynchronously and a callback
		 * is called with a true/false parameter.
		 * 
		 * This is required before any other API calls can be made.
		 * 
		 * If authentication is successful, userID and username are stored.
		 * 
		 * @param {String} username username to log in as. If username and password are both null, a login
		 * check is carried out, so if the user is already logged-in, it responds as if just logged-in as
		 * that user.
		 * @param {String} password password for the user, or null (see above)
		 * @param {Bool} [insecure] true: use http, false: use https, null: attempt to be automatic
		 * 
		 * 'insecure' = false will cause authentication to fail with most browsers if the certificate on the PABX
		 * is unrecognised. 
		 * 
		 * 'insecure' = null will attempt to follow the parent frame/window's http/https setting.
		 * 
		 * A certificate which is signed by a CA which is acceptable to the client browser must
		 * be installed if insecure=false is used, and this is recommended in any production environment. 
		 * @param {Callback~authCB} [callback] After auth is complete, this callback will be called
		 * @memberOf IPCortex.PBX.Auth
		 * @example // login using username "fred", password "password" using http (insecure), with a callback
		 * function authCB(status){ console.log('Auth: '+((status == true)?'succeeded':'failed')+'\n'); };
		 * IPCortex.PBX.Auth.login('fred', 'password', true, authCB);
		 */
		login:	function(username, password, insecure, callback) {
			if ( typeof username == 'function' && !password && !insecure && !callback ) {
				callback = username;
				username = password = insecure = null;
			}
			var _res = false;
			function parseLogin(xml) {
				var m;
				live.userData = {};
				if ( (m = xml.match(/user .*id="(\d+)".*/)) ) {
					live.userData.id = m[1];
				}
				if ( (m = xml.match(/user .*login="([^"]*)".*/)) ) {
					live.userData.login = m[1];
				}
				if ( (m = xml.match(/user .*name="([^"]*)".*/)) ) {
					live.userData.name = m[1];
				}
				if ( (m = xml.match(/user .*company="([^"]*)".*/)) ) {
					live.userData.company = m[1];
				}
				if ( (m = xml.match(/user .*home="([^"]*)".*/)) ) {
					live.userData.home = m[1];
				}
				live.userData.home = live.userData.home || 'default';
				var perms = {};
				var lines = xml.split('\n');
				while ( lines.length ) {
					var line = lines.shift();
					if ( (m = line.match(/action .*name="([^"]+)".*/)) ) {
						perms[m[1]] = (line.indexOf('company="true"') == -1) ? 'yes' : 'company';
					}
				}
				live.userData.perms = perms;
				_res = live.userData.id != null;
				setTimeout(do_Cb, 1);
			}
			function do_Cb() {
				if ( typeof callback == 'function' )
					callback(_res);
			}
			if ( insecure == null )
				insecure = (location.protocol != 'https:');
			Utils.httpPost( (insecure ? 'http://' : 'https://') + live.origHostPort + '/api/api.whtm', 'cmd=login' +
						'&sessionUser=' + (username || '') +
						'&sessionPass=' + (password || ''), parseLogin );
		},
		rtcreset:
			function() {
				if ( webrtcPass['webrtc' + live.userData.id] )
					Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=rtcreset&pass=' + webrtcPass['webrtc' + live.userData.id]);
			},
		exit:
			function() {
				var _qs = 'cmd=exit';
				var _history = _getHistory();
				if ( cH.online )
					_qs += '&offline=1';
				if ( _history )
					_qs += '&history=' + _history;
				if ( loadCache.ocm2config )
					_qs += '&ocm2config=' + base64encode(loadCache.ocm2config);
				if ( webrtcPass['webrtc' + live.userData.id] )
					_qs += '&pass=' + webrtcPass['webrtc' + live.userData.id];
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', _qs);
			},
		/**
		 * Log out of the API. This will also cause a stopPoll(), a disableChat()
		 * and will kill the addressBook callback and flush most user-loaded data.
		 * 
		 * The polling process may be able to continue un-impeded in the background
		 * using cached credentials for up to 60 seconds, but an attempt is made to
		 * stop it.
		 * 
		 * User info is cleared.
		 * 
		 * @memberOf IPCortex.PBX.Auth
		 */
		logout:	
			function() {
				stopPoll();
				disableChat();
				disableHistory();
				flushAddressbook();
				Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=logout');
				var _keep = {
					hdCID:		null,
					origSID:	live.origSID,
					origURI:	live.origURI,
					origHost:	live.origHost,
					origHostPort:	live.origHostPort,
					scriptPort:	live.scriptPort
				};
				for ( var _key in live ) {
					if ( _keep[_key] )
						live[_key] = _keep[_key];
					else
						live[_key] = {};
				}
				loadCache = {};
			},
		/**
		 * 
		 * An object which contains all of the authentication level information that
		 * the PBX knows about the user. 
		 * 
		 * @typedef {Object} IPCortex.PBX.Auth~userData
		 * @property {Number} id Contact ID
		 * @property {String} name Contact name
		 * @property {String} company Currently selected company name or 'default' 
		 * @property {String} home Logged-in user's home company.
		 * @property {Object} perms Index of allowed permissions eg. ocm:"yes" or comp:"company". If the
		 * permission is a per-company permission, "yes" means not for the current company and "company"
		 * means yes and okay for current company.
		 * if user is in Default company.
		 */
		/**
		 * Fetch information on the currently logged-in user
		 * @returns {IPCortex.PBX.Auth~userData} An auth userdata object containing basic user information
		 * @memberOf IPCortex.PBX.Auth
		 * @example // Login and get company name
		 * function authCB(status){ 
		 *   if(status == true){
		 *     var userData = IPCortex.PBX.getUserInfo();
		 *     console.log('User: '+userData.name+' Logged in with Company: '+userData.company+'\n');
		 *   }
		 * }
		 * IPCortex.PBX.Auth.login('fred', 'password', true, authCB);
		 */
		getUserInfo: function() {
			return live.userData;
		},
		/**
		 * Some PABX functions operate on a specific company. If the user has rights to more
		 * than one, then this ensures that the correct one is selected.
		 * 
		 * The currently selected company will be stored in userdata.
		 * 
		 * @param {String} company ID of the company to select
		 * 
		 * @memberOf IPCortex.PBX.Auth
		 * 
		 */
		selcompany: function(company) {
			function parseCompany(xml) {
				var m;
				if ( (m = xml.match(/user .*company="([^"]*)".*/)) ) {
					live.userData.company = m[1];
				}
				if ( (m = xml.match(/user .*home="([^"]*)".*/)) ) {
					live.userData.home = m[1];
				}
			}
			Utils.httpPost(live.origURI + live.origHostPort + '/api/api.whtm', 'cmd=selcompany&company=' + company, parseCompany );
		}
	};

	/**
	 * @namespace IPCortex.PBX.Ops
	 * @todo all of the summary screen operations. (Separate IPCortex.PBX.Ops namespace?)
	 * @description Container for all operations for summary screen
	 */
	var PBXOps = {

	};

	/**
	 * @namespace IPCortex.PBX.errors
	 * @description Container for all PBXError codes for summary screen. Allows forward and reverse lookup.
	 * @todo Persuade jsDoc3 to document the following:
	 */
	var PBXError = {
		0:	['OK',			'No error'],
		'-100':	['CHAT_NO_CONTACT',	'Chat target has no contact'],
		'-101':	['CHAT_NO_ROSTER',	'Chat target not found in roster'],
		'-102':	['CHAT_SELF_REFUSED',	'Chat - Cannot chat to self'],
		'-103':	['CHAT_USER_OFFLINE',	'Chat target is offline'],
		'-104':	['CHAT_ALREADY_JOINED',	'Join attempt ignored, already joined'],
		'-105':	['CHAT_ALREADY_LINKED',	'Link attempt ignored, already linked'],
		'-200':	['HOOK_BAD_CALLBACK',	'Hook request with illegal callback'],
		'-201':	['HOOK_NO_CONTACT',	'Contact hook request for invalid contact id'],
		'-202':	['HOOK_NO_ROOM',	'Chatroom hook request for invalid room id'],
		'-203':	['HOOK_NOT_PARK',	'Park hook request for invalid park device'],
		'-204':	['HOOK_NO_DEVICE',	'Device hook request matched no devices'],
		'-205':	['HOOK_NO_MBOX',	'Mailbox hook request matched no mailboxes'],
		'-206':	['HOOK_NO_QUEUE',	'Queue hook request matched no queues'],
		'-207':	['HOOK_BAD_XMPP',	'Xmpp hook request has invalid xmpp id'],
		'-300':	['ADDR_CANNOT_DEL',	'Cannot remove address'],
		'-301':	['ADDR_CANNOT_ADD',	'Cannot create address'],
		'-302':	['ADDR_MISSING_NUMNAME','Cannot create. Missing name and number'],
		'-303':	['ADDR_MISSING_NUM',	'Cannot create. Missing number'],
		'-304':	['ADDR_MISSING_NAME',	'Cannot create. Missing name'],
		'-305':	['ADDR_ILLEGAL_NUM',	'Cannot create. Illegal characters in number'],
		'-306':	['ADDR_ILLEGAL_NAME',	'Cannot create. Illegal characters in name'],
		'-307':	['ADDR_CANNOT_EDIT',	'Cannot edit address'],
		'-308':	['ADDR_MISSING_XMPPNAM','Cannot create. Missing name and XMPP ID'],
		'-309':	['ADDR_MISSING_XMPP',	'Cannot create. Missing XMPP ID'],
		'-310':	['ADDR_ILLEGAL_XMPP',	'Cannot create. Illegal characters in XMPP ID'],
		'-311':	['ADDR_EDIT_NUMNAME',	'Cannot edit. Missing name and number'],
		'-312':	['ADDR_EDIT_NUM',	'Cannot edit. Missing number'],
		'-313':	['ADDR_EDIT_NAME',	'Cannot edit. Missing name'],
		'-314':	['ADDR_E_ILLEGAL_NUM',	'Cannot edit. Illegal characters in number'],
		'-315':	['ADDR_E_ILLEGAL_NAME',	'Cannot edit. Illegal characters in name'],
		'-316': ['ADDR_PHOTO_BAD',	'Bad photo data rejected'],
		'-317': ['ADDR_PHOTO_FMT',	'Bad photo format rejected'],
		'-318': ['ADDR_PHOTO_NOSUPP',	'No browser support for photo upload'],
		'-319': ['ADDR_PHOTO_PERM',	'No permission to upload photo'],
		'-400': ['XMPP_ALREADY_AUTHED',	'Cannot re-auth XMPP contact'],
		'-401': ['XMPP_ALREADY_RECV',	'Alreading receiving XMPP status'],
		'-402': ['XMPP_NOT_XMPP',	'Not an XMPP capable entry'],
		'-403': ['XMPP_NO_CONN',	'Cannot auth. No connection exists'],
		'-404':	['XMPP_NO_CONTACT',	'Not a valid presence target'],
		'-500':	['DTMF_NO_SESSION',	'No session to send DTMF'],
		'-501':	['DTMF_MANY_DIGITS',	'Too many DTMF digits'],
		'-502':	['DTMF_SEND_FAIL',	'Failed to send DTMF'],
		'-503':	['MUTE_NO_SESSION',	'No session for mute'],
		'-504':	['MUTE_INVALID_REQUEST','Invalid mute request'],
		/**
		 * Breaks down an error to it's top level type, eg. CHAT for chat errors.
		 * @param {Number} error number to grab type from
		 * @memberOf PBXError
		 */
		errtype:	function(errno) {
			if ( PBXError[errno] == null )
				return null;
			return PBXError[errno][0].split('_')[0];
		},
		/**
		 * Return the plain english version of an error code.
		 * @param {Number} error number to retrieve
		 * @memberOf PBXError
		 */
		errstr:	function(errno) {
			if ( PBXError[errno] == null )
				return null;
			return PBXError[errno][1];
		}
	};
	for ( var x in PBXError ) {
		if ( isNaN(x) )
			continue;
		PBXError[PBXError[x][0]] = x;
	}

	return {
			checkReady:		checkReady,
			startPoll:		checkReady,
			stopPoll:		stopPoll,
			getTimeDelta:		getTimeDelta,
			clearMaxData:		clearMaxData,
			loadData:		loadData,
			saveData:		saveData,
			refreshLines:		refreshLines,
			listDDIByExtension:	listDDIByExtension,
			listExtensionByDevice:	listExtensionByDevice,
			listCIDByExtension:	listCIDByExtension,
			listMACByCID:		listMACByCID,
			listExtension:		listExtension,
			getExtension:		getExtension,
			getUser:		getUser,
			getPhone:		getPhone,
			getHIDInfo:		getHIDInfo,
			getAddressbook:		getAddressbook,
			getLines:		getLines,
			getRoster:		getRoster,
			createAddress:		createAddress,
			createXmpp:		createXmpp,
			hookDevice:		hookDevice,
			hookXmpp:		hookXmpp,
			hookContact:		hookContact,
			hookRoom:		hookRoom,
			hookQueue:		hookQueue,
			unHook:			unHook,
			enableChat:		enableChat,
			disableChat:		disableChat,
			enableFeature:		enableFeature,
			disableFeature:		disableFeature,
			enableHistory:		enableHistory,
			disableHistory:		disableHistory,
			saveHistory:		saveHistory,
			setStatus:		setStatus,
			/* Not really public, but needed for inter-frame browser comms. */
			parseAf:		parseAf,
			parseCh:		parseCh,
			parseHd:		parseHd,
			finishAf:		finishAf,
			tmplErr:		tmplErr,
			Auth:			PBXAuth,
			Ops:			PBXOps,
			error:			PBXError,
			mediaStream:		mediaStream
	};
})();

IPCortex.XHR.xmlHttpRun = function (res) {
	var context = {
		/**
		 * Access method for tmpld.pl into IPCortex.PBX
		 * @private
		 */
		parseHd:
			function(p, q, r) {
				IPCortex.PBX.parseHd(p, q, r);
			},

		/**
		 * Access method for tmpld.pl into IPCortex.PBX
		 * @private
		 */
		parseAf:
			function(p) {
				IPCortex.PBX.parseAf(p);
			},

		/**
		 * Access method for tmpld.pl into IPCortex.PBX
		 * @private
		 */
		parseCh:
			function(p) {
				IPCortex.PBX.parseCh(p);
			},

		/**
		 * Access method for tmpld.pl into IPCortex.PBX
		 * @private
		 */
		finishAf:
			function(p, c) {
				IPCortex.PBX.finishAf(p, c);
			},

		/**
		 * Access method for tmpld.pl into IPCortex.PBX
		 * @private
		 */
		tmplErr:
			function(e, c) {
				IPCortex.PBX.tmplErr(e, c);
			}
	};

	var f = new Function('with(this){' + res + '}');
	f.call(context);
	f = null; res = null;
};

