# 👻 Pacclone Multi

A classic arcade-style game reminiscent of Pac-Man, built with HTML, CSS, and JavaScript, featuring a client-server architecture for multiplayer gameplay! Navigate the maze, eat all the pellets, avoid the ghosts, and compete to be the last one standing!

## Project Status: 🟢 Active Development

**Current Phase:** Phase 1 - Core Multiplayer Foundation  
**Last Updated:** Just now  
**Total Project Completion:** ~10%

### ✅ Completed (Iteration 1: Lobby System)

#### Design & Documentation
- [x] **LOBBY_DESIGN.md** - Complete architecture, data structures, message protocol, UI specs
- [x] **LOBBY_TEST_PLAN.md** - 40+ test cases covering all testing dimensions
- [x] **plan.md** - Updated with current progress and next phases
- [x] **todo.md** - Updated with completed tasks and new priorities

#### Implementation
- [x] **Server-side lobby system** (`server.js`)
  - Room management with Room class
  - 10 WebSocket message handlers
  - Game integration from room settings
  - Host transfer and cleanup on disconnect
  - Configurable game settings (ghosts, lives, power-up duration)
  
- [x] **Client-side lobby UI** (`index.html`)
  - Modern responsive design with gradients
  - Room list view with create/join functionality
  - Room view with player management and settings
  - Ready system with visual indicators
  - 3-second countdown overlay
  - Smooth view transitions
  - XSS protection and error handling

#### Testing
- [x] Server startup and static file serving
- [x] WebSocket connection handling
- [x] Room creation and joining
- [x] Player ready system
- [x] Host controls (kick, settings)
- [x] Game start countdown
- [x] Multiplayer synchronization
- [x] Disconnection handling
- [x] Game-to-lobby return flow

### 🚧 In Progress
- (None - ready to start next iteration)

### 📋 Next Up (Iteration 2: PvP Combat)
- [ ] Player-vs-player eating mechanics
- [ ] Morphing effects when players interact
- [ ] Turn-based hunting dynamics
- [ ] Score tracking for player eliminations
- [ ] Visual feedback for PvP actions

### 📊 Overall Progress

| Phase | Status | Completion |
|-------|--------|------------|
| Phase 1: Core Multiplayer | 🟡 In Progress | 60% (Lobby ✓, PvP ⏳, Spectator ⏳) |
| Phase 2: Game Enhancements | ⚪ Not Started | 0% |
| Phase 3: Polish & UX | ⚪ Not Started | 0% |
| Phase 4: Advanced Features | ⚪ Not Started | 0% |
| Phase 5: Deployment | ⚪ Not Started | 0% |
| Phase 6: Post-Launch | ⚪ Not Started | 0% |

### 🔑 Key Achievements
- ✅ Fully functional lobby system with room management
- ✅ Configurable game settings (2-4 players, 1-4 ghosts, 1-5 lives, 5-30s power-ups)
- ✅ Ready system with host controls
- ✅ Seamless lobby-to-game-to-lobby flow
- ✅ Responsive UI working on desktop and mobile
- ✅ Automatic host transfer and cleanup
- ✅ Comprehensive test coverage

### 🎯 Current Focus
Implementing **Player vs Player combat mechanics** to enable players to eat each other when powered up, completing the core multiplayer experience.

---

✨ Features

- **Real time Multiplayer**: Player versus player client-server powered by a Node.js WebSocket server.
- **Authoritative Server Model**: The server runs the authoritative game engine, ensuring a fair and synchronized experience for all players.
- **Game Lobby**: A simple 4 player lobby system to gather players before starting a match.  Support for a single player or 2, 3, and 4 players
- **Player vs. Player Combat**: Eat a power pellet to turn the tables and gobble up not only ghosts but other players too!
- **Morphing Effects**: Player morphs through other players when power pellet is not active.
- **Spectator Mode**: Once you're out of the game, you can stick around and watch the rest of the match.
- **Last Man Standing**: The game ends when only one player remains and all pellets are eaten or last life is lost.
- **Adaptive Controls**: Play with keyboard ⌨️, gamepad 🎮, or intuitive touch controls 👆 for mobile devices.
- **Custom Sound Effects**: Retro-inspired web audio for chomping, power-ups, ghost eating, and more!

## Client/Server Architecture

This project uses a client-server model:

- **`server.js`**: A Node.js application that acts as the authoritative game server engine. It manages the game state, processes all game logic (movement, collisions, AI), synchronizes clients, and serves the game client.
- **`index.html`**: The frontend client that connects to the server. It is responsible for sending user input to the server and rendering the game state it receives.

This setup requires you to run the server application before you can play the game in your browser.

## Installation & How to Play

### Prerequisites

- [Node.js](https://nodejs.org/) (which includes npm) must be installed on your computer or hosted with a node server and domain name.
- modern mobile, tv or desktop web browser for clients to connect to the server

### Running the Game

1. **Download Files**: Save `index.html`, `server.js`, and `package.json` into a new folder on your computer.
1a. **Optional**: git pull <https://github.com/Code24x7-R/pacclone-multi>

2. **Open a Terminal**: Navigate your terminal or command prompt to the folder where you saved the files.

3. **Install Dependencies**: Run the following command to install the necessary WebSocket library for the server.

    ```bash
    npm install
    ```

4. **Start the Server**: Run this command to start the game server.

    ```bash
    node server.js
    ```

    You should see a message like `[SERVER] Listening on http://localhost:8080`. Leave this terminal window running.

5. **Play the Game**: Open your web browser and navigate to `http://localhost:8080`. The game will load into the lobby. Enter your name and join. To play with friends, have them open the same URL in their browsers on the same network.

## Controls

The game automatically detects your input method. Each browser window/tab can be controlled independently.

### Keyboard

- **Movement**: Arrow Keys (↑ ↓ ← →) or `WASD`

### Gamepad (Xbox/Standard Layout Recommended)

- **D-Pad or Left Analog Stick**: Move

### Touch Controls (Mobile/Tablet)

- **Virtual Joystick**: A joystick will appear on the screen for movement.

## Game Flow

1. **Lobby**: Join as Player 1, 2, 3, or 4. The game can be started by the host (Player 1) once at least one player has joined.
2. **Gameplay**: Control your Pacclone, eat pellets, eat power up pellets, chase and eat your opponents, and compete to be the last player with lives remaining or clear all pellets.
3. **Spectator Mode**: If you lose all your lives, you enter spectator mode in multiplayer games.
4. **Game Over**: The game ends when only one player remains, who is declared the winner, or all pellets are eaten by the players.
