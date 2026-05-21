# Lobby System Design Document

## Overview
The lobby system allows players to join, create, and manage game rooms before starting a multiplayer match. It provides a waiting area where players can see available rooms, join existing ones, or create new rooms with custom settings.

## Architecture

### Server-Side Components
1. **Lobby Manager**: Manages all active rooms
2. **Room Class**: Represents individual game rooms with state
3. **WebSocket Handlers**: Process lobby-related messages

### Client-Side Components
1. **Lobby UI**: Main menu with room list and controls
2. **Room View**: Display room details, player list, and ready status
3. **State Management**: Track local lobby state

## Data Structures

### Room Object
```javascript
{
  id: string,              // Unique room ID (UUID)
  name: string,            // Room name
  hostId: string,          // Host player's WebSocket ID
  players: Array<{         // List of players in room
    id: string,           // Player ID
    name: string,         // Player display name
    ready: boolean,       // Ready status
    color: string         // Player color
  }>,
  maxPlayers: number,      // Maximum players (2-4)
  gameStarted: boolean,    // Whether game has started
  createdAt: number,       // Timestamp
  settings: {             // Game settings
    mapType: string,      // 'classic', 'tournament', etc.
    ghostCount: number,   // Number of ghosts (1-4)
    lives: number,        // Lives per player (1-5)
    powerUpDuration: number // milliseconds
  }
}
```

### Lobby State (Client)
```javascript
{
  currentView: 'lobby-list' | 'room-view' | 'creating',
  rooms: Array<Room>,     // Available rooms
  currentRoom: Room|null, // Currently viewed/joined room
  playerName: string,     // Local player's name
  playerId: string        // Local player's ID
}
```

## Message Protocol

### Client → Server Messages

#### `joinLobby`
```json
{
  "type": "joinLobby",
  "playerName": "string"
}
```

#### `createRoom`
```json
{
  "type": "createRoom",
  "roomName": "string",
  "maxPlayers": 2-4,
  "settings": { ... }
}
```

#### `joinRoom`
```json
{
  "type": "joinRoom",
  "roomId": "string"
}
```

#### `leaveRoom`
```json
{
  "type": "leaveRoom",
  "roomId": "string"
}
```

#### `setReady`
```json
{
  "type": "setReady",
  "roomId": "string",
  "ready": boolean
}
```

#### `startGame`
```json
{
  "type": "startGame",
  "roomId": "string"
}
```

#### `updateSettings` (Host only)
```json
{
  "type": "updateSettings",
  "roomId": "string",
  "settings": { ... }
}
```

#### `kickPlayer` (Host only)
```json
{
  "type": "kickPlayer",
  "roomId": "string",
  "playerId": "string"
}
```

### Server → Client Messages

#### `lobbyState`
```json
{
  "type": "lobbyState",
  "rooms": [ ... ]
}
```

#### `roomState`
```json
{
  "type": "roomState",
  "room": { ... }
}
```

#### `roomCreated`
```json
{
  "type": "roomCreated",
  "roomId": "string"
}
```

#### `roomJoined`
```json
{
  "type": "roomJoined",
  "room": { ... }
}
```

#### `roomLeft`
```json
{
  "type": "roomLeft",
  "roomId": "string"
}
```

#### `gameStarting`
```json
{
  "type": "gameStarting",
  "roomId": "string",
  "countdown": 3
}
```

#### `error`
```json
{
  "type": "error",
  "message": "string",
  "code": "ROOM_FULL" | "ROOM_NOT_FOUND" | "NOT_HOST" | "ALREADY_READY"
}
```

## UI Design

### Lobby List View
- **Header**: Game title, player name input
- **Room List**: Scrollable list of available rooms showing:
  - Room name
  - Player count (e.g., "2/4")
  - Host indicator
  - Settings preview
- **Buttons**: 
  - "Create Room" (opens creation modal)
  - "Refresh" (manual refresh)
- **Auto-refresh**: Every 2 seconds

