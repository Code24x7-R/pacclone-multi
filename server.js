// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richard Robertson

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Resolve the current git commit hash (short) for display in the client's
// About dialog. Falls back to 'unknown' if git is unavailable or the working
// tree isn't a repo (e.g. production checkout without .git).
let GIT_COMMIT = 'unknown';
try {
  GIT_COMMIT = execSync('git rev-parse --short HEAD', { cwd: __dirname, encoding: 'utf8' }).trim();
} catch (e) {
  // Not a git repo or git not installed — leave as 'unknown'.
}

// Generate a stable, unique player token (used as the player's persistent
// identity across reconnects). 128-bit uuid — collision risk is negligible.
const { buildGameStatePayload, GAME_STATES, MAZE, TILE_SIZE, getLevelTransition, extraLivesEarned, updateDashState, executePhaseDash, pickRespawnPosition, snapPerpendicular, clampSpriteToWall, wrapTunnelX, frightenGhosts, revertFrightenedGhosts, COUNTDOWN_DURATION_MS, RECONNECT_GRACE_MS, rebuildLobbyFromMatch, areAllReady, togglePlayerReady, getCountdownTick, isWithinGracePeriod, isWall, extractPellets, PELLET_SCORE, POWER_PELLET_SCORE, PLAYER_EAT_SCORE, WEAPON_TYPES, WEAPON_SPAWN_COOLDOWN_TICKS, MAX_WEAPONS_ON_BOARD, EXPLOSIVE_SCORE_PELLET, shouldSpawnWeapons, spawnWeapon, checkWeaponPickup, firePistol, detonateExplosive, updateProjectiles, assignWeaponOnRespawn, AFK_TIMEOUT_MS, AFK_CHECK_INTERVAL_MS, findAfkPlayerIndices } = require('./src/gameLogic');
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
  isGhostStuck,
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

/**
 * Check and handle pellet collision for a player. Extracted as a shared
 * helper so it can be called both after normal movement and after a
 * phase-dash teleport.
 * @param {Object} player - Player object { x, y, score, poweredUp, ... }.
 * @param {Array} pellets - Array of pellet positions (mutated).
 * @param {Array} powerPellets - Array of power-pellet positions (mutated).
 */
function checkPlayerPellets(player, pellets, powerPellets) {
    // Pellet collision
    for (let i = pellets.length - 1; i >= 0; i--) {
        const p = pellets[i];
        const dist = Math.hypot(player.x - (p.x + 0.5), player.y - (p.y + 0.5));
        if (dist < 0.4) {
            pellets.splice(i, 1);
            player.score += PELLET_SCORE;
        }
    }

    // Power pellet collision
    for (let i = powerPellets.length - 1; i >= 0; i--) {
        const pp = powerPellets[i];
        const dist = Math.hypot(player.x - (pp.x + 0.5), player.y - (pp.y + 0.5));
        if (dist < 0.5) {
            powerPellets.splice(i, 1);
            player.score += POWER_PELLET_SCORE;
            player.poweredUp = true;
            // Tick-based power-up countdown (avoids storing non-serializable
            // Timeout objects on the player and prevents timer drift).
            player.poweredUpTicks = Math.ceil(frightenedDurationMs / GAME_LOOP_INTERVAL);
            // Frighten all non-eaten ghosts that are outside the house.
            // Ghosts inside the house (inHouse/exitingHouse) are NOT frightened
            // — only ghosts outside the house turn blue. Eaten ghosts (eyes
            // returning to the house) are skipped — classic behavior.
            // Ghosts that exit the house while power-up is active will become
            // frightened via the house state transition logic.
            ghostFrightenedTimer = frightenedDurationMs;
            frightenGhosts(ghosts, GHOST_FRIGHTENED_SPEED, OPPOSITE);
        }
    }
}

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

/**
 * Get starting positions for the current maze, with x coordinates computed
 * from the maze width. The right-edge positions use maze width - 1.5.
 * @returns {{x: number, y: number}[]}
 */
