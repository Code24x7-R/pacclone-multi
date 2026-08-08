
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { buildGameStatePayload, GAME_STATES } = require('./src/gameLogic');

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
let players = [];
let ghosts = [];
let pellets = [];
let powerPellets = [];
const PLAYER_SPEED = 0.05;
const GHOST_SPEED = 0.04;
const directions = ['up', 'down', 'left', 'right'];

// GAME_STATES is imported from src/gameLogic.js (single source of truth)
let currentGameState = GAME_STATES.LOBBY;
let lobbyPlayers = []; // Array to hold players in the lobby
const spectators = []; // Array to hold WebSocket connections of players in spectator mode

function initializeGameState() {
    players = [];
    ghosts = [{ id: 1, x: 9.5, y: 5.5, color: 'red', direction: 'left' }];
    pellets = [];
    powerPellets = [];
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
initializeGameState();

function startGame() {
    if (currentGameState !== GAME_STATES.LOBBY) {
        return; // Game can only start from LOBBY state
    }

    currentGameState = GAME_STATES.IN_PROGRESS;
    initializeGameState(); // Resets pellets, power pellets, and ghosts

    // Assign players from lobby to game, and give them starting positions
    const startingPositions = [
        { x: 1.5, y: 1.5 },
        { x: maze[0].length - 1.5, y: 1.5 },
        { x: 1.5, y: maze.length - 1.5 },
        { x: maze[0].length - 1.5, y: maze.length - 1.5 },
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

function isWall(x, y) {
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    if (tileY < 0 || tileY >= maze.length || tileX < 0 || tileX >= maze[0].length) {
        return true;
    }
    return maze[tileY][tileX] === 1;
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
                setTimeout(() => {
                    player.poweredUp = false;
                }, 10000);
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
                        const clientWs = wss.clients.find(client => client.playerId === otherPlayer.id);
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

    // Ghost movement and player collision
    ghosts.forEach(ghost => {
        let nextX = ghost.x;
        let nextY = ghost.y;

        switch (ghost.direction) {
            case 'up': nextY -= GHOST_SPEED; break;
            case 'down': nextY += GHOST_SPEED; break;
            case 'left': nextX -= GHOST_SPEED; break;
            case 'right': nextX += GHOST_SPEED; break;
        }

        if (isWall(nextX, nextY) || Math.random() < 0.01) {
            ghost.direction = directions[Math.floor(Math.random() * directions.length)];
        } else {
            ghost.x = nextX;
            ghost.y = nextY;
        }

        // Player collision
        players.forEach((player, playerIndex) => {
            const dist = Math.hypot(player.x - ghost.x, player.y - ghost.y);
            if (dist < 0.5) {
                if (player.poweredUp) {
                    ghost.x = 9.5; // respawn ghost
                    ghost.y = 5.5;
                    player.score += 200;
                } else {
                    player.lives--;
                    if (player.lives <= 0) {
                        // Move to spectator mode
                        // Find the WebSocket connection for this player
                        const clientWs = wss.clients.find(client => client.playerId === player.id);
                        if (clientWs) {
                            spectators.push(clientWs); // Add to spectators array
                            clientWs.send(JSON.stringify({ type: 'spectatorMode', message: 'You ran out of lives! You are now spectating.' }));
                            clientWs.playerId = null; // Mark client as no longer controlling a player
                        }
                        // Remove player from active players
                        players.splice(playerIndex, 1);
                    } else {
                        player.x = 1.5; // respawn player
                        player.y = 1.5;
                    }
                }
            }
        });
    });

    // Win/Loss Conditions (Last Man Standing or All Pellets Eaten)
    if (currentGameState === GAME_STATES.IN_PROGRESS) {
        let gameEnded = false;

        if (players.length === 1) {
            console.log(`[SERVER] Game Over: ${players[0].name} is the Last Man Standing!`);
            gameEnded = true;
        } else if (pellets.length === 0 && powerPellets.length === 0) {
            console.log('[SERVER] Game Over: All pellets eaten!');
            gameEnded = true;
        }

        if (gameEnded) {
            currentGameState = GAME_STATES.GAME_OVER;
            clearInterval(gameInterval);
            gameInterval = null; // Stop game loop

            // Notify clients of game over and winner
            const finalGameState = buildGameStatePayload(maze, players, ghosts, pellets, powerPellets, GAME_STATES.GAME_OVER);
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'gameState', gameState: finalGameState }));
                }
            });
            // After a delay, reset to lobby
            setTimeout(() => {
                initializeGameState();
                currentGameState = GAME_STATES.LOBBY;
                broadcastLobbyState(); // Inform clients the game is reset to lobby
            }, 5000); // 5 seconds to show game over screen
        }
    }

    // Broadcast state to all clients
    const gameState = buildGameStatePayload(maze, players, ghosts, pellets, powerPellets, currentGameState);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'gameState', gameState }));
        }
    });
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
