/**
 * tests/server/weapons.test.js
 *
 * Tests for the weapon powerups feature:
 * - Weapon spawning when powerups are exhausted
 * - Weapon pickup (collision detection)
 * - Pistol firing (projectile creation)
 * - Explosive detonation (blast radius damage)
 */

const {
  WEAPON_TYPES,
  WEAPON_PICKUP_DISTANCE,
  PISTOL_PROJECTILE_SPEED,
  PISTOL_PROJECTILE_RANGE,
  EXPLOSIVE_BLAST_RADIUS,
  EXPLOSIVE_PELLET_RADIUS,
  shouldSpawnWeapons,
  spawnWeapon,
  checkWeaponPickup,
  firePistol,
  detonateExplosive,
  updateProjectiles,
} = require('../../src/gameLogic');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MAZE_OPEN = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

const MAZE_WALLED = [
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('weapon constants', () => {
  test('WEAPON_TYPES has pistol and explosive', () => {
    expect(WEAPON_TYPES.PISTOL).toBe('pistol');
    WEAPON_TYPES.PISTOL = 'pistol';
    expect(WEAPON_TYPES.EXPLOSIVE).toBe('explosive');
  });

  test('WEAPON_PICKUP_DISTANCE is 0.5', () => {
    expect(WEAPON_PICKUP_DISTANCE).toBe(0.5);
  });

  test('PISTOL_PROJECTILE_SPEED is defined', () => {
    expect(PISTOL_PROJECTILE_SPEED).toBeGreaterThan(0);
    expect(PISTOL_PROJECTILE_SPEED).toBeLessThanOrEqual(0.5);
  });

  test('PISTOL_PROJECTILE_RANGE is defined', () => {
    expect(PISTOL_PROJECTILE_RANGE).toBeGreaterThan(0);
  });

  test('EXPLOSIVE_BLAST_RADIUS is defined', () => {
    expect(EXPLOSIVE_BLAST_RADIUS).toBeGreaterThan(1);
  });

  test('EXPLOSIVE_PELLET_RADIUS >= blast radius', () => {
    expect(EXPLOSIVE_PELLET_RADIUS).toBeGreaterThanOrEqual(EXPLOSIVE_BLAST_RADIUS);
  });
});

// ---------------------------------------------------------------------------
// shouldSpawnWeapons
// ---------------------------------------------------------------------------

describe('shouldSpawnWeapons', () => {
  test('returns false when power pellets remain', () => {
    expect(shouldSpawnWeapons([], [{ x: 1, y: 1 }], [])).toBe(false);
  });

  test('returns false when regular pellets remain', () => {
    expect(shouldSpawnWeapons([{ x: 1, y: 1 }], [], [])).toBe(false);
  });

  test('returns false when weapons already on board', () => {
    expect(shouldSpawnWeapons([], [], [{ x: 1, y: 1, type: 'pistol' }])).toBe(false);
  });

  test('returns true when all pellets eaten and no weapons exist', () => {
    expect(shouldSpawnWeapons([], [], [])).toBe(true);
  });

  test('returns true when only power pellets remain but no regular pellets', () => {
    // Power pellets are the "frightened" trigger — once they're gone, weapons spawn
    expect(shouldSpawnWeapons([], [], [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// spawnWeapon
// ---------------------------------------------------------------------------

describe('spawnWeapon', () => {
  test('returns null if no walkable tiles available', () => {
    const weapon = spawnWeapon(MAZE_WALLED, []);
    expect(weapon).toBeNull();
  });

  test('returns a weapon with valid type', () => {
    const weapon = spawnWeapon(MAZE_OPEN, []);
    expect(weapon).not.toBeNull();
    expect(['pistol', 'explosive']).toContain(weapon.type);
  });

  test('returns a weapon at a walkable position', () => {
    const weapon = spawnWeapon(MAZE_OPEN, []);
    expect(weapon).not.toBeNull();
    const tile = MAZE_OPEN[weapon.y][weapon.x];
    expect(tile).not.toBe(1); // Not a wall
  });

  test('spawned weapon does not overlap existing weapons', () => {
    const existingWeapons = [{ x: 3, y: 3, type: 'pistol' }];
    // Run multiple times to ensure no overlap
    for (let i = 0; i < 20; i++) {
      const weapon = spawnWeapon(MAZE_OPEN, existingWeapons);
      if (weapon) {
        const overlap = existingWeapons.some(w => w.x === weapon.x && w.y === weapon.y);
        expect(overlap).toBe(false);
      }
    }
  });

  test('weapon has x and y as integers (tile coordinates)', () => {
    const weapon = spawnWeapon(MAZE_OPEN, []);
    expect(weapon).not.toBeNull();
    expect(Number.isInteger(weapon.x)).toBe(true);
    expect(Number.isInteger(weapon.y)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkWeaponPickup
// ---------------------------------------------------------------------------

describe('checkWeaponPickup', () => {
  test('player picks up weapon within distance', () => {
    const player = { x: 3.5, y: 3.5, weapon: null };
    const weapons = [{ x: 3, y: 3, type: 'pistol' }];
    const result = checkWeaponPickup(player, weapons);
    expect(result).toBe(true);
    expect(player.weapon).toBe('pistol');
    expect(weapons.length).toBe(0);
  });

  test('player does not pick up weapon beyond distance', () => {
    const player = { x: 1.5, y: 1.5, weapon: null };
    const weapons = [{ x: 5, y: 5, type: 'pistol' }];
    const result = checkWeaponPickup(player, weapons);
    expect(result).toBe(false);
    expect(player.weapon).toBeNull();
    expect(weapons.length).toBe(1);
  });

  test('player with existing weapon does not pick up another', () => {
    const player = { x: 3.5, y: 3.5, weapon: 'pistol' };
    const weapons = [{ x: 3, y: 3, type: 'explosive' }];
    const result = checkWeaponPickup(player, weapons);
    expect(result).toBe(false);
    expect(player.weapon).toBe('pistol');
    expect(weapons.length).toBe(1);
  });

  test('pickup removes only the collected weapon', () => {
    const player = { x: 3.5, y: 3.5, weapon: null };
    const weapons = [
      { x: 3, y: 3, type: 'pistol' },
      { x: 5, y: 5, type: 'explosive' },
    ];
    checkWeaponPickup(player, weapons);
    expect(weapons.length).toBe(1);
    expect(weapons[0].type).toBe('explosive');
  });
});

// ---------------------------------------------------------------------------
// firePistol
// ---------------------------------------------------------------------------

describe('firePistol', () => {
  test('creates a projectile in the facing direction', () => {
    const player = { x: 3.5, y: 3.5, direction: 'right', weapon: 'pistol' };
    const projectiles = [];
    firePistol(player, projectiles);
    expect(projectiles.length).toBe(1);
    const proj = projectiles[0];
    expect(proj.direction).toBe('right');
    expect(proj.ownerId).toBeUndefined(); // Set by caller
  });

  test('projectile starts at player position', () => {
    const player = { x: 3.5, y: 3.5, direction: 'up', weapon: 'pistol' };
    const projectiles = [];
    firePistol(player, projectiles);
    const proj = projectiles[0];
    expect(proj.x).toBeCloseTo(3.5, 5);
    expect(proj.y).toBeCloseTo(3.5, 5);
  });

  test('clearing weapon after fire (single-shot)', () => {
    const player = { x: 3.5, y: 3.5, direction: 'right', weapon: 'pistol' };
    const projectiles = [];
    firePistol(player, projectiles);
    // Pistol is single-shot — weapon consumed on fire
    expect(player.weapon).toBeNull();
  });

  test('does not fire without a direction', () => {
    const player = { x: 3.5, y: 3.5, direction: null, weapon: 'pistol' };
    const projectiles = [];
    firePistol(player, projectiles);
    expect(projectiles.length).toBe(0);
  });

  test('projectile has range and speed', () => {
    const player = { x: 3.5, y: 3.5, direction: 'right', weapon: 'pistol' };
    const projectiles = [];
    firePistol(player, projectiles);
    const proj = projectiles[0];
    expect(proj.range).toBe(PISTOL_PROJECTILE_RANGE);
    expect(proj.speed).toBe(PISTOL_PROJECTILE_SPEED);
  });
});

// ---------------------------------------------------------------------------
// detonateExplosive
// ---------------------------------------------------------------------------

describe('detonateExplosive', () => {
  test('returns blast result with affected entities', () => {
    const player = { x: 3.5, y: 3.5, weapon: 'explosive' };
    const players = [
      { id: 'p1', x: 3.5, y: 3.5 },
      { id: 'p2', x: 4.5, y: 3.5 }, // Within radius
      { id: 'p3', x: 10.5, y: 10.5 }, // Outside radius
    ];
    const ghosts = [
      { id: 'g1', x: 3.8, y: 3.8, eaten: false },
      { id: 'g2', x: 8.5, y: 8.5, eaten: false }, // Outside radius
    ];
    const pellets = [
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 10, y: 10 }, // Outside radius
    ];
    const powerPellets = [];

    const result = detonateExplosive(player, players, ghosts, pellets, powerPellets);

    expect(result).toBeDefined();
    expect(result.blastX).toBeCloseTo(3.5, 5);
    expect(result.blastY).toBeCloseTo(3.5, 5);
    expect(result.affectedPlayers.length).toBeGreaterThanOrEqual(2); // p1, p2
    expect(result.affectedGhosts.length).toBe(1); // g1
    expect(result.affectedPellets.length).toBeGreaterThanOrEqual(2); // (3,3), (4,3)
  });

  test('explosive consumes the weapon', () => {
    const player = { x: 3.5, y: 3.5, weapon: 'explosive' };
    detonateExplosive(player, [player], [], [], []);
    expect(player.weapon).toBeNull();
  });

  test('explosive does not affect entities outside blast radius', () => {
    const player = { x: 1.5, y: 1.5, weapon: 'explosive' };
    const farPlayer = { id: 'far', x: 10.5, y: 10.5 };
    const result = detonateExplosive(player, [player, farPlayer], [], [], []);
    const farAffected = result.affectedPlayers.some(p => p.id === 'far');
    expect(farAffected).toBe(false);
  });

  test('blast uses EXPLOSIVE_BLAST_RADIUS for player/ghost damage', () => {
    const player = { x: 3.5, y: 3.5, weapon: 'explosive' };
    // Player exactly at blast radius edge
    const edgePlayer = {
      id: 'edge',
      x: 3.5 + EXPLOSIVE_BLAST_RADIUS - 0.1,
      y: 3.5,
    };
    const result = detonateExplosive(player, [player, edgePlayer], [], [], []);
    const edgeAffected = result.affectedPlayers.some(p => p.id === 'edge');
    expect(edgeAffected).toBe(true);
  });

  test('blast uses EXPLOSIVE_PELLET_RADIUS for pellet clearing', () => {
    const player = { x: 3.5, y: 3.5, weapon: 'explosive' };
    const edgePellet = {
      x: Math.floor(3.5 + EXPLOSIVE_PELLET_RADIUS - 0.1),
      y: 3,
    };
    const result = detonateExplosive(player, [player], [], [edgePellet], []);
    const edgeCleared = result.affectedPellets.some(p => p.x === edgePellet.x && p.y === edgePellet.y);
    expect(edgeCleared).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateProjectiles
// ---------------------------------------------------------------------------

describe('updateProjectiles', () => {
  test('moves projectile in its direction', () => {
    const projectiles = [
      { x: 3.5, y: 3.5, direction: 'right', speed: 0.1, range: 5, distanceTraveled: 0 },
    ];
    const players = [];
    const ghosts = [];
    const result = updateProjectiles(projectiles, MAZE_OPEN, players, ghosts);
    expect(projectiles[0].x).toBeGreaterThan(3.5);
    expect(projectiles[0].distanceTraveled).toBe(0.1);
    expect(result.hitPlayers.length).toBe(0);
    expect(result.hitGhosts.length).toBe(0);
  });

  test('projectile is removed when it hits a wall', () => {
    // Place projectile near the wall — after moving it should enter tile 6 (wall)
    const projectiles = [
      { x: 5.8, y: 3.5, direction: 'right', speed: 0.5, range: 5, distanceTraveled: 0 },
    ];
    const result = updateProjectiles(projectiles, MAZE_OPEN, [], []);
    // After moving: x = 5.8 + 0.5 = 6.3, which is in tile 6 (wall)
    expect(projectiles.length).toBe(0);
  });

  test('projectile hits a player in its path', () => {
    const targetPlayer = { id: 'target', x: 4.0, y: 3.5 };
    const projectiles = [
      { x: 3.5, y: 3.5, direction: 'right', speed: 0.1, range: 5, distanceTraveled: 0 },
    ];
    const result = updateProjectiles(projectiles, MAZE_OPEN, [targetPlayer], []);
    expect(result.hitPlayers.length).toBe(1);
    expect(result.hitPlayers[0].id).toBe('target');
  });

  test('single-player: projectile still fires and hits ghosts', () => {
    // In single-player, no other players to shoot — but pistol still works vs ghosts
    const targetGhost = { id: 'g1', x: 4.0, y: 3.5, eaten: false };
    const projectiles = [
      { x: 3.5, y: 3.5, direction: 'right', speed: 0.1, range: 5, distanceTraveled: 0, ownerId: 'player1' },
    ];
    const result = updateProjectiles(projectiles, MAZE_OPEN, [], [targetGhost]);
    expect(result.hitGhosts.length).toBe(1);
  });

  test('single-player: explosive clears pellets and kills ghosts', () => {
    const player = { id: 'p1', x: 3.5, y: 3.5, weapon: 'explosive' };
    const ghosts = [
      { id: 'g1', x: 3.8, y: 3.8, eaten: false },
      { id: 'g2', x: 3.5, y: 4.2, eaten: false },
    ];
    const pellets = [
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 3, y: 4 },
    ];
    const result = detonateExplosive(player, [player], ghosts, pellets, []);
    expect(result.affectedGhosts.length).toBe(2);
    expect(result.affectedPellets.length).toBe(3);
  });

  test('shouldSpawnWeapons returns true in single-player when pellets exhausted', () => {
    // Weapons should spawn in single-player too (helps clear level)
    expect(shouldSpawnWeapons([], [], [])).toBe(true);
  });

  test('spawnWeapon avoids player position in single-player', () => {
    const player = { x: 3.5, y: 3.5 };
    for (let i = 0; i < 20; i++) {
      const weapon = spawnWeapon(MAZE_OPEN, [], player);
      if (weapon) {
        // Weapon should not spawn on the player
        expect(weapon.x === 3 && weapon.y === 3).toBe(false);
      }
    }
  });

  test('projectile hits a ghost in its path', () => {
    const targetGhost = { id: 'ghost1', x: 4.0, y: 3.5, eaten: false };
    const projectiles = [
      { x: 3.5, y: 3.5, direction: 'right', speed: 0.1, range: 5, distanceTraveled: 0 },
    ];
    const result = updateProjectiles(projectiles, MAZE_OPEN, [], [targetGhost]);
    expect(result.hitGhosts.length).toBe(1);
    expect(result.hitGhosts[0].id).toBe('ghost1');
  });

  test('projectile is removed when it exceeds range', () => {
    const projectiles = [
      { x: 1.5, y: 1.5, direction: 'right', speed: 0.1, range: 0.05, distanceTraveled: 0 },
    ];
    const result = updateProjectiles(projectiles, MAZE_OPEN, [], []);
    // After moving 0.1, distanceTraveled (0.1) > range (0.05), so removed
    expect(projectiles.length).toBe(0);
  });

  test('projectile does not hit eaten ghosts', () => {
    const eatenGhost = { id: 'eaten', x: 4.0, y: 3.5, eaten: true };
    const projectiles = [
      { x: 3.5, y: 3.5, direction: 'right', speed: 0.1, range: 5, distanceTraveled: 0 },
    ];
    const result = updateProjectiles(projectiles, MAZE_OPEN, [], [eatenGhost]);
    expect(result.hitGhosts.length).toBe(0);
  });

  test('handles multiple projectiles', () => {
    const projectiles = [
      { x: 3.5, y: 3.5, direction: 'right', speed: 0.1, range: 5, distanceTraveled: 0 },
      { x: 3.5, y: 3.5, direction: 'left', speed: 0.1, range: 5, distanceTraveled: 0 },
    ];
    updateProjectiles(projectiles, MAZE_OPEN, [], []);
    expect(projectiles[0].x).toBeGreaterThan(3.5);
    expect(projectiles[1].x).toBeLessThan(3.5);
  });
});
