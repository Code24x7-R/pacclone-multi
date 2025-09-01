// --- Constants ---
const TILE_SIZE = 30; // From server
const PACMAN_RADIUS = TILE_SIZE / 2 - 2;

// --- DOM Elements ---
const messageDiv = document.getElementById('message')!;
const messageTitle = document.getElementById('message-title')!;
const messageBody = document.getElementById('message-body')!;
const lobbyDiv = document.getElementById('lobby')!;
const gameContainer = document.getElementById('game-container')!;
const gameCanvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = gameCanvas.getContext('2d')!;
const playerScoresDiv = document.getElementById('player-scores')!;
const lobbyMessageDiv = document.getElementById('lobby-message')!;
const joinButtons = document.querySelectorAll('.join-btn');
const gameSpeedSlider = document.getElementById('game-speed-slider') as HTMLInputElement;
const spectateBtn = document.getElementById('spectate-btn')!;
const gameInfoDiv = document.getElementById('game-info')!;
const finalScoresDiv = document.getElementById('final-scores')!;

// Touch Controls
const touchControls = document.getElementById('touch-controls')!;
const dpadUp = document.getElementById('dpad-up')!;
const dpadDown = document.getElementById('dpad-down')!;
const dpadLeft = document.getElementById('dpad-left')!;
const dpadRight = document.getElementById('dpad-right')!;
const dashBtn = document.getElementById('dash-btn')!;

// --- State ---
let ws: WebSocket;
let clientId: string | null = null;
let gameState: any = null;
let animationFrameId: number | null = null;
let mouthAngle = 0;
let mouthAngleDirection = 1;
let lastInputTimestamp = 0;
const inputCooldown = 1000 / 15; // 15hz input rate
let audioContext: AudioContext | null = null;

const keys: { [key: string]: boolean } = {};
const touchState = {
    up: false,
    down: false,
    left: false,
    right: false,
    dash: false,
};

// --- WebSocket Logic ---
function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Connected to server');
        // The server will send a 'connected' message
    };

    ws.onmessage = (event) => {
        const { event: eventName, payload } = JSON.parse(event.data);
        switch (eventName) {
            case 'connected':
                handleConnected(payload);
                break;
            case 'lobbyStateUpdate':
                updateLobbyUI(payload);
                break;
            case 'gameStarted':
                handleGameStarted(payload);
                break;
            case 'gameStateUpdate':
                const oldGameState = gameState;
                gameState = payload;
                handleAudioCues(oldGameState, gameState);
                break;
            case 'gameInProgress':
                handleGameInProgress();
                break;
            case 'returnToLobby':
                handleReturnToLobby(payload);
                break;
        }
    };

    ws.onclose = () => {
        showMessage('Connection Lost', 'Disconnected from server. Please refresh the page to reconnect.');
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        lobbyDiv.style.display = 'none';
        gameContainer.style.display = 'none';
        gameInfoDiv.style.display = 'none';
        touchControls.style.display = 'none';
    };

    ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
        showMessage('Connection Error', 'Could not connect to the server.');
    };
}

function sendMessage(event: string, payload: any) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event, payload }));
    }
}

// --- Audio ---
function initAudio() {
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        } catch (e) {
            console.error("Web Audio API is not supported in this browser");
        }
    }
}

function playChompSound() {
    if (!audioContext) return;
    const now = audioContext.currentTime;
    const duration = 0.05; // 50ms

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // A square wave sounds more "chiptuney" and distinct than a sine wave.
    oscillator.type = 'square';

    // Add a slight, random pitch variation to make chomping less monotonous.
    const baseFreq = 300;
    oscillator.frequency.setValueAtTime(baseFreq + (Math.random() * 50 - 25), now);

    // A fast attack and decay envelope makes the sound "plucky" or "sucky".
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.1, now + 0.02); // Quick attack
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration); // Fast decay

    oscillator.start(now);
    oscillator.stop(now + duration);
}

