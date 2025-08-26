// --- CONSTANTS (mirrored from server) ---
const TILE_SIZE = 30;
const MAP_WIDTH = 20;
const MAP_HEIGHT = 20;

// --- DOM ELEMENT REFERENCES ---
let canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D;
let gameContainer: HTMLElement, gameInfo: HTMLElement, playerScores: HTMLElement;
let message: HTMLElement, messageTitle: HTMLElement, messageBody: HTMLElement, spectateBtn: HTMLButtonElement;
let lobby: HTMLElement, lobbyMessage: HTMLElement, gameSpeedSlider: HTMLInputElement;
let touchControls: HTMLElement;

// --- GAME STATE ---
let ws: WebSocket;
let clientId: string | null = null;
let gameState: any = null;
let lastGameState: any = null; // For state-change detection (sounds, animations)
let lobbyState: any = null;
let animationFrameId: number;

// --- INPUT STATE ---
const keys: { [key: string]: boolean } = {};
let activeGamepad: Gamepad | null = null;
let lastMove = { dx: 0, dy: 0 };


// --- AUDIO MANAGER ---
class AudioManager {
    private audioCtx: AudioContext | null = null;
    private sounds: { [key: string]: AudioBuffer } = {};
    private isInitialized = false;

    constructor() {
        // Audio must be initialized after a user interaction.
        document.body.addEventListener('click', () => this.init(), { once: true });
        document.body.addEventListener('keydown', () => this.init(), { once: true });
    }

    init() {
        if (this.isInitialized) return;
        try {
            this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.isInitialized = true;
            console.log("Audio context initialized.");
            // Create some placeholder sounds since we don't have files
            this.createPlaceholderSounds();
        } catch (e) {
            console.error("Web Audio API is not supported in this browser.", e);
        }
    }
    
    isReady() {
        return this.isInitialized && this.audioCtx;
    }

    createPlaceholderSounds() {
        if (!this.audioCtx) return;
        // Dash sound
        this.sounds['dash'] = this.createSynthSound(0.1, 'sawtooth', 800, 200);
        // Pellet sound
        this.sounds['eat_pellet'] = this.createSynthSound(0.05, 'square', 440, 440);
         // Death sound
        this.sounds['death'] = this.createSynthSound(0.5, 'sawtooth', 400, 50, 0.2);
    }
    
    // Helper to generate simple synth sounds
    createSynthSound(duration: number, type: OscillatorType, startFreq: number, endFreq: number, gain = 0.1): AudioBuffer {
        if (!this.audioCtx) throw new Error("Audio context not initialized");
        const buffer = this.audioCtx.createBuffer(1, this.audioCtx.sampleRate * duration, this.audioCtx.sampleRate);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < channel.length; i++) {
            const progress = i / channel.length;
            const freq = startFreq + (endFreq - startFreq) * progress;
            channel[i] = Math.sin(2 * Math.PI * freq * (i / this.audioCtx.sampleRate)) * (1 - progress) * gain;
        }
        return buffer;
    }


    playSound(name: string) {
        if (!this.isReady() || !this.sounds[name]) return;
        const source = this.audioCtx!.createBufferSource();
        source.buffer = this.sounds[name];
        source.connect(this.audioCtx!.destination);
        source.start(0);
    }
}
const audioManager = new AudioManager();


// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
    // Query DOM elements
    canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    ctx = canvas.getContext('2d')!;
    gameContainer = document.getElementById('game-container')!;
    gameInfo = document.getElementById('game-info')!;
    playerScores = document.getElementById('player-scores')!;
    message = document.getElementById('message')!;
    messageTitle = document.getElementById('message-title')!;
    messageBody = document.getElementById('message-body')!;
    spectateBtn = document.getElementById('spectate-btn') as HTMLButtonElement;
    lobby = document.getElementById('lobby')!;
    lobbyMessage = document.getElementById('lobby-message')!;
    gameSpeedSlider = document.getElementById('game-speed-slider') as HTMLInputElement;
    touchControls = document.getElementById('touch-controls') as HTMLElement;


    // Setup event listeners
    document.querySelectorAll('.join-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // FIX: Cast the result of `.closest()` to `HTMLElement` to make the `dataset` property available. The default return type `Element` does not have it.
            const slotId = (e.target as HTMLElement).closest<HTMLElement>('.slot')?.dataset.slotId;
            if (slotId) {
                sendMessage('joinLobby', { slotId: parseInt(slotId) });
            }
        });
    });

    gameSpeedSlider.addEventListener('input', (e) => {
        sendMessage('setGameSpeed', { speed: parseFloat((e.target as HTMLInputElement).value) });
    });
    
    spectateBtn.addEventListener('click', () => {
        sendMessage('requestSpectate', {});
        spectateBtn.style.display = 'none';
        messageBody.textContent = 'Waiting for game data...';
    });

    setupInputListeners();
    connect();
});


// --- WEBSOCKET COMMUNICATION ---
function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    ws = new WebSocket(`${protocol}//${host}`);

    ws.onopen = () => {
        console.log('Connected to server.');
        message.style.display = 'none';
        lobby.style.display = 'flex';
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
    };

    ws.onclose = () => {
        console.log('Disconnected from server.');
        showMessage('Disconnected', 'Connection to the server was lost. Please refresh the page to reconnect.');
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };

    ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
        showMessage('Connection Error', 'Could not connect to the game server.');
    };
}

function handleServerMessage({ event, payload }: { event: string, payload: any }) {
    switch (event) {
        case 'connected':
            clientId = payload.clientId;
            lobbyState = payload.lobbyState;
            updateLobbyUI();
            break;
        case 'lobbyStateUpdate':
            lobbyState = payload;
            updateLobbyUI();
            break;
        case 'gameInProgress':
            showMessage('Game in Progress', 'A game is currently running.');
            spectateBtn.style.display = 'block';
            break;
        case 'gameStarted':
            lastGameState = null;
            gameState = payload;
            hideLobbyShowGame();
            gameLoop();
            break;
        case 'gameStateUpdate':
            lastGameState = gameState;
            gameState = payload;
            handleSoundEffects();
            break;
        case 'returnToLobby':
            lobbyState = payload;
            gameState = null;
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            hideGameShowLobby();
            updateLobbyUI();
            break;
    }
}

function sendMessage(event: string, payload: object) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event, payload }));
    }
}

// --- SOUND EFFECT LOGIC ---
function handleSoundEffects() {
    if (!gameState || !lastGameState || !audioManager.isReady()) return;

    // --- Dash Sound Fix ---
    // Use a flag to ensure the sound plays if ANY player starts dashing in a tick.
    // The old (buggy) way might have stored a single dashing player's ID, which
    // would be overwritten if multiple players dashed, causing only one sound.
    let playDashSound = false;
    gameState.players.forEach((player: any) => {
        const oldPlayer = lastGameState.players.find((p: any) => p.id === player.id);
        if (player.isDashing && (!oldPlayer || !oldPlayer.isDashing)) {
            playDashSound = true;
        }
    });
    if (playDashSound) {
        audioManager.playSound('dash');
    }
    
    // --- Pellet Eating ---
    if (gameState.pelletsRemaining < lastGameState.pelletsRemaining) {
        audioManager.playSound('eat_pellet');
    }
    
    // --- Player Death ---
    gameState.players.forEach((player: any) => {
        const oldPlayer = lastGameState.players.find((p: any) => p.id === player.id);
        if (oldPlayer && player.lives < oldPlayer.lives) {
             audioManager.playSound('death');
        }
    });
}


// --- GAME LOOP & RENDERING ---
function gameLoop() {
    processInput();
    if (gameState) {
        renderGame();
    }
    animationFrameId = requestAnimationFrame(gameLoop);
}

function renderGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMap();
    gameState.players.forEach(drawPlayer);
    gameState.ghosts.forEach(drawGhost);
    updateGameUI();
}

function drawMap() {
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const tile = gameState.map[y][x];
            if (tile === 1) { // Wall
                ctx.fillStyle = '#0000ff';
                ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            } else if (tile === 2) { // Pellet
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, 2, 0, Math.PI * 2);
                ctx.fill();
            } else if (tile === 3) { // Power Pellet
                ctx.fillStyle = '#ffb8ae';
                ctx.beginPath();
                ctx.arc(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, 6, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

function drawPlayer(player: any) {
    if (!player.isActive && !player.isSpectator) return;
    
    ctx.save();
    
    if(player.isSpectator) {
      ctx.globalAlpha = 0.5;
    } else if (player.invulnerabilityTimer > 0) {
       // Flashing effect when invulnerable
       ctx.globalAlpha = (Math.floor(Date.now() / 100) % 2 === 0) ? 0.5 : 1.0;
    }
    
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(player.x, player.y, TILE_SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
}

function drawGhost(ghost: any) {
    const radius = TILE_SIZE / 2 - 3;
    ctx.fillStyle = ghost.frightened ? '#0000ff' : ghost.color;
    if (ghost.eaten) ctx.fillStyle = '#fff'; // Just eyes
    
    ctx.beginPath();
    ctx.arc(ghost.x, ghost.y, radius, Math.PI, 0);
    ctx.lineTo(ghost.x + radius, ghost.y + radius);
    ctx.lineTo(ghost.x + radius * 0.5, ghost.y + radius * 0.5);
    ctx.lineTo(ghost.x, ghost.y + radius);
    ctx.lineTo(ghost.x - radius * 0.5, ghost.y + radius * 0.5);
    ctx.lineTo(ghost.x - radius, ghost.y + radius);
    ctx.closePath();
    ctx.fill();

    // Eyes
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(ghost.x - radius / 2.5, ghost.y - radius / 3, 2, 0, Math.PI * 2);
    ctx.arc(ghost.x + radius / 2.5, ghost.y - radius / 3, 2, 0, Math.PI * 2);
    ctx.fill();
}


// --- INPUT HANDLING ---
function setupInputListeners() {
    // Keyboard
    window.addEventListener('keydown', e => { keys[e.key] = true; });
    window.addEventListener('keyup', e => { keys[e.key] = false; });
    
    // Gamepad
    window.addEventListener("gamepadconnected", (e) => {
        console.log("Gamepad connected:", e.gamepad.id);
        activeGamepad = e.gamepad;
    });
     window.addEventListener("gamepaddisconnected", (e) => {
        console.log("Gamepad disconnected:", e.gamepad.id);
        activeGamepad = null;
    });
    
    // Touch
    if ('ontouchstart' in window) {
        touchControls.style.display = 'flex';
        const dpadMap: { [key: string]: { dx: number, dy: number } } = {
            'dpad-up': { dx: 0, dy: -1 }, 'dpad-down': { dx: 0, dy: 1 },
            'dpad-left': { dx: -1, dy: 0 }, 'dpad-right': { dx: 1, dy: 0 }
        };
        for (const id in dpadMap) {
            const el = document.getElementById(id)!;
            el.addEventListener('touchstart', (e) => {
                e.preventDefault();
                sendMessage('playerInput', { action: 'move', direction: dpadMap[id] });
                el.classList.add('active');
            }, { passive: false });
             el.addEventListener('touchend', (e) => {
                e.preventDefault();
                sendMessage('playerInput', { action: 'move', direction: {dx: 0, dy: 0} });
                el.classList.remove('active');
            });
        }
        const dashBtn = document.getElementById('dash-btn')!;
        dashBtn.addEventListener('touchstart', e => {
            e.preventDefault();
            sendMessage('playerInput', { action: 'dash' });
            dashBtn.classList.add('active');
        }, { passive: false });
        dashBtn.addEventListener('touchend', e => {
             e.preventDefault();
             dashBtn.classList.remove('active');
        });
    }
}

function processInput() {
    let dx = 0, dy = 0;
    
    // Keyboard
    if (keys['w'] || keys['ArrowUp']) dy = -1;
    else if (keys['s'] || keys['ArrowDown']) dy = 1;
    else if (keys['a'] || keys['ArrowLeft']) dx = -1;
    else if (keys['d'] || keys['ArrowRight']) dx = 1;

    // Gamepad
    if (activeGamepad) {
        const gp = navigator.getGamepads()[activeGamepad.index];
        if(gp) {
            const axes = gp.axes;
            if (axes[1] < -0.5) dy = -1;
            else if (axes[1] > 0.5) dy = 1;
            if (axes[0] < -0.5) dx = -1;
            else if (axes[0] > 0.5) dx = 1;

            if (gp.buttons[0].pressed) {
                 sendMessage('playerInput', { action: 'dash' });
            }
        }
    }
    
    if (keys[' '] || keys['Shift']) {
        sendMessage('playerInput', { action: 'dash' });
    }

    if (dx !== lastMove.dx || dy !== lastMove.dy) {
        sendMessage('playerInput', { action: 'move', direction: { dx, dy } });
        lastMove = { dx, dy };
    }
}


// --- UI MANAGEMENT ---
function showMessage(title: string, body: string) {
    lobby.style.display = 'none';
    gameContainer.style.display = 'none';
    messageTitle.textContent = title;
    messageBody.textContent = body;
    message.style.display = 'flex';
}

function hideLobbyShowGame() {
    lobby.style.display = 'none';
    message.style.display = 'none';
    gameInfo.style.display = 'flex';
    gameContainer.style.display = 'flex';
    canvas.style.display = 'block';
}

function hideGameShowLobby() {
    gameInfo.style.display = 'none';
    gameContainer.style.display = 'none';
    canvas.style.display = 'none';
    message.style.display = 'none';
    lobby.style.display = 'flex';
}

function updateLobbyUI() {
    lobbyState.slots.forEach((slot: any) => {
        const slotEl = document.getElementById(`slot-${slot.id}`)!;
        const statusEl = slotEl.querySelector('.status')!;
        const btnEl = slotEl.querySelector('.join-btn')! as HTMLButtonElement;

        if (slot.joined) {
            slotEl.classList.add('joined');
            statusEl.textContent = `Joined`;
            statusEl.classList.add('waiting');
            btnEl.disabled = true;
            btnEl.style.display = 'none';
        } else {
            slotEl.classList.remove('joined');
            statusEl.textContent = 'Open';
            statusEl.classList.remove('waiting');
            btnEl.disabled = false;
            btnEl.style.display = 'block';
        }
    });
    lobbyMessage.textContent = lobbyState.message || '';
}

function updateGameUI() {
    if (!gameState) return;
    
    playerScores.innerHTML = ''; // Clear previous scores
    gameState.players.forEach((player: any) => {
        const hud = document.createElement('div');
        hud.className = 'player-hud';
        hud.style.borderColor = player.color;
        hud.style.color = player.color;

        if (!player.isActive && !player.isSpectator) {
            hud.classList.add('inactive');
        }

        let content = `<div>P${player.id}: ${player.score}</div>`;
        if(!player.isSpectator) {
           content += `<div>Lives: ${player.lives}</div>`;
        } else {
           content += `<div>(Spectator)</div>`;
        }
        
        if (player.isWinner) {
           content += `<div class="winner-text">WINNER!</div>`;
        }

        hud.innerHTML = content;
        playerScores.appendChild(hud);
    });
    
    if (gameState.isGameOver && !message.style.display) {
        showMessage('Game Over', 'Returning to lobby...');
    }
}