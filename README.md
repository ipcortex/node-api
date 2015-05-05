Node API/Library
================
This module is a wrapper for the [ipcortex PABX API](https://tech.ipcortex.co.uk/apioverview).

Installation
------------
To install, simply run:
```
npm install git@github.com:ipcortex/node-api.git
```

However use this module you will need to download api.js from the PABX you are trying to connect against. A script is included (updateAPI.js) to handle this for you - just provide the HTTP host for it download it from. For example:

```
node updateAPI.js http://pabx
```

Or you can download the file from http://pabx/api/api.js and place it in lib/api.js - where "pabx" is your PABX's hostname.

After that, you should be ready to include it in your project.

Usage
-----
To get started after installation, simply require the module as you normally would: 
```javascript
var ipcAPI = require('ipcortex-pabx');
```
Then use the constructor to create an object, with the hostname as the PABX's hostname and protocol as 'http' or 'https':
```javascript
var IPCortex = ipcAPI(hostname, protocol);
```
You can then use the API as you would client-side. See our [documentation](https://tech.ipcortex.co.uk/apioverview) for more info.

Example
-------
```javascript
var ipcAPI = require('ipcortex-pabx');

var IPCortex = ipcAPI('10.0.0.1', 'http');

IPCortex.PBX.Auth.login('202t28', '202t28', true, authCB);

function authCB(ok) {
	if ( ok ) {
		/* Request the poller starts and initial PABX
		 * config information is fetched and cached.
		 * 'go' and 'error' are success/fail callbacks.
		 * 'error' will be called on any error event.
		 */
		IPCortex.PBX.startPoll(go, error);
	}
}
function error(n, m) {
	console.log('We got an error number: '+n+' Text: '+m);
}
function go() {
	console.log('Realtime feed callback says we\'re going');

	/* Once initialised, request all our owned lines are returned */
	IPCortex.PBX.getLines(linesCB, true);
}
function linesCB(l) {
	/* Lines are returned in a list - Hook them all */
	while ( l.length )  {
		var line = l.shift();
		var line_id =  line.get('line') ;
		var line_name = line.get('name');

		/* In this example we allow the line to go out of scope once hooked
		 * this is OK as a reference is passed with the callback
		 */
		line.hook(lineEvent);
		console.log('Got a line: ' + line_id  + ' (' + line_name + ')');
	}
}
function lineEvent(f, h, l) {
	console.log('Got an event for line: ' +
	l.get('line') + ' (' + l.get('name') + ')');
	/* A useful thing to know about a line is it's call info */
	var calls = l.get('calls');
	for ( var x in calls ) {
		if ( calls[x].get('state') != 'dead' )
			console.log(calls[x].get('state'));
	}
}
```

Licence
-------
Copyright (c) 2014, IP Cortex Ltd.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of ipcortex nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