function getStartingPositions() {
    const w = currentMaze[0].length;
    return [
        { x: 1.5, y: 1.5 },
        { x: w - 1.5, y: 1.5 },
        { x: 1.5, y: 4.5 },
        { x: w - 1.5, y: 4.5 },
    ];
}

let ghostBaseSpeed = 0.08; // base tiles per tick (personalities apply multiplier); scales with level
let frightenedDurationMs = frightenedDurationForLevel(1); // scales with level

// Ghost AI state
let modeCycle = null; // { mode, timer, index }
let ghostFrightenedTimer = 0; // ms remaining
let ghostHouseConfig = null; // { centerX, centerY, exitX, exitY, gateX, gateY }
let totalPelletsInLevel = 0;

// Weapon state — spawns when power pellets are exhausted.
let weapons = []; // { x, y, type: 'pistol'|'explosive' }
let projectiles = []; // { x, y, direction, speed, range, distanceTraveled, ownerId }
let weaponSpawnCooldown = 0; // ticks until next weapon can spawn

// GAME_STATES is imported from src/gameLogic.js (single source of truth)
let currentGameState = GAME_STATES.LOBBY;
let lobbyPlayers = []; // Array to hold players in the lobby
const spectators = []; // Array to hold WebSocket connections of players in spectator mode

// Lobby chat history — persists while users are joined (in-memory, per server
// process). Capped to a rolling window so it can't grow without bound.
const MAX_CHAT_HISTORY = 100;
const chatHistory = []; // { name, id, text, ts }

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

// --- AFK activity tracking ---
// Every meaningful client message (input, chat, ready toggle) should call
// touchActivity so the player's lastActivity timestamp is refreshed. The
// periodic checkAfkPlayers sweep (below) removes anyone who has gone quiet.
function touchActivity(ws) {
    const now = Date.now();
    // Refresh the lobby player slot.
    if (ws.lobbyPlayerId) {
        const lp = lobbyPlayers.find(p => p.id === ws.lobbyPlayerId);
        if (lp) lp.lastActivity = now;
    }
    // Refresh the in-game player slot.
    if (ws.playerId) {
        const p = players.find(pl => pl.id === ws.playerId);
        if (p) p.lastActivity = now;
    }
}

// Countdown state: when set, holds the timestamps (ms) of the remaining
// countdown ticks so they can be cancelled if a player un-readies / leaves.
let countdownTimers = [];
let countdownStart = 0;

