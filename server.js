
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

// Generate a stable, unique player token (used as the player's persistent
// identity across reconnects). 128-bit uuid — collision risk is negligible.
const { buildGameStatePayload, GAME_STATES, MAZE, TILE_SIZE, getLevelTransition, extraLivesEarned, updateDashState, dashSpeedMultiplier, pickRespawnPosition, snapPerpendicular, clampSpriteToWall, wrapTunnelX, COUNTDOWN_DURATION_MS, RECONNECT_GRACE_MS, rebuildLobbyFromMatch, areAllReady, togglePlayerReady, getCountdownTick, isWithinGracePeriod } = require('./src/gameLogic');
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
const PLAYER_SPEED = 0.1; // tiles per tick (6 tiles/s at 60 FPS)
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

// Single-player mode flag. When true, the match is a solo game: the level
// does not end with one player remaining (no "last man standing" win), and
// the player only loses by running out of lives. Set when a client sends
// 'startSinglePlayer' and cleared when the match ends or returns to lobby.
let isSinglePlayerMatch = false;

// The single player's identity (token + name), captured when a single-player
// game starts. Used to rebuild the lobby after the match ends — without it
// the player would be spliced from players[] on death and lost.
let singlePlayerInfo = null;

// Reconnection grace timers, keyed by player id (token). When a player
// disconnects mid-match, a timer is set; if they reconnect before it fires,
// the timer is cleared and their slot is restored.
const graceTimers = new Map();

// The pending endMatch → LOBBY reset timer. Tracked so it can be cancelled
// when a new match begins or all clients disconnect — otherwise a stale reset
// can fire mid-match or leak across test runs.
let pendingLobbyResetTimer = null;

function cancelPendingLobbyReset() {
    if (pendingLobbyResetTimer) {
        clearTimeout(pendingLobbyResetTimer);
        pendingLobbyResetTimer = null;
    }
}

