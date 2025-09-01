
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 4;
const TICK_RATE = 1000 / 60; // 60 updates per second

// --- HTTP Server to serve client files ---
const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    const fullPath = path.join(__dirname, filePath);

    fs.readFile(fullPath, (err, content) => {
        if (err) {
            console.error(`File not found: ${fullPath}`);
            res.writeHead(404);
            res.end('File not found');
        } else {
            let contentType = 'text/html';
            if (filePath.endsWith('.js')) contentType = 'text/javascript';
            if (filePath.endsWith('.css')) contentType = 'text/css';
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

const wss = new WebSocketServer({ server });

// --- Game Constants ---
const TILE_SIZE = 30;
const MAP_WIDTH = 20;
const MAP_HEIGHT = 20;
const PLAYER_SPEED = 2.0;
const GHOST_NORMAL_SPEED = 1.6;
const GHOST_FRIGHTENED_SPEED = 1.0;
const GHOST_EATEN_SPEED = 4.0;
const POWERUP_DURATION = 8000; // 8 seconds
const GHOST_RELEASE_INTERVAL = 5000;
const PLAYER_SPAWNS = [
    { r: 14, c: 9.5 },
    { r: 1, c: 1.5 },
    { r: 1, c: 18.5 },
    { r: 18, c: 9.5 },
];
const GHOST_SPAWN_INFO = [
    { id: 'blinky', color: 'red',    r: 9.5, c: 9.5 },
    { id: 'pinky',  color: 'pink',   r: 9.5, c: 10.5 },
    { id: 'inky',   color: 'cyan',   r: 9.5, c: 8.5 },
    { id: 'clyde',  color: 'orange', r: 9.5, c: 11.5 },
];
const GHOST_EXIT_TILE = { r: 7.5, c: 9.5 };

const INITIAL_MAP = [
    [1,1,1,1,1,1,1,1,1,1,