function playMoveSound() {
    if (!audioContext) return;
    const now = audioContext.currentTime;
    const duration = 0.15; // 150ms

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Use a square wave for a softer, more subdued sound.
    oscillator.type = 'square';

    // Lower the frequency and reduce the random pitch variation.
    const baseFreq = 30;
    oscillator.frequency.setValueAtTime(baseFreq + (Math.random() * 20 - 10), now );

    // Reduce the gain (volume) significantly.
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.09, now + 0.02); // Slightly increased peak volume
    gainNode.gain.exponentialRampToValueAtTime(0.005, now + duration );

    oscillator.start(now);
    oscillator.stop(now + duration );
}


// --- Message Handlers ---
function handleConnected(payload: { clientId: string; lobbyState: any }) {
    clientId = payload.clientId;
    hideMessage();
    lobbyDiv.style.display = 'flex';
    gameContainer.style.display = 'none';
    gameInfoDiv.style.display = 'none';
    touchControls.style.display = 'none';
    updateLobbyUI(payload.lobbyState);
}

function handleGameStarted(payload: any) {
    gameState = payload;
    hideMessage();
    lobbyDiv.style.display = 'none';
    gameContainer.style.display = 'flex';
    gameInfoDiv.style.display = 'flex';
    gameCanvas.style.display = 'block';
    
    if ('ontouchstart' in window) {
        touchControls.style.display = 'flex';
    }

    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    gameLoop();
}

function handleGameInProgress() {
    showMessage('Game in Progress', 'A game is currently running.');
    spectateBtn.style.display = 'block';
}

function handleReturnToLobby(payload: any) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    gameState = null;
    
    hideMessage();
    gameContainer.style.display = 'none';
    gameInfoDiv.style.display = 'none';
    gameCanvas.style.display = 'none';
    touchControls.style.display = 'none';
    lobbyDiv.style.display = 'flex';
    
    updateLobbyUI(payload);
}

function handleAudioCues(oldState: any, newState: any) {
    if (!audioContext || !oldState || !newState) {
        return;
    }

    // Chomp sound - if any pellet was eaten
    if (newState.pelletsRemaining < oldState.pelletsRemaining) {
        playChompSound();
    }

    // Move sound for the client's player
    const myPlayer = newState.players.find((p: any) => p.clientId === clientId);
    if (myPlayer && myPlayer.isActive) {
        const oldPlayerState = oldState.players.find((p: any) => p.id === myPlayer.id);
        if (oldPlayerState) {
            // Check if player has moved to a new tile
            const oldTileX = Math.floor(oldPlayerState.x / TILE_SIZE);
            const oldTileY = Math.floor(oldPlayerState.y / TILE_SIZE);
            const newTileX = Math.floor(myPlayer.x / TILE_SIZE);
            const newTileY = Math.floor(myPlayer.y / TILE_SIZE);

            if (oldTileX !== newTileX || oldTileY !== newTileY) {
                playMoveSound();
            }
        }
    }
}


// --- UI Update ---
function showMessage(title: string, body: string, showScores = false) {
    messageDiv.style.display = 'flex';
    messageTitle.textContent = title;
    messageBody.innerHTML = body;
    spectateBtn.style.display = 'none';
    
    if (showScores && gameState && gameState.players) {
        finalScoresDiv.innerHTML = '<h2>Final Scores</h2>';
        const table = document.createElement('table');
        const playersSorted = [...gameState.players].sort((a,b) => b.score - a.score);
        playersSorted.forEach(p => {
             const row = table.insertRow();
             const nameCell = row.insertCell();
             const scoreCell = row.insertCell();
             nameCell.textContent = `Player ${p.id}`;
             nameCell.style.color = p.color;
             nameCell.classList.add('player-name');
             scoreCell.textContent = p.score;
        });
        finalScoresDiv.appendChild(table);
    } else {
        finalScoresDiv.innerHTML = '';
    }
}

