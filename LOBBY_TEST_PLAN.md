# Lobby System Test Plan

## Test Objectives
Verify that the lobby system correctly handles room creation, management, player interactions, and game transitions in single-player and multiplayer scenarios.

## Test Environment Setup

### Prerequisites
- Node.js v18+ installed
- Modern web browsers (Chrome, Firefox, Safari)
- WebSocket testing tool (e.g., wscat, Postman)
- Multiple browser instances/tabs for multiplayer testing

### Test Infrastructure
```bash
# Start server
npm install
npm start

# Server should be available at http://localhost:8080
# WebSocket available at ws://localhost:8080
```

## Unit Tests

### 1. Room Creation Tests

#### TC-001: Create Room with Default Settings
**Purpose**: Verify basic room creation works  
**Steps**:
1. Connect client to server
2. Send `joinLobby` with playerName: "TestPlayer"
3. Send `createRoom` with roomName: "Test Room"
**Expected**: 
- Receive `roomCreated` with roomId
- Room appears in `lobbyState`
- Room has default settings (maxPlayers: 4, lives: 3, etc.)
- Creator is marked as host

#### TC-002: Create Room with Custom Settings
**Purpose**: Verify custom settings are applied  
**Steps**:
1. Connect and join lobby
2. Send `createRoom` with:
   ```json
   {
     "roomName": "Custom Room",
     "maxPlayers": 2,
     "settings": {
       "ghostCount": 3,
       "lives": 5,
       "powerUpDuration": 15000
     }
   }
   ```
**Expected**: 
- Room created with specified settings
- All settings validated and stored correctly

#### TC-003: Create Room with Invalid Settings
**Purpose**: Verify validation rejects invalid values  
**Steps**:
1. Attempt to create room with maxPlayers: 10
2. Attempt to create room with lives: 0
3. Attempt to create room with negative ghostCount
**Expected**: 
- Receive `error` with appropriate error codes
- Room not created

#### TC-004: Duplicate Room Names
**Purpose**: Verify duplicate room names are allowed (not unique constraint)  
**Steps**:
1. Create room named "Test"
2. Create another room named "Test"
**Expected**: 
- Both rooms created successfully
- Each has unique roomId

### 2. Room Joining Tests

#### TC-005: Join Existing Room
**Purpose**: Verify players can join rooms  
**Steps**:
1. Player A creates room
2. Player B sends `joinRoom` with roomId
**Expected**: 
- Player B receives `roomJoined`
- Player B appears in room's player list
- Both players receive updated `roomState`

#### TC-006: Join Full Room
**Purpose**: Verify full rooms reject new players  
**Precondition**: Room with maxPlayers: 2 already has 2 players  
**Steps**:
1. Player C attempts to join room
**Expected**: 
- Receive `error` with code: "ROOM_FULL"
- Player C not added to room

#### TC-007: Join Non-existent Room
**Purpose**: Verify invalid room IDs are handled  
**Steps**:
1. Send `joinRoom` with roomId: "invalid-id"
**Expected**: 
- Receive `error` with code: "ROOM_NOT_FOUND"

#### TC-008: Join Room with Duplicate Name
**Purpose**: Verify duplicate player names in same room are handled  
**Precondition**: Room has player named "Alice"  
**Steps**:
1. Another player tries to join with name "Alice"
**Expected**: 
- Receive `error` with message about duplicate name
- Or system auto-generates unique name (e.g., "Alice_2")

### 3. Room Leaving Tests

#### TC-009: Voluntary Leave
**Purpose**: Verify players can leave rooms  
**Steps**:
1. Player in room sends `leaveRoom`
**Expected**: 
- Player receives `roomLeft`
- Remaining players receive updated `roomState`
- Player removed from player list

#### TC-010: Host Leaves - Transfer Host
**Purpose**: Verify host role transfers on leave  
**Precondition**: Room with 3 players, Player A is host  
**Steps**:
1. Host (Player A) leaves room
**Expected**: 
- Host role transfers to oldest remaining player (Player B)
- Remaining players receive updated `roomState` with new hostId
- Room remains active

