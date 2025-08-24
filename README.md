# 👻 Pacclone Arcade

A classic arcade-style game reminiscent of Pac-Man, built with HTML, CSS, and JavaScript, now featuring a client-server architecture for true multiplayer gameplay! Navigate the maze, eat all the pellets, avoid the ghosts, and aim for the high score!

✨ Features
- **True Multiplayer**: Play with a friend in real-time, powered by a Node.js WebSocket server.
- **Client-Server Model**: The server runs the authoritative game simulation, ensuring a fair and synchronized experience for all players.
- **Classic Gameplay**: Familiar maze-chasing action with pellets and power-ups.
- **Intelligent Ghosts**: Each ghost (Blinky, Pinky, Inky, Clyde) has its own unique AI, including scatter and chase modes.
- **Power-ups**: Eat power pellets to turn the tables and gobble up frightened ghosts for bonus points!
- **Phase Dash Ability**: A unique dash mechanic to quickly move through obstacles or escape sticky situations.
- **High Score Tracking**: Persistent local high scores to challenge yourself and others.
- **Adaptive Controls**: Play with keyboard ⌨️, gamepad 🎮, or intuitive touch controls 👆 for mobile devices.
- **Custom Sound Effects**: Retro-inspired audio for chomping, power-ups, ghost eating, and more!
- **Adjustable Game Speed**: A slider to customize the game's pace to your liking.

## Client/Server Architecture

This project now uses a true client-server model:
-   **`server.js`**: A Node.js application that acts as the authoritative game server. It manages the game state, processes all game logic (movement, collisions, AI), and synchronizes clients.
-   **`index.html`**: The frontend client that connects to the server. It is responsible for sending user input to the server and rendering the game state it receives. It does not contain any game logic.

This setup requires you to run the server application locally before you can play the game in your browser.

## Installation & How to Play

### Prerequisites
-   [Node.js](https://nodejs.org/) (which includes npm) must be installed on your computer.

### Running the Game

1.  **Download Files**: Save `index.html`, `server.js`, and `package.json` into a new folder on your computer.

2.  **Open a Terminal**: Navigate your terminal or command prompt to the folder where you saved the files.

3.  **Install Dependencies**: Run the following command to install the necessary WebSocket library for the server.
    ```bash
    npm install
    ```

4.  **Start the Server**: Run this command to start the game server.
    ```bash
    npm start
    ```
    You should see a message like `[SERVER] WebSocket server started on ws://localhost:8080`. Leave this terminal window running.

5.  **Play the Game**: Open the `index.html` file in your web browser. The game will connect to your local server, and you can join the lobby and start playing. To play with a friend on the same computer, open `index.html` in a second browser tab or window.

## Controls

The game automatically detects your input method. Each browser window/tab can be controlled independently.

### Keyboard

-   **Player 1 (first to join):** Arrow Keys (↑ ↓ ← →) to move, `Spacebar` for Phase Dash.
-   **Player 2 (second to join):** `WASD` to move, `Shift` for Phase Dash.
-   **General**: `P` to Pause, `R` to Reset (returns to lobby), `M` to Mute.

### Gamepad (Xbox/Standard Layout Recommended)

-   **D-Pad or Left Analog Stick**: Move
-   **(A) Button**: Execute Phase Dash
-   **(Start) Button**: Pause/Unpause Game
-   **(B) Button**: Reset Game (returns to lobby)

### Touch Controls (Mobile/Tablet)

-   **Virtual D-Pad**: Move
-   **DASH Button**: Execute Phase Dash

## Game Flow

1.  **Lobby**: Join as Player 1 or Player 2. The game can be started once at least one player has joined.
2.  **Gameplay**: Control your Pacclone, eat pellets, and compete for the highest score.
3.  **Game Over**: The game ends when only one player remains.
4.  **High Score**: If the top-scoring player achieves a high score, they will be prompted to enter their initials.

👨‍💻 Technical Details

This project leverages:
-   **HTML5 Canvas**: For rendering the game on the frontend.
-   **CSS3**: For all UI styling and layout.
-   **JavaScript (ES6+)**: Powers the client-side rendering and input handling.
-   **Node.js**: The runtime for the backend server.
-   **`ws` library**: A popular and efficient WebSocket library for Node.js, used for real-time communication between the server and clients.
