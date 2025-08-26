const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const fs = require('fs');
const path = require('path');


// --- Server Setup with HTTP and WebSocket ---
const server = http.createServer((req, res) => {
    // Serve index.html for the root request
    if (req.url === '/' || req.url === '/index.html') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                console.error('[SERVER] Error reading index.html:', err);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error: Could not load the game file.');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

const wss = new WebSocket.Server({ server });

server.listen(8080, '0.0.0.0', () => {
    console.log('[SERVER] Game server is running.');
    console.log('[SERVER] Open http://localhost:8080 in your browser to play.');
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error('[SERVER] FATAL: Port 8080 is already in use.');
        console.error('[SERVER] Please close the other application using this port and try again.');
    } else {
        console.error('[SERVER] FATAL: An unexpected error occurred on the server.', error);
    }
    process.exit(1); // Exit if the server cannot be started
});


// --- Game Constants (mirrored from client) ---
const TILE_SIZE = 30;
const MAP_WIDTH = 20;
const MAP_HEIGHT = 20;
const DASH_TILES = 3;
const GHOST_RELEASE_THRESHOLDS = { 'blinky': 0, 'pinky': 15, 'inky': 30, 'clyde': 50 };
const FRIGHTENED_DURATION = 8000;
const GHOST_FRIGHTENED_SPEED_MULTIPLIER = 0.5;
const GHOST_NORMAL_SPEED_MULTIPLIER = 0.8;
const PACMAN_SPEED_PPS = 150;
const PVP_EAT_SCORE = 500;
const RESPAWN_INVULNERABILITY_DURATION = 3000;
const GAME_TICK_RATE = 1000 / 60; // 60 FPS

let INITIAL_MAP = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,1],
    [1,2,1,1,1,2,1,1,2,1,1,2,1,1,2,1,1,1,2,1],
    [1,3,1,1,1,2,1,1,2,1,1,2,1,1,2,1,1,1,3,1],
    [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
    [1,2,1,1,1,2,1,2,1,1,1,1,2,1,2,1,1,1,2,1],
    [1,2,2,2,2,2,1,2,2,2,2,2,2,1,2,2,2,2,2,1],
    [1,1,1,1,1,2,1,1,1,6,6,1,1,1,2,1,1,1,1,1],
    [0,0,0,0,1,2,1,0,0,0,0,0,0,1,2,1,0,0,0,0],
    [1,1,1,1,1,2,1,0,0,0,0,0,0,1,2,1,1,1,1,1],
    [1,2,2,2,2,2,2,0,1,0,0,1,0,2,2,2,2,2,2,1],
    [1,1,1,1,1,2,1,0,1,1,1,1,0,1,2,1,1,1,1,1],
    [0,0,0,0,1,2,1,0,0,0,0,0,0,1,2,1,0,0,0,0],
    [1,1,1,1,1,2,1,0,1,1,1,1,0,1,2,1,1,1,1,1],
    [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
    [1,2,1,1,1,2,1,1,2,1,1,2,1,1,2,1,1,1,2,1],
    [1,3,2,2,1,2,2,2,2,2,2,2,2,2,2,1,2,2,3,1],
    [1,1,2,1,1,2,1,1,1,1,1,1,1,1,2,1,1,2,1,1],
    [1,2,2,2,2,2,2,2,2,1,1,2,2,2,2,2,2,2,2,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
];

// --- Server State ---
let clients = new Map();
let lobbyState = {
    slots: [
        { id: 1, color: 'yellow', joined: false, clientId: null, startX: 9.5 * TILE_SIZE, startY: 14.5 * TILE_SIZE },
        { id: 2, color: '#4ade80', joined: false, clientId: null, startX: 10.5 * TILE_SIZE, startY: 14.5 * TILE_SIZE },
    ]
};
let gameState = null;
let gameLoopInterval = null;

// --- Game Logic Classes ---
class Player {
    constructor(id, clientId, color, startX, startY) {
        this.id = id;
        this.clientId = clientId;
        this.startX = startX;
        this.startY = startY;
        this.color = color;
        this.reset();
    }
    reset() {
        this.x = this.startX;
        this.y = this.startY;
        this.dx = 0;
        this.dy = 0;
        this.nextDirection = { dx: 0, dy: 0 };
        this.lastDx = 0;
        this.lastDy = 0;
        this.phaseDashAvailable = true;
        this.isDashing = false;
        this.dashTimer = 0;
        this.powerUpTimer = 0;
        this.invulnerabilityTimer = 0;
        this.score = 0;
        this.lives = 3;
        this.isActive = true;
        this.isSpectator = false;
        this.isWinner = false;
    }
    loseLife() {
        this.lives--;
        if (this.lives <= 0) {
            this.enterSpectatorMode();
        } else {
            this.invulnerabilityTimer = RESPAWN_INVULNERABILITY_DURATION;
        }
    }
    enterSpectatorMode() {
        this.isActive = false;
        this.isSpectator = true;
    }
}

class Ghost {
    constructor(id, x, y, color) {
        this.id = id;
        this.originalX = x;
        this.originalY = y;
        this.color = color;
        this.speed = GHOST_NORMAL_SPEED_MULTIPLIER;
        this.targetPlayer = null;
        this.reset();
    }
    reset() {
        this.x = this.originalX;
        this.y = this.originalY;
        this.dx = 0;
        this.dy = 0;
        this.frightened = false;
        this.eaten = false;
        this.state = (this.id === 'blinky') ? 'scatter' : 'inHouse';
        this.reReleaseTimer = 0;
        this.targetPlayer = null;
    }
}

// --- WebSocket Server Logic ---
wss.on('connection', ws => {
    const clientId = uuidv4();
    clients.set(clientId, ws);
    console.log(`[SERVER] Client connected: ${clientId}. Total clients: ${clients.size}`);

    if (gameState && gameState.gameRunning) {
        // Game in progress, inform the new client
        ws.send(JSON.stringify({ event: 'gameInProgress' }));
    } else {
        // No game, send connection confirmation and initial lobby state
        ws.send(JSON.stringify({
            event: 'connected',
            payload: { clientId, lobbyState }
        }));
    }

    ws.on('message', message => {
        try {
            const { event, payload } = JSON.parse(message);
            handleClientMessage(clientId, event, payload);
        } catch (e) {
            console.error(`[SERVER] Error parsing message from ${clientId}:`, e);
        }
    });

    ws.on('close', () => {
        clients.delete(clientId);
        console.log(`[SERVER] Client disconnected: ${clientId}. Total clients: ${clients.size}`);
        
        // If client was in lobby, free up their slot
        const playerSlot = lobbyState.slots.find(s => s.clientId === clientId);
        if (playerSlot) {
            playerSlot.joined = false;
            playerSlot.clientId = null;
            broadcastLobbyState();
        }
        
        // If client was in a game, mark them as inactive
        if (gameState && gameState.players) {
            const player = gameState.players.find(p => p.clientId === clientId);
            if (player) {
                player.isActive = false;
                player.isSpectator = true; // Or handle disconnects differently
            }
        }
    });
});

function broadcast(message) {
    const stringifiedMessage = JSON.stringify(message);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(stringifiedMessage);
        }
    });
}

