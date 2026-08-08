
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { buildGameStatePayload, GAME_STATES, MAZE, getLevelTransition } = require('./src/gameLogic');
const { generateMaze } = require('./src/mazeGenerator');
const { ghostSpeedForLevel, frightenedDurationForLevel } = require('./src/difficulty');
const {
  createInitialGhosts,
  getDefaultHouseConfig,
  getGhostTarget,
  chooseDirection,
  isAtTileCenter,
  snapToTileCenter,
  updateGhostHouseState,
  createModeCycle,
  updateModeCycle,
  isGhostWalkable,
  shouldGhostFlash,
  GHOST_EAT_SCORE,
  GHOST_FRIGHTENED_SPEED,
  GHOST_NORMAL_SPEED,
  GHOST_EATEN_SPEED,
  DIRECTION_VECTORS,
  OPPOSITE,
} = require('./src/ghostAI');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '.')));

// Game State
// currentMaze holds the active maze (swapped each level). It starts as the
// default MAZE from gameLogic.js and is replaced by procedurally generated
// mazes on level advancement.
// Tile types: 0=pellet, 1=wall, 2=power, 4=empty, 6=ghost gate
let currentMaze = MAZE;
let currentLevel = 1;
let players = [];
let ghosts = [];
let pellets = [];
let powerPellets = [];
const PLAYER_SPEED = 0.05; // tiles per tick
let ghostBaseSpeed = 0.08; // base tiles per tick (personalities apply multiplier); scales with level
let frightenedDurationMs = frightenedDurationForLevel(1); // scales with level

// Ghost AI state
let modeCycle = null; // { mode, timer, index }
let ghostFrightenedTimer = 0; // ms remaining
let ghostHouseConfig = null; // { centerX, centerY, exitX, exitY, gateX, gateY }
let totalPelletsInLevel = 0;

// GAME_STATES is imported from src/gameLogic.js (single source of truth)
let currentGameState = GAME_STATES.LOBBY;
let lobbyPlayers = []; // Array to hold players in the lobby
const spectators = []; // Array to hold WebSocket connections of players in spectator mode

function initializeGameState() {
    players = [];
    pellets = [];
    powerPellets = [];

    // Reset difficulty scaling to level-1 defaults.
    ghostBaseSpeed = ghostSpeedForLevel(1);
    frightenedDurationMs = frightenedDurationForLevel(1);

    // Extract pellets and power pellets from the current maze
    for (let y = 0; y < currentMaze.length; y++) {
        for (let x = 0; x < currentMaze[y].length; x++) {
            const tile = currentMaze[y][x];
            if (tile === 0) {
                pellets.push({ x: x, y: y });
            } else if (tile === 2 || tile === 3) {
                powerPellets.push({ x: x, y: y });
            }
        }
    }
    totalPelletsInLevel = pellets.length + powerPellets.length;

    // Initialize ghost house config and create 4 AI-driven ghosts
    ghostHouseConfig = getDefaultHouseConfig(currentMaze);
    ghosts = createInitialGhosts(ghostHouseConfig);

    // Initialize scatter/chase mode cycle
    modeCycle = createModeCycle();
    ghostFrightenedTimer = 0;
}
initializeGameState();

