
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '.')));

// Lobby System
const rooms = new Map(); // roomId -> Room object
const players = new Map(); // ws -> Player info

// Game State (for when game is running)
let gameState = null;
let gameInterval = null;

const PLAYER_COLORS = ['yellow', 'cyan', 'magenta', 'lime'];
const DEFAULT_SETTINGS = {
  mapType: 'classic',
  ghostCount: 1,
  lives: 3,
  powerUpDuration: 10000
};

class Room {
  constructor(id, name, hostId, maxPlayers, settings) {
    this.id = id;
    this.name = name;
    this.hostId = hostId;
    this.players = []; // Array of { id, name, ready, color, ws }
    this.maxPlayers = maxPlayers;
    this.gameStarted = false;
    this.createdAt = Date.now();
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  addPlayer(playerInfo) {
    if (this.players.length >= this.maxPlayers) {
      return false;
    }
    // Check for duplicate names
    if (this.players.some(p => p.name === playerInfo.name)) {
      return false;
    }
    const color = PLAYER_COLORS[this.players.length % PLAYER_COLORS.length];
    this.players.push({
      ...playerInfo,
      ready: false,
      color
    });
    return true;
  }

  removePlayer(playerId) {
    const index = this.players.findIndex(p => p.id === playerId);
    if (index !== -1) {
      this.players.splice(index, 1);
      // Transfer host if needed
      if (this.hostId === playerId && this.players.length > 0) {
        this.hostId = this.players[0].id;
      }
      return true;
    }
    return false;
  }

  getPlayer(playerId) {
    return this.players.find(p => p.id === playerId);
  }

  isHost(playerId) {
    return this.hostId === playerId;
  }

  allPlayersReady() {
    return this.players.length > 0 && this.players.every(p => p.ready);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      hostId: this.hostId,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        ready: p.ready,
        color: p.color
      })),
      maxPlayers: this.maxPlayers,
      gameStarted: this.gameStarted,
      settings: this.settings
    };
  }
}

// Helper to broadcast lobby state to all clients
function broadcastLobbyState() {
  const roomList = Array.from(rooms.values()).map(room => room.toJSON());
  const message = JSON.stringify({ type: 'lobbyState', rooms: roomList });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && !players.get(client)?.inGame) {
      client.send(message);
    }
  });
}

// Helper to broadcast room state to all players in a room
function broadcastRoomState(room) {
  const message = JSON.stringify({ type: 'roomState', room: room.toJSON() });
  room.players.forEach(player => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(message);
    }
  });
}

// Game Loop (existing game logic, now initialized from room settings)
function initializeGameFromRoom(room) {
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
  
  const gamePlayers = room.players.map((p, index) => ({
    id: p.id,
    name: p.name,
    x: 1.5 + (index * 2), // Stagger starting positions
    y: 1.5,
    color: p.color,
    lives: room.settings.lives,
    score: 0,
    direction: null,
    poweredUp: false
  }));
  
  const ghosts = [];
  for (let i = 0; i < room.settings.ghostCount; i++) {
    ghosts.push({
      id: i + 1,
      x: 9.5,
      y: 5.5,
      color: ['red', 'pink', 'cyan', 'orange'][i],
      direction: 'left'
    });
  }
  
  const pellets = [];
  const powerPellets = [];
  for (let y = 0; y < maze.length; y++) {
    for (let x = 0; x < maze[y].length; x++) {
      if (maze[y][x] === 0) {
        pellets.push({ x, y });
      } else if (maze[y][x] === 2) {
        powerPellets.push({ x, y });
      }
    }
  }
  
  gameState = {
    maze,
    players: gamePlayers,
    ghosts,
    pellets,
    powerPellets,
    settings: room.settings
  };
  
  return gamePlayers.map(p => p.id);
}

function isWall(x, y) {
    if (!gameState) return true;
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    if (tileY < 0 || tileY >= gameState.maze.length || tileX < 0 || tileX >= gameState.maze[0].length) {
        return true;
    }
    return gameState.maze[tileY][tileX] === 1;
}

// Game Loop Constants
const GAME_LOOP_INTERVAL = 1000 / 60; // 60 FPS
const PLAYER_SPEED = 0.05;
const GHOST_SPEED = 0.04;
const directions = ['up', 'down', 'left', 'right'];