function broadcastLobbyState() {
    broadcast({ event: 'lobbyStateUpdate', payload: lobbyState });
}

function handleClientMessage(clientId, event, payload) {
    switch (event) {
        case 'joinLobby':
            const slotToJoin = lobbyState.slots.find(s => s.id === payload.slotId);
            const alreadyJoined = lobbyState.slots.some(s => s.clientId === clientId);
            if (slotToJoin && !slotToJoin.joined && !alreadyJoined) {
                slotToJoin.joined = true;
                slotToJoin.clientId = clientId;
                console.log(`[LOBBY] Client ${clientId.substring(0,8)} joined slot ${payload.slotId}.`);
                broadcastLobbyState();
            }
            break;
        case 'startGame':
            if (gameState) return; // Game already in progress
            initializeGame();
            broadcast({ event: 'gameStarted', payload: gameState });
            break;
        case 'playerInput':
            if (!gameState || !gameState.gameRunning) return;
            const player = gameState.players.find(p => p.clientId === clientId);
            if (player && player.isActive) {
                switch(payload.action) {
                    case 'move':
                        player.nextDirection = payload.direction;
                        break;
                    case 'dash':
                        executePhaseDash(player);
                        break;
                }
            }
            break;
        case 'requestSpectate':
            if (gameState && gameState.gameRunning) {
                const clientWs = clients.get(clientId);
                if (clientWs) {
                    // Create a spectator player instance
                    const spectator = new Player(
                        gameState.players.length + 1, // Simple ID assignment
                        clientId,
                        '#cccccc', // Spectator color
                        9.5 * TILE_SIZE, 11.5 * TILE_SIZE // Start pos doesn't matter much
                    );
                    spectator.enterSpectatorMode();
                    spectator.lives = 0;
                    
                    gameState.players.push(spectator);
                    console.log(`[GAME] Client ${clientId.substring(0,8)} is now spectating.`);
                    
                    // Send the current game state to the new spectator
                    clientWs.send(JSON.stringify({ event: 'gameStarted', payload: gameState }));
                }
            }
            break;
    }
}

