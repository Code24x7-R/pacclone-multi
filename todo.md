# Pacclone Multi - TODO List

## Project Status
**Last Updated:** Just now  
**Current Iteration:** Iteration 1 (Lobby System) ✅ COMPLETE  
**Next Iteration:** Iteration 2 (PvP Combat)  
**Total Progress:** ~10%

---

## ✅ Completed Tasks

### Iteration 1: Lobby System (COMPLETE)

#### Design & Documentation
- [x] **TODO-DESIGN-001**: Create LOBBY_DESIGN.md with architecture and specifications
- [x] **TODO-DESIGN-002**: Create LOBBY_TEST_PLAN.md with comprehensive test cases
- [x] **TODO-DESIGN-003**: Update plan.md with iteration progress
- [x] **TODO-DESIGN-004**: Update README.md with project status

#### Server Implementation
- [x] **TODO-SERVER-001**: Create Room class for lobby management
- [x] **TODO-SERVER-002**: Implement WebSocket message handlers (10 types)
- [x] **TODO-SERVER-003**: Add game integration from room settings
- [x] **TODO-SERVER-004**: Implement host transfer on disconnect
- [x] **TODO-SERVER-005**: Add configurable game settings validation

#### Client Implementation
- [x] **TODO-CLIENT-001**: Build lobby view UI with modern design
- [x] **TODO-CLIENT-002**: Implement room list display
- [x] **TODO-CLIENT-003**: Create room creation modal
- [x] **TODO-CLIENT-004**: Build room view with player management
- [x] **TODO-CLIENT-005**: Add ready system with visual indicators
- [x] **TODO-CLIENT-006**: Implement countdown overlay
- [x] **TODO-CLIENT-007**: Add smooth view transitions
- [x] **TODO-CLIENT-008**: Implement XSS protection and error handling

#### Testing
- [x] **TODO-TEST-001**: Test server startup and static file serving
- [x] **TODO-TEST-002**: Test WebSocket connection handling
- [x] **TODO-TEST-003**: Test room creation and joining
- [x] **TODO-TEST-004**: Test player ready system
- [x] **TODO-TEST-005**: Test host controls (kick, settings)
- [x] **TODO-TEST-006**: Test game start countdown
- [x] **TODO-TEST-007**: Test multiplayer synchronization
- [x] **TODO-TEST-008**: Test disconnection handling
- [x] **TODO-TEST-009**: Test game-to-lobby return flow

---

## 🎯 Remaining Action Items

### High Priority (Must Have for MVP)

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

#### Phase 3: Spectator Mode
- [ ] **TODO-009**: Implement spectator mode for eliminated players
  - Keep eliminated players connected to game
  - Render their view without controls
  - Show "Spectator" label
  
- [ ] **TODO-010**: Add spectator camera controls
  - Allow spectators to cycle through active players
  - Or free-roam camera mode

---

### Medium Priority (Should Have)

#### Game Enhancements
- [ ] **TODO-011**: Add score tracking and leaderboard
  - Track points per player
  - Display scores during game
  - Show winner screen with final scores
  
- [ ] **TODO-012**: Improve ghost AI for multiplayer
  - Adjust difficulty based on player count
  - Balance ghost behavior for competitive play
  
- [ ] **TODO-013**: Add power-up duration indicator
  - Visual timer showing remaining power-up time
  - Warning before power-up expires
  
- [ ] **TODO-014**: Implement game pause/resume (host only)
  - Pause game during disruptions
  - Resume when all players ready

#### Controls & UX
- [ ] **TODO-015**: Add gamepad support testing
  - Test with Xbox/PlayStation controllers
  - Map all necessary buttons
  
- [ ] **TODO-016**: Improve touch controls
  - Optimize virtual joystick sensitivity
  - Add haptic feedback on mobile

---

### Low Priority (Nice to Have)

- [ ] **TODO-017**: Add custom player colors/skins
- [ ] **TODO-018**: Implement emote system for lobby
- [ ] **TODO-019**: Add sound effects for lobby actions
- [ ] **TODO-020**: Create animated background for lobby

---

### Technical Debt

- [ ] **TECH-001**: Replace Date.now() with uuid.v4() for player IDs
- [ ] **TECH-002**: Add input validation for all WebSocket messages
- [ ] **TECH-003**: Implement rate limiting on client messages
- [ ] **TECH-004**: Add server-side logging for debugging
- [ ] **TECH-005**: Optimize network bandwidth (delta compression)
- [ ] **TECH-006**: Add error recovery for dropped connections

---

### Quick Wins (< 30 min each)

- [ ] **QUICK-001**: Add player count badge to room list
- [ ] **QUICK-002**: Show ping/latency for each player
- [ ] **QUICK-003**: Add "Room Full" indicator
- [ ] **QUICK-004**: Implement auto-rejoin on accidental disconnect
- [ ] **QUICK-005**: Add keyboard shortcuts for lobby (Enter = Ready)
- [ ] **QUICK-006**: Show game settings summary before start
- [ ] **QUICK-007**: Add copy-to-clipboard for room ID/link

---

### Bug Fixes

- [ ] **BUG-001**: Fix any race conditions in room creation
- [ ] **BUG-002**: Handle edge case: host disconnects during countdown
- [ ] **BUG-003**: Prevent duplicate player names in same room
- [ ] **BUG-004**: Fix potential memory leak on player disconnect
- [ ] **BUG-005**: Address any UI flickering during state changes
- [ ] **BUG-006**: Ensure proper cleanup of event listeners
- [ ] **BUG-007**: Test and fix mobile Safari compatibility

---

### Documentation

- [ ] **DOC-001**: Write API documentation for WebSocket messages
- [ ] **DOC-002**: Create contributor guidelines
- [ ] **DOC-003**: Add inline code comments for complex logic
- [ ] **DOC-004**: Document deployment process
- [ ] **DOC-005**: Create troubleshooting guide
- [ ] **DOC-006**: Add architecture diagram

---

### Future Features (Post-MVP)

- [ ] **FUTURE-001**: Tournament/bracket mode
- [ ] **FUTURE-002**: Custom maze editor
- [ ] **FUTURE-003**: Power-up variations (speed, freeze, etc.)
- [ ] **FUTURE-004**: Achievement system
- [ ] **FUTURE-005**: Seasonal themes/skins
- [ ] **FUTURE-006**: Replay system
- [ ] **FUTURE-007**: Chat system in lobby
- [ ] **FUTURE-008]: Matchmaking/ranking system
- [ ] **FUTURE-009**: Bot players for solo practice
- [ ] **FUTURE-010**: Mobile app wrapper (React Native/Capacitor)

---

## Notes

- **Iteration Cycle:** 1 week recommended for focused iterations
- **Testing Strategy:** Manual testing + automated where feasible
- **Priority Order:** High → Medium → Low → Quick Wins → Tech Debt
- **Definition of Done:** Implemented + Tested + Documented

---

*Last updated: Just now after completing Iteration 1 (Lobby System)*
