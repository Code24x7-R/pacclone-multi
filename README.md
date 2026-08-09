# 👻 Pacclone Multi

A classic arcade-style game reminiscent of Pac-Man, built with HTML, CSS, and JavaScript, featuring a client-server architecture for multiplayer gameplay! Navigate the maze, eat all the pellets, avoid the ghosts, and compete to be the last one standing!

✨ Features

- **Single Player**: Play solo against the ghosts. Clear all pellets to advance levels; the game ends when you run out of lives. No lobby wait — jump straight into the action.
- **Real time Multiplayer**: Player versus player client-server powered by a Node.js WebSocket server (2–4 players).
- **Authoritative Server Model**: The server runs the authoritative game engine, ensuring a fair and synchronized experience for all players.
- **Game Lobby**: A 4-player lobby with ready-up, host-start, and a 3-2-1 countdown. Warm rejoin lets a disconnected player reclaim their slot.
- **Player vs. Player Combat**: Eat a power pellet to turn the tables and gobble up not only ghosts but other players too!
- **Dash**: Hold Shift (or gamepad R1 / double-tap on touch) to burst forward on a cooldown.
- **Spectator Mode**: Once you're out of lives in a multiplayer match, stick around and watch the rest of the game.
- **Last Man Standing**: In multiplayer, the match ends when only one player remains or all pellets are eaten.
- **Level Progression**: Clear every pellet to advance to a new, procedurally generated maze with scaling difficulty.
- **High Scores**: Best scores are saved locally in your browser.
- **Adaptive Controls**: Play with keyboard ⌨️, gamepad 🎮, or intuitive touch controls 👆 for mobile devices.
- **Custom Sound Effects**: Retro-inspired web audio for chomping, power-ups, ghost eating, and more. Mute button in the lobby.
- **About Dialog**: Help/About modal (click "About" in the lobby) with features, controls, and tech stack.

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
- **Dash**: Hold `Shift` to burst forward (3s cooldown)
- **Leave Game**: Press `Escape` to return to the lobby

### Gamepad (Xbox/Standard Layout Recommended)

- **D-Pad or Left Analog Stick**: Move
- **Dash**: Hold `R1` (right shoulder button)

### Touch Controls (Mobile/Tablet)

- **Virtual Joystick**: A joystick appears on the screen for movement
- **Dash**: Double-tap to burst forward

### Lobby

- **About**: Click the "About" button for game info, controls, and tech stack

## Game Flow

### Single Player

1. **Join the Lobby**: Enter your name and click "Join".
2. **Start**: Click "Single Player" to jump straight into a solo match — no ready-up or countdown.
3. **Gameplay**: Eat all the pellets to advance to the next level. Lose all your lives and the game is over. Your high scores are saved locally.

### Multiplayer

1. **Lobby**: Join as Player 1, 2, 3, or 4. Everyone readies up, then the host starts the match (3-2-1 countdown).
2. **Gameplay**: Control your Pacclone, eat pellets, grab power pellets, and chase your opponents. Compete to be the last player standing or clear all the pellets.
3. **Spectator Mode**: If you lose all your lives, you can stick around and watch the rest of the match.
4. **Game Over**: The last player standing wins. The group stays together in the lobby for a rematch.
5. **Leave Anytime**: Press `Escape` to return to the lobby mid-match.
