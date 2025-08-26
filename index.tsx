// --- CONSTANTS ---
const TILE_SIZE = 30;
const MAP_WIDTH = 20;
const MAP_HEIGHT = 20;

// --- DOM ELEMENTS ---
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const lobbyEl = document.getElementById('lobby')!;
const messageEl = document.getElementById('message')!;
const messageTitleEl = document.getElementById('message-title')!;
const messageBodyEl = document.getElementById('message-body')!;
const lobbySlotsEl = document.querySelector('.lobby-slots')!;
const gameContainerEl = document.getElementById('game-container')!;
const gameInfoEl = document.getElementById('game-info')!;
const touchControlsEl = document.getElementById('touch-controls')!;
const playerScoresEl = document.getElementById('player-scores')!;
const finalScoresEl = document.getElementById('final-scores')!;
const spectateBtn = document.getElementById('spectate-btn') as HTMLButtonElement;
const gameSpeedSlider = document.getElementById('game-speed-slider') as HTMLInputElement;


// --- GAME STATE ---
let ws: WebSocket;
let clientId: string | null = null;
let gameState: any | null = null;
let lastFrameTime = 0;
let playerDeathAnimations: any[] = [];
let inputState = { up: false, down: false, left: false, right: false, dash: false };

// --- INITIALIZATION ---
function init() {
    showMessage('Connecting...', 'Attempting to connect to the game server.');
    setupWebSocket();
    setupEventListeners();
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    requestAnimationFrame(render);
}

function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Connected to server');
    };

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleServerMessage(message.event, message.payload);
    };

    ws.onclose = () => {
        showMessage('Disconnected', 'Lost connection to the server. Please refresh the page to reconnect.', true);
        gameState = null;
    };

    ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
        showMessage('Connection Error', 'Could not connect to the server. Make sure it is running and refresh the page.', true);
    };
}

function handleServerMessage(event: string, payload: any) {
    switch (event) {
        case 'connected':
            clientId = payload.clientId;
            updateLobby(payload.lobbyState);
            hideMessage();
            showLobby();
            break;
        case 'lobbyStateUpdate':
            updateLobby(payload);
            break;
        case 'gameStarted':
            gameState = payload;
            hideLobby();
            hideMessage();
            showGame();
            break;
        case 'gameStateUpdate':
            if (gameState && gameState.players) {
                payload.players.forEach((newPlayerState: any) => {
                    const oldPlayerState = gameState.players.find((p: any) => p.id === newPlayerState.id);
                    if (oldPlayerState && newPlayerState.lives < oldPlayerState.lives) {
                        if (!playerDeathAnimations.some(anim => anim.playerId === oldPlayerState.id)) {
                            triggerDeathAnimation(oldPlayerState);
                        }
                    }
                });
            }
            gameState = payload;
            break;
        case 'gameInProgress':
            showMessage('Game in Progress', 'A game is currently running.');
            spectateBtn.style.display = 'block';
            break;
        case 'returnToLobby':
            gameState = null;
            hideGame();
            hideMessage();
            showLobby();
            updateLobby(payload);
            break;
    }
}

// --- UI MANAGEMENT ---
function showMessage(title: string, body: string, isError: boolean = false) {
    messageTitleEl.textContent = title;
    messageBodyEl.innerHTML = body;
    messageTitleEl.style.color = isError ? '#ff4444' : 'yellow';
    messageEl.style.display = 'flex';
    finalScoresEl.innerHTML = '';
}

function hideMessage() {
    messageEl.style.display = 'none';
}

function showLobby() {
    lobbyEl.style.display = 'flex';
}

function hideLobby() {
    lobbyEl.style.display = 'none';
}

function showGame() {
    gameContainerEl.style.display = 'flex';
    gameInfoEl.style.display = 'flex';
    canvas.style.display = 'block';
    if ('ontouchstart' in window) {
        touchControlsEl.style.display = 'flex';
    }
}

function hideGame() {
    gameContainerEl.style.display = 'none';
    gameInfoEl.style.display = 'none';
    canvas.style.display = 'none';
    touchControlsEl.style.display = 'none';
}

