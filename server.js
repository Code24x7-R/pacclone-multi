
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
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,1],
    [1,3,1,1,1,2,1,1,2,1,1,2,1,1,2,1,1,1,3,1],
    [1,2,1,1,1,2,1,1,2,1,1,2,1,1,2,1,1,1,2,1],
    [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
    [1,2,1,1,1,2,1,2,1,1,1,1,2,1,2,1,1,1,2,1],
    [1,2,2,2,2,2,1,2,2,2,2,2,2,1,2,2,2,2,2,1],
    [1,1,1,1,1,2,1,1,1,6,6,1,1,1,2,1,1,1,1,1],
    [0,0,0,0,1,2,1,0,0,0,0,0,0,1,2,1,0,0,0,0],
    [1,1,1,1,1,2,1,0,1,1,1,1,0,1,2,1,1,1,1,1],
    [1,2,2,2,2,2,2,0,1,0,0,1,0,2,2,2,2,2,2,1],
    [1,1,1,1,1,2,1,0,1,1,1,1,0,1,2,1,1,1,1,1],
    [0,0,0,0,1,2,1,0,0,0,0,0,0,1,2,1,0,0,0,0],
    [1,1,1,1,1,2,1,0,1,1,1,1,0,1,2,1,1,1,1,1],
    [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
    [1,2,1,1,1,2,1,1,2,1,1,2,1,1,2,1,1,1,2,1],
    [1,3,2,2,1,2,2,2,2,2,2,2,2,2,2,1,2,2,3,1],
    [1,1,2,1,1,2,1,2,1,1,1,1,2,1,2,1,1,2,1,1],
    [1,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
];

// --- Game State ---
let lobby = { players: new Array(MAX_PLAYERS).fill(null) };
let gameState = null;
const clients = new Map(); // Map<ws, playerId>

// --- Server Logic ---
function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
            client.send(message);
        }
    });
}

function send(ws, data) {
    ws.send(JSON.stringify(data));
}

function resetGame() {
    console.log("[SERVER] Resetting game state and lobby.");
    lobby = { players: new Array(MAX_PLAYERS).fill(null) };
    gameState = null;
    broadcast({ type: 'lobbyUpdate', lobby });
}

function initGame() {
    const gamePlayers = lobby.players.map(p => {
        if (!p) return null;
        const spawn = PLAYER_SPAWNS[p.index];
        return {
            ...p,
            x: spawn.c * TILE_SIZE,
            y: spawn.r * TILE_SIZE,
            dx: 0,
            dy: 0,
            radius: TILE_SIZE / 2 - 2,
            mouthOpen: true,
            mouthAngle: Math.PI / 4,
            animationFrame: 0,
            nextDirection: { dx: 0, dy: 0 },
            lives: 3,
            score: 0,
            isPoweredUp: false,
            powerUpTimer: 0,
            state: 'active' // 'active' or 'spectating'
        };
    });

    const ghosts = GHOST_SPAWN_INFO.map(g => ({
        ...g,
        x: g.c * TILE_SIZE,
        y: g.r * TILE_SIZE,
        dx: 0,
        dy: 0,
        originalX: g.c * TILE_SIZE,
        originalY: g.r * TILE_SIZE,
        speed: GHOST_NORMAL_SPEED,
        state: 'inHouse', // inHouse, exitingHouse, chasing, frightened, eaten
    }));
    
    pelletsRemaining = 0;
    const gameMap = INITIAL_MAP.map(row => [...row]);
    gameMap.forEach(row => row.forEach(tile => {
        if (tile === 2 || tile === 3) pelletsRemaining++;
    }));

    gameState = {
        players: gamePlayers,
        ghosts: ghosts,
        map: gameMap,
        ghostFrightenedTimer: 0,
        ghostReleaseTimer: 0,
        pelletsRemaining,
    };
    
    console.log("[SERVER] Game starting!");
    broadcast({ type: 'gameStart', gameState });
}

function gameTick() {
    if (!gameState) return;
    
    const soundEvents = [];

    // Update timers
    if (gameState.ghostFrightenedTimer > 0) {
        gameState.ghostFrightenedTimer -= TICK_RATE;
        if (gameState.ghostFrightenedTimer <= 0) {
            gameState.ghosts.forEach(g => {
                if (g.state === 'frightened') g.state = 'chasing';
            });
        }
    }
    gameState.players.forEach(p => {
        if (p && p.powerUpTimer > 0) {
            p.powerUpTimer -= TICK_RATE;
            if (p.powerUpTimer <= 0) p.isPoweredUp = false;
        }
    });

    gameState.ghostReleaseTimer += TICK_RATE;
    if(gameState.ghostReleaseTimer >= GHOST_RELEASE_INTERVAL) {
        const ghostToRelease = gameState.ghosts.find(g => g.state === 'inHouse');
        if(ghostToRelease) ghostToRelease.state = 'exitingHouse';
        gameState.ghostReleaseTimer = 0;
    }

    // Update positions
    gameState.players.forEach(p => p && p.state === 'active' && movePlayer(p));
    gameState.ghosts.forEach(g => moveGhost(g));

    // Check collisions
    checkCollisions(soundEvents);
    
    // Check win/loss condition
    const activePlayers = gameState.players.filter(p => p && p.state === 'active');
    if (activePlayers.length <= 1) {
        const winner = activePlayers.length === 1 ? activePlayers[0] : null;
        console.log(`[SERVER] Game over. Winner: ${winner ? winner.name : 'None'}`);
        broadcast({ type: 'gameOver', winner });
        gameState = null; // Stop the game loop
        setTimeout(resetGame, 5000); // Reset after 5 seconds
        return;
    }

    broadcast({ type: 'gameState', gameState, events: soundEvents });
}