function startGame() {
    if (currentGameState !== GAME_STATES.LOBBY) {
        return; // Game can only start from LOBBY state
    }

    currentGameState = GAME_STATES.IN_PROGRESS;
    initializeGameState(); // Resets pellets, power pellets, and ghosts

    // Assign players from lobby to game, and give them starting positions
    // Starting positions spread across the maze on walkable tiles
    // (avoiding the ghost house area in the center)
    const startingPositions = [
        { x: 1.5, y: 1.5 }, // top-left
        { x: currentMaze[0].length - 1.5, y: 1.5 }, // top-right
        { x: 1.5, y: 4.5 }, // mid-left
        { x: currentMaze[0].length - 1.5, y: 4.5 }, // mid-right
    ];

    players = lobbyPlayers.map((lp, index) => ({
        id: lp.id,
        x: startingPositions[index % startingPositions.length].x,
        y: startingPositions[index % startingPositions.length].y,
        color: ['yellow', 'lime', 'cyan', 'magenta'][index % 4], // Assign different colors
        lives: 3,
        score: 0,
        direction: null,
        poweredUp: false,
    }));
    lobbyPlayers = []; // Clear lobby after starting game

    // Link WebSocket connections to player objects
    wss.clients.forEach(client => {
        if (client.lobbyPlayerId) {
            const player = players.find(p => p.id === client.lobbyPlayerId);
            if (player) {
                client.playerId = player.id;
            }
        }
    });

    if (!gameInterval) { // Start the game interval if not already running
        console.log('[SERVER] Starting game loop.');
        gameInterval = setInterval(gameLoop, GAME_LOOP_INTERVAL);
    }

    console.log('[SERVER] Game started with players:', players.map(p => p.id));
    broadcastLobbyState(); // Send updated lobby state (empty)
    // The gameLoop will immediately broadcast gameState
}

function isWall(x, y, maze = currentMaze) {
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    if (tileY < 0 || tileY >= maze.length || tileX < 0 || tileX >= maze[0].length) {
        return true;
    }
    const tile = maze[tileY][tileX];
    // 1 = wall, 6 = ghost gate (impassable for players)
    return tile === 1 || tile === 6;
}

// Game Loop
const GAME_LOOP_INTERVAL = 1000 / 60; // 60 FPS
let gameInterval = null;