// --- Game Initialization and Loop ---
function initializeGame() {
    const participatingPlayers = lobbyState.slots
        .filter(s => s.joined)
        .map(s => new Player(s.id, s.clientId, s.color, s.startX, s.startY));
        
    gameState = {
        players: participatingPlayers,
        ghosts: [
            new Ghost('blinky', 9.5 * TILE_SIZE, 8.5 * TILE_SIZE, 'red'),
            new Ghost('pinky', 9.5 * TILE_SIZE, 9.5 * TILE_SIZE, 'pink'),
            new Ghost('inky', 8.5 * TILE_SIZE, 9.5 * TILE_SIZE, 'cyan'),
            new Ghost('clyde', 10.5 * TILE_SIZE, 9.5 * TILE_SIZE, 'orange')
        ],
        map: INITIAL_MAP.map(row => [...row]),
        pelletsRemaining: 0,
        totalPelletsInLevel: 0,
        gameRunning: true,
        isGameOver: false,
        gameOverTimer: 0,
        ghostFrightenedTimer: 0,
        ghostMode: 'scatter',
        ghostModeTimer: 7000,
        modeCycleIndex: 0,
        MODE_CYCLES: [
            { duration: 7000, mode: 'scatter' }, { duration: 20000, mode: 'chase' },
            { duration: 7000, mode: 'scatter' }, { duration: 20000, mode: 'chase' },
            { duration: 5000, mode: 'scatter' }, { duration: 20000, mode: 'chase' },
            { duration: 5000, mode: 'scatter' }, { duration: Infinity, mode: 'chase' },
        ],
        GHOST_EXIT_TILE_X: 9.5,
        GHOST_EXIT_TILE_Y: 6.5
    };
    
    // Count initial pellets
    for (let r = 0; r < MAP_HEIGHT; r++) {
        for (let c = 0; c < MAP_WIDTH; c++) {
            if (gameState.map[r][c] === 2 || gameState.map[r][c] === 3) {
                gameState.pelletsRemaining++;
            }
        }
    }
    gameState.totalPelletsInLevel = gameState.pelletsRemaining;

    if(gameLoopInterval) clearInterval(gameLoopInterval);
    gameLoopInterval = setInterval(gameLoop, GAME_TICK_RATE);
    console.log(`[GAME] Starting game with players: ${participatingPlayers.map(p => `P${p.id} (${p.clientId.substring(0,8)})`).join(', ')}`);
}