function movePlayer(player) {
    // Animation
    player.animationFrame = (player.animationFrame + 1) % 20;
    player.mouthAngle = player.animationFrame < 10 ? Math.PI / 4 : 0;

    // Turning logic
    if (player.nextDirection.dx !== 0 || player.nextDirection.dy !== 0) {
        if (!isCollisionWithWall(player.x, player.y, player.nextDirection.dx, player.nextDirection.dy, player.radius, PLAYER_SPEED)) {
            const currentTileX = Math.floor(player.x / TILE_SIZE);
            const currentTileY = Math.floor(player.y / TILE_SIZE);
            const alignmentThreshold = PLAYER_SPEED;
            const canTurn = (player.nextDirection.dx !== 0 && Math.abs(player.y - (currentTileY * TILE_SIZE + TILE_SIZE / 2)) < alignmentThreshold) ||
                            (player.nextDirection.dy !== 0 && Math.abs(player.x - (currentTileX * TILE_SIZE + TILE_SIZE / 2)) < alignmentThreshold);
            if (canTurn) {
                if (player.nextDirection.dx !== 0) player.y = currentTileY * TILE_SIZE + TILE_SIZE / 2;
                if (player.nextDirection.dy !== 0) player.x = currentTileX * TILE_SIZE + TILE_SIZE / 2;
                player.dx = player.nextDirection.dx;
                player.dy = player.nextDirection.dy;
            }
        }
    }

    // Movement
    if (!isCollisionWithWall(player.x, player.y, player.dx, player.dy, player.radius, PLAYER_SPEED)) {
        player.x += player.dx * PLAYER_SPEED;
        player.y += player.dy * PLAYER_SPEED;
    } else {
        player.dx = 0;
        player.dy = 0;
    }
     // Tunnel
    if (player.x < 0) player.x = MAP_WIDTH * TILE_SIZE;
    else if (player.x > MAP_WIDTH * TILE_SIZE) player.x = 0;
}

function isCollisionWithWall(x, y, dx, dy, radius, speed) {
    const nextX = x + dx * speed;
    const nextY = y + dy * speed;
    const checkPoints = [
        { x: nextX - radius, y: nextY - radius }, { x: nextX + radius, y: nextY - radius },
        { x: nextX - radius, y: nextY + radius }, { x: nextX + radius, y: nextY + radius }
    ];
    for (const point of checkPoints) {
        let tileX = Math.floor(point.x / TILE_SIZE);
        let tileY = Math.floor(point.y / TILE_SIZE);
        if (tileX < 0) tileX = MAP_WIDTH - 1; else if (tileX >= MAP_WIDTH) tileX = 0;
        if (tileY < 0 || tileY >= MAP_HEIGHT || (gameState.map[tileY] && gameState.map[tileY][tileX] === 1)) {
            return true;
        }
    }
    return false;
}

