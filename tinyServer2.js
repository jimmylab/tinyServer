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
	port: 8089,
	indexEnabled: false
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


const FAVICON = Buffer.from(
	'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////////////////////////////////////////////////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP////////////////////////////////////////////////8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA////////////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////////////////////////////////////////////////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP////////////////////////////////////////////////8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA////////////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////////////////////////////////////////////////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP////////////////////////////////////////////////8AAAD/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA////////////AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////////////////////////////////////////////////wAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///////////////////////////////////////////wAAAP////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////////////////////////////////////wAAAP////8A////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP////8A////AP///wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAMAHAADABwAAwAcAAMAHAADABwAAwAcAAMAHAADABwAAwAcAAMAHAADABwAAwA8AAMAfAADAPwAA//8AAA=='
, 'base64');
const STYLESHEET = 'html,body{margin:0;padding:0}body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:14px}h2{font-size:36px;padding:0 0 9px;margin:60px 0 30px;border-bottom:1px solid #eee;font-weight:500;line-height:1.1}table{width:100%;max-width:100%;border-spacing:0;border-collapse:collapse}td,th{border:0;padding:8px;text-align:left;line-height:1.4}th{vertical-align:bottom;border-bottom:2px solid #ddd}td{border-top:1px solid #ddd}a{color:#337ab7;text-decoration:none}a:focus,a:hover{color:#23527c;text-decoration:underline}.container:before,.container:after{content:" ";display:table}.container:after{clear:both}.container{margin-right:auto;margin-left:auto;padding-left:15px;padding-right:15px}@media(min-width: 768px){.container{width:750px}}@media(min-width: 992px){.container{width:970px}}@media(min-width: 1200px){.container{width:1170px}}'

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
		res.end(FAVICON);
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
				if (CONF.indexEnabled) {
					if (fList.find(fCur => fCur.name === 'index.html')) {
						let indexFile = path.join(fPath, 'index.html');
						fs.stat(indexFile, (err, stats) => {
							if (err) {
								console.log(err)
								res.end();
							}
							res.writeHead(200, {
								'Content-Type': MIME[".html"],
								'Content-Length': stats.size,
								'Accept-Ranges': 'none'
							})
							let fStream = fs.createReadStream(indexFile);
							fStream.pipe(res);
							req.on('end', () => {
								fStream.close();
							})
						})
						return;
					}
				}

				// TODO: Distinguish symbolic link between a directory or a file.
				fList.sort(
					(a, b) =>
						((b.isDirectory() || b.isSymbolicLink()) - (a.isDirectory() || a.isSymbolicLink())) || a.name.localeCompare(b.name)
				)

				if (urlPath !== '/') {
					fList.unshift(
						{
							name: '..',
							__virtual: true,
							isDirectory: () => true
						}
					);
				}

				fList = fList.map(fCur => {
					let url = querystring.escape(fCur.name),
						caption = fCur.name;
					if (fCur.isDirectory()) {
						url += '/';
						caption += '/';
					}

					return `
<tr>
	<td><a href="${url}">${caption}</a></td>
	<td>&nbsp;</td>
	<td>&nbsp;</td>
</tr>
`
				}).join('');
				
				
				res.writeHead(200, {
					'Content-Type': 'text/html;charset=utf-8',
					'Accept-Ranges': 'none'
				});
				// <link href="/style.css" rel="stylesheet"></link>
				res.end(
`<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Index of ${urlPath}</title>
<style type="text/css">${STYLESHEET}</style>
</head>
<body>
<div class="container">
<h2>Index of ${urlPath}</h2>
<table>
	<thead>
		<tr>
			<th>Filename</th>
			<th>Date</th>
			<th>Size</th>
		</tr>
	</thead>
	<tbody>
		${fList}
	</tbody>
</table>
</div>
</body>
</html>
`
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