#### TC-011: Last Player Leaves
**Purpose**: Verify empty rooms are cleaned up  
**Steps**:
1. Only player in room leaves
**Expected**: 
- Room removed from lobby after short delay (or immediately)
- `lobbyState` broadcast shows room removed

#### TC-012: Disconnect Without Leaving
**Purpose**: Verify disconnection triggers automatic leave  
**Steps**:
1. Player in room closes browser/cuts connection
2. Wait for timeout period (30s)
**Expected**: 
- Player automatically removed from room
- Host transfer occurs if disconnected player was host
- Remaining players notified via `roomState`

### 4. Ready System Tests

#### TC-013: Toggle Ready Status
**Purpose**: Verify players can set ready status  
**Steps**:
1. Player in room sends `setReady` with ready: true
2. Same player sends `setReady` with ready: false
**Expected**: 
- Player's ready status updates correctly
- All players in room receive updated `roomState`

#### TC-014: Start Game - All Ready
**Purpose**: Verify game starts when all players ready  
**Precondition**: Room with 3 players, all ready: true  
**Steps**:
1. Host sends `startGame`
**Expected**: 
- All players receive `gameStarting` with countdown: 3
- After countdown, receive game state or transition to game
- Room marked as gameStarted: true

#### TC-015: Start Game - Not All Ready
**Purpose**: Verify game won't start if players not ready  
**Precondition**: Room with 3 players, one player ready: false  
**Steps**:
1. Host sends `startGame`
**Expected**: 
- Receive `error` with message about players not ready
- Game does not start

#### TC-016: Start Game - Non-Host Attempts
**Purpose**: Verify only host can start game  
**Precondition**: Room with multiple players  
**Steps**:
1. Non-host player sends `startGame`
**Expected**: 
- Receive `error` with code: "NOT_HOST"
- Game does not start

### 5. Host Controls Tests

#### TC-017: Update Settings
**Purpose**: Verify host can update room settings  
**Steps**:
1. Host sends `updateSettings` with new settings
**Expected**: 
- Settings updated successfully
- All players receive updated `roomState`

#### TC-018: Update Settings - Non-Host
**Purpose**: Verify non-host cannot update settings  
**Steps**:
1. Non-host player sends `updateSettings`
**Expected**: 
- Receive `error` with code: "NOT_HOST"
- Settings unchanged

#### TC-019: Kick Player
**Purpose**: Verify host can kick players  
**Precondition**: Room with 3 players  
**Steps**:
1. Host sends `kickPlayer` with playerId of Player C
**Expected**: 
- Player C removed from room
- Player C receives notification of being kicked
- Remaining players receive updated `roomState`

#### TC-020: Kick Player - Non-Host
**Purpose**: Verify non-host cannot kick players  
**Steps**:
1. Non-host sends `kickPlayer`
**Expected**: 
- Receive `error` with code: "NOT_HOST"
- No player removed

### 6. Lobby State Tests

#### TC-021: Lobby State Broadcast
**Purpose**: Verify lobby state is broadcast to all clients  
**Steps**:
1. Multiple clients connected to lobby
2. New room created
3. Room deleted
**Expected**: 
- All clients receive updated `lobbyState` within 2 seconds
- State is consistent across all clients

#### TC-022: Lobby Auto-Refresh
**Purpose**: Verify periodic lobby state updates  
**Steps**:
1. Client joins lobby
2. Wait 5 seconds without any actions
**Expected**: 
- Client receives `lobbyState` at least twice (every 2s)

### 7. Concurrency Tests

#### TC-023: Simultaneous Room Creation
**Purpose**: Verify concurrent room creation doesn't cause issues  
**Steps**:
1. Five clients simultaneously send `createRoom`
**Expected**: 
- All five rooms created successfully
- Each has unique roomId
- No race conditions or data corruption

#### TC-024: Simultaneous Join Same Room
**Purpose**: Verify concurrent joins to same room handled correctly  
**Precondition**: Room with maxPlayers: 4, currently 3 players  
**Steps**:
1. Two clients simultaneously send `joinRoom` for same room
**Expected**: 
- One player joins successfully
- Other receives "ROOM_FULL" error (if room reaches max)
- Or both join if room has space
- No duplicate player entries

