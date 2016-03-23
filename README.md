Node API/Library
================
This module is a wrapper for the [IPCortex Communication System (CS) API](https://developers.ipcortex.co.uk/gs/js).

Installation
------------
To install, simply run:
```
npm install ipcortex/node-api
```

However use this module you will need to download api.js from the IPCortex CS you are trying to connect against. A script is included (updateAPI.js) to handle this for you - just provide the HTTP host for it download it from. For example:

```
node updateAPI.js http://pabx.hostname
```

Or you can download the file from http://pabx.hostname/api/api.js and place it in lib/api.js - where `pabx.hostname` is your IPCortex CS' hostname.

After that, you should be ready to include it in your project.

Usage
-----
To get started after installation, simply require the module as you normally would:
```javascript
var IPCortex = require('ipcortex-pabx');
```

You can then use the API as you would client-side. See our [documentation](https://developers.ipcortex.co.uk/gs/js) for more info.

Example
-------
```javascript
var IPCortex = require('ipcortex-pabx');

IPCortex.PBX.Auth.setHost('https://pabx.hostname');
IPCortex.PBX.Auth.login({
  username: '<username>',
  password: '<password>'
}).then(function () {
	console.log('Login successful');
	IPCortex.PBX.startFeed().then(function () {
		console.log('Live data feed started');
		// Do stuff here
	}, function () {
		console.log('Live data feed failed');
	});
}, function () {
	console.log('Login failed');
});
```

License
-------
Copyright (c) 2016, IP Cortex Ltd.
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