function checkCollisions(soundEvents) {
    gameState.players.forEach(player => {
        if (!player || player.state !== 'active') return;

        // Pellets
        const tileX = Math.floor(player.x / TILE_SIZE);
        const tileY = Math.floor(player.y / TILE_SIZE);
        const tile = gameState.map[tileY][tileX];
        if (tile === 2 || tile === 3) {
            if (tile === 2) { // Pellet
                player.score += 10;
                soundEvents.push({ sound: 'chomp' });
            } else { // Power-up
                player.score += 50;
                player.isPoweredUp = true;
                player.powerUpTimer = POWERUP_DURATION;
                gameState.ghostFrightenedTimer = POWERUP_DURATION;
                gameState.ghosts.forEach(g => { if(g.state !== 'eaten') g.state = 'frightened' });
                soundEvents.push({ sound: 'powerup' });
            }
            gameState.map[tileY][tileX] = 4; // Empty
            gameState.pelletsRemaining--;
        }

        // Ghosts
        gameState.ghosts.forEach(ghost => {
            const dist = Math.hypot(player.x - ghost.x, player.y - ghost.y);
            if (dist < player.radius + TILE_SIZE / 3) {
                if (ghost.state === 'frightened') {
                    player.score += 200;
                    ghost.state = 'eaten';
                    soundEvents.push({ sound: 'eatGhost' });
                } else if (ghost.state !== 'eaten') {
                    player.lives--;
                    soundEvents.push({ sound: 'death', playerId: player.id });
                    if (player.lives <= 0) {
                        player.state = 'spectating';
                    } else {
                        // Reset player position
                        const spawn = PLAYER_SPAWNS[player.index];
                        player.x = spawn.c * TILE_SIZE;
                        player.y = spawn.r * TILE_SIZE;
                        player.dx = 0; player.dy = 0;
                    }
                }
            }
        });

        // Other players
        if(player.isPoweredUp) {
            gameState.players.forEach(otherPlayer => {
                if (!otherPlayer || otherPlayer.id === player.id || otherPlayer.state !== 'active' || otherPlayer.isPoweredUp) return;
                const dist = Math.hypot(player.x - otherPlayer.x, player.y - otherPlayer.y);
                if (dist < player.radius * 2) {
                     player.score += 500;
                     otherPlayer.lives--;
                     soundEvents.push({ sound: 'eatGhost' }); // Re-use sound
                     soundEvents.push({ sound: 'death', playerId: otherPlayer.id });
                     if(otherPlayer.lives <= 0) {
                         otherPlayer.state = 'spectating';
                     } else {
                         const spawn = PLAYER_SPAWNS[otherPlayer.index];
                         otherPlayer.x = spawn.c * TILE_SIZE;
                         otherPlayer.y = spawn.r * TILE_SIZE;
                         otherPlayer.dx = 0; otherPlayer.dy = 0;
                     }
                }
            });
        }
    });
}

function moveGhost(ghost) {
    // Simplified AI logic for server
    let targetX = 0, targetY = 0;
    let speed = GHOST_NORMAL_SPEED;

    const activePlayers = gameState.players.filter(p => p && p.state === 'active');
    const mainTarget = activePlayers.length > 0 ? activePlayers[0] : { x: 0, y: 0 }; // Simple target

    switch (ghost.state) {
        case 'eaten':
            targetX = ghost.originalX; targetY = ghost.originalY; speed = GHOST_EATEN_SPEED;
            if (Math.hypot(ghost.x - targetX, ghost.y - targetY) < TILE_SIZE) ghost.state = 'inHouse';
            break;
        case 'inHouse':
        case 'exitingHouse':
            targetX = GHOST_EXIT_TILE.c * TILE_SIZE; targetY = GHOST_EXIT_TILE.r * TILE_SIZE;
            if (Math.hypot(ghost.x - targetX, ghost.y - targetY) < TILE_SIZE) ghost.state = 'chasing';
            break;
        case 'frightened':
            targetX = Math.random() * MAP_WIDTH * TILE_SIZE; targetY = Math.random() * MAP_HEIGHT * TILE_SIZE; speed = GHOST_FRIGHTENED_SPEED;
            break;
        case 'chasing':
            targetX = mainTarget.x; targetY = mainTarget.y;
            break;
    }
    
    // Simple pathfinding: move towards target
    const dx = targetX - ghost.x;
    const dy = targetY - ghost.y;
    const angle = Math.atan2(dy, dx);
    
    ghost.dx = Math.cos(angle);
    ghost.dy = Math.sin(angle);

    ghost.x += ghost.dx * speed;
    ghost.y += ghost.dy * speed;
}

// --- WebSocket Connection Handling ---
wss.on('connection', (ws) => {
    console.log('[SERVER] Client connected');
    let playerId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'join':
                    if (gameState) {
                        send(ws, { type: 'error', message: 'Game already in progress.' });
                        return;
                    }
                    const playerIndex = lobby.players.findIndex(p => p === null);
                    if (playerIndex === -1) {
                        send(ws, { type: 'error', message: 'Lobby is full.' });
                        return;
                    }
                    playerId = uuidv4();
                    clients.set(ws, playerId);
                    lobby.players[playerIndex] = { id: playerId, name: data.name, index: playerIndex };
                    send(ws, { type: 'assignId', playerId, playerIndex });
                    broadcast({ type: 'lobbyUpdate', lobby });
                    break;
                case 'startGame':
                    if (!gameState && lobby.players[0] && lobby.players[0].id === playerId) {
                        initGame();
                    }
                    break;
                case 'input':
                    if (gameState && playerId) {
                        const player = gameState.players.find(p => p && p.id === playerId);
                        if (player && player.state === 'active') {
                            player.nextDirection = data.direction;
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('[SERVER] Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('[SERVER] Client disconnected');
        clients.delete(ws);
        if (playerId) {
            const index = lobby.players.findIndex(p => p && p.id === playerId);
            if (index !== -1) {
                lobby.players[index] = null;
            }
            if (gameState) {
                const gamePlayer = gameState.players.find(p => p && p.id === playerId);
                if (gamePlayer) gamePlayer.state = 'spectating'; // Don't remove, just make spectator
            }
            broadcast({ type: 'lobbyUpdate', lobby });
        }
    });
});

server.listen(PORT, () => {
    console.log(`[SERVER] Listening on http://localhost:${PORT}`);
    setInterval(gameTick, TICK_RATE);
});
