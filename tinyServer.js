'use strict'

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const querystring = require('querystring');
const process = require('process');
const url = require('url');

const DEFAULT_CONF = {
	host: '0.0.0.0',
	port: 8089
}

const CONF = (function() {
	let USER_CONF = {};
	try {
		USER_CONF = require('./tinyServer.conf.json');
	} catch (whatever) {
		console.log('Warning: Error reading conf file, use default one instead.')
	}
	return Object.assign({}, DEFAULT_CONF, USER_CONF);
}) ();


const favicon = Buffer.from(
	'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////////////////////////////////////////////////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP////////////////////////////////////////////////8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA////////////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////////////////////////////////////////////////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP////////////////////////////////////////////////8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA////////////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////////////////////////////////////////////////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP////////////////////////////////////////////////8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA////////////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////////////////////////////////////////////////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///////////////////////////////////////////wAAAP////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////////////////////////////////////wAAAP////8A////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP////8A////AP///wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAMAHAADABwAAwAcAAMAHAADABwAAwAcAAMAHAADABwAAwAcAAMAHAADABwAAwA8AAMAfAADAPwAA//8AAA=='
, 'base64');

const USE_HTTPS = CONF.protocol === "https";
const PROTOCOL = USE_HTTPS ? https : http;
const CWD = process.cwd();
const ROOTDIR = path.resolve(__dirname, CONF.rootPath || CWD);

const requestHandler = function(req, res) {
	const { href, host, pathname } = url.parse(req.url);

	// Special handler for favicon
	if (pathname === '/favicon.ico') {
		res.writeHead(200, {
			'Content-Type': MIME[".ico"],
			'Accept-Ranges': 'none'
		});
		res.end(favicon);
		return;
	} else if (pathname === '/robots.txt') {
		res.writeHead(200, {
			'Content-Type': MIME[".txt"],
			'Accept-Ranges': 'none'
		});
		res.end(
`User-agent: *
Disallow: /`
		);
		return;
	}

	// Safe url path
	const urlPath = path.posix.resolve('/', querystring.unescape(pathname));

	// Actual path of local file (directory)
	const fPath = path.join(ROOTDIR, urlPath);
	console.log(urlPath, fPath);
	
	fs.stat(fPath, (err, stats) => {
		if (err) {
			// Handles 404
			if (err.code === 'ENOENT') {
				res.writeHead(404, {
					'Content-Type': 'text/html;charset=utf-8',
					'Accept-Ranges': 'none'
				});
				res.end('<h1>404 Not Found</h1><hr />' + (new Date()).toString());
			}
			// Handles other error
			else {
				res.writeHead(500, {
					'Content-Type': 'text/html;charset=utf-8',
					'Accept-Ranges': 'none'
				});
				res.end('<h1>500 Internal Server Error</h1><hr />' + (new Date()).toString());
			}
			return;
		}
		
		// Handles dir
		if (stats.isDirectory()) {
			fs.readdir(fPath, {withFileTypes: true}, (err, fList) => {
				if (err) {
					res.writeHead(500, {
						'Content-Type': 'text/html;charset=utf-8',
						'Accept-Ranges': 'none'
					});
					res.end('<h1>500 Internal Server Error</h1>Cannot read target directory.<hr />' + (new Date()).toString());
					return;
				}
				
				// All items in 'files' is the instances fs.Dirent
				// Order: directory first, filename second.
				let listDir = [],
					listFile = [];
				
				// TODO: show file size, date
				fList.forEach(fCur => {
					if (fCur.isDirectory()) {
						listDir.push(fCur.name);
					} else if (fCur.isSymbolicLink()) {
						// TODO: Distinguish symbolic link between a directory or a file.
						listDir.push(fCur.name);
					} else {
						listFile.push(fCur.name);
					}
				});
				listDir.sort();
				listFile.sort();

				if (urlPath !== '/') {
					listDir.unshift('..');
				}

				listDir = listDir.map(hrefDir).join('\n');
				listFile = listFile.map(hrefFile).join('\n');
				
				
				res.writeHead(200, {
					'Content-Type': 'text/html;charset=utf-8',
					'Accept-Ranges': 'none'
				});
				res.end(
`<h2>Index of ${urlPath}</h2>
<title>Index of ${urlPath}</title>
<hr />
<meta charset="utf-8">
<pre>
${listDir}
${listFile}
</pre>`
				);
			});
		}

		// Handles normal file stream
		else {
			let ext = path.extname(fPath);
			let mime = MIME[ext] || 'application/octet-stream';

			// TODO: multi thread downloading - https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests
			// TODO: disable multi thread downloading when file is small
			res.writeHead(200, {
				'Content-Type': mime,
				'Content-Length': stats.size,
				'Accept-Ranges': 'none'
			})
			let fStream = fs.createReadStream(fPath);
			fStream.pipe(res);
			req.on('end', () => {
				fStream.close();
			})
		}
	});
};

let listenOptions = {};
if (USE_HTTPS) {
	try {
		listenOptions = {
			key: fs.readFileSync(path.resolve(path.dirname(__filename), CONF.private)),
			cert: fs.readFileSync(path.resolve(path.dirname(__filename), CONF.cert))
		};
	} catch (err) {
		console.log('Error: failed to read certificate files, exiting.\n', err);
		process.exit(-2);
	}
}
try {
	const server = PROTOCOL.createServer(listenOptions, requestHandler);
	server.listen({
		port: CONF.port,
		host: CONF.host
	});
} catch(serverErr) {
	console.log('Error: ', serverErr);
	process.exit(-1);
}


function hrefFile(fName) {
	let urlencodedName = querystring.escape(fName);
	return hrefTemplate(urlencodedName, fName);
}
function hrefDir(fName) {
	let urlencodedName = querystring.escape(fName);
	return hrefTemplate(urlencodedName + '/', fName + '/');
}

function hrefTemplate(url, caption) {
	return `<a href="${url}">${caption}</a>`
}


const MIME = {
	'.ico':  'image/x-icon',
	'.html': 'text/html',
	'.htm':  'text/html',
	'.css':  'text/css',
	'.txt':  'text/plain',
	'.log':  'text/plain',
	'.js':   'text/javascript',
	'.json': 'application/json',
	'.xml':  'application/xml',
	'.jpg':  'image/jpeg',
	'.png':  'image/png',
	'.svg':  'image/svg+xml',
	'.gif':  'image/gif',
	'.bmp':  'image/bmp',
	'.zip':  'application/x-compressed-zip',
	'.tar':  'application/x-tar',
	'.gz':   'application/x-gzip',
	'.bz2':  'application/x-bzip2',
	'.7z':   'application/x-7z-compressed',
	'.pdf':  'application/pdf',
	'.doc':  'application/msword',
	'.xls':  'application/vnd.ms-excel',
	'.ppt':  'application/vnd.ms-powerpoint',
}