function gameLoop() {
    if (!gameState) {
        clearInterval(gameLoopInterval);
        gameLoopInterval = null;
        return;
    }
    
    update(GAME_TICK_RATE);

    if (gameState) {
        broadcast({ event: 'gameStateUpdate', payload: gameState });
    }
}

// --- Core Game Logic (ported from client, adapted for server) ---
function update(deltaTime) {
    if (gameState.isGameOver) {
        gameState.gameOverTimer -= deltaTime;
        if (gameState.gameOverTimer <= 0) {
            // Reset to lobby
            Object.values(lobbyState.slots).forEach(s => { s.joined = false; s.clientId = null; });
            console.log('[LOBBY] Game has ended. Returning all clients to lobby.');
            broadcast({ event: 'returnToLobby', payload: lobbyState });
            gameState = null; // This will stop the game loop
        }
        return;
    };

    if (!gameState.gameRunning) return;

    gameState.players.forEach(player => {
        if (player.powerUpTimer > 0) player.powerUpTimer -= deltaTime;
        if (player.invulnerabilityTimer > 0) player.invulnerabilityTimer -= deltaTime;
        if (player.dashTimer > 0) player.dashTimer -= deltaTime;
        if (player.isDashing && player.dashTimer <=0) player.isDashing = false;

        if(player.isActive || player.isSpectator) movePlayer(player, deltaTime);
        if(player.isActive) checkPelletCollision(player);
        if(player.isActive) checkGhostCollision(player);
    });
    
    checkPlayerCollision();

    const anyPlayerPoweredUp = gameState.players.some(p => p.powerUpTimer > 0);
    gameState.ghostFrightenedTimer = anyPlayerPoweredUp ? Math.max(...gameState.players.map(p => p.powerUpTimer)) : 0;

    if (gameState.ghostFrightenedTimer <= 0 && gameState.ghosts.some(g => g.frightened)) {
        // Frightened mode ends
        gameState.ghosts.forEach(ghost => {
            if (ghost.frightened) {
                ghost.frightened = false;
                ghost.speed = GHOST_NORMAL_SPEED_MULTIPLIER;
                ghost.state = gameState.ghostMode;
            }
        });
    } else if (gameState.ghostFrightenedTimer > 0 && !gameState.ghosts.every(g => g.frightened || g.eaten)) {
        // Frightened mode begins
        gameState.ghosts.forEach(ghost => {
            if (ghost.state !== 'eaten' && !ghost.frightened) {
                ghost.frightened = true;
                ghost.speed = GHOST_FRIGHTENED_SPEED_MULTIPLIER;
                 if (ghost.state === 'chase' || ghost.state === 'scatter') {
                    ghost.dx = -ghost.dx; ghost.dy = -ghost.dy;
                }
                ghost.state = 'frightened';
            }
        });
    }
    
    gameState.ghostModeTimer -= deltaTime;
    if (gameState.ghostModeTimer <= 0 && gameState.modeCycleIndex < gameState.MODE_CYCLES.length - 1) {
        gameState.modeCycleIndex++;
        const newMode = gameState.MODE_CYCLES[gameState.modeCycleIndex];
        gameState.ghostMode = newMode.mode;
        gameState.ghostModeTimer = newMode.duration;
        gameState.ghosts.forEach(ghost => {
            if(ghost.state === 'chase' || ghost.state === 'scatter') {
                ghost.state = gameState.ghostMode;
                ghost.dx = -ghost.dx; ghost.dy = -ghost.dy;
            }
        });
    }
    
    const totalPelletsEaten = gameState.totalPelletsInLevel - gameState.pelletsRemaining;
    gameState.ghosts.forEach(ghost => {
        if (ghost.state === 'inHouse') {
            if (ghost.reReleaseTimer > 0) {
                ghost.reReleaseTimer -= deltaTime;
                if (ghost.reReleaseTimer <= 0) ghost.state = 'exitingHouse';
            } else if (totalPelletsEaten >= GHOST_RELEASE_THRESHOLDS[ghost.id]) {
                ghost.state = 'exitingHouse';
            }
        }
    });

    gameState.ghosts.forEach(ghost => moveGhost(ghost, deltaTime));
    
    if (gameState.pelletsRemaining === 0) {
        // For simplicity, ending game on level clear. Could be extended to load new level.
        gameState.players.forEach(p => p.isWinner = true);
        gameOver();
    }
    
    const activePlayers = gameState.players.filter(p => p.isActive);
    if (activePlayers.length <= 1 && gameState.players.length > 1) {
        if (activePlayers.length === 1) {
            activePlayers[0].isWinner = true;
        }
        gameOver();
    }
}

