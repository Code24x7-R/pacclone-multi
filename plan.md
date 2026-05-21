# Pacclone Multi - Development Plan

## 📋 Project Overview

**Pacclone Multi** is a real-time multiplayer Pac-Man-style game built with Node.js, Express, WebSocket, and vanilla JavaScript. The project uses an authoritative server model where the server maintains the true game state.

### Current State Assessment

#### ✅ What's Working
- Basic client-server WebSocket communication
- Server-side game loop (60 FPS)
- Maze rendering with walls, pellets, and power pellets
- Player movement with keyboard controls (Arrow keys + WASD)
- Ghost AI (basic random movement)
- Collision detection (player-pellet, player-ghost, player-power pellet)
- Score tracking and lives system
- Player respawn on death
- Game reset when all pellets are cleared

#### ❌ Critical Gaps (vs README PRD)
1. **No Game Lobby System** - Players join directly without lobby, names, or player slot selection
2. **No Multiplayer Combat** - Players cannot eat each other when powered up
3. **No Spectator Mode** - Eliminated players are simply removed, not converted to spectators
4. **No Last Man Standing Logic** - Game doesn't end when one player remains
5. **Missing Controls**: No gamepad support, no touch controls for mobile
6. **No Sound Effects** - No audio implementation
7. **No Host/Start Game Mechanism** - Game starts immediately on connection
8. **Single Ghost Only** - Only one ghost exists in the game
9. **No Player Morphing Effects** - Visual effects when players interact
10. **Unused Files**: `index.tsx`, `tsconfig.json`, `vite.config.ts` are empty placeholders

---

## 🎯 Development Phases

### Phase 1: Core Multiplayer Foundation (Priority: HIGH)
**Goal**: Implement proper lobby system and basic multiplayer infrastructure

#### Objectives
- [ ] Create game lobby with 4 player slots
- [ ] Add player name input
- [ ] Implement host/player roles
- [ ] Add "Ready" state and game start mechanism
- [ ] Fix player ID assignment (currently uses timestamp, should use UUID)

#### Test Criteria
- Multiple players can join lobby and see each other
- Player names display correctly
- Host can start game when players are ready
- Game only starts when host triggers it

---

### Phase 2: Player vs Player Combat (Priority: HIGH)
**Goal**: Enable player-vs-player interactions as described in PRD

#### Objectives
- [ ] Implement player collision detection
- [ ] Add logic: powered-up player can eat non-powered players
- [ ] Add morphing/pass-through effect when not powered up
- [ ] Transfer score/points when player eats player
- [ ] Update win condition to "Last Man Standing"

#### Test Criteria
- Powered-up player can eliminate other players
- Non-powered players pass through each other
- Eliminated players lose lives and respawn (or become spectators)
- Score updates correctly on player eliminations

---

### Phase 3: Spectator Mode & Game Flow (Priority: MEDIUM)
**Goal**: Proper end-game flow and spectator experience

#### Objectives
- [ ] Convert eliminated players (0 lives) to spectators
- [ ] Spectators can still view game state
- [ ] Display "Winner" announcement
- [ ] Implement proper game over screen
- [ ] Add rematch/restart functionality

#### Test Criteria
- Eliminated players remain connected as spectators
- Winner is correctly identified and announced
- Game can be restarted without page refresh

---

### Phase 4: Enhanced Controls (Priority: MEDIUM)
**Goal**: Support multiple input methods per PRD

#### Objectives
- [ ] Add gamepad support (Xbox/standard layout)
- [ ] Implement touch controls with virtual joystick
- [ ] Auto-detect input method
- [ ] Ensure each client can use different control schemes

#### Test Criteria
- Gamepad D-pad and analog stick work
- Touch joystick appears on mobile devices
- Keyboard, gamepad, and touch can coexist

---

### Phase 5: Audio & Polish (Priority: LOW)
**Goal**: Add sound effects and visual polish

#### Objectives
- [ ] Implement Web Audio API sound effects:
  - Chomping sound
  - Power-up activation
  - Ghost eating
  - Player elimination
  - Win/lose sounds
- [ ] Add visual feedback for events
- [ ] Improve ghost AI (more than random movement)
- [ ] Add multiple ghosts

