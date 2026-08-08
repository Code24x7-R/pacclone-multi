# 👻 Pacclone Multi

A classic arcade-style game reminiscent of Pac-Man, built with HTML, CSS, and JavaScript, featuring a client-server architecture for multiplayer gameplay! Navigate the maze, eat all the pellets, avoid the ghosts, and compete to be the last one standing!

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

## Development

### Quick Commands

| Command | Description |
| :--- | :--- |
| `npm start` | Start the game server (production mode) |
| `npm run dev` | Start with auto-reload via nodemon |
| `npm test` | Run all Jest tests with coverage |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint server.js and tests/ |
| `npm run lint:fix` | Lint with auto-fix |
| `npm run verify` | Full pass: lint + test |

### Project Structure

```
server.js              # Express + WebSocket server, game loop, state management
index.html             # Canvas client: rendering, input (keyboard/gamepad/touch), audio
src/gameLogic.js       # Pure game logic (maze, collision, movement) — fully unit-tested
tests/
  server/              # Server-side game logic tests (Jest, node env)
  client/              # Client-side rendering & input tests (Jest, jsdom env)
  integration/         # WebSocket message flow tests
eslint.config.js       # ESLint configuration
Dockerfile             # Container image for deployment
.github/workflows/ci.yml  # CI pipeline (lint + test + Docker build)
```

### Testing

Tests live in `tests/` and use Jest. The pure game logic in `src/gameLogic.js` has 100% coverage. Run `npm test` to execute all suites with coverage reporting.

### Deployment

**Docker**:
```bash
docker build -t pacclone-multi .
docker run -p 8080:8080 pacclone-multi
```

**Platform**: Any Node.js 18+ host with WebSocket support (Railway, Render, Fly.io, or a VPS).

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