function hideMessage() {
    messageDiv.style.display = 'none';
}

function updateLobbyUI(lobbyState: any) {
    lobbyState.slots.forEach((slot: any) => {
        const slotEl = document.getElementById(`slot-${slot.id}`)!;
        const statusEl = slotEl.querySelector('.status')!;
        const buttonEl = slotEl.querySelector('.join-btn') as HTMLButtonElement;

        if (slot.joined) {
            slotEl.classList.add('joined');
            statusEl.textContent = `Joined`;
            statusEl.classList.remove('waiting');
            buttonEl.disabled = true;
            buttonEl.textContent = 'Joined';
            if (slot.clientId === clientId) {
                statusEl.textContent = 'You';
                statusEl.classList.add('waiting');
            }
        } else {
            slotEl.classList.remove('joined');
            statusEl.textContent = 'Open';
            statusEl.classList.remove('waiting');
            buttonEl.disabled = false;
            buttonEl.textContent = 'Join';
        }
    });
    lobbyMessageDiv.textContent = lobbyState.message || '';
}

function updateHUD() {
    if (!gameState || !gameState.players) return;
    
    playerScoresDiv.innerHTML = '';
    const sortedPlayers = [...gameState.players].sort((a,b) => a.id - b.id);

    sortedPlayers.forEach((player: any) => {
        const playerHud = document.createElement('div');
        playerHud.classList.add('player-hud');
        playerHud.style.borderColor = player.color;
        playerHud.style.color = player.color;
        
        if (!player.isActive) {
            playerHud.classList.add('inactive');
        }

        let content = `
            <div>P${player.id} Score: ${player.score}</div>
            <div>Lives: ${player.lives}</div>
        `;
        
        if (player.isWinner) {
             content += `<div class="winner-text">🏆 WINNER 🏆</div>`;
        } else if (player.isSpectator) {
             content = `<div>P${player.id} (Spectator)</div><div>Score: ${player.score}</div>`;
        }

        playerHud.innerHTML = content;
        playerScoresDiv.appendChild(playerHud);
    });
}


// --- Rendering Logic ---
function gameLoop() {
    handleInput();
    draw();
    animationFrameId = requestAnimationFrame(gameLoop);
}

function draw() {
    if (!gameState || !ctx) return;
    
    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
    
    drawMap(gameState.map);
    
    gameState.ghosts.forEach((ghost: any) => drawGhost(ghost));
    gameState.players.forEach((player: any) => drawPlayer(player));
    
    updateHUD();

    if (gameState.isGameOver) {
        const winner = gameState.players.find((p: any) => p.isWinner);
        const title = winner ? `Player ${winner.id} Wins!` : "Game Over!";
        showMessage(title, 'Returning to lobby...', true);
    }
}

