const http = require('http');
const fs   = require('fs');
const path = require('path');

const HOST = '10.0.0.16';
const PORT = 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const server = http.createServer((req, res) => {
  // Normalise URL — default to index.html
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(__dirname, urlPath);
  const ext      = path.extname(filePath).toLowerCase();

  // Prevent directory traversal outside the project root
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('403 Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`NetMap running at http://${HOST}:${PORT}`);
});

server.on('error', err => {
  if (err.code === 'EADDRNOTAVAIL') {
    console.error(`Error: IP address ${HOST} is not available on this machine.`);
    console.error('Check that the network interface with that address is up.');
  } else if (err.code === 'EADDRINUSE') {
    console.error(`Error: Port ${PORT} is already in use.`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
