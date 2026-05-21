# Pacclone Multi - TODO List

## 🎯 Immediate Action Items

### High Priority (Must Have for MVP)

#### Phase 1: Lobby System
- [ ] **TODO-001**: Create lobby UI in index.html
  - Add player name input field
  - Display 4 player slots with status (empty/ready)
  - Add "Ready" button
  - Add "Start Game" button (host only)
  
- [ ] **TODO-002**: Implement lobby state management on server
  - Add lobby state to game state object
  - Track player ready status
  - Track host player (first to join)
  - Only start game when host triggers and ≥1 player ready

- [ ] **TODO-003**: Update WebSocket message types
  - Add `lobbyState` message type
  - Add `playerReady` client→server message
  - Add `startGame` client→server message (host only)
  - Add `setPlayerName` client→server message

- [ ] **TODO-004**: Fix player ID generation
  - Replace `Date.now()` with `uuid.v4()` 
  - Update all player references to use UUID

#### Phase 2: Player vs Player Combat
- [ ] **TODO-005**: Implement player-player collision detection
  - Add distance check between all player pairs in game loop
  - Detect when players overlap

- [ ] **TODO-006**: Add PvP combat logic
  - If player A powered up AND player B not powered → A eats B
  - B loses life, A gains points
  - B respawns at starting position

- [ ] **TODO-007**: Implement morphing/pass-through effect
  - When both players NOT powered up → pass through each other
  - Add visual effect (transparency? color shift?)

- [ ] **TODO-008**: Update win condition
  - Track remaining players with lives > 0
  - End game when only 1 player remains (Last Man Standing)
  - OR when all pellets cleared

---

### Medium Priority (Should Have)

#### Phase 3: Spectator Mode & Game Flow
- [ ] **TODO-009**: Implement spectator mode
  - When player.lives ≤ 0, set player.isSpectator = true
  - Don't remove from players array
  - Disable input for spectators
  - Show "SPECTATOR" label on UI

- [ ] **TODO-010**: Add game over screen
  - Display winner name/score
  - Show final leaderboard
  - Add "Play Again" button (triggers rematch)

- [ ] **TODO-011**: Implement rematch functionality
  - Host can initiate rematch
  - Reset all player stats (lives, score, position)
  - Reset pellets and power pellets
  - Keep same player roster

#### Phase 4: Enhanced Controls
- [ ] **TODO-012**: Add gamepad support
  - Poll gamepad API in animation frame
  - Map D-pad and left stick to directions
  - Send input to server like keyboard

- [ ] **TODO-013**: Implement touch controls
  - Add virtual joystick overlay for mobile
  - Detect touch events
  - Calculate direction from joystick position
  - Send input to server

- [ ] **TODO-014**: Auto-detect input method
  - Listen for first input type used
  - Show/hide appropriate controls
  - Allow switching between methods

---

### Low Priority (Nice to Have)

#### Phase 5: Audio & Polish
- [ ] **TODO-015**: Implement sound effects system
  - Create AudioContext manager
  - Add chomp sound (eating pellets)
  - Add power-up sound
  - Add ghost-eaten sound
  - Add player-eliminated sound
  - Add win/lose sounds

- [ ] **TODO-016**: Add multiple ghosts
  - Create 4 ghosts with different colors
  - Start positions: ghost house area

- [ ] **TODO-017**: Improve ghost AI
  - Research classic Pac-Man ghost behaviors
  - Implement at least basic tracking/chasing
  - Different personalities per ghost

- [ ] **TODO-018**: Add visual feedback
  - Flash effect when player hit
  - Particle effect when eating pellet
  - Animation when power-up activates

---

### Technical Debt & Maintenance

#### Code Quality
- [ ] **TODO-019**: Remove unused files
  - Delete `index.tsx` (placeholder)
  - Delete `tsconfig.json` (empty)
  - Delete `vite.config.ts` (empty)
  - Or implement TypeScript if desired

