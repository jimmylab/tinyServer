const fs = require('fs');

console.log(
	fs.readFileSync('icon-doc.ico', {encoding: 'base64'})
);

// magick -background none icon-doc.svg icon-doc-large.png