function gameLoop() {
    if (currentGameState !== GAME_STATES.IN_PROGRESS) { // Only run game logic if IN_PROGRESS
        return;
    }
    // Player movement and pellet collision
    players.forEach(player => {
        // Tick down power-up timer (avoids setTimeout + circular JSON)
        if (player.poweredUp && player.poweredUpTicks > 0) {
            player.poweredUpTicks--;
            if (player.poweredUpTicks <= 0) {
                player.poweredUp = false;
                player.poweredUpTicks = 0;
            }
        }

        let nextX = player.x;
        let nextY = player.y;

        switch (player.direction) {
            case 'up': nextY -= PLAYER_SPEED; break;
            case 'down': nextY += PLAYER_SPEED; break;
            case 'left': nextX -= PLAYER_SPEED; break;
            case 'right': nextX += PLAYER_SPEED; break;
        }

        if (!isWall(nextX, player.y)) player.x = nextX;
        if (!isWall(player.x, nextY)) player.y = nextY;

        // Pellet collision
        for (let i = pellets.length - 1; i >= 0; i--) {
            const p = pellets[i];
            const dist = Math.hypot(player.x - (p.x + 0.5), player.y - (p.y + 0.5));
            if (dist < 0.4) {
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
                // Tick-based power-up countdown (avoids storing non-serializable
                // Timeout objects on the player and prevents timer drift).
                player.poweredUpTicks = Math.ceil(frightenedDurationMs / GAME_LOOP_INTERVAL);
                // Frighten all active ghosts
                ghostFrightenedTimer = frightenedDurationMs;
                ghosts.forEach(ghost => {
                    if (ghost.state !== 'eaten' && ghost.state !== 'inHouse') {
                        ghost.frightened = true;
                        ghost.speed = GHOST_FRIGHTENED_SPEED;
                        if (ghost.state === 'chase' || ghost.state === 'scatter') {
                            ghost.state = 'frightened';
                            ghost.direction = OPPOSITE[ghost.direction] || ghost.direction;
                        }
                    }
                });
            }
        }

        // Player collision with other players
        players.forEach(otherPlayer => {
            if (player.id === otherPlayer.id) return; // Don't check collision with self

            const dist = Math.hypot(player.x - otherPlayer.x, player.y - otherPlayer.y);
            if (dist < 0.5) { // Collision detected
                if (player.poweredUp && !otherPlayer.poweredUp) {
                    // Current player (player) is powered up and eats otherPlayer
                    otherPlayer.lives--;
                    player.score += 100; // Score for eating another player

                    if (otherPlayer.lives <= 0) {
                        // Move to spectator mode
                        const clientWs = Array.from(wss.clients).find(client => client.playerId === otherPlayer.id);
                        if (clientWs) {
                            spectators.push(clientWs); // Add to spectators array
                            clientWs.send(JSON.stringify({ type: 'spectatorMode', message: 'You were eaten! You are now spectating.' }));
                            clientWs.playerId = null; // Mark client as no longer controlling a player
                        }
                        // Remove player from active players
                        const eatenPlayerIndex = players.findIndex(p => p.id === otherPlayer.id);
                        if (eatenPlayerIndex !== -1) {
                            players.splice(eatenPlayerIndex, 1);
                        }
                    } else {
                        // Respawn otherPlayer
                        otherPlayer.x = 1.5; // Or some other safe respawn point
                        otherPlayer.y = 1.5;
                        otherPlayer.poweredUp = false; // Lose power-up on respawn
                    }
                } else if (!player.poweredUp && otherPlayer.poweredUp) {
                    // Other player is powered up and eats current player (handled by otherPlayer's loop iteration)
                    // No action needed here to avoid double processing or incorrect logic
                } else {
                    // Neither is powered up or both are powered up: morph through (no collision effect)
                }
            }
        });
    });

    // --- Ghost AI: mode cycling & frightened timer ---
    if (modeCycle) {
        const prevMode = modeCycle.mode;
        modeCycle = updateModeCycle(modeCycle, GAME_LOOP_INTERVAL);
        // When mode changes, reverse active ghosts (classic behavior)
        if (modeCycle.changed && modeCycle.mode !== prevMode) {
            ghosts.forEach(ghost => {
                if (ghost.state === 'chase' || ghost.state === 'scatter') {
                    ghost.state = modeCycle.mode;
                    ghost.direction = OPPOSITE[ghost.direction] || ghost.direction;
                }
            });
        }
    }

    // Tick down frightened timer & compute white-flash flag
    // (flash in the last 1/3 of the duration, toggling every 100ms)
    ghosts.forEach(ghost => {
        if (ghost.frightened) {
            ghost.flashing = shouldGhostFlash(ghostFrightenedTimer, frightenedDurationMs);
        } else {
            ghost.flashing = false;
        }
    });
    if (ghostFrightenedTimer > 0) {
        ghostFrightenedTimer -= GAME_LOOP_INTERVAL;
        if (ghostFrightenedTimer <= 0) {
            ghostFrightenedTimer = 0;
            // Revert frightened ghosts back to their mode
            ghosts.forEach(ghost => {
                if (ghost.state === 'frightened') {
                    ghost.frightened = false;
                    ghost.flashing = false;
                    ghost.speed = GHOST_NORMAL_SPEED;
                    ghost.state = modeCycle ? modeCycle.mode : 'scatter';
                }
            });
        }
    }

    // --- Ghost movement and player collision ---
    const pelletsEaten = totalPelletsInLevel - (pellets.length + powerPellets.length);
    const blinkyGhost = ghosts.find(g => g.id === 'blinky');

    ghosts.forEach(ghost => {
        // Update house state machine (inHouse → exitingHouse transitions)
        updateGhostHouseState(ghost, {
            pelletsEaten,
            deltaTime: GAME_LOOP_INTERVAL,
            houseConfig: ghostHouseConfig,
            globalMode: modeCycle ? modeCycle.mode : 'scatter',
        });

        // Bobbing for ghosts waiting in the house
        if (ghost.state === 'inHouse') {
            ghost.idleTimer = (ghost.idleTimer || 0) + GAME_LOOP_INTERVAL;
            const bobble = Math.sin(ghost.idleTimer / 250) * 0.1;
            ghost.y = ghost.originalY + bobble;
            ghost.x = ghost.originalX;
        }

        // Choose direction at tile centers (AI decision point)
        if (ghost.state !== 'inHouse') {
            const atCenter = isAtTileCenter(ghost.x, ghost.y, ghostBaseSpeed / 2);
            if (atCenter) {
                const snapped = snapToTileCenter(ghost);
                ghost.x = snapped.x;
                ghost.y = snapped.y;

                const target = getGhostTarget(ghost, {
                    players,
                    blinky: blinkyGhost,
                    mode: modeCycle ? modeCycle.mode : 'scatter',
                    mazeWidth: currentMaze[0].length,
                    mazeHeight: currentMaze.length,
                    houseConfig: ghostHouseConfig,
                });
                ghost.direction = chooseDirection(ghost, target, currentMaze, currentMaze[0].length, currentMaze.length);
            }

            // Move ghost in current direction
            const vec = DIRECTION_VECTORS[ghost.direction] || { dx: 0, dy: 0 };
            const moveAmount = ghostBaseSpeed * (ghost.speed || GHOST_NORMAL_SPEED);
            const nextX = ghost.x + vec.dx * moveAmount;
            const nextY = ghost.y + vec.dy * moveAmount;

            // Check wall collision (use ghost-aware walkability for gates)
            if (!isGhostWalkable(currentMaze, Math.floor(nextX), Math.floor(nextY), ghost.state, currentMaze[0].length, currentMaze.length)) {
                // Hit a wall — stop and let next tick pick a new direction
                // Snap to tile edge to prevent overshoot
                if (vec.dx > 0) ghost.x = Math.floor(ghost.x) + 0.99;
                else if (vec.dx < 0) ghost.x = Math.floor(ghost.x) + 0.01;
                if (vec.dy > 0) ghost.y = Math.floor(ghost.y) + 0.99;
                else if (vec.dy < 0) ghost.y = Math.floor(ghost.y) + 0.01;
            } else {
                ghost.x = nextX;
                ghost.y = nextY;
            }

            // Tunnel wrapping: only tunnel rows (type 4 at the horizontal edges) wrap.
            // Type 0 at edges is a regular pellet path and does NOT wrap.
            const tileY = Math.floor(ghost.y);
            const isTunnelRow = tileY >= 0 && tileY < currentMaze.length && currentMaze[tileY][0] === 4;
            if (isTunnelRow && (ghost.x < 0 || ghost.x >= currentMaze[0].length)) {
                if (ghost.x < 0) ghost.x = currentMaze[0].length + ghost.x;
                else if (ghost.x >= currentMaze[0].length) ghost.x = ghost.x - currentMaze[0].length;
            }
        }

        // Player collision
        players.forEach((player, playerIndex) => {
            const dist = Math.hypot(player.x - ghost.x, player.y - ghost.y);
            if (dist < 0.5) {
                if (ghost.eaten) return; // Already eaten, skip

                if (player.poweredUp || ghost.frightened) {
                    // Player eats ghost
                    ghost.eaten = true;
                    ghost.frightened = false;
                    ghost.speed = GHOST_EATEN_SPEED;
                    ghost.state = 'eaten';
                    player.score += GHOST_EAT_SCORE;
                } else {
                    // Ghost catches player
                    player.lives--;
                    if (player.lives <= 0) {
                        const clientWs = Array.from(wss.clients).find(client => client.playerId === player.id);
                        if (clientWs) {
                            spectators.push(clientWs);
                            clientWs.send(JSON.stringify({ type: 'spectatorMode', message: 'You ran out of lives! You are now spectating.' }));
                            clientWs.playerId = null;
                        }
                        players.splice(playerIndex, 1);
                    } else {
                        player.x = 1.5;
                        player.y = 1.5;
                    }
                }
            }
        });
    });

    // Win/Loss Conditions
    //   - Last Man Standing (1 player left)        -> GAME_OVER (match ends)
    //   - All pellets eaten (2+ players alive)     -> LEVEL_COMPLETE -> next level
    if (currentGameState === GAME_STATES.IN_PROGRESS) {
        const transition = getLevelTransition(players, pellets, powerPellets);
        if (transition === GAME_STATES.GAME_OVER) {
            endMatch(players[0] || null);
        } else if (transition === GAME_STATES.LEVEL_COMPLETE) {
            startNextLevel();
        }
    }

    // Broadcast state to all clients
    const gameState = buildGameStatePayload(currentMaze, players, ghosts, pellets, powerPellets, currentGameState, currentLevel);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'gameState', gameState }));
        }
    });
}