### Create Room Modal
- Room name input
- Max players slider (2-4)
- Game settings:
  - Map type dropdown
  - Ghost count slider (1-4)
  - Lives slider (1-5)
  - Power-up duration slider
- "Create" and "Cancel" buttons

### Room View
- **Room Info**: Name, settings
- **Player List**: 
  - Each player shows: name, ready status, color
  - Host badge for host player
  - Kick button (host only, next to other players)
- **Ready Button**: Toggle ready status
- **Start Game Button**: (Host only, enabled when all players ready)
- **Leave Room Button**
- **Chat Box** (optional future feature)

## Game Flow

1. **Connect**: Client connects via WebSocket
2. **Join Lobby**: Client sends `joinLobby` with player name
3. **Browse Rooms**: Server sends `lobbyState` with available rooms
4. **Create/Join Room**: 
   - Create: Client sends `createRoom`, server responds with `roomCreated`
   - Join: Client sends `joinRoom`, server responds with `roomJoined`
5. **Wait in Room**: 
   - Players toggle ready status
   - Host adjusts settings
   - Server broadcasts `roomState` on changes
6. **Start Game**: 
   - Host clicks "Start Game" (all players must be ready)
   - Server sends `gameStarting` with countdown
   - After countdown, transition to game view
7. **Game Ends**: Return to lobby or disconnect

## Edge Cases & Error Handling

### Connection Loss
- Automatically remove player from room after 30s timeout
- Notify remaining players
- If host disconnects, transfer host to oldest player or close room

### Room Cleanup
- Auto-delete empty rooms after 5 minutes
- Delete rooms where game ended and players left

### Validation
- Prevent duplicate player names in same room
- Enforce max player limit
- Only host can start game or change settings
- All players must be ready to start

### Race Conditions
- Use atomic operations for joining/leaving
- Lock room state during critical updates
- Send confirmation before transitioning states

## Testing Strategy

### Unit Tests
- Room creation with various settings
- Player join/leave logic
- Ready status toggling
- Host transfer logic
- Room cleanup

### Integration Tests
- Multiple clients joining same room
- Concurrent room creation
- Message ordering and consistency
- Disconnection handling

### E2E Tests
- Full flow: connect → create room → join → start game
- Cross-browser compatibility
- Mobile responsiveness

### Manual Test Scenarios
1. Create room, wait for others, start game
2. Join full room (should error)
3. Host disconnects during waiting
4. Player disconnects after ready
5. Rapid join/leave cycles
6. Settings validation (min/max values)

## Implementation Phases

### Phase 1: Core Lobby (Week 1)
- [ ] Basic room data structure
- [ ] Create/join/leave room functionality
- [ ] Lobby state broadcasting
- [ ] Simple lobby UI (list + basic room view)

### Phase 2: Room Management (Week 1)
- [ ] Ready system
- [ ] Host controls (kick, settings)
- [ ] Player list with colors
- [ ] Enhanced room UI

### Phase 3: Game Transition (Week 2)
- [ ] Countdown timer
- [ ] Game initialization from room settings
- [ ] Smooth transition animations
- [ ] Post-game return to lobby

### Phase 4: Polish & Edge Cases (Week 2)
- [ ] Disconnection handling
- [ ] Room cleanup
- [ ] Error messages
- [ ] Responsive design
- [ ] Accessibility improvements

## Security Considerations

- Validate all client inputs
- Rate limit room creation
- Prevent room ID enumeration
- Sanitize player names (XSS prevention)
- Authenticate WebSocket connections
- Limit rooms per IP to prevent abuse

## Performance Optimization

- Batch lobby state updates (max 2/sec)
- Clean up inactive rooms automatically
- Use efficient data structures for room lookup
- Implement pagination for large room lists (future)
- Compress WebSocket messages if needed

## Future Enhancements

- Password-protected rooms
- Spectator slots
- Room chat
- Player profiles and stats
- Matchmaking system
- Tournament mode
- Custom maps
- Replay system