// Countdown state: when set, holds the timestamps (ms) of the remaining
// countdown ticks so they can be cancelled if a player un-readies / leaves.
let countdownTimers = [];
let countdownStart = 0;

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
    // A match can begin from LOBBY (direct) or from COUNTDOWN (the countdown
    // completion timer calls this). Any other state means something is wrong.
    if (currentGameState !== GAME_STATES.LOBBY && currentGameState !== GAME_STATES.COUNTDOWN) {
        return;
    }
    // If arriving from a countdown, the countdown timers are already scheduled
    // to fire into this function; clear any stragglers defensively.
    countdownTimers.forEach((t) => clearTimeout(t));
    countdownTimers = [];
    countdownStart = 0;

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
        id: lp.id, // === the stable token, so reconnecting clients can reclaim this slot
        name: lp.name,
        x: startingPositions[index % startingPositions.length].x,
        y: startingPositions[index % startingPositions.length].y,
        color: ['yellow', 'lime', 'cyan', 'magenta'][index % 4], // Assign different colors
        lives: 3,
        score: 0,
        direction: null,
        poweredUp: false,
        poweredUpTicks: 0,
        // Extra-lives tracking: how many extra lives have been awarded so far.
        extraLivesAwarded: 0,
        // Dash state.
        dashActiveTicks: 0,
        dashCooldownTicks: 0,
        dashing: false,
    }));
    lobbyPlayers = []; // Clear lobby after starting game

    // Link WebSocket connections to player objects.
    // Tell each client its player ID so it can set myPlayerId (clients that
    // were spectators in the previous game have myPlayerId = null and would
    // otherwise be unable to send input).
    wss.clients.forEach(client => {
        if (client.lobbyPlayerId) {
            const player = players.find(p => p.id === client.lobbyPlayerId);
            if (player) {
                client.playerId = player.id;
                client.send(JSON.stringify({ type: 'playerAssigned', playerId: player.id }));
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

// --- Single-player mode: start a solo match with one player ---
// Bypasses the ready-up gate and countdown. The requesting player is removed
// from the lobby and placed into a fresh match by themselves. The match ends
// only when they run out of lives (not via "last man standing"). Clearing all
// pellets advances to the next level, just like multiplayer.
function startSinglePlayer(ws) {
    if (currentGameState !== GAME_STATES.LOBBY) {
        ws.send(JSON.stringify({ type: 'error', message: 'Can only start from the lobby.' }));
        return;
    }
    // Identify the requesting player by their stable token. They must have
    // joined the lobby first.
    if (!ws.playerToken) {
        ws.send(JSON.stringify({ type: 'error', message: 'Join the lobby first.' }));
        return;
    }
    const lobbyIndex = lobbyPlayers.findIndex(lp => lp.id === ws.playerToken);
    if (lobbyIndex === -1) {
        ws.send(JSON.stringify({ type: 'error', message: 'Join the lobby first.' }));
        return;
    }
    const lobbyPlayer = lobbyPlayers[lobbyIndex];

    // Remove this player from the lobby (other lobby players remain).
    lobbyPlayers.splice(lobbyIndex, 1);

    // Mark the match as single-player and capture the player's identity so the
    // lobby can be rebuilt around them when the match ends.
    isSinglePlayerMatch = true;
    singlePlayerInfo = { id: lobbyPlayer.id, name: lobbyPlayer.name };

    currentGameState = GAME_STATES.IN_PROGRESS;
    initializeGameState(); // Resets pellets, power pellets, and ghosts

    // Place the single player at the top-left starting position.
    players = [{
        id: lobbyPlayer.id,
        name: lobbyPlayer.name,
        x: 1.5,
        y: 1.5,
        color: 'yellow',
        lives: 3,
        score: 0,
        direction: null,
        poweredUp: false,
        poweredUpTicks: 0,
        extraLivesAwarded: 0,
        dashActiveTicks: 0,
        dashCooldownTicks: 0,
        dashing: false,
    }];

    // Link the requesting client to their player slot and tell them their ID.
    ws.playerId = players[0].id;
    ws.send(JSON.stringify({ type: 'playerAssigned', playerId: players[0].id }));

    if (!gameInterval) {
        console.log('[SERVER] Starting single-player game loop.');
        gameInterval = setInterval(gameLoop, GAME_LOOP_INTERVAL);
    }

    console.log(`[SERVER] Single-player game started for ${lobbyPlayer.name}.`);
    // Update the remaining lobby players (this player left the lobby).
    broadcastLobbyState();
    // The gameLoop will immediately broadcast gameState to all clients.
}

// --- Countdown (feature D): a brief 3-2-1 before the match begins ---
// The host triggers this instead of an immediate start. It broadcasts a
// `lobbyState` with currentGameState === COUNTDOWN and a `countdown` tick so
// clients can render the 3-2-1-GO. When the timer fires, the real match starts.
// If a player un-readies or disconnects during the countdown, cancelCountdown
// returns everyone to the LOBBY state.
function beginCountdown() {
    if (currentGameState !== GAME_STATES.LOBBY) return;
    currentGameState = GAME_STATES.COUNTDOWN;
    countdownStart = Date.now();
    broadcastLobbyState(); // tick 3
    // Schedule the 2, 1, and GO ticks.
    countdownTimers.push(setTimeout(() => {
        if (currentGameState === GAME_STATES.COUNTDOWN) broadcastLobbyState(); // tick 2
    }, 1000));
    countdownTimers.push(setTimeout(() => {
        if (currentGameState === GAME_STATES.COUNTDOWN) broadcastLobbyState(); // tick 1
    }, 2000));
    countdownTimers.push(setTimeout(() => {
        if (currentGameState === GAME_STATES.COUNTDOWN) {
            countdownTimers = [];
            countdownStart = 0;
            startGame();
        }
    }, COUNTDOWN_DURATION_MS));
}

function cancelCountdown() {
    countdownTimers.forEach((t) => clearTimeout(t));
    countdownTimers = [];
    if (currentGameState === GAME_STATES.COUNTDOWN) {
        currentGameState = GAME_STATES.LOBBY;
        countdownStart = 0;
        broadcastLobbyState();
    }
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
        // Skip disconnected players (grace period, feature E). They remain in
        // the array so their slot is reserved, but they don't move or act
        // until they reconnect or the grace window expires.
        if (player.disconnected) return;

        // Tick down power-up timer (avoids setTimeout + circular JSON)
        if (player.poweredUp && player.poweredUpTicks > 0) {
            player.poweredUpTicks--;
            if (player.poweredUpTicks <= 0) {
                player.poweredUp = false;
                player.poweredUpTicks = 0;
            }
        }

        // --- Dash: update state from input flag, apply speed multiplier ---
        const dashResult = updateDashState(player, player._dashTriggered || false);
        player.dashActiveTicks = dashResult.dashActiveTicks;
        player.dashCooldownTicks = dashResult.dashCooldownTicks;
        player.dashing = dashResult.dashing;
        player._dashTriggered = false; // consume the flag
        const speedMul = dashSpeedMultiplier(player);

        // --- Extra lives: award at score thresholds ---
        const earned = extraLivesEarned(player.score);
        if (earned > player.extraLivesAwarded) {
            const newLives = earned - player.extraLivesAwarded;
            player.lives += newLives;
            player.extraLivesAwarded = earned;
            console.log(`[SERVER] ${player.name || player.id} earned extra life! (${player.lives} total)`);
        }

        let nextX = player.x;
        let nextY = player.y;

        const moveSpeed = PLAYER_SPEED * speedMul;
        switch (player.direction) {
            case 'up': nextY -= moveSpeed; break;
            case 'down': nextY += moveSpeed; break;
            case 'left': nextX -= moveSpeed; break;
            case 'right': nextX += moveSpeed; break;
        }

        // Tunnel wrapping: on tunnel rows, walking off one horizontal edge
        // teleports to the other side. Apply the wrap to the *candidate*
        // position BEFORE the wall check so the out-of-bounds guard in isWall()
        // does not block the tunnel entrance.
        nextX = wrapTunnelX(nextX, player.y, currentMaze);

        if (!isWall(nextX, player.y)) player.x = nextX;
        if (!isWall(player.x, nextY)) player.y = nextY;

        // Clamp the player sprite so it never overlaps a wall. The wall
        // check above only gates the sprite *center*, but the player radius
        // (TILE_SIZE/2 - 2 ≈ 0.45 tiles) means the body can stick into the
        // wall at the end of a corridor — half the sprite visually inside
        // the wall tile. Pushing the center back keeps the sprite flush.
        // Player radius in tile units: (TILE_SIZE / 2 - 2) / TILE_SIZE.
        var clamped = clampSpriteToWall(player.x, player.y, (TILE_SIZE / 2 - 2) / TILE_SIZE, currentMaze);
        player.x = clamped.x;
        player.y = clamped.y;

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
            if (otherPlayer.disconnected) return; // Skip players in grace period

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
                        // Respawn otherPlayer in a random free corner (not on top
                        // of another player). Excludes otherPlayer from the occupied
                        // set since they are still in the players array.
                        const occupied = players
                            .filter(p => p.id !== otherPlayer.id)
                            .map(p => ({ x: p.x, y: p.y }));
                        const pos = pickRespawnPosition(occupied, currentMaze);
                        otherPlayer.x = pos.x;
                        otherPlayer.y = pos.y;
                        otherPlayer.poweredUp = false; // Lose power-up on respawn
                        // Reset dash state on respawn.
                        otherPlayer.dashActiveTicks = 0;
                        otherPlayer.dashing = false;
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

            // Tunnel wrapping: on tunnel rows, walking off one horizontal
            // edge teleports the ghost to the other side (classic Pac-Man tunnel).
            ghost.x = wrapTunnelX(ghost.x, ghost.y, currentMaze);
        }

        // Player collision
        players.forEach((player, playerIndex) => {
            if (player.disconnected) return; // Skip players in grace period
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
                            if (isSinglePlayerMatch) {
                                // Single-player: there is nothing to spectate, so
                                // just clear the player ID. The match ends via
                                // getLevelTransition (players.length === 0).
                                clientWs.playerId = null;
                            } else {
                                // Multiplayer: move to spectator mode so they
                                // can watch the rest of the match.
                                spectators.push(clientWs);
                                clientWs.send(JSON.stringify({ type: 'spectatorMode', message: 'You ran out of lives! You are now spectating.' }));
                                clientWs.playerId = null;
                            }
                        }
                        players.splice(playerIndex, 1);
                    } else {
                        // Respawn player in a random free corner (not on top of
                        // another player). Excludes player from the occupied set
                        // since they are still in the players array.
                        const occupied = players
                            .filter(p => p.id !== player.id)
                            .map(p => ({ x: p.x, y: p.y }));
                        const pos = pickRespawnPosition(occupied, currentMaze);
                        player.x = pos.x;
                        player.y = pos.y;
                        // Reset dash state on respawn.
                        player.dashActiveTicks = 0;
                        player.dashing = false;
                    }
                }
            }
        });
    });

    // Win/Loss Conditions
    //   - Last Man Standing (1 player left, multiplayer) -> GAME_OVER (match ends)
    //   - All pellets eaten (2+ players alive, or single-player) -> LEVEL_COMPLETE -> next level
    //   - Single-player: the match ends only when the player loses all lives
    //     (players.length === 0 after the spectator-mode splice). One player
    //     remaining is NOT a win in single-player mode.
    if (currentGameState === GAME_STATES.IN_PROGRESS) {
        const transition = getLevelTransition(players, pellets, powerPellets, isSinglePlayerMatch);
        if (transition === GAME_STATES.GAME_OVER) {
            endMatch(players[0] || null);
        } else if (transition === GAME_STATES.LEVEL_COMPLETE) {
            startNextLevel();
        }
    }

    // Broadcast state to all clients
    broadcastGameState();
}