function initializeGameState() {
    players = [];

    // Reset difficulty scaling to level-1 defaults.
    ghostBaseSpeed = ghostSpeedForLevel(1);
    frightenedDurationMs = frightenedDurationForLevel(1);

    // Extract pellets and power pellets from the current maze
    const extracted = extractPellets(currentMaze);
    pellets = extracted.pellets;
    powerPellets = extracted.powerPellets;
    totalPelletsInLevel = pellets.length + powerPellets.length;

    // Initialize ghost house config and create 4 AI-driven ghosts
    ghostHouseConfig = getDefaultHouseConfig(currentMaze);
    ghosts = createInitialGhosts(ghostHouseConfig);

    // Initialize scatter/chase mode cycle
    modeCycle = createModeCycle();
    ghostFrightenedTimer = 0;

    // Reset weapons and projectiles
    weapons = [];
    projectiles = [];
    weaponSpawnCooldown = 0;
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
    const startingPositions = getStartingPositions();

    players = lobbyPlayers.map((lp, index) => ({
        id: lp.id, // === the stable token, so reconnecting clients can reclaim this slot
        name: lp.name,
        x: startingPositions[index % startingPositions.length].x,
        y: startingPositions[index % startingPositions.length].y,
        color: ['yellow', 'lime', 'cyan', 'magenta'][index % 4], // Assign different colors
        lives: 3,
        score: 0,
        direction: null,
        lastDirection: null, // last non-null direction (for dash when stopped)
        poweredUp: false,
        poweredUpTicks: 0,
        // Extra-lives tracking: how many extra lives have been awarded so far.
        extraLivesAwarded: 0,
        // Phase-dash state: teleport forward DASH_TILES, once per life.
        dashAvailable: true, // resets on respawn
        dashing: false, // true during the brief visual effect
        dashActiveTicks: 0, // visual-effect countdown
        // Weapon state: null = unarmed, 'pistol' | 'explosive' = armed
        weapon: null, // picked up from weapon drops
        weaponRounds: 0, // remaining rounds (pistol only)
        // AFK tracking: last time this player sent an input message.
        lastActivity: Date.now(),
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
        lastDirection: null,
        poweredUp: false,
        poweredUpTicks: 0,
        extraLivesAwarded: 0,
        dashAvailable: true,
        dashing: false,
        dashActiveTicks: 0,
        weapon: null,
        weaponRounds: 0,
        // AFK tracking: last time this player sent an input message.
        lastActivity: Date.now(),
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

// Game Loop
const GAME_LOOP_INTERVAL = 1000 / 60; // 60 FPS
let gameInterval = null;

// AFK check interval — always running so idle players are swept even when
// no match is in progress. Keeps the server autonomous. Unref'd so it does
// not keep the Node process alive after tests tear down the server.
const afkCheckInterval = setInterval(checkAfkPlayers, AFK_CHECK_INTERVAL_MS);
afkCheckInterval.unref();

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

        // --- Phase dash: tick down visual effect, execute teleport on trigger ---
        const dashResult = updateDashState(player);
        player.dashing = dashResult.dashing;
        player.dashActiveTicks = dashResult.dashActiveTicks;

        // Execute phase dash if triggered (teleport forward DASH_TILES).
        if (player._dashTriggered && !player.dashing) {
            const dash = executePhaseDash(player, currentMaze, currentMaze[0].length, currentMaze.length);
            if (dash.moved) {
                player.x = dash.x;
                player.y = dash.y;
                player.dashAvailable = dash.dashAvailable;
                player.dashing = dash.dashing;
                player.dashActiveTicks = dash.dashActiveTicks;
                // Stop movement to prevent running into a wall after teleport.
                player.direction = null;
                // Check for pellets at the new position (reference behavior: eat on arrival).
                checkPlayerPellets(player, pellets, powerPellets);
            }
        }
        player._dashTriggered = false; // consume the flag

        // --- Extra lives: award at score thresholds ---
        const earned = extraLivesEarned(player.score);
        if (earned > player.extraLivesAwarded) {
            const newLives = earned - player.extraLivesAwarded;
            player.lives += newLives;
            player.extraLivesAwarded = earned;
            console.log(`[SERVER] ${player.name || player.id} earned extra life! (${player.lives} total)`);
        }

        // Skip normal movement while dashing (visual effect period).
        if (!player.dashing) {
            let nextX = player.x;
            let nextY = player.y;

            const moveSpeed = PLAYER_SPEED;
            if (player.direction) {
                switch (player.direction) {
                    case 'up': nextY -= moveSpeed; break;
                    case 'down': nextY += moveSpeed; break;
                    case 'left': nextX -= moveSpeed; break;
                    case 'right': nextX += moveSpeed; break;
                }
                // Track last non-null direction for dash when stopped.
                player.lastDirection = player.direction;
            }

            // Tunnel wrapping: on tunnel rows, walking off one horizontal edge
            // teleports to the other side. Apply the wrap to the *candidate*
            // position BEFORE the wall check so the out-of-bounds guard in isWall()
            // does not block the tunnel entrance.
            nextX = wrapTunnelX(nextX, player.y, currentMaze);

            if (!isWall(nextX, player.y, currentMaze)) player.x = nextX;
            if (!isWall(player.x, nextY, currentMaze)) player.y = nextY;

            // Clamp the player sprite so it never overlaps a wall. The wall
            // check above only gates the sprite *center*, but the player radius
            // (TILE_SIZE/2 - 2 ≈ 0.45 tiles) means the body can stick into the
            // wall at the end of a corridor — half the sprite visually inside
            // the wall tile. Pushing the center back keeps the sprite flush.
            // Player radius in tile units: (TILE_SIZE / 2 - 2) / TILE_SIZE.
            var clamped = clampSpriteToWall(player.x, player.y, (TILE_SIZE / 2 - 2) / TILE_SIZE, currentMaze);
            player.x = clamped.x;
            player.y = clamped.y;

            // Pellet collision (only when not dashing — reference behavior).
            if (!player.dashing) {
                checkPlayerPellets(player, pellets, powerPellets);
            }

            // Weapon pickup (only when not dashing)
            if (!player.dashing) {
                checkWeaponPickup(player, players, weapons);
            }
        }

        // Player collision with other players
        players.forEach(otherPlayer => {
            if (player.id === otherPlayer.id) return; // Don't check collision with self
            if (otherPlayer.disconnected) return; // Skip players in grace period
            if (player.dashing || otherPlayer.dashing) return; // Invulnerable during phase-dash

            const dist = Math.hypot(player.x - otherPlayer.x, player.y - otherPlayer.y);
            if (dist < 0.5) { // Collision detected
                if (player.poweredUp && !otherPlayer.poweredUp) {
                    // Current player (player) is powered up and eats otherPlayer
                    otherPlayer.lives--;
                    player.score += PLAYER_EAT_SCORE;

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
                        // Reset phase-dash availability on respawn (once per life).
                        otherPlayer.dashAvailable = true;
                        otherPlayer.dashing = false;
                        otherPlayer.dashActiveTicks = 0;
                        // Weapon lifetime rules: pistol persists (infinite rounds);
                        // explosive is single-use per life (like dash) — fresh on respawn.
                        assignWeaponOnRespawn(otherPlayer);
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

    // --- Weapon spawning & projectile updates ---
    // Spawn weapons when power pellets are exhausted.
    if (weaponSpawnCooldown > 0) {
        weaponSpawnCooldown--;
    }
    if (shouldSpawnWeapons(pellets, powerPellets, weapons) && weaponSpawnCooldown <= 0 && weapons.length < MAX_WEAPONS_ON_BOARD) {
        // In single-player, avoid spawning on the player; in multiplayer, allow anywhere
        const sp = players.length === 1 ? players[0] : undefined;
        const weapon = spawnWeapon(currentMaze, weapons, sp);
        if (weapon) {
            weapon.id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            weapons.push(weapon);
            weaponSpawnCooldown = WEAPON_SPAWN_COOLDOWN_TICKS;
            console.log(`[SERVER] Weapon spawned: ${weapon.type} at (${weapon.x},${weapon.y})`);
        }
    }

    // Update projectiles (movement + collision)
    const projectileHits = updateProjectiles(projectiles, currentMaze, players, ghosts);

    // Resolve pistol hits on players
    for (const hitPlayer of projectileHits.hitPlayers) {
        hitPlayer.lives--;
        console.log(`[SERVER] Player ${hitPlayer.name || hitPlayer.id} shot! Lives: ${hitPlayer.lives}`);
        if (hitPlayer.lives <= 0) {
            const clientWs = Array.from(wss.clients).find(client => client.playerId === hitPlayer.id);
            if (clientWs) {
                spectators.push(clientWs);
                clientWs.send(JSON.stringify({ type: 'spectatorMode', message: 'You were shot! You are now spectating.' }));
                clientWs.playerId = null;
            }
            const eatenPlayerIndex = players.findIndex(p => p.id === hitPlayer.id);
            if (eatenPlayerIndex !== -1) {
                players.splice(eatenPlayerIndex, 1);
            }
        } else {
            // Respawn
            const occupied = players.filter(p => p.id !== hitPlayer.id).map(p => ({ x: p.x, y: p.y }));
            const pos = pickRespawnPosition(occupied, currentMaze);
            hitPlayer.x = pos.x;
            hitPlayer.y = pos.y;
            hitPlayer.poweredUp = false;
            hitPlayer.dashAvailable = true;
            hitPlayer.dashing = false;
            hitPlayer.dashActiveTicks = 0;
            // Weapon lifetime rules: pistol persists (infinite rounds);
            // explosive is single-use per life (like dash) — fresh on respawn.
            assignWeaponOnRespawn(hitPlayer);
        }
    }

    // Resolve pistol hits on ghosts
    for (const hitGhost of projectileHits.hitGhosts) {
        if (hitGhost.eaten) continue;
        hitGhost.eaten = true;
        hitGhost.frightened = false;
        hitGhost.speed = GHOST_EATEN_SPEED;
        hitGhost.state = 'eaten';
        console.log(`[SERVER] Ghost ${hitGhost.name} shot!`);
    }

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
            // Revert ALL frightened ghosts. Patrolling ghosts return to the
            // mode cycle; house ghosts (inHouse/exitingHouse) keep their state
            // so the house logic can finish.
            revertFrightenedGhosts(
                ghosts,
                GHOST_NORMAL_SPEED,
                modeCycle ? modeCycle.mode : 'scatter',
            );
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
            frightenedTimer: ghostFrightenedTimer,
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
            // Capture position before movement so we can detect a frozen ghost
            // (one that fails to change position tick after tick).
            const prevX = ghost.x;
            const prevY = ghost.y;

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
                // Hit a wall — snap to tile center so the ghost can pick a new
                // direction on the next tick. Snapping to the tile edge would
                // leave the ghost stuck at a non-center position where isAtTileCenter
                // returns false forever, freezing the ghost in place.
                const snapped = snapToTileCenter(ghost);
                ghost.x = snapped.x;
                ghost.y = snapped.y;
                // Remember the blocked direction so chooseDirection can avoid
                // picking it again (prevents wall-snap oscillation).
                ghost.lastBlockedDirection = ghost.direction;
            } else {
                ghost.x = nextX;
                ghost.y = nextY;
            }

            // Tunnel wrapping: on tunnel rows, walking off one horizontal
            // edge teleports the ghost to the other side (classic Pac-Man tunnel).
            ghost.x = wrapTunnelX(ghost.x, ghost.y, currentMaze);

            // Track how long the ghost has gone without changing position.
            // A ghost that cannot move (e.g. a frightened ghost frozen despite
            // having valid exits) will accumulate stuckTicks until the timeout
            // fires and isGhostStuck returns true, sending it back to the house.
            if (Math.abs(ghost.x - prevX) < 0.001 && Math.abs(ghost.y - prevY) < 0.001) {
                ghost.stuckTicks = (ghost.stuckTicks || 0) + 1;
            } else {
                ghost.stuckTicks = 0;
            }

            // Stuck-ghost rescue: if the ghost is trapped (all surrounding
            // tiles are walls) OR has not moved for STUCK_TICK_THRESHOLD ticks,
            // send it back to the house to respawn. The movement-timeout check
            // catches edge cases like frightened ghosts that stop moving
            // despite having valid exits. The ghost transitions to eaten state
            // and returns to the house center, then respawns after the
            // re-release timer.
            if (ghost.state !== 'inHouse' && ghost.state !== 'exitingHouse') {
                const stuck = isGhostStuck(ghost, currentMaze, currentMaze[0].length, currentMaze.length);
                if (stuck) {
                    console.log(`[SERVER] Ghost ${ghost.name} is stuck at (${ghost.x.toFixed(2)}, ${ghost.y.toFixed(2)}). Sending to house.`);
                    ghost.eaten = true;
                    ghost.frightened = false;
                    ghost.speed = GHOST_EATEN_SPEED;
                    ghost.state = 'eaten';
                    ghost.stuckTicks = 0; // reset so it doesn't immediately re-trigger
                }
            }
        }

        // Player collision
        players.forEach((player, playerIndex) => {
            if (player.disconnected) return; // Skip players in grace period
            if (player.dashing) return; // Invulnerable during phase-dash effect
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
                        // Reset phase-dash availability on respawn (once per life).
                        player.dashAvailable = true;
                        player.dashing = false;
                        player.dashActiveTicks = 0;
                        // Weapon lifetime rules: pistol persists (infinite rounds);
                        // explosive is single-use per life (like dash) — fresh on respawn.
                        assignWeaponOnRespawn(player);
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
    const gameState = buildGameStatePayload(currentMaze, players, ghosts, pellets, powerPellets, currentGameState, currentLevel, weapons, projectiles);
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

    const finalGameState = buildGameStatePayload(currentMaze, players, ghosts, pellets, powerPellets, GAME_STATES.GAME_OVER, currentLevel, weapons, projectiles);
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
            // Stamp fresh activity on the rebuilt lobby players so they aren't
            // swept as AFK immediately on the next check.
            const rebuiltAt = Date.now();
            for (const lp of lobbyPlayers) lp.lastActivity = rebuiltAt;
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
    const startingPositions = getStartingPositions();
    players.forEach((player, index) => {
        player.x = startingPositions[index % startingPositions.length].x;
        player.y = startingPositions[index % startingPositions.length].y;
        player.direction = null;
        player.poweredUp = false;
        player.poweredUpTicks = 0;
    });

    // Brief pause so the client can show "Level Complete", then resume.
    currentGameState = GAME_STATES.LEVEL_COMPLETE;
    const levelCompleteState = buildGameStatePayload(currentMaze, players, ghosts, pellets, powerPellets, GAME_STATES.LEVEL_COMPLETE, currentLevel, weapons, projectiles);
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
    ws.send(JSON.stringify({ type: 'welcome', message: 'Welcome to Pacclone Multi! Please join the lobby.', clientId: ws.id, commit: GIT_COMMIT }));

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
                        gameState: buildGameStatePayload(currentMaze, players, ghosts, pellets, powerPellets, currentGameState, currentLevel, weapons, projectiles),
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
                    existing.lastActivity = Date.now(); // activity: reconnect
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
            const newLobbyPlayer = { id: token, name: data.name || `Player ${token.slice(-4)}`, token, ready: false, lastActivity: Date.now() };
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
            touchActivity(ws); // activity: ready toggle
            lobbyPlayers = togglePlayerReady(lobbyPlayers, ws.playerToken);
            // If a player un-readies during a countdown, cancel it.
            if (!areAllReady(lobbyPlayers)) cancelCountdown();
            broadcastLobbyState();
        } else if (data.type === 'input' && currentGameState === GAME_STATES.IN_PROGRESS) {
            const player = players.find(p => p.id === ws.playerId);
            if (player) {
                touchActivity(ws); // activity: movement / dash / fire
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

                // Handle weapon firing.
                if (data.fire && player.weapon) {
                    if (player.weapon === WEAPON_TYPES.PISTOL) {
                        firePistol(player, projectiles);
                    } else if (player.weapon === WEAPON_TYPES.EXPLOSIVE) {
                        const blast = detonateExplosive(player, players, ghosts, pellets, powerPellets);
                        if (blast) {
                            // Apply explosive damage to players
                            for (const hitPlayer of blast.affectedPlayers) {
                                if (hitPlayer.id === player.id) continue; // Don't self-damage
                                hitPlayer.lives--;
                                console.log(`[SERVER] Player ${hitPlayer.name || hitPlayer.id} caught in explosion! Lives: ${hitPlayer.lives}`);
                                if (hitPlayer.lives <= 0) {
                                    const clientWs = Array.from(wss.clients).find(client => client.playerId === hitPlayer.id);
                                    if (clientWs) {
                                        spectators.push(clientWs);
                                        clientWs.send(JSON.stringify({ type: 'spectatorMode', message: 'You were blown up! You are now spectating.' }));
                                        clientWs.playerId = null;
                                    }
                                    const idx = players.findIndex(p => p.id === hitPlayer.id);
                                    if (idx !== -1) players.splice(idx, 1);
                                } else {
                                    const occupied = players.filter(p => p.id !== hitPlayer.id).map(p => ({ x: p.x, y: p.y }));
                                    const pos = pickRespawnPosition(occupied, currentMaze);
                                    hitPlayer.x = pos.x;
                                    hitPlayer.y = pos.y;
                                    hitPlayer.poweredUp = false;
                                    hitPlayer.dashAvailable = true;
                                    // Weapon lifetime rules: pistol persists (infinite rounds);
                                    // explosive is single-use per life (like dash) — fresh on respawn.
                                    assignWeaponOnRespawn(hitPlayer);
                                }
                            }
                            // Apply explosive damage to ghosts
                            for (const hitGhost of blast.affectedGhosts) {
                                if (hitGhost.eaten) continue;
                                hitGhost.eaten = true;
                                hitGhost.frightened = false;
                                hitGhost.speed = GHOST_EATEN_SPEED;
                                hitGhost.state = 'eaten';
                                console.log(`[SERVER] Ghost ${hitGhost.name} blown up!`);
                            }
                            // Award score for cleared pellets
                            player.score += blast.affectedPellets.length * EXPLOSIVE_SCORE_PELLET;
                        }
                    }
                }
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
        } else if (data.type === 'spectateGame') {
            handleSpectateGame(ws);
        } else if (data.type === 'chat') {
            touchActivity(ws); // activity: chat message
            handleChat(ws, data);
        } else if (data.type === 'getChatHistory') {
            ws.send(JSON.stringify({ type: 'chatHistory', messages: chatHistory }));
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

// --- AFK sweep: runs on AFK_CHECK_INTERVAL_MS and removes idle players. ---
// This keeps the server autonomous: an AFK host won't block the lobby forever,
// and an AFK player in a match won't prevent the game from ending.
function checkAfkPlayers() {
    const now = Date.now();

    // Lobby AFK sweep (also covers COUNTDOWN — lobbyPlayers still populated).
    if (currentGameState === GAME_STATES.LOBBY || currentGameState === GAME_STATES.COUNTDOWN) {
        const afkIndices = findAfkPlayerIndices(lobbyPlayers, now, AFK_TIMEOUT_MS);
        if (afkIndices.length > 0) {
            // Collect names BEFORE splicing so we can tell remaining players who left.
            const removedNames = [];
            // Splice in reverse so earlier indices stay valid.
            for (let i = afkIndices.length - 1; i >= 0; i--) {
                const idx = afkIndices[i];
                const removed = lobbyPlayers[idx];
                removedNames.unshift(removed.name);
                console.log(`[SERVER] Removing AFK lobby player: ${removed.name} (idle ${Math.round((now - removed.lastActivity) / 1000)}s)`);
                // Notify the kicked client so its UI can reset.
                notifyAfkKick(removed.id);
                lobbyPlayers.splice(idx, 1);
            }
            // Broadcast an IRC-style notice to everyone still connected so all
            // players see who was removed and why (e.g. "Bob was kicked for inactivity").
            if (removedNames.length > 0) {
                broadcastKickNotice(removedNames);
            }
            // Removing a player can change host / ready state — cancel countdown
            // if not everyone is still ready, then broadcast the new lobby.
            if (!areAllReady(lobbyPlayers)) cancelCountdown();
            broadcastLobbyState();
        }
    }

    // In-game AFK sweep.
    if (currentGameState === GAME_STATES.IN_PROGRESS) {
        const afkIndices = findAfkPlayerIndices(players, now, AFK_TIMEOUT_MS);
        if (afkIndices.length > 0) {
            for (let i = afkIndices.length - 1; i >= 0; i--) {
                const idx = afkIndices[i];
                const removed = players[idx];
                console.log(`[SERVER] Removing AFK player from match: ${removed.name || removed.id} (idle ${Math.round((now - removed.lastActivity) / 1000)}s)`);
                notifyAfkKick(removed.id);
                players.splice(idx, 1);
            }
            // If the match has thinned out too far, end it.
            if (players.length < 2) {
                endMatch(players[0] || null);
            } else {
                broadcastGameState();
            }
        }
    }
}

// Notify a kicked player's connection (if still open) so the client UI resets.
// The client hears `kicked` and returns to the lobby-join screen.
function notifyAfkKick(playerId) {
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN && (client.lobbyPlayerId === playerId || client.playerId === playerId)) {
            client.send(JSON.stringify({ type: 'kicked', message: 'You were removed for inactivity.' }));
            // Clear associations so the client rejoins fresh.
            client.lobbyPlayerId = null;
            client.playerId = null;
        }
    }
}

// Broadcast an IRC-style kick notice to every open connection so all players
// see who was removed and why. Names are joined naturally: a single name is
// used directly; multiple names are combined with "and".
function broadcastKickNotice(names) {
    let who;
    if (names.length === 1) {
        who = names[0];
    } else if (names.length === 2) {
        who = `${names[0]} and ${names[1]}`;
    } else {
        who = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    }
    const payload = JSON.stringify({
        type: 'kickNotice',
        text: `${who} was kicked for inactivity.`,
    });
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
}

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
        lobbyPlayers.push({ id: token, name: name, ready: false, lastActivity: Date.now() });
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
    // When a game is in progress, expose its type + participants to the lobby
    // so waiting players can decide to spectate or wait it out.
    let inProgressMatch = null;
    if (currentGameState === GAME_STATES.IN_PROGRESS || currentGameState === GAME_STATES.GAME_OVER) {
        inProgressMatch = {
            isSinglePlayer: isSinglePlayerMatch,
            playerCount: players.length,
            players: players.map(p => ({ id: p.id, name: p.name })),
        };
    }
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'lobbyState',
                lobbyPlayers: lobbyPlayers,
                currentGameState: currentGameState,
                countdown: countdown,
                inProgressMatch: inProgressMatch,
            }));
        }
    });
}