// --- Collision & Movement Logic (Server authoritative) ---
// This section contains functions like movePlayer, moveGhost, checkPelletCollision, etc.
// They are heavily based on the original client-side code but now modify the server's `gameState`.
function isCollisionWithWall(currentX, currentY, moveDx, moveDy, entityRadius, moveAmount) { if (moveDx === 0 && moveDy === 0) return false; const nextCenterX = currentX + moveDx * moveAmount; const nextCenterY = currentY + moveDy * moveAmount; const buffer = 0.2; const checkPoints = [ { x: nextCenterX - entityRadius + buffer, y: nextCenterY - entityRadius + buffer }, { x: nextCenterX + entityRadius - buffer, y: nextCenterY - entityRadius + buffer }, { x: nextCenterX - entityRadius + buffer, y: nextCenterY + entityRadius - buffer }, { x: nextCenterX + entityRadius - buffer, y: nextCenterY + entityRadius - buffer } ]; for (const point of checkPoints) { let tileX = Math.floor(point.x / TILE_SIZE); let tileY = Math.floor(point.y / TILE_SIZE); if (tileX < 0) tileX = MAP_WIDTH - 1; else if (tileX >= MAP_WIDTH) tileX = 0; if (tileY < 0 || tileY >= MAP_HEIGHT || (gameState.map[tileY] && gameState.map[tileY][tileX] === 1)) { return true; } } return false; }
function movePlayer(player, deltaTime) { const moveAmount = PACMAN_SPEED_PPS * (deltaTime / 1000); const playerRadius = TILE_SIZE / 2 - 2; if (player.isSpectator) { player.x += player.nextDirection.dx * moveAmount; player.y += player.nextDirection.dy * moveAmount; player.x = (player.x + MAP_WIDTH * TILE_SIZE) % (MAP_WIDTH * TILE_SIZE); player.y = (player.y + MAP_HEIGHT * TILE_SIZE) % (MAP_HEIGHT * TILE_SIZE); player.dx = player.nextDirection.dx; player.dy = player.nextDirection.dy; return; } const currentTileX = Math.floor(player.x / TILE_SIZE); const currentTileY = Math.floor(player.y / TILE_SIZE); const alignmentThreshold = TILE_SIZE / 2 - 1; if (player.nextDirection.dx !== 0 || player.nextDirection.dy !== 0) { if (!isCollisionWithWall(player.x, player.y, player.nextDirection.dx, player.nextDirection.dy, playerRadius, moveAmount)) { const canTurn = (player.nextDirection.dx !== 0 && Math.abs(player.y - (currentTileY * TILE_SIZE + TILE_SIZE / 2)) < alignmentThreshold) || (player.nextDirection.dy !== 0 && Math.abs(player.x - (currentTileX * TILE_SIZE + TILE_SIZE / 2)) < alignmentThreshold); if (canTurn) { if (player.nextDirection.dx !== 0) player.y = currentTileY * TILE_SIZE + TILE_SIZE / 2; if (player.nextDirection.dy !== 0) player.x = currentTileX * TILE_SIZE + TILE_SIZE / 2; player.dx = player.nextDirection.dx; player.dy = player.nextDirection.dy; } } } if (player.dx !== 0 || player.dy !== 0) { player.lastDx = player.dx; player.lastDy = player.dy; } if (player.dx !== 0 || player.dy !== 0) { if (!isCollisionWithWall(player.x, player.y, player.dx, player.dy, playerRadius, moveAmount)) { player.x += player.dx * moveAmount; player.y += player.dy * moveAmount; if (player.x < 0) player.x = MAP_WIDTH * TILE_SIZE + player.x; else if (player.x >= MAP_WIDTH * TILE_SIZE) player.x = player.x - MAP_WIDTH * TILE_SIZE; } else { player.dx = 0; player.dy = 0; } } }
function findNearestActivePlayer(entity) { const activePlayers = gameState.players.filter(p => p.isActive); if (activePlayers.length === 0) return null; let closestPlayer = null; let minDistance = Infinity; activePlayers.forEach(player => { const distance = Math.sqrt(Math.pow(entity.x - player.x, 2) + Math.pow(entity.y - player.y, 2)); if (distance < minDistance) { minDistance = distance; closestPlayer = player; } }); return closestPlayer; }
function moveGhost(ghost, deltaTime) { if (ghost.state === 'inHouse') return; const ghostRadius = TILE_SIZE / 3; const currentTileX = Math.floor(ghost.x / TILE_SIZE); const currentTileY = Math.floor(ghost.y / TILE_SIZE); const tileCenterX = currentTileX * TILE_SIZE + TILE_SIZE / 2; const tileCenterY = currentTileY * TILE_SIZE + TILE_SIZE / 2; const exitTargetX = gameState.GHOST_EXIT_TILE_X * TILE_SIZE; const exitTargetY = gameState.GHOST_EXIT_TILE_Y * TILE_SIZE; const exitTileX = Math.floor(exitTargetX / TILE_SIZE); const exitTileY = Math.floor(exitTargetY / TILE_SIZE); if (ghost.eaten && ghost.state !== 'eaten') { ghost.state = 'eaten'; } else if (ghost.state === 'eaten' && Math.abs(ghost.x - ghost.originalX) < TILE_SIZE / 4 && Math.abs(ghost.y - ghost.originalY) < TILE_SIZE / 4) { ghost.eaten = false; ghost.frightened = false; ghost.speed = GHOST_NORMAL_SPEED_MULTIPLIER; ghost.dx = 0; ghost.dy = 0; ghost.state = 'inHouse'; ghost.reReleaseTimer = 5000; } else if (ghost.state === 'exitingHouse' && currentTileX === exitTileX && currentTileY === exitTileY) { ghost.x = exitTargetX; ghost.y = exitTargetY; ghost.state = gameState.ghostFrightenedTimer > 0 ? 'frightened' : gameState.ghostMode; } let targetX, targetY; let effectiveSpeedMultiplier = ghost.speed; if (ghost.state === 'eaten') { effectiveSpeedMultiplier = 1.5; } const moveAmount = PACMAN_SPEED_PPS * effectiveSpeedMultiplier * (deltaTime / 1000); const setScatterTarget = () => { switch (ghost.id) { case 'blinky': targetX = (MAP_WIDTH - 1) * TILE_SIZE; targetY = 0; break; case 'pinky': targetX = 0; targetY = 0; break; case 'inky': targetX = (MAP_WIDTH - 1) * TILE_SIZE; targetY = (MAP_HEIGHT - 1) * TILE_SIZE; break; case 'clyde': targetX = 0; targetY = (MAP_HEIGHT - 1) * TILE_SIZE; break; } }; if (ghost.state === 'eaten') { targetX = ghost.originalX; targetY = ghost.originalY; } else if (ghost.state === 'exitingHouse') { targetX = exitTargetX; targetY = exitTargetY; } else if (ghost.state === 'frightened') { targetX = Math.floor(Math.random() * MAP_WIDTH) * TILE_SIZE + TILE_SIZE / 2; targetY = Math.floor(Math.random() * MAP_HEIGHT) * TILE_SIZE + TILE_SIZE / 2; } else if (ghost.state === 'scatter') { setScatterTarget(); } else if (ghost.state === 'chase') { let targetPlayer = ghost.targetPlayer; if (!targetPlayer || !targetPlayer.isActive) { targetPlayer = findNearestActivePlayer(ghost); ghost.targetPlayer = targetPlayer; } if (targetPlayer) { switch (ghost.id) { case 'blinky': targetX = targetPlayer.x; targetY = targetPlayer.y; break; case 'pinky': targetX = targetPlayer.x + targetPlayer.dx * 4 * TILE_SIZE; targetY = targetPlayer.y + targetPlayer.dy * 4 * TILE_SIZE; break; case 'inky': const blinky = gameState.ghosts.find(g => g.id === 'blinky'); if (blinky) { let aheadX = targetPlayer.x + targetPlayer.dx * 2 * TILE_SIZE; let aheadY = targetPlayer.y + targetPlayer.dy * 2 * TILE_SIZE; targetX = blinky.x + 2 * (aheadX - blinky.x); targetY = blinky.y + 2 * (aheadY - blinky.y); } else { targetX = targetPlayer.x; targetY = targetPlayer.y; } break; case 'clyde': const dist = Math.sqrt(Math.pow(ghost.x - targetPlayer.x, 2) + Math.pow(ghost.y - targetPlayer.y, 2)); if (dist > 8 * TILE_SIZE) { targetX = targetPlayer.x; targetY = targetPlayer.y; } else { setScatterTarget(); } break; } } else { setScatterTarget(); } } const centeringBuffer = moveAmount / 2; if (Math.abs(ghost.x - tileCenterX) < centeringBuffer && Math.abs(ghost.y - tileCenterY) < centeringBuffer) { ghost.x = tileCenterX; ghost.y = tileCenterY; let possibleDirections = []; const directions = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }]; for (const dir of directions) { if (ghost.state !== 'frightened' && dir.dx === -ghost.dx && dir.dy === -ghost.dy && (ghost.dx !== 0 || ghost.dy !== 0)) continue; let nextTileX = currentTileX + dir.dx; let nextTileY = currentTileY + dir.dy; if (nextTileX < 0) nextTileX = MAP_WIDTH - 1; else if (nextTileX >= MAP_WIDTH) nextTileX = 0; if (nextTileY < 0 || nextTileY >= MAP_HEIGHT || gameState.map[nextTileY][nextTileX] === 1) continue; const isNextTileInHouse = (nextTileY >= 8 && nextTileY <= 11 && nextTileX >= 7 && nextTileX <= 12); if (isNextTileInHouse && ghost.state !== 'eaten' && ghost.state !== 'exitingHouse') continue; possibleDirections.push(dir); } if (possibleDirections.length > 0) { let bestDir = possibleDirections[0]; let bestDistance = (ghost.state === 'frightened') ? -Infinity : Infinity; for (const dir of possibleDirections) { const dist = Math.sqrt(Math.pow(((currentTileX + dir.dx) * TILE_SIZE) - targetX, 2) + Math.pow(((currentTileY + dir.dy) * TILE_SIZE) - targetY, 2)); if ((ghost.state === 'frightened' && dist > bestDistance) || (ghost.state !== 'frightened' && dist < bestDistance)) { bestDistance = dist; bestDir = dir; } } ghost.dx = bestDir.dx; ghost.dy = bestDir.dy; } } if ((ghost.dx !== 0 || ghost.dy !== 0) && !isCollisionWithWall(ghost.x, ghost.y, ghost.dx, ghost.dy, ghostRadius, moveAmount)) { ghost.x += ghost.dx * moveAmount; ghost.y += ghost.dy * moveAmount; } if (ghost.x < 0) ghost.x = MAP_WIDTH * TILE_SIZE + ghost.x; else if (ghost.x >= MAP_WIDTH * TILE_SIZE) ghost.x = ghost.x - MAP_WIDTH * TILE_SIZE; }
function checkPelletCollision(player) { const tileX = Math.floor(player.x / TILE_SIZE); const tileY = Math.floor(player.y / TILE_SIZE); if (gameState.map[tileY] && (gameState.map[tileY][tileX] === 2 || gameState.map[tileY][tileX] === 3)) { if (gameState.map[tileY][tileX] === 2) { player.score += 10; } else if (gameState.map[tileY][tileX] === 3) { player.score += 50; player.powerUpTimer = FRIGHTENED_DURATION; } gameState.map[tileY][tileX] = 4; gameState.pelletsRemaining--; } }
function checkGhostCollision(player) { if (player.isDashing || player.invulnerabilityTimer > 0) return; gameState.ghosts.forEach(ghost => { if (ghost.eaten) return; const distance = Math.sqrt(Math.pow(player.x - ghost.x, 2) + Math.pow(player.y - ghost.y, 2)); if (distance < TILE_SIZE / 2) { if (ghost.frightened) { player.score += 200; ghost.eaten = true; } else { handlePlayerDeath(player); } } }); }
function checkPlayerCollision() { const activePlayers = gameState.players.filter(p => p.isActive); if (activePlayers.length < 2) return; for (let i = 0; i < activePlayers.length; i++) { for (let j = i + 1; j < activePlayers.length; j++) { const p1 = activePlayers[i]; const p2 = activePlayers[j]; const distance = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)); if (distance < TILE_SIZE - 4) { const p1Powered = p1.powerUpTimer > 0; const p2Powered = p2.powerUpTimer > 0; const p1Invulnerable = p1.invulnerabilityTimer > 0; const p2Invulnerable = p2.invulnerabilityTimer > 0; if (p1Powered && !p2Powered && !p2Invulnerable) { p1.score += PVP_EAT_SCORE; handlePlayerDeath(p2); } else if (p2Powered && !p1Powered && !p1Invulnerable) { p2.score += PVP_EAT_SCORE; handlePlayerDeath(p1); } } } } }
function handlePlayerDeath(player) { player.loseLife(); if (player.isActive) { resetActivePositions(); } }
function resetActivePositions() { gameState.players.forEach(p => { if (p.isActive) { p.x = p.startX; p.y = p.startY; p.dx = 0; p.dy = 0; p.nextDirection = {dx: 0, dy: 0}; } }); gameState.ghosts.forEach(g => g.reset()); gameState.modeCycleIndex = 0; gameState.ghostMode = gameState.MODE_CYCLES[0].mode; gameState.ghostModeTimer = gameState.MODE_CYCLES[0].duration; }
function gameOver() { if (gameState.isGameOver) return; gameState.gameRunning = false; gameState.isGameOver = true; gameState.gameOverTimer = 4000; const winner = gameState.players.find(p => p.isWinner); console.log(`[GAME] Game over. Winner: ${winner ? `Player ${winner.id}` : 'None'}. Resetting to lobby in 4s.`); }
function executePhaseDash(player) { if (!player.phaseDashAvailable || player.isDashing) return; const dirX = player.dx || player.lastDx || 0; const dirY = player.dy || player.lastDy || 0; if (dirX === 0 && dirY === 0) return; const currentTileX = Math.floor(player.x / TILE_SIZE); const currentTileY = Math.floor(player.y / TILE_SIZE); let targetTileX = currentTileX + dirX * DASH_TILES; let targetTileY = currentTileY + dirY * DASH_TILES; if (targetTileX < 0) targetTileX = MAP_WIDTH + targetTileX; else if (targetTileX >= MAP_WIDTH) targetTileX = targetTileX - MAP_WIDTH; if (targetTileY < 0 || targetTileY >= MAP_HEIGHT || (gameState.map[targetTileY][targetTileX] === 1)) return; player.phaseDashAvailable = false; player.isDashing = true; player.dashTimer = 200; player.x = targetTileX * TILE_SIZE + TILE_SIZE / 2; player.y = targetTileY * TILE_SIZE + TILE_SIZE / 2; player.dx = 0; player.dy = 0; player.nextDirection = { dx: 0, dy: 0 }; }