#### TC-025: Rapid Join/Leave Cycles
**Purpose**: Verify system handles rapid state changes  
**Steps**:
1. Player joins room, immediately leaves
2. Repeats 10 times rapidly
**Expected**: 
- No memory leaks
- No orphaned state
- Room state remains consistent

### 8. Edge Case Tests

#### TC-026: Empty Player Name
**Purpose**: Verify empty player names handled  
**Steps**:
1. Send `joinLobby` with playerName: ""
**Expected**: 
- Receive error OR system assigns default name
- Connection still established

#### TC-027: Very Long Player Name
**Purpose**: Verify long names handled gracefully  
**Steps**:
1. Send `joinLobby` with playerName: 200-character string
**Expected**: 
- Name truncated OR error returned
- No buffer overflow or crash

#### TC-028: Special Characters in Names
**Purpose**: Verify special characters sanitized  
**Steps**:
1. Send `joinLobby` with playerName: "<script>alert('xss')</script>"
2. Send `createRoom` with roomName containing special chars
**Expected**: 
- Names sanitized (HTML entities escaped)
- No XSS vulnerabilities
- Displayed correctly in UI

#### TC-029: Room Settings Boundary Values
**Purpose**: Verify boundary values accepted/rejected correctly  
**Steps**:
1. Test maxPlayers: 1 (should fail), 2 (ok), 4 (ok), 5 (fail)
2. Test lives: 0 (fail), 1 (ok), 5 (ok), 6 (fail)
3. Test ghostCount: 0 (fail), 1 (ok), 4 (ok), 5 (fail)
**Expected**: 
- Boundary values validated correctly
- Appropriate errors for out-of-range values

#### TC-030: Message Flood Attack
**Purpose**: Verify rate limiting prevents abuse  
**Steps**:
1. Send 100 `createRoom` messages in 1 second
2. Send 100 `joinRoom` messages in 1 second
**Expected**: 
- Rate limiting kicks in
- Excess messages rejected or delayed
- Server remains responsive

## Integration Tests

### IT-001: Full Game Flow - Single Room
**Purpose**: Verify complete flow from lobby to game  
**Steps**:
1. Player A creates room
2. Player B joins room
3. Both players set ready: true
4. Host starts game
5. Countdown completes
6. Game runs
7. Game ends (win/loss)
8. Players return to lobby
**Expected**: 
- Smooth transitions between all states
- No data loss
- Proper cleanup

### IT-002: Multiple Concurrent Rooms
**Purpose**: Verify multiple rooms operate independently  
**Steps**:
1. Create 3 rooms with different settings
2. Join each room with different players
3. Start games in all rooms simultaneously
**Expected**: 
- Rooms don't interfere with each other
- Game states remain isolated
- Performance acceptable

### IT-003: Server Restart Recovery
**Purpose**: Verify graceful handling of server restart  
**Steps**:
1. Players in lobby/rooms
2. Server restarts
3. Clients attempt to reconnect
**Expected**: 
- Clients detect disconnection
- Can reconnect and rejoin lobby
- Old rooms cleaned up

## UI/UX Tests

### UT-001: Lobby List Rendering
**Purpose**: Verify lobby UI displays correctly  
**Steps**:
1. Open client in browser
2. Create multiple rooms with various settings
**Expected**: 
- Room list displays all rooms
- Player counts accurate
- Settings preview visible
- Responsive layout

### UT-002: Room View Interactions
**Purpose**: Verify room view UI interactions work  
**Steps**:
1. Join room
2. Click ready button
3. Change settings (if host)
4. Click leave button
**Expected**: 
- UI responds immediately
- Visual feedback for actions
- Buttons enable/disable appropriately

### UT-003: Error Message Display
**Purpose**: Verify errors shown to user clearly  
**Steps**:
1. Trigger various errors (join full room, etc.)
**Expected**: 
- Clear, user-friendly error messages
- Errors don't crash UI
- User can continue using lobby

### UT-004: Mobile Responsiveness
**Purpose**: Verify lobby works on mobile devices  
**Steps**:
1. Open lobby on mobile browser or responsive mode
2. Navigate through all screens
**Expected**: 
- Layout adapts to screen size
- Touch targets appropriately sized
- No horizontal scrolling