// Handle an incoming chat message from a lobby player. Validates membership,
// appends to the rolling history, and broadcasts to every connected client.
function handleChat(ws, data) {
    // Only players who have joined the lobby may chat. Identified by the stable
    // token so the name displayed is the authoritative lobby name.
    if (!ws.lobbyPlayerId) return;
    const sender = lobbyPlayers.find(lp => lp.id === ws.lobbyPlayerId);
    if (!sender) return;
    const text = String(data.text || '').trim().slice(0, 200);
    if (!text) return;
    const msg = { name: sender.name, id: sender.id, text, ts: Date.now() };
    chatHistory.push(msg);
    if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.shift();
    const payload = JSON.stringify({ type: 'chatMessage', message: msg });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
}

// A lobby client opts to spectate the in-progress match. Removes them from
// the waiting lobby list and adds them to spectators so they receive game
// state broadcasts. They return to the lobby via leaveGame.
function handleSpectateGame(ws) {
    if (currentGameState !== GAME_STATES.IN_PROGRESS && currentGameState !== GAME_STATES.GAME_OVER) {
        ws.send(JSON.stringify({ type: 'error', message: 'No game in progress to spectate.' }));
        return;
    }
    // Remove from the waiting lobby (if present) — they're now spectating.
    if (ws.lobbyPlayerId) {
        const idx = lobbyPlayers.findIndex(lp => lp.id === ws.lobbyPlayerId);
        if (idx !== -1) lobbyPlayers.splice(idx, 1);
        ws.lobbyPlayerId = null;
    }
    // Add to spectators (avoid duplicates).
    if (!spectators.includes(ws)) {
        spectators.push(ws);
    }
    // Acknowledge and hand an immediate state snapshot so the client doesn't
    // wait for the next 1/60s broadcast.
    ws.send(JSON.stringify({ type: 'spectatorMode', voluntary: true, message: 'You are now spectating.' }));
    ws.send(JSON.stringify({
        type: 'gameState',
        gameState: buildGameStatePayload(currentMaze, players, ghosts, pellets, powerPellets, currentGameState, currentLevel, weapons, projectiles),
    }));
    broadcastLobbyState();
}

const PORT = process.env.PORT || 8080;
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[SERVER] Listening on http://localhost:${PORT}`);
  });
}

module.exports = { server, app, wss };
