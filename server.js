
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '.')));

// Game State
const maze = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,2,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,2,1],
    [1,0,1,1,0,1,1,1,1,1,1,1,1,1,1,0,1,1,0,1],
    [1,0,1,1,0,1,0,0,0,0,0,0,0,0,1,0,1,1,0,1],
    [1,0,0,0,0,1,0,1,1,1,1,1,1,0,1,0,0,0,0,1],
    [1,0,1,1,0,0,0,1,0,0,0,0,1,0,0,0,1,1,0,1],
    [1,0,0,1,0,1,1,1,0,1,1,0,1,1,1,0,1,0,0,1],
    [1,1,0,1,0,1,0,0,0,0,0,0,0,0,1,0,1,0,1,1],
    [1,0,0,0,0,1,0,1,1,1,1,1,1,0,1,0,0,0,0,1],
    [1,0,1,1,0,1,0,0,0,0,0,0,0,0,1,0,1,1,0,1],
    [1,0,1,1,0,1,1,1,1,1,1,1,1,1,1,0,1,1,0,1],
    [1,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];
const players = [];
const ghosts = [{ id: 1, x: 9.5, y: 5.5, color: 'red' }];
const pellets = [];
const powerPellets = [];
const PLAYER_SPEED = 0.05;

function initializePellets() {
    for (let y = 0; y < maze.length; y++) {
        for (let x = 0; x < maze[y].length; x++) {
            if (maze[y][x] === 0) {
                pellets.push({ x: x, y: y });
            } else if (maze[y][x] === 2) {
                powerPellets.push({ x: x, y: y });
            }
        }
    }
}
initializePellets();

function isWall(x, y) {
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    return maze[tileY] && (maze[tileY][tileX] === 1);
}

// Game Loop
const GAME_LOOP_INTERVAL = 1000 / 60; // 60 FPS
let gameInterval = null;

function gameLoop() {
    // Update player positions and check for pellet collision
    players.forEach(player => {
        let nextX = player.x;
        let nextY = player.y;

        switch (player.direction) {
            case 'up': nextY -= PLAYER_SPEED; break;
            case 'down': nextY += PLAYER_SPEED; break;
            case 'left': nextX -= PLAYER_SPEED; break;
            case 'right': nextX += PLAYER_SPEED; break;
        }
        
        if (!isWall(nextX, nextY)) {
            player.x = nextX;
            player.y = nextY;
        }

        // Pellet collision
        for (let i = pellets.length - 1; i >= 0; i--) {
            const p = pellets[i];
            const dist = Math.hypot(player.x - (p.x + 0.5), player.y - (p.y + 0.5));
            if (dist < 0.5) {
                pellets.splice(i, 1);
                player.score += 10;
            }
        }

        // Power pellet collision
        for (let i = powerPellets.length - 1; i >= 0; i--) {
            const pp = powerPellets[i];
            const dist = Math.hypot(player.x - (pp.x + 0.5), player.y - (pp.y + 0.5));
            if (dist < 0.5) {
                powerPellets.splice(i, 1);
                player.score += 50;
                player.poweredUp = true;
                setTimeout(() => {
                    player.poweredUp = false;
                }, 10000); // 10 seconds
            }
        }
    });

    // Broadcast state to all clients
    const gameState = { maze, players, ghosts, pellets, powerPellets };
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'gameState', gameState }));
        }
    });
}

wss.on('connection', (ws) => {
    console.log('[SERVER] A new client connected.');
    ws.send(JSON.stringify({ type: 'welcome', message: 'Welcome to Pacclone Multi!' }));

    const playerId = Date.now();
    const player = { id: playerId, x: 1.5, y: 1.5, color: 'yellow', lives: 3, score: 0, direction: null, poweredUp: false };
    players.push(player);

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.type === 'input') {
            player.direction = data.direction;
        }
    });

    if (!gameInterval) {
        console.log('[SERVER] Starting game loop.');
        gameInterval = setInterval(gameLoop, GAME_LOOP_INTERVAL);
    }

    ws.on('close', () => {
        console.log('[SERVER] Client disconnected.');
        const index = players.findIndex(p => p.id === playerId);
        if (index !== -1) {
            players.splice(index, 1);
        }

        if (wss.clients.size === 0) {
            console.log('[SERVER] No clients left. Stopping game loop.');
            clearInterval(gameInterval);
            gameInterval = null;
        }
    });
});

const PORT = 8080;
server.listen(PORT, () => {
    console.log(`[SERVER] Listening on http://localhost:${PORT}`);
});