/**
 * End the match: stop the loop, broadcast GAME_OVER, then reset to lobby.
 * @param {Object} winner - The last surviving player.
 */
function endMatch(winner) {
    console.log(`[SERVER] Game Over: ${winner ? winner.name : 'No winner'} is the Last Man Standing!`);
    currentGameState = GAME_STATES.GAME_OVER;
    clearInterval(gameInterval);
    gameInterval = null;

    const finalGameState = buildGameStatePayload(currentMaze, players, ghosts, pellets, powerPellets, GAME_STATES.GAME_OVER, currentLevel);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'gameState', gameState: finalGameState }));
        }
    });
    // After a delay, reset to lobby.
    setTimeout(() => {
        currentLevel = 1;
        currentMaze = MAZE;
        initializeGameState();
        currentGameState = GAME_STATES.LOBBY;
        broadcastLobbyState();
    }, 5000);
}

/**
 * Advance to the next level: generate a new maze, scale difficulty, reset
 * pellets/ghosts, keep player scores & lives, then resume the game loop.
 */
function startNextLevel() {
    currentLevel++;
    console.log(`[SERVER] Level ${currentLevel - 1} complete! Advancing to level ${currentLevel}...`);

    // Stop the loop during the transition.
    clearInterval(gameInterval);
    gameInterval = null;

    // Generate a fresh maze for the new level.
    currentMaze = generateMaze();

    // Re-extract pellets and power pellets from the new maze.
    pellets = [];
    powerPellets = [];
    for (let y = 0; y < currentMaze.length; y++) {
        for (let x = 0; x < currentMaze[y].length; x++) {
            const tile = currentMaze[y][x];
            if (tile === 0) {
                pellets.push({ x, y });
            } else if (tile === 2 || tile === 3) {
                powerPellets.push({ x, y });
            }
        }
    }
    totalPelletsInLevel = pellets.length + powerPellets.length;

    // Reset ghosts for the new maze.
    ghostHouseConfig = getDefaultHouseConfig(currentMaze);
    ghosts = createInitialGhosts(ghostHouseConfig);

    // Reset mode cycle and frightened timer.
    modeCycle = createModeCycle();
    ghostFrightenedTimer = 0;

    // Difficulty scaling per level.
    applyDifficultyScaling();

    // Move players back to starting positions (keep scores/lives).
    const startingPositions = [
        { x: 1.5, y: 1.5 },
        { x: currentMaze[0].length - 1.5, y: 1.5 },
        { x: 1.5, y: 4.5 },
        { x: currentMaze[0].length - 1.5, y: 4.5 },
    ];
    players.forEach((player, index) => {
        player.x = startingPositions[index % startingPositions.length].x;
        player.y = startingPositions[index % startingPositions.length].y;
        player.direction = null;
        player.poweredUp = false;
        player.poweredUpTicks = 0;
    });

    // Brief pause so the client can show "Level Complete", then resume.
    currentGameState = GAME_STATES.LEVEL_COMPLETE;
    const levelCompleteState = buildGameStatePayload(currentMaze, players, ghosts, pellets, powerPellets, GAME_STATES.LEVEL_COMPLETE, currentLevel);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'gameState', gameState: levelCompleteState }));
        }
    });

    setTimeout(() => {
        currentGameState = GAME_STATES.IN_PROGRESS;
        console.log(`[SERVER] Level ${currentLevel} started.`);
        if (!gameInterval) {
            gameInterval = setInterval(gameLoop, GAME_LOOP_INTERVAL);
        }
    }, 3000);
}