/**
 * Broadcast the current game state to every connected client.
 * Extracted so grace-period expiry and match-end can reuse it.
 */
function broadcastGameState() {
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
    console.log(`[SERVER] Game Over: ${winner ? winner.name : 'No winner'} is the ${isSinglePlayerMatch ? 'single-player game' : 'Last Man Standing'}!`);
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
    cancelPendingLobbyReset();
    pendingLobbyResetTimer = setTimeout(() => {
        pendingLobbyResetTimer = null;
        // Capture the match players BEFORE initializeGameState() clears them,
        // so the warm-rejoin lobby can be rebuilt from the finished match.
        const matchPlayers = [...players];
        const winnerId = winner ? winner.id : null;
        currentLevel = 1;
        currentMaze = MAZE;
        initializeGameState();
        currentGameState = GAME_STATES.LOBBY;
        // Clear stale spectator references so they don't persist across matches.
        spectators.length = 0;
        if (isSinglePlayerMatch && singlePlayerInfo) {
            // Single-player: the player was spliced from players[] on death, so
            // matchPlayers is empty. Rebuild the lobby with the single player
            // using the identity captured at game start so they return to the
            // lobby and can play again.
            lobbyPlayers = [{
                id: singlePlayerInfo.id,
                name: singlePlayerInfo.name,
                token: singlePlayerInfo.id,
                ready: false,
            }];
        } else {
            // Warm rejoin (feature A): rebuild the lobby from the just-finished
            // match so the group stays together for a rematch. The winner is placed
            // first (becomes the new host). Player ids ARE their stable tokens, so
            // reconnecting clients will recognize their slot. Everyone starts
            // not-ready so the group must ready up again.
            lobbyPlayers = rebuildLobbyFromMatch(matchPlayers, winnerId);
        }
        // Reset single-player state for the next match.
        isSinglePlayerMatch = false;
        singlePlayerInfo = null;
        // Re-link any still-connected client to their rebuilt lobby slot by token.
        wss.clients.forEach(client => {
            if (client.playerId) client.playerId = null;
            if (client.playerToken) {
                const match = lobbyPlayers.find(lp => lp.id === client.playerToken);
                if (match) client.lobbyPlayerId = match.id;
            }
        });
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
            // --- Reconnection to an in-progress match (grace period) ---
            // If a match is running and this token matches a disconnected player
            // still within the grace window, restore that slot instead of joining the lobby.
            if (currentGameState === GAME_STATES.IN_PROGRESS && data.token) {
                const player = players.find(p => p.id === data.token && p.disconnected);
                if (player && isWithinGracePeriod(player.disconnectedAt, Date.now())) {
                    player.disconnected = false;
                    player.disconnectedAt = null;
                    const timer = graceTimers.get(player.id);
                    if (timer) { clearTimeout(timer); graceTimers.delete(player.id); }
                    ws.playerId = player.id;
                    ws.playerToken = player.id;
                    console.log(`[SERVER] ${player.name} reconnected to the match.`);
                    // Send the reconnecting client its identity + a fresh state snapshot.
                    ws.send(JSON.stringify({ type: 'playerAssigned', playerId: player.id }));
                    ws.send(JSON.stringify({
                        type: 'gameState',
                        gameState: buildGameStatePayload(currentMaze, players, ghosts, pellets, powerPellets, currentGameState, currentLevel),
                    }));
                    broadcastGameState();
                    return;
                }
            }

            if (currentGameState !== GAME_STATES.LOBBY) {
                ws.send(JSON.stringify({ type: 'error', message: 'Game in progress, cannot join lobby.' }));
                return;
            }

            // --- Reconnection to the lobby (same token, new connection) ---
            // A returning client presents its stable token; if a lobby player with
            // that token exists, resume that slot (preserving ready state) rather
            // than creating a duplicate. Also fall back to ws.lobbyPlayerId so a
            // client that re-joins without an explicit token (e.g. after a game
            // over rebuilt the lobby around its existing slot) still reclaims it.
            const matchToken = data.token || ws.lobbyPlayerId;
            if (matchToken) {
                const existing = lobbyPlayers.find(lp => lp.id === matchToken);
                if (existing) {
                    existing.name = data.name || existing.name;
                    ws.lobbyPlayerId = existing.id;
                    ws.playerToken = existing.id;
                    ws.playerName = existing.name;
                    console.log(`[SERVER] ${existing.name} rejoined the lobby.`);
                    broadcastLobbyState();
                    return;
                }
            }

            // --- Brand-new lobby join: mint a stable token that persists across reconnects ---
            const token = crypto.randomUUID();
            const newLobbyPlayer = { id: token, name: data.name || `Player ${token.slice(-4)}`, token, ready: false };
            lobbyPlayers.push(newLobbyPlayer);
            ws.lobbyPlayerId = token;
            ws.playerToken = token;
            ws.playerName = newLobbyPlayer.name;
            console.log(`[SERVER] ${newLobbyPlayer.name} joined the lobby.`);
            // Echo the token so the client can store it for future reconnects.
            ws.send(JSON.stringify({ type: 'lobbyJoined', token }));
            broadcastLobbyState();
        } else if (data.type === 'toggleReady') {
            // Toggle this player's ready flag. Identified by stable token so a
            // reconnecting client can still toggle after a dropped connection.
            if (currentGameState !== GAME_STATES.LOBBY || !ws.playerToken) return;
            lobbyPlayers = togglePlayerReady(lobbyPlayers, ws.playerToken);
            // If a player un-readies during a countdown, cancel it.
            if (!areAllReady(lobbyPlayers)) cancelCountdown();
            broadcastLobbyState();
        } else if (data.type === 'input' && currentGameState === GAME_STATES.IN_PROGRESS) {
            const player = players.find(p => p.id === ws.playerId);
            if (player) {
                // Only update direction when one is provided. A dash-only input
                // (direction === undefined/null) must not clear the current direction.
                if (data.direction) {
                    // Snap the perpendicular axis to the nearest corridor center on
                    // every turn. Without this, turning at a non-half-tile offset
                    // (e.g. x=1.8) leaves the player drifting off the pellet line,
                    // and the offset compounds over multiple turns into visible drift.
                    if (data.direction !== player.direction) {
                        const snapped = snapPerpendicular(player.x, player.y, data.direction);
                        player.x = snapped.x;
                        player.y = snapped.y;
                    }
                    player.direction = data.direction;
                }
                // Store dash trigger flag for the game loop to consume.
                player._dashTriggered = !!data.dash;
            }
        } else if (data.type === 'startGame' && currentGameState === GAME_STATES.LOBBY) {
            // Only the host (first lobby player) may start, and only once every
            // player has readied up. This is the authoritative gate — the client
            // also disables the button, but the server decides.
            const isHost = lobbyPlayers.length > 0 && lobbyPlayers[0].id === ws.lobbyPlayerId;
            if (!isHost) {
                ws.send(JSON.stringify({ type: 'error', message: 'Only the host can start the game.' }));
                return;
            }
            if (!areAllReady(lobbyPlayers)) {
                ws.send(JSON.stringify({ type: 'error', message: 'Not all players are ready.' }));
                return;
            }
            beginCountdown();
        } else if (data.type === 'startSinglePlayer' && currentGameState === GAME_STATES.LOBBY) {
            // Single-player: the requesting player starts a solo match
            // immediately — no ready-up or countdown required. They are
            // removed from the lobby and placed into a game by themselves.
            startSinglePlayer(ws);
        } else if (data.type === 'leaveGame') {
            handleLeaveGame(ws);
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

        // --- Active game player: grace period instead of instant removal ---
        // During a match, a disconnected player is marked `disconnected` and
        // given a window to reconnect. While disconnected they are skipped by
        // the game loop (don't move / don't collide) so the match continues
        // fairly. If the grace window expires, they are removed for real.
        if (currentGameState === GAME_STATES.IN_PROGRESS && ws.playerId) {
            const player = players.find(p => p.id === ws.playerId);
            if (player && !player.disconnected) {
                player.disconnected = true;
                player.disconnectedAt = Date.now();
                console.log(`[SERVER] ${player.name} disconnected — grace period started.`);
                graceTimers.set(player.id, setTimeout(() => {
                    graceTimers.delete(player.id);
                    const idx = players.findIndex(p => p.id === player.id);
                    if (idx !== -1) {
                        console.log(`[SERVER] ${player.name} grace expired — removed from match.`);
                        players.splice(idx, 1);
                    }
                    // If the match has thinned out too far, end it.
                    if (currentGameState === GAME_STATES.IN_PROGRESS && players.length < 2) {
                        endMatch(players[0] || null);
                    } else {
                        broadcastGameState();
                    }
                }, RECONNECT_GRACE_MS));
                broadcastGameState();
                return;
            }
        }

        // Remove from game players if in game (non-grace case: spectator-mode
        // players, or a disconnect outside IN_PROGRESS).
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
            // Cancel any pending post-match lobby reset — we're resetting now.
            cancelPendingLobbyReset();
            initializeGameState();
            currentGameState = GAME_STATES.LOBBY;
        }
        // If clients remain but game is not in progress, broadcast updated lobby state
        else if (currentGameState === GAME_STATES.LOBBY) {
            broadcastLobbyState();
        }
    });
});