function gameLoop() {
    if (!gameState) return;
    
    // Player movement and pellet collision
    gameState.players.forEach(player => {
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
        for (let i = gameState.pellets.length - 1; i >= 0; i--) {
            const p = gameState.pellets[i];
            const dist = Math.hypot(player.x - (p.x + 0.5), player.y - (p.y + 0.5));
            if (dist < 0.4) {
                gameState.pellets.splice(i, 1);
                player.score += 10;
            }
        }

        // Power pellet collision
        for (let i = gameState.powerPellets.length - 1; i >= 0; i--) {
            const pp = gameState.powerPellets[i];
            const dist = Math.hypot(player.x - (pp.x + 0.5), player.y - (pp.y + 0.5));
            if (dist < 0.5) {
                gameState.powerPellets.splice(i, 1);
                player.score += 50;
                player.poweredUp = true;
                setTimeout(() => {
                    player.poweredUp = false;
                }, gameState.settings.powerUpDuration);
            }
        }
    });

    // Ghost movement and player collision
    gameState.ghosts.forEach(ghost => {
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
        gameState.players.forEach((player, playerIndex) => {
            const dist = Math.hypot(player.x - ghost.x, player.y - ghost.y);
            if (dist < 0.5) {
                if (player.poweredUp) {
                    ghost.x = 9.5; // respawn ghost
                    ghost.y = 5.5;
                    player.score += 200;
                } else {
                    player.lives--;
                    if (player.lives <= 0) {
                        gameState.players.splice(playerIndex, 1);
                    } else {
                        player.x = 1.5; // respawn player
                        player.y = 1.5;
                    }
                }
            }
        });
    });

    // Win/Loss Conditions
    if (gameState.pellets.length === 0 && gameState.powerPellets.length === 0) {
        // Game complete - broadcast results and return to lobby
        broadcastGameResults();
        resetToLobby();
        return;
    }

    // Broadcast state to all clients in game
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && players.get(client)?.inGame) {
            client.send(JSON.stringify({ type: 'gameState', gameState }));
        }
    });
}

function broadcastGameResults() {
    // Send final scores to all players
    const results = {
        type: 'gameResults',
        players: gameState.players.map(p => ({
            id: p.id,
            name: p.name,
            score: p.score,
            lives: p.lives
        }))
    };
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && players.get(client)?.inGame) {
            client.send(JSON.stringify(results));
        }
    });
}

function resetToLobby() {
    gameState = null;
    if (gameInterval) {
        clearInterval(gameInterval);
        gameInterval = null;
    }
    // Mark all players as not in game
    players.forEach((playerInfo, ws) => {
        playerInfo.inGame = false;
    });
    // Broadcast updated lobby state
    broadcastLobbyState();
}

wss.on('connection', (ws) => {
    console.log('[SERVER] A new client connected.');
    ws.send(JSON.stringify({ type: 'welcome', message: 'Welcome to Pacclone Multi!' }));

    // Store player info in the players map
    const playerId = uuidv4();
    players.set(ws, {
        id: playerId,
        name: 'Player',
        inLobby: false,
        inGame: false,
        currentRoomId: null
    });

    // Send initial lobby state
    broadcastLobbyState();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleWebSocketMessage(ws, data);
        } catch (error) {
            console.error('[SERVER] Error parsing message:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
    });

    ws.on('close', () => {
        console.log('[SERVER] Client disconnected.');
        handleClientDisconnect(ws);
    });
});

// Message Handler
function handleWebSocketMessage(ws, data) {
    const playerInfo = players.get(ws);
    if (!playerInfo) return;

    switch (data.type) {
        // Lobby Messages
        case 'joinLobby':
            handleJoinLobby(ws, data);
            break;
        case 'createRoom':
            handleCreateRoom(ws, data);
            break;
        case 'joinRoom':
            handleJoinRoom(ws, data);
            break;
        case 'leaveRoom':
            handleLeaveRoom(ws, data);
            break;
        case 'setReady':
            handleSetReady(ws, data);
            break;
        case 'startGame':
            handleStartGame(ws, data);
            break;
        case 'updateSettings':
            handleUpdateSettings(ws, data);
            break;
        case 'kickPlayer':
            handleKickPlayer(ws, data);
            break;
        
        // Game Messages
        case 'input':
            handleGameInput(ws, data);
            break;
    }
}