### UT-005: Countdown Animation
**Purpose**: Verify game start countdown displays correctly  
**Steps**:
1. Start game with multiple players
**Expected**: 
- Countdown visible (3, 2, 1)
- Smooth animation
- Game starts at 0

## Performance Tests

### PT-001: Lobby Load Test
**Purpose**: Verify performance under load  
**Steps**:
1. Simulate 50 concurrent users
2. Create/join/leave rooms rapidly
3. Monitor server response times
**Expected**: 
- Response time < 100ms for lobby operations
- No memory leaks
- CPU usage reasonable

### PT-002: Message Throughput
**Purpose**: Verify WebSocket message handling capacity  
**Steps**:
1. Send 1000 lobby messages per second
2. Monitor message delivery
**Expected**: 
- All messages processed
- No message loss
- Latency stays low

### PT-003: Memory Leak Detection
**Purpose**: Verify no memory leaks over time  
**Steps**:
1. Run server for 1 hour
2. Simulate continuous room creation/deletion
3. Monitor memory usage
**Expected**: 
- Memory usage stable
- No gradual increase
- Garbage collection working

## Security Tests

### ST-001: XSS Prevention
**Purpose**: Verify XSS attacks prevented  
**Steps**:
1. Enter script tags in player name, room name
2. Check rendering in UI
**Expected**: 
- Scripts not executed
- Content displayed as text or sanitized

### ST-002: Input Validation
**Purpose**: Verify all inputs validated  
**Steps**:
1. Send malformed JSON messages
2. Send messages with unexpected types
3. Send extremely large payloads
**Expected**: 
- Invalid inputs rejected
- No crashes
- Appropriate error responses

### ST-003: Authentication Bypass
**Purpose**: Verify unauthorized actions prevented  
**Steps**:
1. Try to kick player without being host
2. Try to start game without being host
3. Try to modify other player's ready status
**Expected**: 
- All unauthorized actions rejected
- Proper error codes returned

## Accessibility Tests

### AT-001: Keyboard Navigation
**Purpose**: Verify lobby navigable by keyboard  
**Steps**:
1. Navigate lobby using only Tab, Enter, Escape
**Expected**: 
- All interactive elements reachable
- Focus indicators visible
- Logical tab order

### AT-002: Screen Reader Compatibility
**Purpose**: Verify screen readers can read lobby  
**Steps**:
1. Use screen reader (NVDA, VoiceOver)
2. Navigate through lobby
**Expected**: 
- All elements have proper labels
- Dynamic updates announced
- Semantic HTML used

### AT-003: Color Contrast
**Purpose**: Verify sufficient color contrast  
**Steps**:
1. Check all text/background combinations
**Expected**: 
- WCAG AA compliance (4.5:1 ratio)
- Readable for visually impaired users

## Test Execution Schedule

### Week 1 - Core Functionality
- Day 1-2: Unit tests TC-001 through TC-020
- Day 3: Integration tests IT-001, IT-002
- Day 4: UI tests UT-001 through UT-005
- Day 5: Bug fixes and retesting

### Week 2 - Edge Cases & Polish
- Day 1: Edge case tests TC-026 through TC-030
- Day 2: Performance tests PT-001 through PT-003
- Day 3: Security tests ST-001 through ST-003
- Day 4: Accessibility tests AT-001 through AT-003
- Day 5: Final regression testing

## Test Reporting

### Defect Tracking
Each defect should include:
- Test case ID that failed
- Steps to reproduce
- Expected vs actual behavior
- Severity (Critical, Major, Minor)
- Environment details
- Screenshots/logs if applicable

### Exit Criteria
Lobby system ready for production when:
- ✅ All critical and major test cases pass
- ✅ No critical or high-severity bugs open
- ✅ Performance benchmarks met
- ✅ Security tests pass
- ✅ Accessibility standards met
- ✅ Code review completed

## Regression Test Suite

After initial testing, maintain this core regression suite:
1. TC-001 (Create Room)
2. TC-005 (Join Room)
3. TC-009 (Leave Room)
4. TC-013 (Toggle Ready)
5. TC-014 (Start Game - All Ready)
6. TC-019 (Kick Player)
7. TC-021 (Lobby State Broadcast)
8. IT-001 (Full Game Flow)

Run regression suite before each deployment.