function handleLeaveGame(ws) {
    // Remove from players[] if active, capturing the name first so we can
    // show it in the lobby after they leave.
    let leavingName = null;
    const playerIndex = players.findIndex(p => p.id === ws.playerId);
    if (playerIndex !== -1) {
        leavingName = players[playerIndex].name;
        console.log(`[SERVER] ${leavingName || ws.playerId} left the game.`);
        // Cancel any grace timer for this player (they're leaving on purpose).
        const timer = graceTimers.get(players[playerIndex].id);
        if (timer) { clearTimeout(timer); graceTimers.delete(players[playerIndex].id); }
        players.splice(playerIndex, 1);
    }

    // Remove from spectators[] if spectating.
    const specIndex = spectators.findIndex(s => s.id === ws.id);
    if (specIndex !== -1) {
        spectators.splice(specIndex, 1);
    }

    // Clear the player ID on this connection so input is ignored and the
    // client is no longer treated as an active participant.
    ws.playerId = null;

    // Re-add to lobbyPlayers so they appear in the lobby UI with their name.
    // Prefer the name from the active player entry; fall back to the name
    // stored at join time (spectators are already spliced out of players[]).
    const name = leavingName || ws.playerName || `Player ${ws.playerToken && ws.playerToken.slice(-4)}`;
    const token = ws.playerToken || crypto.randomUUID();
    ws.playerToken = token;
    if (!lobbyPlayers.find(lp => lp.id === token)) {
        lobbyPlayers.push({ id: token, name: name, ready: false });
        ws.lobbyPlayerId = token;
    }

    // Transition the leaving client back to the lobby.
    ws.send(JSON.stringify({
        type: 'returnToLobby',
        lobbyPlayers: lobbyPlayers,
        currentGameState: currentGameState
    }));

    // If the game is still in progress but now has < 2 players, end the match.
    if (currentGameState === GAME_STATES.IN_PROGRESS && players.length < 2) {
        endMatch(players[0] || null);
    }
}

function broadcastLobbyState() {
    // Compute the current countdown tick (3/2/1) if a countdown is running,
    // otherwise null. The client renders the number + switches to the board
    // when the state leaves COUNTDOWN.
    let countdown = null;
    if (currentGameState === GAME_STATES.COUNTDOWN && countdownStart > 0) {
        countdown = getCountdownTick(Date.now() - countdownStart);
    }
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'lobbyState',
                lobbyPlayers: lobbyPlayers,
                currentGameState: currentGameState,
                countdown: countdown,
            }));
        }
    });
}

const PORT = process.env.PORT || 8080;
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[SERVER] Listening on http://localhost:${PORT}`);
  });
}

module.exports = { server, app, wss };