function handleJoinLobby(ws, data) {
    const playerInfo = players.get(ws);
    if (!playerInfo) return;

    const playerName = data.playerName?.trim() || `Player_${playerInfo.id.substring(0, 6)}`;
    playerInfo.name = playerName;
    playerInfo.inLobby = true;
    playerInfo.currentRoomId = null;

    console.log(`[SERVER] Player ${playerName} joined the lobby`);
    broadcastLobbyState();
}

function handleCreateRoom(ws, data) {
    const playerInfo = players.get(ws);
    if (!playerInfo || !playerInfo.inLobby) {
        ws.send(JSON.stringify({ type: 'error', message: 'Must join lobby first' }));
        return;
    }

    const roomName = data.roomName?.trim() || `${playerInfo.name}'s Room`;
    const maxPlayers = Math.min(Math.max(data.maxPlayers || 4, 2), 4);
    const settings = {
        ghostCount: Math.min(Math.max(data.settings?.ghostCount || 1, 1), 4),
        lives: Math.min(Math.max(data.settings?.lives || 3, 1), 5),
        powerUpDuration: Math.min(Math.max(data.settings?.powerUpDuration || 10000, 5000), 30000),
        mapType: data.settings?.mapType || 'classic'
    };

    const roomId = uuidv4();
    const room = new Room(roomId, roomName, playerInfo.id, maxPlayers, settings);
    
    // Add host to room
    if (!room.addPlayer({ id: playerInfo.id, name: playerInfo.name, ws })) {
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to join room' }));
        return;
    }

    rooms.set(roomId, room);
    playerInfo.currentRoomId = roomId;

    console.log(`[SERVER] Room created: ${roomName} by ${playerInfo.name}`);
    ws.send(JSON.stringify({ type: 'roomCreated', roomId }));
    broadcastRoomState(room);
    broadcastLobbyState();
}

function handleJoinRoom(ws, data) {
    const playerInfo = players.get(ws);
    if (!playerInfo || !playerInfo.inLobby) {
        ws.send(JSON.stringify({ type: 'error', message: 'Must join lobby first' }));
        return;
    }

    const room = rooms.get(data.roomId);
    if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room not found', code: 'ROOM_NOT_FOUND' }));
        return;
    }

    if (!room.addPlayer({ id: playerInfo.id, name: playerInfo.name, ws })) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room is full or name taken', code: 'ROOM_FULL' }));
        return;
    }

    playerInfo.currentRoomId = room.id;

    console.log(`[SERVER] Player ${playerInfo.name} joined room ${room.name}`);
    ws.send(JSON.stringify({ type: 'roomJoined', roomId: room.id }));
    broadcastRoomState(room);
    broadcastLobbyState();
}

function handleLeaveRoom(ws, data) {
    const playerInfo = players.get(ws);
    if (!playerInfo || !playerInfo.currentRoomId) {
        return;
    }

    const room = rooms.get(playerInfo.currentRoomId);
    if (!room) {
        playerInfo.currentRoomId = null;
        return;
    }

    const wasHost = room.isHost(playerInfo.id);
    room.removePlayer(playerInfo.id);
    playerInfo.currentRoomId = null;

    console.log(`[SERVER] Player ${playerInfo.name} left room ${room.name}`);

    // If room is empty, delete it
    if (room.players.length === 0) {
        rooms.delete(room.id);
        broadcastLobbyState();
    } else {
        broadcastRoomState(room);
        broadcastLobbyState();
    }

    ws.send(JSON.stringify({ type: 'roomLeft', roomId: room.id }));
}

function handleSetReady(ws, data) {
    const playerInfo = players.get(ws);
    if (!playerInfo || !playerInfo.currentRoomId) {
        return;
    }

    const room = rooms.get(playerInfo.currentRoomId);
    if (!room) {
        return;
    }

    const player = room.getPlayer(playerInfo.id);
    if (player) {
        player.ready = data.ready;
        console.log(`[SERVER] Player ${playerInfo.name} set ready: ${data.ready}`);
        broadcastRoomState(room);
    }
}