/**
 * Scale difficulty with the current level: faster ghosts and shorter
 * frightened duration. Values are capped to keep the game playable.
 */
function applyDifficultyScaling() {
    ghostBaseSpeed = ghostSpeedForLevel(currentLevel);
    frightenedDurationMs = frightenedDurationForLevel(currentLevel);

    const speedMultiplier = ghostBaseSpeed / 0.08;
    console.log(`[SERVER] Difficulty L${currentLevel}: ghost speed x${speedMultiplier.toFixed(2)}, frightened ${frightenedDurationMs}ms`);
}

wss.on('connection', (ws) => {
    console.log('[SERVER] A new client connected.');
    ws.id = Date.now(); // Assign a unique ID to the WebSocket connection

    // Send a welcome message, but the player is not yet in the game
    ws.send(JSON.stringify({ type: 'welcome', message: 'Welcome to Pacclone Multi! Please join the lobby.', clientId: ws.id }));

    // NEW: Expect a 'joinLobby' message from the client
    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'joinLobby') {
            if (currentGameState === GAME_STATES.LOBBY) {
                const newLobbyPlayer = { id: ws.id, name: data.name || `Player ${ws.id % 1000}` };
                lobbyPlayers.push(newLobbyPlayer);
                ws.lobbyPlayerId = newLobbyPlayer.id; // Store lobby player ID on websocket
                console.log(`[SERVER] ${newLobbyPlayer.name} joined the lobby.`);
                broadcastLobbyState();
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'Game in progress, cannot join lobby.' }));
            }
        } else if (data.type === 'input' && currentGameState === GAME_STATES.IN_PROGRESS) {
            const player = players.find(p => p.id === ws.playerId);
            if (player) {
                player.direction = data.direction;
            }
        } else if (data.type === 'startGame' && currentGameState === GAME_STATES.LOBBY) {
            // For now, let any client start the game. Later, this could be restricted to a host.
            startGame(); // Implement this function next
        }
    });

    // Handle disconnection
    ws.on('close', () => {
        console.log('[SERVER] Client disconnected.');
        // Remove from lobbyPlayers if they were in lobby
        if (ws.lobbyPlayerId) {
            const lobbyIndex = lobbyPlayers.findIndex(lp => lp.id === ws.lobbyPlayerId);
            if (lobbyIndex !== -1) {
                lobbyPlayers.splice(lobbyIndex, 1);
                broadcastLobbyState();
            }
        }

        // Remove from game players if in game
        const index = players.findIndex(p => p.id === ws.playerId);
        if (index !== -1) {
            players.splice(index, 1);
        }

        // Remove from spectators if they were spectating
        const spectatorIndex = spectators.findIndex(s => s.id === ws.id);
        if (spectatorIndex !== -1) {
            spectators.splice(spectatorIndex, 1);
        }

        // If no clients left, stop game loop and reset state
        if (wss.clients.size === 0) {
            console.log('[SERVER] No clients left. Stopping game loop.');
            clearInterval(gameInterval);
            gameInterval = null;
            initializeGameState();
            currentGameState = GAME_STATES.LOBBY;
        }
        // If clients remain but game is not in progress, broadcast updated lobby state
        else if (currentGameState === GAME_STATES.LOBBY) {
            broadcastLobbyState();
        }
    });
});

function broadcastLobbyState() {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'lobbyState', lobbyPlayers: lobbyPlayers, currentGameState: currentGameState }));
        }
    });
}

const PORT = 8080;
server.listen(PORT, () => {
    console.log(`[SERVER] Listening on http://localhost:${PORT}`);
});
