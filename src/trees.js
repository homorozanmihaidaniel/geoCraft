import { B, SOLID } from './blocks.js';

// Tree generation helper for both procedural worldgen and in-game planting

// Generate voxel blocks for a tree rooted at (x, y, z)
// (x, y, z) is the ground surface block where the trunk starts
export function createTreeBlocks(x, y, z, kind = 'oak', seed = 0) {
  const blocks = [];
  const isSakura = kind === 'sakura';
  const leafId = isSakura ? B.SAKURA : B.LEAVES;
  const woodId = B.LOG;

  // Trunk height: 4 to 6 for oak, 5 to 7 for sakura
  const trunkHeight = isSakura ? 5 + (seed % 3) : 4 + (seed % 3);

  // 1. Trunk
  for (let dy = 0; dy < trunkHeight; dy++) {
    blocks.push([x, y + dy, z, woodId]);
  }

  // 2. Leaf canopy
  const topY = y + trunkHeight;

  // Layer -2 and -1 (lower canopy: 5x5 rounded)
  for (let dy = -2; dy <= -1; dy++) {
    const ly = topY + dy;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        // Exclude 4 outer corners for rounded organic shape
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) {
          if ((Math.abs(dx * 7 + dz * 13 + dy * 5 + seed) % 3) !== 0) continue;
        }
        if (dx === 0 && dz === 0 && dy < 0) continue; // trunk position
        blocks.push([x + dx, ly, z + dz, leafId]);
      }
    }
  }

  // Layer 0 (mid-top canopy: 3x3)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (Math.abs(dx) === 1 && Math.abs(dz) === 1 && (seed % 2 === 0)) continue;
      blocks.push([x + dx, topY, z + dz, leafId]);
    }
  }

  // Layer +1 (top crown cap: cross shape)
  const cap = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dz] of cap) {
    blocks.push([x + dx, topY + 1, z + dz, leafId]);
  }

  // If sakura, add slightly wider flower branch spread
  if (isSakura) {
    const extra = [
      [2, topY - 1, 0],
      [-2, topY - 1, 0],
      [0, topY - 1, 2],
      [0, topY - 1, -2],
      [1, topY, 1],
      [-1, topY, -1],
    ];
    for (const [dx, ey, dz] of extra) {
      blocks.push([x + dx, ey, z + dz, leafId]);
    }
  }

  return blocks;
}

// Plant a tree in the interactive game world
export function plantTree(world, x, y, z, kind = 'oak') {
  const seed = (Math.imul(x, 0x1f1f1f1f) ^ Math.imul(z, 0x5b5b5b5b)) >>> 0;
  const blocks = createTreeBlocks(x, y, z, kind, seed);

  // Only place blocks if they won't collide with existing bedrock or buildings
  const valid = [];
  for (const [bx, by, bz, id] of blocks) {
    const cur = world.getBlock(bx, by, bz);
    if (cur === 0 || cur === B.AIR || cur === B.LEAVES || cur === B.SAKURA) {
      valid.push([bx, by, bz, id]);
    }
  }

  world.setBlocks(valid);
  return valid.length;
}