function updateLobby(lobbyState: any) {
    lobbyState.slots.forEach((slot: any) => {
        const slotEl = document.getElementById(`slot-${slot.id}`)!;
        const statusEl = slotEl.querySelector('.status')!;
        const joinBtn = slotEl.querySelector('.join-btn') as HTMLButtonElement;

        if (slot.joined) {
            slotEl.classList.add('joined');
            statusEl.textContent = 'Joined';
            statusEl.classList.add('waiting');
            joinBtn.style.display = 'none';
        } else {
            slotEl.classList.remove('joined');
            statusEl.textContent = 'Open';
            statusEl.classList.remove('waiting');
            joinBtn.style.display = 'block';
        }
    });
}

function resizeCanvas() {
    const size = Math.min(window.innerWidth * 0.9, window.innerHeight * 0.9, 600);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
    lobbySlotsEl.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('join-btn')) {
            const slotEl = target.closest('.slot') as HTMLElement;
            const slotId = parseInt(slotEl.dataset.slotId!, 10);
            ws.send(JSON.stringify({ event: 'joinLobby', payload: { slotId } }));
            // Disable all join buttons after clicking one
            document.querySelectorAll('.join-btn').forEach(btn => (btn as HTMLButtonElement).disabled = true);
        }
    });
    
    spectateBtn.addEventListener('click', () => {
        ws.send(JSON.stringify({ event: 'requestSpectate' }));
        spectateBtn.style.display = 'none';
    });

    gameSpeedSlider.addEventListener('input', (e) => {
         ws.send(JSON.stringify({ event: 'setGameSpeed', payload: { speed: parseFloat(gameSpeedSlider.value) } }));
    });
    
    // Keyboard input
    document.addEventListener('keydown', e => handleKey(e.key, true));
    document.addEventListener('keyup', e => handleKey(e.key, false));
    
    // Touch input
    const dpadButtons = {
        'dpad-up': { up: true }, 'dpad-down': { down: true },
        'dpad-left': { left: true }, 'dpad-right': { right: true }
    };
    for (const [id, state] of Object.entries(dpadButtons)) {
        const btn = document.getElementById(id)!;
        const updateState = (isActive: boolean) => () => {
            Object.assign(inputState, { up: false, down: false, left: false, right: false });
            if (isActive) Object.assign(inputState, state);
        };
        btn.addEventListener('touchstart', updateState(true), { passive: true });
        btn.addEventListener('touchend', updateState(false), { passive: true });
        btn.addEventListener('touchcancel', updateState(false), { passive: true });
    }
    const dashBtn = document.getElementById('dash-btn')!;
    dashBtn.addEventListener('touchstart', () => inputState.dash = true, { passive: true });
    dashBtn.addEventListener('touchend', () => inputState.dash = false, { passive: true });
}

function handleKey(key: string, isDown: boolean) {
    switch (key.toLowerCase()) {
        case 'arrowup': case 'w': inputState.up = isDown; break;
        case 'arrowdown': case 's': inputState.down = isDown; break;
        case 'arrowleft': case 'a': inputState.left = isDown; break;
        case 'arrowright': case 'd': inputState.right = isDown; break;
        case ' ': case 'shift': inputState.dash = isDown; break;
    }
}

function sendInput() {
    if (!gameState || !gameState.gameRunning) return;

    let direction = { dx: 0, dy: 0 };
    if (inputState.up) direction.dy = -1;
    else if (inputState.down) direction.dy = 1;
    else if (inputState.left) direction.dx = -1;
    else if (inputState.right) direction.dx = 1;
    
    ws.send(JSON.stringify({ event: 'playerInput', payload: { action: 'move', direction } }));

    if (inputState.dash) {
        ws.send(JSON.stringify({ event: 'playerInput', payload: { action: 'dash' } }));
        inputState.dash = false; // Dash is a single press
    }
}

// --- ANIMATION & RENDERING ---
function triggerDeathAnimation(player: any) {
    const animation = {
        playerId: player.id,
        x: player.x,
        y: player.y,
        startTime: performance.now(),
        duration: 1200,
        particles: [] as any[],
    };

    for (let i = 0; i < 50; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3 + 1;
        animation.particles.push({
            x: player.x,
            y: player.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            alpha: 1,
            size: Math.random() * 3 + 1,
        });
    }
    playerDeathAnimations.push(animation);
}