function drawMap(map: number[][]) {
    for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[y].length; x++) {
            const tile = map[y][x];
            const tileX = x * TILE_SIZE;
            const tileY = y * TILE_SIZE;

            if (tile === 1) { // Wall
                ctx.fillStyle = '#1919A6';
                ctx.fillRect(tileX, tileY, TILE_SIZE, TILE_SIZE);
            } else if (tile === 2) { // Pellet
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(tileX + TILE_SIZE / 2, tileY + TILE_SIZE / 2, 3, 0, Math.PI * 2);
                ctx.fill();
            } else if (tile === 3) { // Power Pellet
                ctx.fillStyle = '#FFB8AE';
                ctx.beginPath();
                ctx.arc(tileX + TILE_SIZE / 2, tileY + TILE_SIZE / 2, 8, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

function drawPlayer(player: any) {
    if (!player.isActive && !player.isSpectator) return;
    
    ctx.save();
    ctx.translate(player.x, player.y);
    
    // Spectator appearance
    if(player.isSpectator){
        ctx.fillStyle = 'rgba(200, 200, 200, 0.5)';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, PACMAN_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        return;
    }
    
    // Dashing visual effect
    if(player.isDashing) {
         ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
         ctx.beginPath();
         ctx.arc(0, 0, PACMAN_RADIUS * 1.2, 0, Math.PI * 2);
         ctx.fill();
    }
    
    // Invulnerability visual effect
    if (player.invulnerabilityTimer > 0) {
        const blink = Math.floor(player.invulnerabilityTimer / 100) % 2 === 0;
        ctx.globalAlpha = blink ? 0.5 : 1.0;
    }
    
    // Determine rotation based on direction
    if (player.dx > 0) ctx.rotate(0);
    else if (player.dx < 0) ctx.rotate(Math.PI);
    else if (player.dy > 0) ctx.rotate(Math.PI / 2);
    else if (player.dy < 0) ctx.rotate(-Math.PI / 2);

    // Mouth animation
    const baseMouthAngle = 0.35;
    mouthAngle += 0.05 * mouthAngleDirection;
    if (mouthAngle > baseMouthAngle || mouthAngle < 0) {
        mouthAngleDirection *= -1;
    }
    const currentMouthAngle = (player.dx === 0 && player.dy === 0) ? baseMouthAngle / 2 : mouthAngle;
    
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(0, 0, PACMAN_RADIUS, currentMouthAngle, Math.PI * 2 - currentMouthAngle);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    
    ctx.restore();
}

function drawGhost(ghost: any) {
    const radius = TILE_SIZE / 2.5;
    ctx.save();
    ctx.translate(ghost.x, ghost.y);

    // Frightened or Eaten style
    if (ghost.eaten) {
        // Just draw eyes returning to base
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-radius/3, 0, radius/4, 0, Math.PI * 2);
        ctx.arc(radius/3, 0, radius/4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    } else if (ghost.frightened) {
        const isEnding = gameState.ghostFrightenedTimer < 3000 && Math.floor(gameState.ghostFrightenedTimer / 250) % 2 === 0;
        ctx.fillStyle = isEnding ? '#fff' : '#0033ff';
    } else {
        ctx.fillStyle = ghost.color;
    }

    // Body
    ctx.beginPath();
    ctx.arc(0, -radius/4, radius, Math.PI, 0);
    ctx.lineTo(radius, radius);
    // Wavy bottom
    for (let i = 0; i < 5; i++) {
        ctx.lineTo(radius - (radius * 2 / 5) * (i + 0.5), radius - (i % 2 === 0 ? 5 : 0));
    }
    ctx.lineTo(-radius, radius);
    ctx.closePath();
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-radius/2.5, -radius/2, radius/3, 0, Math.PI * 2);
    ctx.arc(radius/2.5, -radius/2, radius/3, 0, Math.PI * 2);
    ctx.fill();

    // Pupils
    ctx.fillStyle = '#000';
    let pupilX = 0, pupilY = 0;
    if (ghost.dx > 0) pupilX = 2;
    if (ghost.dx < 0) pupilX = -2;
    if (ghost.dy > 0) pupilY = 2;
    if (ghost.dy < 0) pupilY = -2;
    ctx.beginPath();
    ctx.arc(-radius/2.5 + pupilX, -radius/2 + pupilY, radius/6, 0, Math.PI * 2);
    ctx.arc(radius/2.5 + pupilX, -radius/2 + pupilY, radius/6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}


// --- Input Handling ---
function setupEventListeners() {
    window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
    window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

    joinButtons.forEach(button => {
        button.addEventListener('click', () => {
            initAudio(); // Create audio context on user interaction
            const slotId = parseInt((button.parentElement as HTMLElement).dataset.slotId!);
            sendMessage('joinLobby', { slotId });
        });
    });

    gameSpeedSlider.addEventListener('input', () => {
        sendMessage('setGameSpeed', { speed: parseFloat(gameSpeedSlider.value) });
    });
    
    spectateBtn.addEventListener('click', () => {
        sendMessage('requestSpectate', {});
    });

    // Touch controls
    const handleTouch = (el: HTMLElement, stateProp: keyof typeof touchState, isActive: boolean) => {
        el.classList.toggle('active', isActive);
        touchState[stateProp] = isActive;
    };

    dpadUp.addEventListener('touchstart', (e) => { e.preventDefault(); handleTouch(dpadUp, 'up', true); }, { passive: false });
    dpadDown.addEventListener('touchstart', (e) => { e.preventDefault(); handleTouch(dpadDown, 'down', true); }, { passive: false });
    dpadLeft.addEventListener('touchstart', (e) => { e.preventDefault(); handleTouch(dpadLeft, 'left', true); }, { passive: false });
    dpadRight.addEventListener('touchstart', (e) => { e.preventDefault(); handleTouch(dpadRight, 'right', true); }, { passive: false });
    dashBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handleTouch(dashBtn, 'dash', true); }, { passive: false });

    dpadUp.addEventListener('touchend', () => handleTouch(dpadUp, 'up', false));
    dpadDown.addEventListener('touchend', () => handleTouch(dpadDown, 'down', false));
    dpadLeft.addEventListener('touchend', () => handleTouch(dpadLeft, 'left', false));
    dpadRight.addEventListener('touchend', () => handleTouch(dpadRight, 'right', false));
    dashBtn.addEventListener('touchend', () => handleTouch(dashBtn, 'dash', false));
}

function handleInput() {
    const now = performance.now();
    if (now - lastInputTimestamp < inputCooldown) return;
    lastInputTimestamp = now;
    
    let direction = { dx: 0, dy: 0 };
    let dash = false;
    
    // Keyboard
    if (keys['arrowup'] || keys['w']) direction = { dx: 0, dy: -1 };
    else if (keys['arrowdown'] || keys['s']) direction = { dx: 0, dy: 1 };
    else if (keys['arrowleft'] || keys['a']) direction = { dx: -1, dy: 0 };
    else if (keys['arrowright'] || keys['d']) direction = { dx: 1, dy: 0 };
    if (keys[' '] || keys['shift']) dash = true;

    // Touch
    if (touchState.up) direction = { dx: 0, dy: -1 };
    else if (touchState.down) direction = { dx: 0, dy: 1 };
    else if (touchState.left) direction = { dx: -1, dy: 0 };
    else if (touchState.right) direction = { dx: 1, dy: 0 };
    if (touchState.dash) {
        dash = true;
        // Reset touch state for dash to prevent holding it down
        touchState.dash = false; 
        dashBtn.classList.remove('active');
    }
    
    // Gamepad
    const gamepads = navigator.getGamepads().filter(g => g);
    if (gamepads.length > 0) {
        const gp = gamepads[0]!;
        const deadzone = 0.4;
        if (gp.axes[1] < -deadzone || gp.buttons[12]?.pressed) direction = { dx: 0, dy: -1 };
        else if (gp.axes[1] > deadzone || gp.buttons[13]?.pressed) direction = { dx: 0, dy: 1 };
        else if (gp.axes[0] < -deadzone || gp.buttons[14]?.pressed) direction = { dx: -1, dy: 0 };
        else if (gp.axes[0] > deadzone || gp.buttons[15]?.pressed) direction = { dx: 1, dy: 0 };
        if (gp.buttons[0]?.pressed) dash = true; // 'A' button
    }
    
    // Send input to server
    if (direction.dx !== 0 || direction.dy !== 0) {
        sendMessage('playerInput', { action: 'move', direction });
    }
    if (dash) {
        sendMessage('playerInput', { action: 'dash' });
    }
}

// --- Initializer ---
document.addEventListener('DOMContentLoaded', () => {
    showMessage('Connecting...', 'Attempting to connect to the game server.');
    connect();
    setupEventListeners();
});