#### Test Criteria
- All sound effects play at appropriate times
- Visual effects enhance gameplay clarity
- Ghosts provide meaningful challenge

---

### Phase 6: Code Quality & Architecture (Priority: ONGOING)
**Goal**: Clean up codebase and improve maintainability

#### Objectives
- [ ] Remove unused files (`index.tsx`, empty `tsconfig.json`, `vite.config.ts`)
- [ ] Refactor server.js into modular components
- [ ] Separate game logic from WebSocket handling
- [ ] Add proper error handling
- [ ] Add logging/debugging tools
- [ ] Consider TypeScript migration (if desired)
- [ ] Add unit tests for game logic
- [ ] Add integration tests for WebSocket communication

#### Test Criteria
- Code is modular and maintainable
- No console errors during normal operation
- Tests pass consistently

---

## 🧪 Testing Strategy

### Manual Testing Checklist
1. **Single Player**
   - [ ] Can navigate maze
   - [ ] Can eat pellets and score points
   - [ ] Can eat power pellets
   - [ ] Ghost collision works (death when not powered, kill when powered)
   - [ ] Game resets when all pellets cleared

2. **Multiplayer (2-4 players)**
   - [ ] All players can join lobby
   - [ ] Player names display
   - [ ] Each player controls independently
   - [ ] Player-vs-player combat works
   - [ ] Spectator mode activates on elimination
   - [ ] Winner declared correctly

3. **Controls**
   - [ ] Keyboard (Arrow + WASD)
   - [ ] Gamepad
   - [ ] Touch (mobile)

4. **Edge Cases**
   - [ ] Player disconnects mid-game
   - [ ] All players disconnect (server resets)
   - [ ] Network latency handling
   - [ ] Simultaneous collisions

### Automated Testing (Future)
- Unit tests for collision detection
- Unit tests for game state transitions
- Integration tests for WebSocket messages
- Load testing for multiple concurrent players

---

## 📅 Suggested Iteration Cycle

### Iteration 1: Foundation (Week 1)
- **Plan**: Finalize requirements, set up development environment
- **Implement**: Phase 1 (Lobby system)
- **Test**: Manual testing of lobby functionality

### Iteration 2: Combat (Week 2)
- **Plan**: Review Phase 1, gather feedback
- **Implement**: Phase 2 (PvP combat)
- **Test**: Multiplayer combat scenarios

### Iteration 3: Game Flow (Week 3)
- **Plan**: Refine combat mechanics
- **Implement**: Phase 3 (Spectator mode, win conditions)
- **Test**: Full game flow from lobby to winner

### Iteration 4: Controls (Week 4)
- **Plan**: Polish core gameplay
- **Implement**: Phase 4 (Gamepad + Touch)
- **Test**: All control schemes on various devices

### Iteration 5: Polish (Week 5+)
- **Plan**: Prioritize remaining features
- **Implement**: Phase 5 (Audio, visual effects, AI improvements)
- **Test**: Comprehensive QA pass

---

## 🔧 Technical Debt & Notes

1. **Player ID Generation**: Currently uses `Date.now()` which could collide. Should use `uuid` package (already in dependencies).

2. **Hardcoded Values**: Many values (speeds, tile sizes, colors) are hardcoded. Consider configuration object.

3. **Ghost AI**: Currently just random movement. Consider implementing classic Pac-Man ghost behaviors (Blinky, Pinky, Inky, Clyde patterns).

4. **State Broadcasting**: Server broadcasts full state to all clients every frame. Consider delta compression for scalability.

5. **Security**: No input validation on WebSocket messages. Add sanitization.

6. **Responsive Design**: Canvas size is fixed (800x520). Make responsive for different screen sizes.

7. **Mobile Optimization**: No viewport meta tag optimization for mobile gaming.

---

## 📚 Resources

- WebSocket Documentation: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Express.js: https://expressjs.com/
- Gamepad API: https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API
- Web Audio API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- Touch Events: https://developer.mozilla.org/en-US/docs/Web/API/Touch_events

---

*Last Updated: $(date)*
*Version: 1.0.0*