- [ ] **TODO-020**: Refactor server.js
  - Extract game logic into separate module (game.js)
  - Extract WebSocket handlers into separate module (websocket.js)
  - Create config file for constants (speeds, sizes, etc.)

- [ ] **TODO-021**: Add error handling
  - Wrap WebSocket message parsing in try-catch
  - Handle malformed JSON gracefully
  - Add connection retry logic on client

- [ ] **TODO-022**: Improve logging
  - Add debug mode flag
  - Log game events (collisions, power-ups, eliminations)
  - Log connection/disconnection events with player names

- [ ] **TODO-023**: Make canvas responsive
  - Calculate tile size based on window dimensions
  - Add CSS media queries for mobile
  - Maintain aspect ratio

- [ ] **TODO-024**: Add input validation
  - Validate direction values from clients
  - Rate limit messages from clients
  - Prevent cheating via modified clients

---

## 📋 Quick Wins (Can be done in < 1 hour each)

- [ ] **QW-001**: Add player count display in lobby
- [ ] **QW-002**: Change player colors for differentiation (P1: yellow, P2: green, P3: purple, P4: orange)
- [ ] **QW-003**: Add "Waiting for players..." message in lobby
- [ ] **QW-004**: Display current player's name on their character
- [ ] **QW-005**: Add pause functionality (host only)
- [ ] **QW-006**: Show countdown before game starts (3...2...1...GO!)
- [ ] **QW-007**: Add minimum browser version requirements to README
- [ ] **QW-008**: Update package.json test script with actual tests

---

## 🔥 Bug Fixes

- [ ] **BUG-001**: Player ID collision possible with Date.now() - use UUID
- [ ] **BUG-002**: Game starts immediately on connection (should wait for host)
- [ ] **BUG-003**: No visual distinction between multiple players (same yellow color)
- [ ] **BUG-004**: Canvas doesn't scale for different screen sizes
- [ ] **BUG-005**: Ghost can get stuck in walls with random movement
- [ ] **BUG-006**: No feedback when trying to move into wall
- [ ] **BUG-007**: Power-up timeout uses setTimeout which isn't synced with game loop

---

## 📝 Documentation Tasks

- [ ] **DOC-001**: Update README with current installation steps
- [ ] **DOC-002**: Add API documentation for WebSocket messages
- [ ] **DOC-003**: Create CONTRIBUTING.md for future contributors
- [ ] **DOC-004**: Add inline code comments in server.js
- [ ] **DOC-005**: Document game rules and scoring system
- [ ] **DOC-006**: Add troubleshooting section to README

---

## 🎮 Feature Requests (Future Consideration)

- [ ] **FEAT-001**: Add different maze layouts
- [ ] **FEAT-002**: Implement power-up variations (speed boost, freeze ghosts, etc.)
- [ ] **FEAT-003**: Add achievements/trophy system
- [ ] **FEAT-004**: Implement ranking/leaderboard system
- [ ] **FEAT-005**: Add chat feature in lobby
- [ ] **FEAT-006**: Support for custom rooms (private games with codes)
- [ ] **FEAT-007**: Add tournament mode
- [ ] **FEAT-008**: Implement replay system
- [ ] **FEAT-009**: Add bots for single-player practice
- [ ] **FEAT-010**: Mobile app wrapper (React Native / Capacitor)

---

## ✅ Completed Tasks

- [x] Initial project setup
- [x] Basic server with Express + WebSocket
- [x] Client HTML with canvas rendering
- [x] Maze data structure
- [x] Player movement (keyboard)
- [x] Pellet collection
- [x] Power pellet mechanics
- [x] Ghost entity (basic)
- [x] Collision detection (player-pellet, player-ghost)
- [x] Score tracking
- [x] Lives system
- [x] Game loop (60 FPS)
- [x] State broadcasting to clients

---

*Last Updated: $(date)*
*Total Open Tasks: 47*
*High Priority: 8*
*Medium Priority: 7*
*Low Priority: 4*
*Technical Debt: 6*
*Quick Wins: 8*
*Bug Fixes: 7*