function drawDeathAnimation(animation: any, now: number) {
    const elapsed = now - animation.startTime;
    let progress = Math.min(elapsed / animation.duration, 1);

    // Update and draw particles
    animation.particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.02;
        if (p.alpha > 0) {
            ctx.fillStyle = 'yellow';
            ctx.globalAlpha = p.alpha;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
    });
    ctx.globalAlpha = 1;

    // Draw Pac-Man animation
    const radius = TILE_SIZE / 2;
    if (progress < 0.5) { // Mouth closing
        const mouthProgress = progress * 2;
        const angle = 0.2 * (1 - mouthProgress);
        ctx.fillStyle = 'yellow';
        ctx.beginPath();
        ctx.arc(animation.x, animation.y, radius, angle * Math.PI, (2 - angle) * Math.PI);
        ctx.lineTo(animation.x, animation.y);
        ctx.closePath();
        ctx.fill();
    } else { // Shrinking
        const shrinkProgress = (progress - 0.5) * 2;
        const currentRadius = radius * (1 - shrinkProgress);
        if (currentRadius > 0) {
            ctx.fillStyle = 'yellow';
            ctx.beginPath();
            ctx.arc(animation.x, animation.y, currentRadius, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
    
    return progress < 1;
}

function render(timestamp: number) {
    const deltaTime = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (gameState) {
        sendInput(); // Send input on each frame
        drawMap(gameState.map);

        gameState.players.forEach(drawPlayer);
        gameState.ghosts.forEach(drawGhost);

        playerDeathAnimations = playerDeathAnimations.filter(anim => drawDeathAnimation(anim, timestamp));

        updateUI();
        if(gameState.isGameOver) {
            showEndGameMessage();
        }
    }
    
    requestAnimationFrame(render);
}

function drawMap(map: number[][]) {
    for (let r = 0; r < MAP_HEIGHT; r++) {
        for (let c = 0; c < MAP_WIDTH; c++) {
            const tile = map[r][c];
            const x = c * TILE_SIZE;
            const y = r * TILE_SIZE;
            if (tile === 1) { // Wall
                ctx.fillStyle = '#00008b';
                ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            } else if (tile === 2) { // Pellet
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(x + TILE_SIZE / 2, y + TILE_SIZE / 2, TILE_SIZE / 8, 0, Math.PI * 2);
                ctx.fill();
            } else if (tile === 3) { // Power Pellet
                ctx.fillStyle = '#ffb8ae';
                ctx.beginPath();
                ctx.arc(x + TILE_SIZE / 2, y + TILE_SIZE / 2, TILE_SIZE / 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

function drawPlayer(player: any) {
    if (!player.isActive || playerDeathAnimations.some(anim => anim.playerId === player.id)) {
        return;
    }

    const { x, y, color, dx, dy, lastDx, lastDy, invulnerabilityTimer } = player;
    const radius = TILE_SIZE / 2;

    if (invulnerabilityTimer > 0 && Math.floor(Date.now() / 150) % 2 === 0) {
        ctx.globalAlpha = 0.5;
    }

    ctx.fillStyle = color;
    ctx.beginPath();

    const dir = (dx !== 0 || dy !== 0) ? { dx, dy } : { dx: lastDx, dy: lastDy };
    const angleOffset = Math.sin(Date.now() / 100) * 0.1 + 0.2; // Mouth animation
    let startAngle = 0, endAngle = Math.PI * 2;

    if (dir.dx > 0) { startAngle = angleOffset * Math.PI; endAngle = (2 - angleOffset) * Math.PI; }
    else if (dir.dx < 0) { startAngle = (1 + angleOffset) * Math.PI; endAngle = (1 - angleOffset) * Math.PI; }
    else if (dir.dy > 0) { startAngle = (0.5 + angleOffset) * Math.PI; endAngle = (0.5 - angleOffset) * Math.PI; }
    else if (dir.dy < 0) { startAngle = (1.5 + angleOffset) * Math.PI; endAngle = (1.5 - angleOffset) * Math.PI; }

    ctx.arc(x, y, radius, startAngle, endAngle);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();

    // Eye
    ctx.fillStyle = 'black';
    const eyeRadius = radius * 0.15;
    let eyeX = x - radius * 0.2;
    let eyeY = y - radius * 0.45;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, eyeRadius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.globalAlpha = 1.0;
}

function drawGhost(ghost: any) {
    const radius = TILE_SIZE / 2 * 0.9;
    const { x, y, color, frightened, eaten, dx, dy } = ghost;

    const bodyColor = frightened ? (eaten ? color : '#2121de') : color;
    ctx.fillStyle = bodyColor;
    
    if (!eaten) {
        ctx.beginPath();
        ctx.arc(x, y, radius, Math.PI, 0); // Top semi-circle
        const numScallops = 4;
        for (let i = 0; i < numScallops; i++) {
            const sx1 = x + radius - (i * (radius * 2) / numScallops);
            const sx2 = x + radius - ((i + 0.5) * (radius * 2) / numScallops);
            const sx3 = x + radius - ((i + 1) * (radius * 2) / numScallops);
            if (i === 0) ctx.lineTo(sx1, y);
            ctx.quadraticCurveTo(sx2, y + radius * 0.8, sx3, y);
        }
        ctx.closePath();
        ctx.fill();
    }

    // Eyes
    const eyeRadiusX = radius * 0.25;
    const eyeRadiusY = radius * 0.35;
    const eyeOffsetX = radius * 0.4;
    
    // Sclera (white part)
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.ellipse(x - eyeOffsetX, y - radius * 0.1, eyeRadiusX, eyeRadiusY, 0, 0, Math.PI * 2);
    ctx.ellipse(x + eyeOffsetX, y - radius * 0.1, eyeRadiusX, eyeRadiusY, 0, 0, Math.PI * 2);
    ctx.fill();

    if (frightened && !eaten) {
        ctx.fillStyle = 'white';
        ctx.strokeStyle = '#2121de';
        ctx.lineWidth = 1;
        // Pupils
        ctx.beginPath();
        ctx.arc(x - eyeOffsetX, y - radius * 0.1, eyeRadiusX * 0.5, 0, Math.PI * 2);
        ctx.arc(x + eyeOffsetX, y - radius * 0.1, eyeRadiusX * 0.5, 0, Math.PI * 2);
        ctx.fill();
        // Mouth
        ctx.beginPath();
        const numWaves = 6;
        for (let i = 0; i <= numWaves; i++) {
            const mx = (x - radius * 0.6) + (i * (radius * 1.2) / numWaves);
            const my = y + radius * 0.4 + (i % 2 === 0 ? -2 : 2);
            if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
        }
        ctx.stroke();
    } else {
        // Normal pupils
        const pupilRadius = eyeRadiusX * 0.6;
        const pupilOffsetX = (dx || 0) * eyeRadiusX * 0.4;
        const pupilOffsetY = (dy || 0) * eyeRadiusY * 0.4;

        ctx.fillStyle = '#00008b';
        ctx.beginPath();
        ctx.arc(x - eyeOffsetX + pupilOffsetX, y - radius * 0.1 + pupilOffsetY, pupilRadius, 0, Math.PI * 2);
        ctx.arc(x + eyeOffsetX + pupilOffsetX, y - radius * 0.1 + pupilOffsetY, pupilRadius, 0, Math.PI * 2);
        ctx.fill();
    }
}


function updateUI() {
    if (!gameState) return;
    playerScoresEl.innerHTML = '';
    gameState.players.forEach((player: any) => {
        const hud = document.createElement('div');
        hud.className = 'player-hud';
        if (!player.isActive) hud.classList.add('inactive');
        hud.style.borderColor = player.color;
        hud.style.color = player.color;

        if (player.isWinner) {
            const winnerText = document.createElement('span');
            winnerText.className = 'winner-text';
            winnerText.textContent = 'WINNER';
            hud.appendChild(winnerText);
        }
        
        const name = document.createElement('div');
        name.textContent = player.isSpectator ? `SPECTATOR` : `P${player.id}`;

        const score = document.createElement('div');
        score.textContent = `Score: ${player.score}`;
        
        const lives = document.createElement('div');
        lives.textContent = `Lives: ${'♥'.repeat(player.lives)}`;
        
        hud.appendChild(name);
        hud.appendChild(score);
        if(!player.isSpectator) hud.appendChild(lives);

        playerScoresEl.appendChild(hud);
    });
}

function showEndGameMessage() {
    const winner = gameState.players.find((p: any) => p.isWinner);
    const title = winner ? `Player ${winner.id} Wins!` : 'Game Over!';
    let body = '<table>';
    gameState.players.filter((p:any) => !p.isSpectator).sort((a:any, b:any) => b.score - a.score).forEach((p:any) => {
        body += `<tr><td class="player-name" style="color:${p.color};">Player ${p.id}</td><td>${p.score}</td></tr>`;
    });
    body += '</table><p>Returning to lobby...</p>';

    messageTitleEl.textContent = title;
    messageBodyEl.innerHTML = '';
    finalScoresEl.innerHTML = body;
    messageEl.style.display = 'flex';
}


// --- START ---
init();