function handleStartGame(ws, data) {
    const playerInfo = players.get(ws);
    if (!playerInfo || !playerInfo.currentRoomId) {
        return;
    }

    const room = rooms.get(playerInfo.currentRoomId);
    if (!room) {
        return;
    }

    // Only host can start game
    if (!room.isHost(playerInfo.id)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Only host can start game', code: 'NOT_HOST' }));
        return;
    }

    // Check all players are ready
    if (!room.allPlayersReady()) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not all players are ready' }));
        return;
    }

    // Start countdown
    console.log(`[SERVER] Game starting in room ${room.name}`);
    let countdown = 3;
    
    const countdownInterval = setInterval(() => {
        room.players.forEach(player => {
            if (player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(JSON.stringify({ 
                    type: 'gameStarting', 
                    roomId: room.id, 
                    countdown 
                }));
            }
        });

        countdown--;
        if (countdown < 0) {
            clearInterval(countdownInterval);
            startGameFromRoom(room);
        }
    }, 1000);
}

function startGameFromRoom(room) {
    room.gameStarted = true;
    
    // Initialize game state from room
    const playerIds = initializeGameFromRoom(room);
    
    // Mark players as in game
    playerIds.forEach(id => {
        players.forEach((playerInfo, ws) => {
            if (playerInfo.id === id) {
                playerInfo.inGame = true;
            }
        });
    });

    // Start game loop
    if (!gameInterval) {
        gameInterval = setInterval(gameLoop, GAME_LOOP_INTERVAL);
    }

    console.log(`[SERVER] Game started with ${playerIds.length} players`);
}

function handleUpdateSettings(ws, data) {
    const playerInfo = players.get(ws);
    if (!playerInfo || !playerInfo.currentRoomId) {
        return;
    }

    const room = rooms.get(playerInfo.currentRoomId);
    if (!room || !room.isHost(playerInfo.id)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Only host can update settings', code: 'NOT_HOST' }));
        return;
    }

    // Update settings with validation
    if (data.settings) {
        if (data.settings.ghostCount !== undefined) {
            room.settings.ghostCount = Math.min(Math.max(data.settings.ghostCount, 1), 4);
        }
        if (data.settings.lives !== undefined) {
            room.settings.lives = Math.min(Math.max(data.settings.lives, 1), 5);
        }
        if (data.settings.powerUpDuration !== undefined) {
            room.settings.powerUpDuration = Math.min(Math.max(data.settings.powerUpDuration, 5000), 30000);
        }
        if (data.settings.mapType !== undefined) {
            room.settings.mapType = data.settings.mapType;
        }
    }

    broadcastRoomState(room);
}

function handleKickPlayer(ws, data) {
    const playerInfo = players.get(ws);
    if (!playerInfo || !playerInfo.currentRoomId) {
        return;
    }

    const room = rooms.get(playerInfo.currentRoomId);
    if (!room || !room.isHost(playerInfo.id)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Only host can kick players', code: 'NOT_HOST' }));
        return;
    }

    const kickedPlayer = room.getPlayer(data.playerId);
    if (kickedPlayer && kickedPlayer.ws) {
        kickedPlayer.ws.send(JSON.stringify({ type: 'kicked', roomId: room.id }));
        players.get(kickedPlayer.ws).currentRoomId = null;
    }

    room.removePlayer(data.playerId);
    broadcastRoomState(room);
    broadcastLobbyState();
}

function handleGameInput(ws, data) {
    const playerInfo = players.get(ws);
    if (!playerInfo || !playerInfo.inGame || !gameState) {
        return;
    }

    const player = gameState.players.find(p => p.id === playerInfo.id);
    if (player) {
        player.direction = data.direction;
    }
}

function handleClientDisconnect(ws) {
    const playerInfo = players.get(ws);
    if (!playerInfo) return;

    // If in a room, leave the room
    if (playerInfo.currentRoomId) {
        const room = rooms.get(playerInfo.currentRoomId);
        if (room) {
            room.removePlayer(playerInfo.id);
            
            // If room is empty, delete it
            if (room.players.length === 0) {
                rooms.delete(room.id);
            } else {
                broadcastRoomState(room);
            }
            broadcastLobbyState();
        }
    }

    // Remove player from map
    players.delete(ws);
}

const PORT = 8080;
server.listen(PORT, () => {
    console.log(`[SERVER] Listening on http://localhost:${PORT}`);
});
