import './storage.js'; // first: saved data from the project's earlier names is moved over
import * as THREE from 'three';
import { SEA_Y, MIN_EDIT_Y, FAR_TILE, FAR_RADIUS } from './config.js';
import { Projection } from './geo.js';
import { B, SOLID, TEX_TOP, MODEL, KIND, FACING, ITEM_OF, PLACE, MATE, SWING, SLAB_OF, SOUND, DX, DZ } from './blocks.js';
import { NETHER, NETHER_SPAWN, inNether, netherRegion, REGION, REGION_FOG } from './nether.js';
import { createMaterials } from './materials.js';
import { World } from './world.js';
import { Player, EYE } from './player.js';
import { Sky } from './sky.js';
import { UI } from './ui.js';
import { Hand } from './hand.js';
import { Effects } from './fx.js';
import { Mobs, MOB_NAMES } from './mobs.js';
import { CarManager } from './car.js';
import { MissileManager } from './missile.js';
import { plantTree } from './trees.js';
import { sfx } from './sound.js';
import { I, FOOD, EGGS, isBlock, itemName, layerCanvas, DEFAULT_SLOTS } from './items.js';
import { loadTexturePack, strips } from './pack.js';
import { initTitle } from './title.js';
import { PanoManager, AmsterdamProvider, PanoramaxProvider } from './pano.js';
import { GoogleProvider, unlessGoogle, usage, cap, paidBudget, GOOGLE_KEY, PAID_KEY, FREE_TILES, DAILY_QUOTA } from './google.js';
import { gridTurn, ALIGN_KEY } from './grid.js';
import { tx, localize, lang, locale, LANGS, LANG_KEY } from './i18n.js';
import { WorldMap } from './worldmap.js';

const REACH_WALK = 9;
const REACH_LOCKED = 80; // standing in a photo, you build at a distance
const MELEE = 6;
const SLOTS_KEY = 'geocrafter:slots:v1';
const XP_KEY = 'geocrafter:xp:v1';
const $ = (id) => document.getElementById(id);

// Street photos are the game: a place is only offered where there are some. The free sources
// cover the first two places: Amsterdam's own survey panoramas (8000 px, every 5 m, measured
// poses) over the national laser scan. Everything else, and any place the player adds, takes
// Google Street View, which needs the player's own key (Options).
const LOCATIONS = [
  { name: 'Târgu Mureș', sub: 'România · Strada Mihai Viteazul', lat: 46.5465, lon: 24.56878 },
  { name: 'Nieuwmarkt', sub: 'Amsterdam · the Waag, cobbled square', lat: 52.37251, lon: 4.90049 },
  // `turn`: the paving of the boulevard, which the streets around it do not follow
  { name: 'Arena Boulevard', sub: 'Amsterdam · stadium forecourt, wide square', lat: 52.31288, lon: 4.94254, turn: 6.5 },
  { name: 'New York', sub: 'Manhattan · Fifth Avenue', lat: 40.75753, lon: -73.97795, google: true },
  { name: 'Times Square', sub: 'New York · Broadway and Seventh Avenue', lat: 40.758, lon: -73.9855, google: true },
  { name: 'Las Vegas Strip', sub: 'Las Vegas · the wide boulevard of the casinos', lat: 36.1126, lon: -115.1728, google: true },
  { name: 'Piccadilly Circus', sub: 'London · West End', lat: 51.5101, lon: -0.134, google: true },
  { name: 'Brandenburg Gate', sub: 'Berlin · Pariser Platz', lat: 52.5162, lon: 13.3795, google: true },
  { name: 'Coolsingel', sub: 'Rotterdam · city boulevard, laser-scanned ground', lat: 51.9225, lon: 4.4792, google: true },
  { name: 'Colosseum', sub: 'Rome · Via dei Fori Imperiali', lat: 41.8925, lon: 12.4885, google: true },
  { name: 'Sagrada Família', sub: 'Barcelona · the grid of the Eixample', lat: 41.4036, lon: 2.1744, google: true },
  { name: 'Tel Aviv', sub: 'Dizengoff Square · the round plaza and its fountain', lat: 32.0779, lon: 34.7741, google: true },
  { name: 'Shibuya', sub: 'Tokyo · by the station and the scramble crossing', lat: 35.6595, lon: 139.7005, google: true },
];
const samePlace = (a, b) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;

// Places the player added (Google only), kept in this browser: [{ name, lat, lon }].
const PLACES_KEY = 'geocrafter:places';
function loadPlaces() {
  try {
    const list = JSON.parse(localStorage.getItem(PLACES_KEY));
    if (Array.isArray(list)) return list.filter((p) => p && typeof p.name === 'string' && Math.abs(p.lat) <= 85 && Math.abs(p.lon) <= 180).slice(0, 60);
  } catch (e) {
    // unreadable: none
  }
  return [];
}
const myPlaces = loadPlaces();
const savePlaces = () => localStorage.setItem(PLACES_KEY, JSON.stringify(myPlaces));

// The game starts on the free sources. Google is used once the player switches it on in Options;
// the key is the one saved in this browser (a key in .env.local only counts while developing, so
// a build never carries one).
const GOOGLE_ON = 'geocrafter:google-on';
const googleKey = localStorage.getItem(GOOGLE_KEY) || (import.meta.env.DEV ? import.meta.env.VITE_GOOGLE_MAPS_KEY || '' : '');
const googleOn = !!googleKey && localStorage.getItem(GOOGLE_ON) === '1';

// The place asked for in the address, if it may be played: one of the free ones always, any
// other only with Google. Anything else falls back to the first place.
const params = new URLSearchParams(location.search);
function asked() {
  const lat = +params.get('lat'), lon = +params.get('lon');
  if (!params.has('lat') || !params.has('lon') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  const want = { name: (params.get('name') || '').slice(0, 40) || tx('Custom place'), lat, lon };
  const known = LOCATIONS.find((l) => samePlace(l, want));
  return known || want;
}
const want = asked();
const loc = want || LOCATIONS[0];
if (!want && params.has('lat')) history.replaceState(null, '', location.pathname); // not that place after all
const freePlace = LOCATIONS.some((l) => !l.google && samePlace(l, loc));

function goTo(l, autoPlay = false) {
  const q = new URLSearchParams({ lat: l.lat.toFixed(5), lon: l.lon.toFixed(5), name: l.name });
  if (autoPlay) q.set('play', '1');
  location.search = q.toString();
}

// ---------------------------------------------------------------- scene

const canvas = $('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  throw new Error('this browser or device has no WebGL 2'); // shown on the title screen (index.html)
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, 1, 0.2, 16000);
camera.rotation.order = 'YXZ';

// a texture pack, if one is installed, replaces the built-in drawings before anything uses them
const packGui = await loadTexturePack();
const materials = createMaterials();
// The block grid runs along the streets of the place rather than north-up (see grid.js);
// `?grid=` in the address forces a bearing, 0 for north-up.
const listed = LOCATIONS.find((l) => samePlace(l, loc));
const turn = params.has('grid') ? +params.get('grid') || 0
  : listed && listed.turn !== undefined && localStorage.getItem(ALIGN_KEY) !== '0' ? listed.turn
  : await gridTurn(loc.lon, loc.lat);
const proj = new Projection(loc.lon, loc.lat, turn);
// blocks are saved in grid coordinates: a turned grid keeps its own set
const world = new World(scene, materials, `geocrafter:v2:${loc.lat.toFixed(5)},${loc.lon.toFixed(5)}${turn ? `:t${turn}` : ''}`);
const player = new Player(world);
const sky = new Sky(scene, materials);
const hand = new Hand();

// Saved inventories from before the items changed keep what is in them and get what is new:
// the hotbar of its day (the bow and the eggs did not exist at first); later the creeper's egg
// where the skeleton's used to be handed out, and the portal egg in the storage's first free slot.
const SLOTS_VERSION = 3;
function loadSlots() {
  try {
    const a = JSON.parse(localStorage.getItem(SLOTS_KEY));
    if (Array.isArray(a) && a.length === 36 && a.every((v) => v === 0 || itemName(v))) {
      const saved = +localStorage.getItem(`${SLOTS_KEY}:version`);
      if (saved < 2) a.splice(0, 9, ...DEFAULT_SLOTS.slice(0, 9));
      if (saved < 3) {
        if (a[5] === I.EGG) a[5] = I.EGG_CREEPER;
        if (!a.includes(I.EGG_PORTAL) && a.includes(0, 9)) a[a.indexOf(0, 9)] = I.EGG_PORTAL;
      }
      return a;
    }
  } catch (e) {
    console.warn('saved inventory unreadable', e);
  }
  return DEFAULT_SLOTS.slice();
}
const slots = loadSlots();
const ui = new UI(slots, packGui);

let wasPlayingBeforeMap = false;

function openWorldMap() {
  wasPlayingBeforeMap = playing;
  worldMap.open();
  if (locked()) document.exitPointerLock();
}

const worldMap = new WorldMap({
  getPlayerCoords: () => {
    if (spawned && player) {
      const [lon, lat] = proj.blockToLonLat(player.x, player.z);
      return { lat, lon };
    }
    return { lat: loc.lat, lon: loc.lon };
  },
  getLocations: () => LOCATIONS,
  getMyPlaces: () => myPlaces,
  onTeleport: (target) => {
    const [bx, bz] = proj.lonLatToBlock(target.lon, target.lat);
    const distFromOrigin = Math.hypot(bx, bz);
    if (spawned && !dead && distFromOrigin < 1500) {
      const n = panos.nearest(bx, bz, 300);
      if (n) {
        travel(n);
      } else {
        roam = true;
        panos.unlock();
        player.placeAt(bx, bz);
        const curTop = world.topY(Math.floor(bx), Math.floor(bz));
        const top = curTop > 40 ? curTop : world.topY(0, 0);
        if (top > 40) player.y = top + 3;
        player.vy = 0;
      }
      ui.toast(`Teleportat la ${target.name}!`, 3000);
      if (cars && cars.activeCar) cars.exitCar(player);
      enterPlay(false);
      canvas.requestPointerLock();
      return;
    }
    const known = LOCATIONS.find((l) => samePlace(l, target)) || myPlaces.find((l) => samePlace(l, target));
    if (!known) {
      myPlaces.push({ name: target.name, lat: target.lat, lon: target.lon });
      savePlaces();
    }
    goTo(known || target, true);
  },
  onClose: () => {
    if (wasPlayingBeforeMap && !dead) {
      enterPlay(false);
      canvas.requestPointerLock();
    }
  },
  onSavePlace: (place) => {
    const known = LOCATIONS.find((l) => samePlace(l, place)) || myPlaces.find((l) => samePlace(l, place));
    if (!known) {
      myPlaces.push({ name: place.name, lat: place.lat, lon: place.lon });
      savePlaces();
      buildPlaces();
      ui.toast(`Locație salvată: ${place.name}`, 3000);
    }
  },
});

const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
);
outline.visible = false;
scene.add(outline);

// Where the photos come from. On the free sources: Amsterdam's survey panoramas where they
// exist (and nothing else there: mixing in GPS-posed images would bring back the misalignment
// they avoid), volunteers' photos elsewhere. With Google switched on, Street View everywhere;
// at the free places the free source steps in if the key turns out not to work, anywhere else
// there is nothing to step in.
const survey = AmsterdamProvider.covers(loc.lon, loc.lat);
const providers = survey ? [new AmsterdamProvider()] : [new PanoramaxProvider()];
const google = googleOn ? new GoogleProvider(googleKey) : null;
if (google) providers.splice(0, providers.length, google, ...(freePlace ? providers.map((p) => unlessGoogle(google, p)) : []));

// ---------------------------------------------------------------- player state

const stats = { health: 20, food: 20, xp: +localStorage.getItem(XP_KEY) || 0, hurtAt: -10, healAt: 0 };
let clock = 0; // seconds of game time
let dead = false;
let shake = 0;
const visited = new Set();
const tmp = new THREE.Vector3();
const tmpColor = new THREE.Color();

// Level and progress to the next one (each level costs a little more than the last).
function levelOf(total) {
  let l = 0;
  while (total >= 2 * l + 7) {
    total -= 2 * l + 7;
    l++;
  }
  return [l, total / (2 * l + 7)];
}

function addXp(n) {
  const before = levelOf(stats.xp)[0];
  stats.xp += n;
  localStorage.setItem(XP_KEY, stats.xp.toFixed(2));
  if (levelOf(stats.xp)[0] > before) sfx.level();
}

const tire = (n) => (stats.food = Math.max(0, stats.food - n));

function damage(n) {
  if (dead || n <= 0) return;
  stats.health = Math.max(0, stats.health - n);
  stats.hurtAt = clock;
  ui.hurt();
  sfx.hurt();
  if (stats.health > 0) return;
  dead = true;
  cars.exitCar(player);
  keys.clear();
  clearInterval(repeat);
  ui.showDeath(`Score: ${Math.floor(stats.xp)}`);
  if (locked()) document.exitPointerLock();
}

const fx = new Effects(scene, world, {
  onFuse: (seconds) => sfx.fuse(seconds),
  onExplode: ({ x, y, z, blocks, power, cells }) => {
    settle(cells);
    const dPlayer = Math.hypot(player.x - x, (player.y + player.eye) - y, player.z - z);
    const dCam = camera.position.distanceTo(tmp.set(x, y, z));
    sfx.boom(dCam);
    shake = Math.max(shake, Math.min(1.6, 9 / (dCam + 2)));
    const reach = power * 2;
    // The player piloting a missile remotely does NOT take damage from the missile's own explosion
    if (dPlayer < reach && !(missiles && (missiles.activeMissile || missiles.justDetonated))) {
      damage(Math.round(24 * (1 - dPlayer / reach) ** 1.4));
      if (roam) {
        const k = (1 - dPlayer / reach) * 14;
        player.vx += ((player.x - x) / (dPlayer || 1)) * k;
        player.vz += ((player.z - z) / (dPlayer || 1)) * k;
        player.vy += k * 0.6;
      }
    }
    addXp(blocks * 0.02);
  },
});

const mobs = new Mobs(scene, world, {
  onShoot: () => sfx.bow(),
  onThud: () => sfx.thud(),
  onStruck: (n, dx, dz) => {
    damage(n);
    shake = Math.max(shake, 0.5);
    if (roam) {
      player.vx += dx * 5;
      player.vz += dz * 5;
    }
  },
  onDeath: (x, y, z, kind) => {
    fx.burst(x, y, z, { skeleton: [0.86, 0.86, 0.82], zombie: [0.3, 0.5, 0.28], piglin: [0.82, 0.56, 0.5], creeper: [0.36, 0.66, 0.3] }[kind], 26, 4.2, 0.13, 1);
    if (kind === 'skeleton') sfx.rattle();
    else sfx.hit();
    addXp(5);
  },
  onHiss: () => sfx.fuse(1.5),
  onBlast: (x, y, z) => fx.explode(x, y, z, 3),
});

const cars = new CarManager(scene, world, fx);
const missiles = new MissileManager(scene, world, fx, cars);
const panos = new PanoManager({ renderer, scene, world, materials, proj, providers, hidden: [sky.mesh, outline, fx.group, mobs.group, cars.group, missiles.group] });
panos.onChange = (node) => {
  if (visited.has(node.id)) return;
  visited.add(node.id);
  if (visited.size > 1) addXp(1); // every new place seen
};

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  hand.resize(camera.aspect);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- state

let spawned = false;
let arrived = false; // first panorama chosen (or none exists here)
let stranded = false; // no street photo to stand in here: nothing to play
let faced = false; // turned to look down the street once
let roam = false; // off the photos, on foot: down in the Nether (on the street one stands in a photo)
let debug = false;
let photoOn = true;
let calibrating = false;
let clip = 0; // metres of fully loaded voxel terrain around the player
let elevOffset = 0;
let radius = +localStorage.getItem('geocrafter:radius') || (survey ? 9 : 12); // laser-scan tiles are heavy
world.setRadius(radius);
const keys = new Set();
const stand = new THREE.Vector3(); // where the player stands: the camera, less what a jump has it lifted
const locked = () => document.pointerLockElement === canvas;
// playing: the game has the input. Normally that means the pointer is locked; where the browser
// refuses the lock (embedded views), `dragLook` takes over: drag to look, click to act, Esc for menu.
let playing = false;
let dragLook = false;
// Standing in a photo, these keys step to the neighbouring photo in that direction (an angle
// to the right of where the player looks).
const HOPS = { KeyW: 0, ArrowUp: 0, KeyD: Math.PI / 2, ArrowRight: Math.PI / 2, KeyS: Math.PI, ArrowDown: Math.PI, KeyA: -Math.PI / 2, ArrowLeft: -Math.PI / 2 };

world.on('ready', (m) => {
  elevOffset = 0;
});
world.on('places', (list) => ui.addPlaces(list));
world.on('pois', (list) => {
  ui.addPois(list);
  if (worldMap) worldMap.addPois(list);
});
world.on('error', (msg) => ui.toast(`Error: ${String(msg).split('\n')[0]}`, 6000));
world.init(loc.lon, loc.lat, turn);
ui.setNorth(turn);

ui.onChange = () => {
  localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
  localStorage.setItem(`${SLOTS_KEY}:version`, SLOTS_VERSION);
};
ui.onCraft = (id) => {
  sfx.pick();
  addXp(1);
  ui.toast(`Crafted: ${itemName(id)}`);
};

// Lowest solid column near the origin: streets beat rooftops.
function findSpawn() {
  let best = [0, 0], bestScore = -Infinity;
  const isStreet = (id) =>
    id === B.ASPHALT || id === B.ROAD_LINE || id === B.PAVEMENT || id === B.PAVING ||
    id === B.CONCRETE || id === B.CONCRETE_DARK || id === B.DECK || id === B.DECK_LINE;
  const isRoofOrTree = (id) =>
    id === B.ROOF_GRAY || id === B.ROOF_KAWARA || id === B.ROOF_BLUE || id === B.ROOF_BROWN ||
    id === B.COPPER || id === B.LEAVES || id === B.SAKURA || id === B.LOG ||
    id === B.GLASS || id === B.GLASS_DARK;

  for (let z = -16; z <= 16; z++) {
    for (let x = -16; x <= 16; x++) {
      const y = world.topY(x, z);
      if (y < 40) continue;
      const b = world.getBlock(x, y, z);
      if (!b || b === B.WATER) continue;
      // Need 2 blocks of air above
      if (world.getBlock(x, y + 1, z) !== 0 || world.getBlock(x, y + 2, z) !== 0) continue;

      const dist = Math.hypot(x, z);
      let score = -dist * 2; // Closer to origin is better
      if (isStreet(b)) score += 1000;
      else if (isRoofOrTree(b)) score -= 5000;
      else score += 100; // ground: grass, dirt, gravel, sand, etc.

      if (score > bestScore) {
        bestScore = score;
        best = [x, z];
      }
    }
  }
  return best;
}

// The photo skin belongs to the spot it was taken from: a long way from it, it thins out and
// the block world shows.
function setPhoto() {
  let k = calibrating ? 0.55 : photoOn ? 1 : 0;
  if (inNether(camera.position.x, camera.position.y, camera.position.z)) k = 0; // no street down there
  const slot = panos.current && panos.slotOf(panos.current);
  if (slot && roam) k *= 1 - THREE.MathUtils.smoothstep(camera.position.distanceTo(slot.pos), 70, 130);
  materials.uniforms.uPhoto.value = k;
}

// ---------------------------------------------------------------- menu

let showScreen = () => {};

// How fast the player gets around, as a multiple of the unhurried pace the game started with.
const PACE_KEY = 'geocrafter:pace';
const PACE = THREE.MathUtils.clamp(+localStorage.getItem(PACE_KEY) || 1.5, 0.75, 3);
let paceNow = PACE;
function setPace(v) {
  paceNow = v;
  panos.pace = v;
  player.pace = v;
}

function buildMenu() {
  showScreen = initTitle($('overlay'));
  localize(document);
  $('open-places').textContent = tx('Place: {0}', tx(loc.name));
  for (const code of Object.keys(LANGS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = code.toUpperCase();
    b.title = LANGS[code];
    if (code === lang) b.className = 'current';
    b.addEventListener('click', () => {
      localStorage.setItem(LANG_KEY, code);
      location.reload();
    });
    $('language').append(b);
  }
  // the free photos are the default; say plainly what the Google key adds
  $('promo').classList.toggle('on', !!google);
  $('promo-title').textContent = tx(google ? 'Google Street View is on' : 'Playing with free street photos');
  $('promo-text').textContent = google ? '' : tx('Google Street View shows almost every street on Earth, in sharper photos');
  $('promo').addEventListener('click', openGoogleOptions);
  buildPlaces();
  $('custom').addEventListener('submit', addPlace);
  // how fast the player gets around: the steps between photos, and walking in the Nether
  const pace = $('pace');
  const showPace = () => {
    setPace(+pace.value);
    $('pace-value').textContent = `${(+pace.value).toLocaleString(locale)}×`;
  };
  pace.value = PACE;
  pace.addEventListener('input', showPace);
  pace.addEventListener('change', () => localStorage.setItem(PACE_KEY, pace.value));
  showPace();
  // blocks along the streets, or north-up as on a map: a different grid, so the place reloads
  const align = $('align');
  align.checked = localStorage.getItem(ALIGN_KEY) !== '0';
  align.addEventListener('change', () => {
    if (align.checked) localStorage.removeItem(ALIGN_KEY);
    else localStorage.setItem(ALIGN_KEY, '0');
    location.reload();
  });
  $('align-state').textContent = tx(turn
    ? `Here the grid is turned ${Math.abs(turn).toLocaleString('en-US')}° to the ${turn > 0 ? 'right' : 'left'}.`
    : align.checked ? 'Here the streets already run north-south, or share no direction.' : 'The grid faces north.');
  $('google-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('google-key').value.trim();
    if (v) {
      localStorage.setItem(GOOGLE_KEY, v);
      localStorage.setItem(GOOGLE_ON, '1'); // whoever saves a key wants it used
    } else {
      localStorage.removeItem(GOOGLE_KEY);
      localStorage.removeItem(GOOGLE_ON);
    }
    location.reload();
  });
  const on = $('google-on');
  on.checked = googleOn;
  on.disabled = !googleKey;
  on.addEventListener('change', () => {
    if (on.checked) localStorage.setItem(GOOGLE_ON, '1');
    else localStorage.removeItem(GOOGLE_ON);
    location.reload();
  });
  $('google-cap-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Math.floor(+$('google-cap').value);
    if (v > 0) localStorage.setItem(PAID_KEY, v);
    else localStorage.removeItem(PAID_KEY); // empty: nothing is paid for
    $('google-cap').value = '';
    refreshUsage();
  });
  if (google) {
    google.onLimit = () => ui.toast(freePlace
      ? 'Google tile cap reached: from here on the free photo sources are used (see Options)'
      : 'Google tile cap reached: no more photos can be loaded here (see Options)', 8000);
  }
  const googleState = (msg) => ($('google-state').textContent = tx(msg));
  if (!googleKey) googleState('No key. It takes a Google Cloud key with the "Map Tiles API" enabled.');
  else if (!google) googleState('A key is saved, but Google Street View is switched off: the free photos are used.');
  else {
    googleState('Trying the key…');
    google.works().then((ok) => {
      googleState(ok ? 'Google Street View connected — save it empty to remove the key from this browser.'
        : freePlace ? `Google is not working: ${google.error}. The other sources are used.` : `Google is not working: ${google.error}.`);
      if (ok) return;
      // say so on the first screen too: the player switched it on and is not getting it
      $('promo').classList.remove('on');
      $('promo-title').textContent = tx('Google Street View is not working');
      $('promo-text').textContent = tx('See Options for the reason');
      $('connect').textContent = tx('Options…');
    });
  }
  refreshUsage();
  $('overlay').addEventListener('click', (e) => {
    if (e.target.closest('[data-go="options"]')) refreshUsage();
  });
  $('open-world-map-menu')?.addEventListener('click', () => openWorldMap());
  $('open-world-map-places')?.addEventListener('click', () => openWorldMap());
  $('hud-world-map-btn')?.addEventListener('click', () => openWorldMap());
  $('minimap')?.addEventListener('click', () => {
    ui.toggleMap();
  });
  $('play').addEventListener('click', startPlay);
  $('respawn').addEventListener('click', respawn);
  $('reset-edits').addEventListener('click', () => {
    chests = {};
    saveChests();
    world.resetEdits();
    refreshEdits();
  });
  // every place at once is a bigger thing to lose: the button asks for a second click
  const all = $('reset-all');
  all.addEventListener('click', () => {
    if (all.dataset.armed) {
      for (const m of savedMaps()) localStorage.removeItem(m.key);
      for (const k of Object.keys(localStorage)) if (k.startsWith('geocrafter:chests:')) localStorage.removeItem(k);
      chests = {};
      world.resetEdits();
      refreshEdits();
      return;
    }
    all.dataset.armed = '1';
    all.textContent = tx('Sure? Click again');
    setTimeout(refreshEdits, 3000);
  });
  refreshEdits();
}

// The list of places: the free ones, the ones Google opens (locked without it), and the
// player's own, which can be taken off the list again.
function buildPlaces() {
  const box = $('locations');
  box.textContent = '';
  const capped = !!google && usage().month >= cap();
  const entry = (l, mine) => {
    const locked = (l.google || mine) && (!google || capped);
    const b = document.createElement('button');
    b.type = 'button';
    const sub = mine ? `${l.lat.toFixed(4)}, ${l.lon.toFixed(4)}` : tx(l.sub);
    b.innerHTML = '<span></span><small></small>';
    b.firstChild.textContent = mine ? l.name : tx(l.name);
    b.children[1].textContent = sub;
    if (locked) b.insertAdjacentHTML('beforeend', `<em>${tx('Photos need Google')}</em>`);
    if (locked) b.className = 'locked';
    else if (samePlace(l, loc)) b.className = 'current';
    b.addEventListener('click', () => goTo(l));
    if (!mine) return box.append(b);
    const wrap = document.createElement('div');
    wrap.className = 'mine';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'remove';
    x.textContent = '×';
    x.title = tx('Remove this place');
    x.addEventListener('click', () => {
      myPlaces.splice(myPlaces.indexOf(l), 1);
      savePlaces();
      buildPlaces();
    });
    wrap.append(b, x);
    box.append(wrap);
  };
  for (const l of LOCATIONS) entry(l, false);
  for (const l of myPlaces) entry(l, true);
  $('custom').classList.remove('hidden');
  $('custom-locked').classList.add('hidden');
}

function addPlace(e) {
  e.preventDefault();
  const text = $('coords').value;
  // a pair of numbers, or a Google Maps link, which carries them after the @
  const m = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || text.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
  if (!m || Math.abs(+m[1]) > 85 || Math.abs(+m[2]) > 180) {
    $('coords').value = '';
    $('coords').placeholder = tx('Format: 52.3731, 4.8932');
    return;
  }
  const place = { name: $('place-name').value.trim().slice(0, 40) || `${tx('My place')} ${myPlaces.length + 1}`, lat: +(+m[1]).toFixed(5), lon: +(+m[2]).toFixed(5) };
  const known = LOCATIONS.find((l) => samePlace(l, place)) || myPlaces.find((l) => samePlace(l, place));
  if (!known) {
    myPlaces.push(place);
    savePlaces();
  }
  goTo(known || place);
}

// Saved block changes of every place in this browser: [{ key, count }].
function savedMaps() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!/^geocrafter:v[12]:/.test(key)) continue;
    let count = 0;
    try {
      for (const [, list, body] of JSON.parse(localStorage.getItem(key))) count += list.length + (body ? body.length : 0);
    } catch (e) {
      // unreadable: still listed, so it can be cleared
    }
    out.push({ key, count });
  }
  return out;
}

function refreshEdits() {
  const here = world.editCount();
  const others = savedMaps().filter((m) => m.key !== world.storageKey);
  const elsewhere = others.reduce((sum, m) => sum + m.count, 0);
  let text = here ? tx('Block changes on this map: {0}', here) : tx('No changes on this map');
  if (others.length) text += ` · ${tx('{0} on other maps ({1})', elsewhere, others.length)}`;
  $('edits-count').textContent = `${text}. ${tx('In the game, R resets this map.')}`;
  $('reset-edits').classList.toggle('hidden', !here);
  const all = $('reset-all');
  delete all.dataset.armed;
  all.textContent = tx('Reset all maps');
  all.classList.toggle('hidden', !here && !others.length);
}

// How many Street View tiles this browser has asked Google for, against what it may: the free
// ones each month, and the tiles the player has set aside to pay for.
function refreshUsage() {
  const u = usage(), limit = cap(), budget = paidBudget();
  const n = (v) => v.toLocaleString(locale);
  const paid = u.paid + Math.max(0, u.month - FREE_TILES);
  let text = tx('This month {0} / {1} tiles · today {2} / {3}', n(u.month), n(limit), n(u.today), n(DAILY_QUOTA));
  if (budget) text += ` · ${tx('paid for so far {0} / {1}', n(Math.min(paid, budget)), n(budget))}`;
  if (u.month >= limit) text += ` · ${tx('cap reached: the free photo sources are used')}`;
  else if (budget && paid >= budget) text += ` · ${tx('the paid tiles are used up: only the free ones from here on')}`;
  $('google-usage').textContent = text;
  $('google-cap').placeholder = budget ? tx('Tiles to pay for, in all (now {0})', n(budget)) : tx('Tiles to pay for, in all (now none)');
  // the key opened a session and was called connected, then Google refused the pictures themselves
  if (google && google.down) $('google-state').textContent = tx('Google is giving no photos right now: {0}. The other sources are used.', google.error);
  // Google asks for a way to report a picture next to wherever it is shown
  const report = panos.current && panos.current.report;
  $('google-report').classList.toggle('hidden', !report);
  if (report) $('google-report').href = report;
}

// Options, opened because Google is wanted (the call-out on the first screen, a locked place):
// a gold light for a few seconds behind what to look at there, so nobody has to search for it.
let shining = 0;
function openGoogleOptions() {
  showScreen('options');
  refreshUsage();
  const at = !google ? $('google-connect') // not connected: the switch and the box the key goes in
    : usage().month >= cap() ? $('google-usage') // connected, and this month's tiles are used up
    : $('promo').classList.contains('on') ? null : $('google-connect'); // refused: the reason is there
  if (!at) return;
  at.closest('details').open = true;
  at.scrollIntoView({ block: 'center' });
  document.querySelector('.shine')?.classList.remove('shine'); // one light at a time
  void at.offsetWidth; // asked for again while it is lit: the light starts over
  at.classList.add('shine');
  clearTimeout(shining);
  shining = setTimeout(() => at.classList.remove('shine'), 3400);
}

// In the game: R twice within three seconds puts this place back as it was.
let resetArmed = -10;
function resetKey() {
  if (clock - resetArmed > 3) {
    resetArmed = clock;
    ui.toast(world.editCount() ? 'Press R again to reset this map' : 'Nothing to reset on this map', 3000);
    return;
  }
  resetArmed = -10;
  const n = world.editCount();
  chests = {};
  saveChests();
  world.resetEdits();
  ui.toast(`Map reset (${n} block${n === 1 ? '' : 's'} put back)`);
}

function showOverlay(show) {
  $('overlay').classList.toggle('hidden', !show);
  if (show) {
    showScreen('main');
    refreshEdits();
    refreshUsage();
  }
}

function enterPlay(viaDrag) {
  const first = !playing;
  playing = true;
  dragLook = viaDrag;
  if (first) keys.clear();
  showOverlay(false);
  if (roam && !inNether(player.x, player.y, player.z)) {
    const top = Math.max(world.topY(Math.floor(player.x), Math.floor(player.z)), world.topY(0, 0));
    if (top > 40 && player.y < top) {
      player.y = top + 3;
      player.vy = 0;
    }
  }
  // from here on the menu is a pause screen over the game, not the title screen
  $('overlay').classList.remove('title');
  $('play').textContent = tx('Back to Game');
  $('hud').classList.remove('hidden');
  $('crosshair').classList.toggle('hidden', viaDrag);
  canvas.style.cursor = viaDrag ? 'crosshair' : '';
  if (viaDrag && first) ui.toast('Could not lock the pointer: drag to look, click to break/place, Esc for the menu', 6000);
}

function leavePlay() {
  playing = false;
  dragLook = false;
  keys.clear();
  clearInterval(repeat);
  canvas.style.cursor = '';
  showOverlay(true);
  if (cars.activeCar) cars.exitCar(player);
}

function startPlay() {
  sfx.unlock();
  const p = canvas.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
  setTimeout(() => {
    if (!locked() && !dragLook) enterPlay(true);
  }, 350);
}

function showClickToPlayPrompt() {
  if (locked() || playing) return;
  if ($('click-to-play-prompt')) return;

  const prompt = document.createElement('div');
  prompt.id = 'click-to-play-prompt';
  prompt.innerHTML = `
    <div class="ctp-card">
      <div class="ctp-icon">🎮</div>
      <div class="ctp-title">Teleportare Reușită!</div>
      <div class="ctp-place">${loc.name}</div>
      <div class="ctp-action">Fă click oriunde pe ecran pentru a juca</div>
    </div>
  `;
  document.body.appendChild(prompt);

  const onKeyDown = (e) => {
    if (['Space', 'Enter', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE'].includes(e.code)) {
      activate(e);
    }
  };

  const activate = (e) => {
    if (e?.code) keys.add(e.code);
    e?.preventDefault();
    prompt.remove();
    window.removeEventListener('click', activate, true);
    window.removeEventListener('pointerdown', activate, true);
    window.removeEventListener('keydown', onKeyDown, true);
    startPlay();
  };

  prompt.addEventListener('click', activate);
  window.addEventListener('click', activate, true);
  window.addEventListener('pointerdown', activate, true);
  window.addEventListener('keydown', onKeyDown, true);
}

function openInventory() {
  keys.clear();
  clearInterval(repeat);
  ui.openInventory();
  if (locked()) document.exitPointerLock();
}

function closeInventory() {
  ui.closeInventory();
  if (!dragLook) startPlay();
}

function respawn() {
  dead = false;
  stats.health = 20;
  stats.food = 20;
  stats.hurtAt = clock;
  ui.hideDeath();
  // whatever happened down in the cave stays there
  mobs.clear((m) => !inNether(m.x, m.y, m.z));
  netherHome = null;
  netherCheck = false;
  warp = 0;
  warpHeld = false;
  const home = panos.nearest(0, 0, 600);
  if (home) travel(home);
  else {
    const [sx, sz] = findSpawn();
    player.placeAt(sx, sz);
  }
  if (!dragLook) startPlay();
}

document.addEventListener('pointerlockchange', () => {
  if (locked()) enterPlay(false);
  else if (!dragLook && !ui.inventoryOpen && !worldMap?.isOpen && !dead) leavePlay();
});

// ---------------------------------------------------------------- input

let dragged = 0;
const mouse = new THREE.Vector2(); // cursor in normalised device coordinates (drag-look mode aims with it)
const cursorRay = new THREE.Vector3();
const trackCursor = (e) => mouse.set((e.clientX / window.innerWidth) * 2 - 1, 1 - (e.clientY / window.innerHeight) * 2);
document.addEventListener('mousemove', (e) => {
  trackCursor(e);
  if (dead || ui.inventoryOpen || worldMap?.isOpen) return;
  if (missiles && missiles.activeMissile) missiles.steer(e.movementX, e.movementY);
  else if (locked()) player.look(e.movementX, e.movementY);
  else if (playing && dragLook && e.buttons) {
    dragged += Math.abs(e.movementX) + Math.abs(e.movementY);
    player.look(-e.movementX * 1.4, -e.movementY * 1.4); // grab the scene and pull it
  }
});

// Step into a panorama: the picture cross-fades while the camera glides to where it was taken.
function travel(node) {
  if (!node) return;
  roam = false;
  panos.goTo(node, true);
}

// Step to the neighbouring panorama `offset` radians to the right of the view direction.
function hop(offset, quiet) {
  const node = panos.snapped;
  if (!node || panos.hop || panos.pending) return;
  const l = panos.linkToward(node, -player.yaw + offset, offset ? 0.85 : 1.15);
  if (l) {
    travel(l.node);
    tire(0.06);
  } else if (!quiet) ui.toast('No way on in this direction — see the arrows on the ground', 1400);
}

// Fine-tune how the current photo sits on the geometry (saved per image sequence).
function calibrate(code, big) {
  const node = panos.current;
  if (!node) return false;
  const step = big ? 4 : 1;
  const d = {
    ArrowLeft: { heading: -0.5 * step }, ArrowRight: { heading: 0.5 * step },
    ArrowUp: { height: 0.1 * step }, ArrowDown: { height: -0.1 * step },
    KeyI: { dz: -0.5 * step }, KeyK: { dz: 0.5 * step }, KeyJ: { dx: -0.5 * step }, KeyL: { dx: 0.5 * step },
    Backspace: { reset: true },
  }[code];
  if (!d) return false;
  const c = panos.adjust(node, d);
  ui.toast(`Alignment · heading ${c.heading >= 0 ? '+' : ''}${c.heading}° · camera ${c.height.toFixed(1)} m · shift ${c.offset[0].toFixed(1)}, ${c.offset[1].toFixed(1)} m`, 4000);
  return true;
}

let lastW = 0;
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || dead) return;
  if (e.code === 'KeyM' && !e.repeat) {
    if (e.shiftKey && playing) {
      ui.toggleMap();
    } else {
      if (worldMap.isOpen) {
        worldMap.close();
      } else {
        openWorldMap();
      }
    }
    return;
  }
  if (ui.inventoryOpen) {
    if ((e.code === 'KeyE' || e.code === 'Escape') && !e.repeat) closeInventory();
    else ui.key(e.code);
    return;
  }
  if (worldMap?.isOpen) return;
  if (!playing) return;
  if ((e.code === 'Escape' || e.code === 'Backspace') && missiles && missiles.activeMissile) {
    missiles.teleportBack(player, camera, world);
    ui.toast('🚀 Zbor rachetă anulat - teleportat înapoi!', 2500);
    return;
  }
  if (e.code === 'KeyE' && !e.repeat) {
    if (missiles && missiles.activeMissile) {
      missiles.detonate();
      ui.toast('💥 Rachetă detonată!', 2000);
      return;
    }
    return openInventory();
  }
  if (e.code === 'Escape' && dragLook) return leavePlay();
  if (['Space', 'Tab', 'F3', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(e.code)) e.preventDefault();
  if (calibrating && calibrate(e.code, e.shiftKey)) return;
  keys.add(e.code);
  if (e.repeat) return;
  const now = performance.now();
  // (Space needs nothing here: held, it jumps; see frame() and Player)
  if (e.code === 'KeyX' && !e.repeat) {
    if (missiles && missiles.activeMissile) {
      missiles.detonate();
      ui.toast('💥 Rachetă detonată manual!', 2000);
    } else {
      roam = true;
      panos.unlock();
      if (missiles.launch(player, camera)) {
        ui.toast('🚀 Rachetă lansată! [A / D] Inerție Rotație • [Mouse] Avion Smooth • [Space/W] Boost • [S] Frână • [R] Stop rotire • [Click/E/X] Detonare', 4500);
      }
    }
    return;
  }
  if (e.code === 'KeyR' && missiles && missiles.activeMissile) {
    missiles.rollVel = 0;
    ui.toast('Rotație oprită!', 1500);
    return;
  }
  if (e.code === 'KeyR' && (cars.activeCar || cars.hasFlippedNear(player.x, player.z, 6.0))) {
    if (cars.flipCar(player)) {
      ui.toast('Mașina a fost repusă pe roți!', 2500);
      return;
    }
  }
  if (e.code === 'KeyF') {
    if (missiles && missiles.activeMissile) {
      missiles.detonate();
      ui.toast('💥 Rachetă detonată!', 2000);
      return;
    }
    if (cars.isRagdolling) {
      cars.ragdollManager.recover(player);
      ui.toast('Te-ai ridicat în picioare!', 2000);
      return;
    }
    if (cars.activeCar) {
      cars.exitCar(player);
      ui.toast('Ai ieșit din mașină', 2000);
    } else {
      const near = cars.nearestCar(player.x, player.z, 4.0);
      if (near) {
        roam = true;
        panos.unlock();
        cars.enterCar(near, player);
        ui.toast('Ai urcat în mașină! Conduce cu W A S D.', 3000);
      } else {
        const sx = player.x - Math.sin(player.yaw) * 3.0;
        const sz = player.z - Math.cos(player.yaw) * 3.0;
        const newCar = cars.spawnCar(sx, undefined, sz, player.yaw);
        roam = true;
        panos.unlock();
        cars.enterCar(newCar, player);
        ui.toast('Ai urcat în mașină! Conduce cu W A S D.', 3000);
      }
    }
    return;
  }
  if (e.code === 'KeyB') {
    if (cars.activeCar) {
      sfx.horn();
    } else {
      const sx = player.x - Math.sin(player.yaw) * 3.5;
      const sz = player.z - Math.cos(player.yaw) * 3.5;
      cars.spawnCar(sx, undefined, sz, player.yaw);
      sfx.carDoor();
      ui.toast('Mașină nouă creată! Apasă [F] pentru a o conduce.', 3000);
    }
    return;
  }
  if (e.code === 'KeyC') {
    if (missiles && missiles.activeMissile) {
      missiles.toggleCamera();
      ui.toast(missiles.activeMissile.cameraMode === 'FIRST_PERSON' ? 'Cameră: Vedere din botul rachetei (1st Person)' : 'Cameră: Vedere exterioară (3rd Person)', 2500);
      return;
    }
    if (cars.activeCar) {
      cars.toggleCamera();
      ui.toast(cars.camMode === 'CHASE' ? 'Cameră: Vedere exterioară (3rd Person)' : 'Cameră: Vedere din cabină (1st Person)', 2500);
      return;
    }
  }
  if (!roam && e.code in HOPS) return hop(HOPS[e.code]);
  if (e.code === 'KeyW') {
    if (now - lastW < 280) player.sprint = true;
    lastW = now;
  } else if (e.code === 'KeyG' && roam) {
    // off the photos: straight back to the street
    if (inNether(player.x, player.y, player.z)) {
      warp = 1; // no waiting this way out, but the same letting go on arrival
      portalAt = clock;
      sfx.travel();
      leaveNether();
    } else {
      const n = panos.nearest(player.x, player.z, 400);
      if (n) travel(n);
      else {
        const top = Math.max(world.topY(Math.floor(player.x), Math.floor(player.z)), world.topY(0, 0));
        if (top > 0) {
          player.y = top + 3;
          player.vy = 0;
          ui.toast('Sus pe suprafață!');
        }
      }
    }
  } else if (e.code === 'KeyV') {
    // a car at the crosshair gets its body, whatever is in the hand
    const t = aim();
    if (t) carBody(t, aimDirection());
  } else if (e.code === 'KeyT') {
    const isShift = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const kind = isShift ? 'sakura' : 'oak';
    const t = aim(12);
    let px, py, pz;
    if (t) {
      px = t.x + t.nx;
      py = t.y + (t.ny > 0 ? 1 : 0);
      pz = t.z + t.nz;
    } else {
      const dir = player.direction();
      px = Math.floor(player.x + dir[0] * 3.5);
      pz = Math.floor(player.z + dir[2] * 3.5);
      py = world.topY(px, pz) + 1;
    }
    const count = plantTree(world, px, py, pz, kind);
    if (count > 0) {
      sfx.step('grass');
      fx.burst(px + 0.5, py + 1.5, pz + 0.5, kind === 'sakura' ? B.SAKURA : B.LEAVES);
      ui.toast(kind === 'sakura' ? 'Copac Sakura plantat! (Shift+T)' : 'Copac Stejar plantat! [T] (Shift+T pentru Sakura)', 3000);
    } else {
      ui.toast('Nu este loc pentru un copac aici.', 2000);
    }
  } else if (e.code === 'KeyR') {
    resetKey();
  } else if (e.code === 'KeyP') {
    photoOn = !photoOn;
    setPhoto();
    ui.toast(photoOn ? 'Photo on' : 'Photo off: the block world underneath');
  } else if (e.code === 'KeyC') {
    calibrating = !calibrating;
    setPhoto();
    ui.toast(calibrating ? 'Alignment: ← → heading · ↑ ↓ camera height · I J K L shift · Backspace reset' : 'Alignment off', 6000);
  } else if (e.code.startsWith('Digit')) {
    const n = +e.code.slice(5);
    if (n >= 1 && n <= 9) ui.select(n - 1);
  } else if (e.code === 'F3' || e.code === 'Backquote') debug = !debug;
  else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
    radius = Math.max(4, Math.min(28, radius + (e.code === 'BracketRight' ? 2 : -2)));
    world.setRadius(radius);
    localStorage.setItem('geocrafter:radius', radius);
    ui.toast(`Block detail distance: ${radius * 16} m`);
  }
});
document.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

canvas.addEventListener('wheel', (e) => {
  if (!playing || dead) return;
  e.preventDefault();
  ui.select(ui.selected + (e.deltaY > 0 ? 1 : -1));
}, { passive: false });

// ---------------------------------------------------------------- acting on the world

// Where the player is pointing: the crosshair, or the cursor when the pointer is not locked.
function aimDirection() {
  if (!dragLook) return player.direction();
  cursorRay.set(mouse.x, mouse.y, 0.5).unproject(camera).sub(camera.position).normalize();
  return [cursorRay.x, cursorRay.y, cursorRay.z];
}

function aim(maxDist) {
  const [dx, dy, dz] = aimDirection();
  return world.raycast(camera.position.x, camera.position.y, camera.position.z, dx, dy, dz, maxDist ?? (roam ? REACH_WALK : REACH_LOCKED));
}

// A block placed here would box in the player or the camera (in the middle of a jump: anywhere
// between where they stand and where it has them).
function inTheWay(x, y, z) {
  const c = camera.position;
  return player.overlapsBlock(x, y, z) || (Math.abs(x + 0.5 - c.x) < 0.85 && Math.abs(z + 0.5 - c.z) < 0.85 && c.y > y - 0.35 && c.y - player.lift < y + 1.35);
}

// The bow is drawn while the button is held and loosed when it is let go: the longer the draw
// (up to a second), the faster and flatter the arrow flies and the harder it hits.
let drawing = -1; // game time the draw began, -1 = not drawing
function loose() {
  if (drawing < 0) return;
  const pull = Math.min(1, Math.max(0.25, (clock - drawing) / 0.9));
  drawing = -1;
  hand.pull = 0;
  if (dead || ui.held !== I.BOW) return;
  const d = aimDirection(), c = camera.position;
  const speed = 14 + pull * 36;
  mobs.shoot(c.x + d[0] * 0.6, c.y - 0.12 + d[1] * 0.6, c.z + d[2] * 0.6, d[0] * speed, d[1] * speed, d[2] * speed, Math.round(3 + pull * 7), true);
  hand.swing();
  sfx.bow();
}

// The sword cuts what gives way to a blade and clangs off the rest.
const SOFT = new Set([B.LEAVES, B.SAKURA, B.CANOPY, B.GLASS, B.GLASS_DARK, B.WINDOW, B.WINDOW_DARK, B.GLASS_PANE, B.ICE, B.HAY, B.PUMPKIN, B.MELON]);

// What a block sounds like when it is dug, put down or walked on.
const soundOf = (id) => SOUND[id];

// ---- the portal. An upright frame of obsidian, its opening at least two blocks wide and three
// high, lit with the flint: the opening fills with the portal.
// (on the street nobody walks: a portal there is gone through with a click)
const portalHint = () => (roam ? 'Portal lit · right-click it, or step in and wait' : 'Portal lit · right-click it to go through');

function lightPortal(t) {
  if (t.id !== B.OBSIDIAN) return false;
  const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
  for (const along of ['x', 'z']) {
    const seen = new Map(), stack = [[x, y, z]];
    let ok = true;
    while (stack.length && ok) {
      const [cx, cy, cz] = stack.pop();
      const k = `${cx},${cy},${cz}`;
      if (seen.has(k)) continue;
      const id = world.getBlock(cx, cy, cz);
      if (id === B.OBSIDIAN) continue; // the frame
      if (id !== B.AIR || seen.size >= 60) ok = false; // something in the way, or no frame around it
      else {
        seen.set(k, [cx, cy, cz]);
        stack.push([cx, cy + 1, cz], [cx, cy - 1, cz]);
        if (along === 'x') stack.push([cx + 1, cy, cz], [cx - 1, cy, cz]);
        else stack.push([cx, cy, cz + 1], [cx, cy, cz - 1]);
      }
    }
    if (!ok || !seen.size) continue;
    const cells = [...seen.values()];
    const span = (i) => Math.max(...cells.map((c) => c[i])) - Math.min(...cells.map((c) => c[i])) + 1;
    const wide = span(along === 'x' ? 0 : 2), high = span(1);
    if (wide < 2 || high < 3 || cells.length !== wide * high) continue;
    world.setBlocks(cells.map((c) => [...c, B.PORTAL]));
    sfx.level();
    ui.toast(portalHint(), 4000);
    return true;
  }
  ui.toast('A portal needs an upright obsidian frame: at least 2 blocks wide and 3 high inside', 4500);
  return false;
}

// A portal goes out when its frame is broken (or any part of it).
function closePortal(x, y, z) {
  const gone = new Map(), stack = [[x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]];
  while (stack.length && gone.size < 400) {
    const [cx, cy, cz] = stack.pop();
    const k = `${cx},${cy},${cz}`;
    if (gone.has(k) || world.getBlock(cx, cy, cz) !== B.PORTAL) continue;
    gone.set(k, [cx, cy, cz, B.AIR]);
    stack.push([cx + 1, cy, cz], [cx - 1, cy, cz], [cx, cy + 1, cz], [cx, cy - 1, cz], [cx, cy, cz + 1], [cx, cy, cz - 1]);
  }
  if (gone.size) world.setBlocks([...gone.values()]);
}

// The portal egg: a whole portal at once, lit, in the frame of four by five the Nether's own has.
// It stands on the ground where the egg is pointed, across the way the player looks.
function openPortal(t, dir) {
  hand.swing();
  const x = t.x + t.nx, z = t.z + t.nz;
  let y = t.y + t.ny;
  // pointed at a wall or a ceiling: down to the floor in front of it
  for (let drop = 0; drop < 12 && world.getBlock(x, y - 1, z) === B.AIR; drop++) y--;
  // the opening's middle comes as near as it can to the spot pointed at
  const alongZ = Math.abs(dir[0]) > Math.abs(dir[2]);
  const c = camera.position;
  const from = Math.round(alongZ ? c.z + dir[2] * t.t : c.x + dir[0] * t.t) - 2;
  // on a kerb or a slope the frame stands on the highest ground under it
  for (let up = 0; up < 3; up++, y++) {
    const cells = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 5; j++) cells.push([alongZ ? x : from + i, y + j, alongZ ? from + i : z, i % 3 && j % 4 ? B.PORTAL : B.OBSIDIAN]);
    }
    if (!cells.every(([cx, cy, cz]) => cy >= MIN_EDIT_Y && world.isLoaded(cx, cz) && vacant(cx, cy, cz) && !inTheWay(cx, cy, cz))) continue;
    world.setBlocks(cells);
    sfx.level();
    return ui.toast(portalHint(), 4000);
  }
  ui.toast('No room for a portal here');
}

// ---- the Nether: a cavern under every place (nether.js). A portal takes the player down to
// the ledge in its middle and the portal there back up, to the photo nearest to where they left.
let netherHome = null; // [x, z] of the portal that was used
let portalAt = -10; // when a portal was last gone through: no bouncing straight back
let netherCheck = false; // just arrived: make sure the cavern is there once its chunks are
let lavaAt = -10; // when lava last burned the player
let lifeAt = 0; // when the cavern was last looked over for who lives in it
const REGION_NAMES = ['nether wastes', 'crimson forest', 'warped forest', 'soul sand valley', 'basalt deltas'];
const netherFog = new THREE.Color(...REGION_FOG[0]);

// A portal takes hold slowly, as in the game this is borrowed from: standing in one (or having
// clicked one from a photo), the view begins to swim and the portal's purple closes over it,
// and after four seconds one is through. Stepping out in time, or moving on, calls it off.
const WARP_SECONDS = 4;
let warp = 0; // 0..1: how far a portal has taken hold of the player
let warpHeld = false; // set going by a click: it runs on without standing in the portal
let bent = false; // the projection was bent last frame and has to be put right

function usePortal() {
  if (clock - portalAt > 2.5) warpHeld = true;
}

function throughPortal() {
  portalAt = clock;
  warpHeld = false;
  sfx.travel();
  if (inNether(player.x, player.y, player.z)) return leaveNether();
  netherHome = [player.x, player.z];
  roam = true;
  panos.unlock();
  [player.x, player.y, player.z] = NETHER_SPAWN;
  player.vx = player.vy = player.vz = player.lift = 0;
  player.yaw = Math.PI; // the portal back is behind: look out over the cavern
  player.pitch = 0;
  netherCheck = true;
  ui.toast('Nether · W A S D walk, Space jump · portal or G: go back', 6000);
}

// The view swims: stretched along a line that keeps turning, the more the further the portal
// has taken hold (the sum is the original's).
const WARP_AXIS = new THREE.Vector3(0, Math.SQRT1_2, Math.SQRT1_2);
const bendTurn = new THREE.Matrix4(), bendPull = new THREE.Matrix4();
function bendView() {
  if (warp <= 0 && !bent) return;
  camera.updateProjectionMatrix();
  bent = warp > 0;
  if (!bent) return;
  const h = (5 / (warp * warp + 5) - warp * 0.04) ** 2;
  const a = clock * 400 * (Math.PI / 180); // twenty degrees a tick, twenty ticks a second
  camera.projectionMatrix.multiply(bendTurn.makeRotationAxis(WARP_AXIS, a)).multiply(bendPull.makeScale(1 / h, 1, 1)).multiply(bendTurn.makeRotationAxis(WARP_AXIS, -a));
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

// And the portal's own picture closes over it, a frame every twentieth of a second: there at
// once but faint, little more for a long while, everything at the end.
const veil = $('portal-veil'), veilCtx = veil.getContext('2d');
veilCtx.imageSmoothingEnabled = false;
let veiled = false;
function drawVeil() {
  if (warp <= 0) {
    if (veiled) veil.style.opacity = 0;
    veiled = false;
    return;
  }
  veiled = true;
  veil.style.opacity = (warp < 1 ? warp ** 4 * 0.8 + 0.2 : 1) * Math.min(1, warp * 8);
  const strip = strips.get('portal'), tick = Math.floor(clock * 20);
  veilCtx.clearRect(0, 0, 16, 16);
  if (strip) {
    const side = strip.naturalWidth;
    veilCtx.drawImage(strip, 0, (tick % Math.floor(strip.naturalHeight / side)) * side, side, side, 0, 0, 16, 16);
  } else {
    // the game's own drawing is a single frame: it drifts
    const tile = layerCanvas(TEX_TOP[B.PORTAL]), o = tick % 16;
    veilCtx.drawImage(tile, 0, o - 16);
    veilCtx.drawImage(tile, 0, o);
  }
}

function leaveNether() {
  mobs.clear((m) => !inNether(m.x, m.y, m.z));
  const home = netherHome || [0, 0];
  netherHome = null;
  netherCheck = false;
  const n = panos.nearest(home[0], home[1], 600);
  if (n) return travel(n);
  // no photo to stand in: back on the street above
  player.placeAt(Math.floor(home[0]), Math.floor(home[1]));
}

// Where one can stand in the cavern over a column: the lowest dry floor with headroom, or -1.
function netherFloor(x, z) {
  for (let y = NETHER.LAVA + 1; y < NETHER.TOP; y++) {
    if (SOLID[world.getBlock(x, y - 1, z)] && world.getBlock(x, y, z) === B.AIR && world.getBlock(x, y + 1, z) === B.AIR) return y;
  }
  return -1;
}

// Once the cavern's chunks are loaded: is there one at all (the ground may be too low for it),
// and who is about near the way in.
function arriveInNether() {
  if (!world.isLoaded(0, 0)) return;
  netherCheck = false;
  if (SOLID[world.getBlock(0, NETHER.PLAT, 1)] || !SOLID[world.getBlock(0, NETHER.PLAT - 1, 1)]) {
    ui.toast('There is no room for the Nether under this place', 4000);
    return leaveNether();
  }
  for (let tries = 0; tries < 40 && mobs.count('piglin') < 3; tries++) {
    const a = Math.random() * Math.PI * 2, d = 9 + Math.random() * 14;
    const x = Math.floor(Math.cos(a) * d), z = Math.floor(Math.sin(a) * d);
    const y = netherFloor(x, z);
    if (y > 0) mobs.spawn('piglin', x, y, z);
  }
}

// Who lives down there: zombified piglins in the wastes and the crimson forest, skeletons in
// the valley of soul sand, nobody among the warped fungi or on the basalt. They turn up a way
// off, behind the player if there is room, a few at a time.
function netherLife() {
  if (clock - lifeAt < 2.5) return;
  lifeAt = clock;
  if (mobs.list.length >= 7) return;
  const look = player.direction();
  for (let tries = 0; tries < 8; tries++) {
    const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 16;
    if (tries < 5 && Math.cos(a) * look[0] + Math.sin(a) * look[2] > 0.2) continue;
    const x = Math.floor(player.x + Math.cos(a) * d), z = Math.floor(player.z + Math.sin(a) * d);
    const region = netherRegion(x, z);
    const kind = region === REGION.SOUL ? 'skeleton' : region === REGION.WASTES || region === REGION.CRIMSON ? 'piglin' : null;
    const y = kind && world.isLoaded(x, z) ? netherFloor(x, z) : -1;
    if (y > 0 && mobs.spawn(kind, x, y, z)) return;
  }
}

// ---- chests: 27 slots each, kept per place like the block changes.
const CHESTS_KEY = world.storageKey.replace('geocrafter:v2:', 'geocrafter:chests:');
let chests = {};
try {
  chests = JSON.parse(localStorage.getItem(CHESTS_KEY)) || {};
} catch (e) {
  // unreadable: the chests are empty
}
const saveChests = () => {
  if (Object.keys(chests).length) localStorage.setItem(CHESTS_KEY, JSON.stringify(chests));
  else localStorage.removeItem(CHESTS_KEY);
};

function openChest(x, y, z) {
  const k = `${x},${y},${z}`;
  keys.clear();
  clearInterval(repeat);
  sfx.place('wood');
  ui.openChest(chests[k] ? chests[k].slice() : new Array(27).fill(0), (items) => {
    if (items.some(Boolean)) chests[k] = items;
    else delete chests[k];
    saveChests();
    sfx.place('wood');
  });
  if (locked()) document.exitPointerLock();
}

// A broken chest hands back what fits and loses the rest.
function emptyChest(x, y, z) {
  const k = `${x},${y},${z}`;
  for (const id of chests[k] || []) ui.give(id);
  delete chests[k];
  saveChests();
}

// ---- cars. A car in a street photo is paint on whatever lies behind it: a swing at it digs up
// the road beyond, and a block put behind it shows in front. The game cannot tell where the cars
// are, so the player points one out: aim at the road under the middle of the car's near edge. A
// body goes there (World.addBody), four blocks long, two wide and two high, lying along the
// street (Shift: across it). From then on the car is solid, hides what is behind it and breaks
// like anything else. Pointing at a body takes it away again.
function carBody(t, dir) {
  if (world.isBody(t.x, t.y, t.z)) {
    const n = world.removeBody(t.x, t.y, t.z);
    hand.swing();
    sfx.dig('stone');
    return ui.toast(`Car body removed (${n} block${n === 1 ? '' : 's'})`, 2500);
  }
  if (t.ny !== 1) return ui.toast('Aim at the road under the side of the car that faces you', 3000);
  // 0: the street runs along x, 1: along z. The photos follow the street one after another;
  // away from them, the car is taken to point away from the player.
  const link = !roam && panos.snapped ? panos.links(panos.snapped)[0] : null;
  const view = Math.abs(dir[0]) > Math.abs(dir[2]) ? 0 : 1;
  let along = link ? (Math.abs(Math.sin(link.az)) > Math.abs(Math.cos(link.az)) ? 0 : 1) : view;
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) along = 1 - along;
  const c = camera.position;
  const hit = [c.x + dir[0] * t.t, c.z + dir[2] * t.t], cell = [t.x, t.z], ahead = [dir[0], dir[2]];
  const from = [0, 0], span = [0, 0];
  for (const a of [0, 1]) {
    const len = (span[a] = a === along ? 4 : 2);
    // the way the player looks, the body starts at the spot and runs away from them; the other
    // way it is centred on the spot
    if (a === view) from[a] = ahead[a] > 0 ? cell[a] : cell[a] - len + 1;
    else from[a] = cell[a] - len / 2 + (hit[a] - cell[a] < 0.5 ? 0 : 1);
  }
  const cells = [];
  for (let i = 0; i < span[0]; i++) {
    for (let j = 0; j < span[1]; j++) {
      for (let h = 1; h <= 2; h++) if (!inTheWay(from[0] + i, t.y + h, from[1] + j)) cells.push([from[0] + i, t.y + h, from[1] + j]);
    }
  }
  if (!world.addBody(cells)) return ui.toast('No room here');
  hand.swing();
  sfx.place('stone');
  ui.toast('Car body placed: a hit now breaks the car · wrong? point at it and press again · Shift: crosswise', 4500);
}

// The other half of a door or a bed, if it is still there: [x, y, z] or null.
function mateOf(x, y, z, id) {
  const m = MATE[id];
  return m && world.getBlock(x + m[0], y + m[1], z + m[2]) === m[3] ? [x + m[0], y + m[1], z + m[2]] : null;
}

// What goes with the blocks that were just taken out of `cells` ([x, y, z, ...] each): whatever
// stood on one (a torch, a carpet, a door) or hung on its side (a ladder, a torch on the wall),
// and in turn whatever those were holding up.
function settle(cells) {
  const queue = cells.slice(), gone = new Map();
  const drop = (x, y, z, id) => {
    const k = `${x},${y},${z}`;
    if (gone.has(k)) return;
    gone.set(k, [x, y, z, B.AIR]);
    queue.push([x, y, z]);
    const mate = mateOf(x, y, z, id);
    if (mate) drop(...mate, MATE[id][3]);
  };
  while (queue.length && gone.size < 4000) {
    const [x, y, z] = queue.pop();
    const up = world.getBlock(x, y + 1, z), kind = KIND[up];
    if ((kind === 'torch' && FACING[up] < 0) || kind === 'carpet' || (kind === 'door' && MATE[up][1] === 1)) drop(x, y + 1, z, up);
    for (let f = 0; f < 4; f++) {
      const id = world.getBlock(x + DX[f], y, z + DZ[f]);
      if ((KIND[id] === 'ladder' || KIND[id] === 'torch') && FACING[id] === (f + 2) % 4) drop(x + DX[f], y, z + DZ[f], id);
    }
  }
  if (gone.size) world.setBlocks([...gone.values()]);
}

// Take a block out of the world, and with it the other half of whatever it is half of.
function clearBlock(x, y, z, id) {
  const mate = mateOf(x, y, z, id);
  const cells = mate ? [[x, y, z, B.AIR], [...mate, B.AIR]] : [[x, y, z, B.AIR]];
  world.setBlocks(cells);
  settle(cells);
}

// ---- the bed. Nobody sleeps on a street: lying down sets it off like TNT, only harder.
function sleepIn(x, y, z, id) {
  hand.swing();
  clearBlock(x, y, z, id);
  ui.toast('You can\'t sleep here…', 1800);
  fx.explode(x + 0.5, y + 0.5, z + 0.5, 5);
}

// ---- doors and hatches swing when they are pushed
function swing(t, dir) {
  const { x, y, z, id } = t;
  if (KIND[id] === 'door') {
    const mate = mateOf(x, y, z, id);
    const list = [[x, y, z, SWING[id]]];
    if (mate) list.push([...mate, SWING[MATE[id][3]]]);
    world.setBlocks(list);
  } else {
    // a hatch stands up against the side the player is looking towards, and lies down again
    const open = PLACE[B.TRAPDOOR].open;
    world.setBlock(x, y, z, id === B.TRAPDOOR ? open[heading(dir)] : B.TRAPDOOR);
  }
  hand.swing();
  sfx.place(soundOf(id));
}

function breakBlock(t) {
  if (t.id === B.BEDROCK) return;
  if (t.id === B.OBSIDIAN && ui.held !== I.PICKAXE) {
    sfx.swing();
    fx.sparks(t.x + 0.5 + t.nx * 0.55, t.y + 0.5 + t.ny * 0.55, t.z + 0.5 + t.nz * 0.55);
    return ui.toast('Obsidian only breaks with a pickaxe', 1600);
  }
  clearBlock(t.x, t.y, t.z, t.id);
  fx.burst(t.x + 0.5, t.y + 0.5, t.z + 0.5, fx.colorOf(t.id), 9, 3.4, 0.12, 0.7);
  sfx.dig(soundOf(t.id));
  if (t.id === B.OBSIDIAN || t.id === B.PORTAL) closePortal(t.x, t.y, t.z);
  if (KIND[t.id] === 'chest') emptyChest(t.x, t.y, t.z);
  // what the street is made of goes into the inventory the first time it is dug up; an ore
  // gives its stone, a portal gives nothing
  const got = t.id === B.DIAMOND_ORE ? I.DIAMOND : t.id === B.PORTAL ? 0 : ITEM_OF[t.id];
  if (ui.give(got)) {
    sfx.pick();
    ui.toast(`Added to inventory: ${itemName(got)}`, 1600);
  }
  addXp(0.2);
  tire(0.02);
}

// ---- putting a block down. Most go where they are pointed; the shaped ones also choose a
// heading or a half from how the player stands and where exactly they point (blocks.js: PLACE).

// The way the player looks, as a heading: 0 north (-z), 1 east, 2 south, 3 west.
const heading = (dir) => (Math.abs(dir[0]) > Math.abs(dir[2]) ? (dir[0] > 0 ? 1 : 3) : dir[2] > 0 ? 2 : 0);
// The heading of a unit step along x or z, or -1 for none.
const sideOf = (nx, nz) => (nz < 0 ? 0 : nx > 0 ? 1 : nz > 0 ? 2 : nx < 0 ? 3 : -1);
// A cell something can be put into: air, or a liquid it pushes aside.
const vacant = (x, y, z) => {
  const id = world.getBlock(x, y, z);
  return id === B.AIR || id === B.WATER || id === B.LAVA;
};

// -> the cells to fill ([x, y, z, id] each), or null if the item cannot go there.
function placing(item, t, dir) {
  const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
  const p = PLACE[item];
  if (p && p.how === 'slab') {
    // a second slab against the open face of the first makes the whole block again
    const whole = (id, low) => ITEM_OF[id] === item && id === p.ids[low ? 0 : 1];
    if ((t.ny === 1 && whole(t.id, true)) || (t.ny === -1 && whole(t.id, false))) return [[t.x, t.y, t.z, SLAB_OF[item]]];
    if (!vacant(x, y, z)) return null;
    // the upper half of a wall, or the underside of something: the slab goes up under it
    const at = camera.position.y + dir[1] * t.t - t.y;
    return [[x, y, z, p.ids[t.ny === -1 || (t.ny === 0 && at > 0.5) ? 1 : 0]]];
  }
  if (!vacant(x, y, z)) return null;
  if (!p) return [[x, y, z, item]];
  const f = heading(dir);
  switch (p.how) {
    case 'away': return [[x, y, z, p.ids[f]]]; // stairs climb away from the player
    case 'front': return [[x, y, z, p.ids[(f + 2) % 4]]]; // a chest faces them
    case 'door': {
      // on the near edge of its cell, with room for the upper half
      if (!vacant(x, y + 1, z)) return null;
      const e = (f + 2) % 4;
      return [[x, y, z, p.ids[e]], [x, y + 1, z, p.upper[e]]];
    }
    case 'bed': {
      const hx = x + DX[f], hz = z + DZ[f];
      if (!vacant(hx, y, hz)) return null;
      return [[x, y, z, p.ids[f]], [hx, y, hz, p.heads[f]]];
    }
    case 'wall': {
      // against the wall that was pointed at; pointed at a floor, against the wall ahead
      const side = t.ny === 0 ? sideOf(-t.nx, -t.nz) : f;
      const wall = world.getBlock(x + DX[side], y, z + DZ[side]);
      return SOLID[wall] && !MODEL[wall] ? [[x, y, z, p.ids[side]]] : null;
    }
    case 'torch':
      if (t.ny === -1) return null;
      return [[x, y, z, t.ny === 1 ? p.ids[0] : p.wall[sideOf(-t.nx, -t.nz)]]];
    default: return [[x, y, z, p.ids[0]]];
  }
}

function primary() {
  const item = ui.held;
  const dir = aimDirection();
  const t = aim();
  hand.swing();
  const hit = mobs.pick(camera.position, dir, Math.min(MELEE, t ? t.t : Infinity));
  if (hit) {
    mobs.hurt(hit.mob, item === I.SWORD ? 7 : item === I.PICKAXE ? 4 : 2, dir[0], dir[2]);
    sfx.hit();
    sfx.bones();
    return;
  }
  // (the arrows and rings on the road only show the way: a click on one would be a step taken
  // by mistake, so stepping is left to the keys)
  if (!t) return sfx.swing();
  if (item === I.SWORD && !SOFT.has(t.id)) {
    sfx.swing();
    const c = camera.position;
    if (t.t < MELEE) fx.sparks(c.x + dir[0] * t.t, c.y + dir[1] * t.t, c.z + dir[2] * t.t);
    return;
  }
  breakBlock(t);
}

function secondary() {
  const item = ui.held;
  if (item === I.MISSILE) {
    roam = true;
    panos.unlock();
    if (missiles.launch(player, camera)) {
      hand.swing();
      ui.toast('🚀 Rachetă lansată! [A / D] Inerție Rotație • [Mouse] Avion Smooth • [Space/W] Boost • [S] Frână • [R] Stop rotire • [Click/E/X] Detonare', 4500);
    }
    return;
  }
  if (item === I.BOW) return; // see loose()
  if (FOOD[item]) {
    if (stats.food >= 20) return ui.toast('You are not hungry');
    stats.food = Math.min(20, stats.food + FOOD[item]);
    hand.swing();
    sfx.eat();
    return;
  }
  const dir = aimDirection();
  const t = aim();
  if (item === I.FLINT) {
    hand.swing();
    sfx.flint();
    if (!t) return;
    const c = camera.position;
    if (!fx.ignite(t.x, t.y, t.z) && !lightPortal(t)) fx.sparks(c.x + dir[0] * t.t, c.y + dir[1] * t.t, c.z + dir[2] * t.t);
    return;
  }
  const nearCar = cars.nearestCar(player.x, player.z, 3.8);
  if (nearCar && item !== I.DRIVABLE_CAR && !cars.activeCar && (keys.has('ShiftLeft') || !item)) {
    roam = true;
    panos.unlock();
    cars.enterCar(nearCar, player);
    ui.toast('Ai urcat în mașină! Conduce cu W A S D.', 3000);
    return;
  }
  if (!t) return;
  // things in the world that are used rather than built on
  if (t.id === B.PORTAL) return usePortal();
  if (!keys.has('ShiftLeft')) {
    const kind = KIND[t.id];
    if (kind === 'chest') return openChest(t.x, t.y, t.z);
    if (kind === 'bed') return sleepIn(t.x, t.y, t.z, t.id);
    if (kind === 'door' || kind === 'trapdoor') return swing(t, dir);
    if (t.id === B.CRAFTING_TABLE) return openInventory();
  }
  const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
  if (item === I.DRIVABLE_CAR) {
    cars.spawnCar(x + 0.5, y, z + 0.5, player.yaw);
    hand.swing();
    sfx.carDoor();
    ui.toast('Mașină plasată! Apasă [F] pentru a conduce.', 3000);
    return;
  }
  if (item === I.SAPLING || item === I.SAPLING_SAKURA) {
    const kind = item === I.SAPLING_SAKURA ? 'sakura' : 'oak';
    const placed = plantTree(world, x, y, z, kind);
    hand.swing();
    sfx.step('grass');
    fx.burst(x + 0.5, y + 1.5, z + 0.5, kind === 'sakura' ? B.SAKURA : B.LEAVES);
    ui.toast(kind === 'sakura' ? 'Ai plantat un copac Sakura!' : 'Ai plantat un copac Stejar!', 2500);
    return;
  }
  if (item === I.CAR) return carBody(t, dir);
  if (item === I.EGG_PORTAL) return openPortal(t, dir);
  if (EGGS[item]) {
    hand.swing();
    if (mobs.spawn(EGGS[item], x, y, z)) sfx.pop();
    else ui.toast(mobs.list.length ? 'No room here (or too many creatures)' : 'No room here');
    return;
  }
  if (!isBlock(item)) return;
  const cells = placing(item, t, dir);
  if (!cells || (SOLID[item] && cells.some(([cx, cy, cz]) => inTheWay(cx, cy, cz)))) return;
  // a fill block in open air joins what the street camera saw (a van is taller than a car's
  // body); anywhere else it is a block like the rest
  if (!(item === B.FILL && world.addBody([[x, y, z]]))) {
    if (!world.isLoaded(x, z) || cells.some((c) => c[1] < MIN_EDIT_Y)) return;
    world.setBlocks(cells);
  }
  hand.swing();
  sfx.place(soundOf(item) === 'glass' ? 'stone' : soundOf(item)); // glass only tinkles when it breaks
}

function act(button) {
  if (dead || !spawned) return;
  if (missiles && missiles.activeMissile) {
    missiles.detonate();
    ui.toast('💥 Rachetă detonată manual!', 2000);
    return;
  }
  if (button === 0) primary();
  else if (button === 2) secondary();
  else if (button === 1) {
    const t = aim();
    if (t) ui.setSlot(ITEM_OF[t.id]);
  }
}

let repeat = null;
function press(button) {
  if (button === 2 && ui.held === I.BOW && !dead) {
    drawing = clock;
    return;
  }
  act(button);
  clearInterval(repeat);
  const item = ui.held;
  const every = button === 0 ? (item === I.SWORD ? 0 : item === I.PICKAXE ? 320 : 480) : button === 2 && isBlock(item) ? 250 : 0;
  if (every) repeat = setInterval(() => act(button), every);
}

canvas.addEventListener('mousedown', (e) => {
  if (!playing || dead) return;
  if (!locked() && !worldMap?.isOpen && !ui.inventoryOpen) {
    canvas.requestPointerLock();
  }
  e.preventDefault();
  sfx.unlock();
  if (dragLook) {
    dragged = 0; // decided on release: a drag looks around, a click acts
    if (e.button === 2 && ui.held === I.BOW) drawing = clock;
    return;
  }
  press(e.button);
});
canvas.addEventListener('click', () => {
  if (playing && !locked() && !worldMap?.isOpen && !ui.inventoryOpen) {
    canvas.requestPointerLock();
  }
});
window.addEventListener('mouseup', (e) => {
  clearInterval(repeat);
  if (playing && dragLook && e.target === canvas && dragged < 5) {
    trackCursor(e); // a click may arrive without any mouse movement before it
    if (drawing >= 0) {
      drawing = Math.min(drawing, clock - 0.6); // a plain click still sends a decent shot
      loose();
    } else act(e.button);
  } else if (e.button === 2) loose();
  drawing = -1;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------- loop

let last = performance.now();
let fps = 60;
let slow = 0;
let lookKey = '';
let wasHop = false;
let arrivedAt = 0; // game time the last step between photos ended
let spawnedAt = 0;

const TYPE_NAMES = {
  residential: 'Clădire rezidențială',
  apartments: 'Bloc de locuințe',
  house: 'Casă',
  commercial: 'Clădire comercială',
  retail: 'Magazin / Comercial',
  office: 'Clădire de birouri',
  school: 'Școală',
  hospital: 'Spital',
  church: 'Biserică',
  cathedral: 'Catedrală',
  university: 'Universitate',
  kindergarten: 'Grădiniță',
  hotel: 'Hotel',
  dormitory: 'Cămin',
  industrial: 'Clădire industrială',
};

function describeTarget() {
  const t = aim(260);
  if (!t) {
    lookKey = '';
    ui.setTarget('');
    return;
  }

  // Ignore ground / road / natural terrain blocks so looking at the street doesn't trigger building names
  if (
    t.id === B.ASPHALT ||
    t.id === B.ROAD_LINE ||
    t.id === B.PAVING ||
    t.id === B.PAVEMENT ||
    t.id === B.GRASS ||
    t.id === B.DIRT ||
    t.id === B.SAND ||
    t.id === B.WATER ||
    t.id === B.GRAVEL ||
    t.id === B.TURF
  ) {
    lookKey = '';
    ui.setTarget('');
    return;
  }

  const key = `${t.x},${t.z}`;
  if (key === lookKey) return;
  lookKey = key;
  world.queryBuilding(t.x, t.z).then((info) => {
    if (lookKey !== key) return;
    if (!info) {
      ui.setTarget('');
      return;
    }
    const h = info.height ? ` · ${info.height.toFixed(1)} m` : '';
    let name = '';
    if (info.source === 'PLATEAU') {
      name = `PLATEAU building ${info.id}`;
    } else if (info.source === '3D BAG') {
      name = `BAG ${info.id}${info.year ? ' · ' + info.year : ''}`;
    } else {
      // OpenStreetMap building
      if (info.name) {
        // Real building name from OpenStreetMap (e.g. "Primăria", "Palatul Culturii")
        name = info.housenumber ? `${info.name} (${info.housenumber})` : info.name;
      } else if (info.poi && info.poi.hasRealName) {
        // Business / facility with a genuine specific name (e.g. "Catena · Farmacie", "Lidl · Supermarket")
        name = `${info.poi.name} · ${info.poi.category}`;
      } else if (info.housenumber) {
        // Real address number
        name = info.poi && info.poi.category ? `Clădire ${info.housenumber} · ${info.poi.category}` : `Clădire ${info.housenumber}`;
      } else if (info.poi && info.poi.category) {
        // Specific category
        name = info.poi.category;
      } else if (info.type && TYPE_NAMES[info.type.toLowerCase()]) {
        name = TYPE_NAMES[info.type.toLowerCase()];
      } else if (info.source && info.source !== 'OpenStreetMap') {
        name = info.source;
      } else {
        name = 'Clădire';
      }
    }
    ui.setTarget(name + h);
  });
}

function hud() {
  const place = ui.updatePlace(player.x, player.z);
  let html = `<b>${place ? place.name : loc.name}</b>\n`;
  const n = panos.current;
  if (n) {
    html += `${tx('Photo: {0} · {1} · {2}', n.author || tx('anonymous'), n.date, n.license || (n.exact ? tx('open data') : n.provider + ' (CC BY-SA 4.0)'))}\n`;
    if (inNether(player.x, player.y, player.z)) html += tx('Nether ({0}) · portal or G: go back', tx(REGION_NAMES[netherRegion(Math.floor(player.x), Math.floor(player.z))]));
    else if (roam) html += tx('Off the photos · G: back to the nearest one');
    else html += tx(panos.pending ? 'Loading the next photo…' : 'W A S D: step along the arrows · Space: jump');
  } else if (panos.searching() || panos.pending) html += tx('Looking for 360° street photos…');
  else html += tx('Block world · W A S D: walk · Space: jump');
  const pending = world.inflight.size + world.farInflight.size;
  if (pending) html += `\n${tx('Loading the map… ({0})', pending)}`;
  for (const [name, msg] of panos.errors) html += `\n<span class="dbg">${name}: ${msg}</span>`;
  if (debug) {
    const [lon, lat] = proj.blockToLonLat(player.x, player.z);
    const r = renderer.info.render;
    html += `\n<span class="dbg">${fps.toFixed(0)} fps · ${world.chunks.size} chunks + ${world.far.size} far tiles · ${(r.triangles / 1000).toFixed(0)}k triangles · ${r.calls} draws`;
    html += `\n${lat.toFixed(5)}, ${lon.toFixed(5)} · elevation ${Math.floor(player.y) - SEA_Y} m · XYZ ${player.x.toFixed(1)} ${player.y.toFixed(1)} ${player.z.toFixed(1)}`;
    html += `\ndetail ${radius * 16} m · ${panos.list.length} panoramas · ${n && n.exact ? 'surveyed pose' : n && (n.rot || n.confident) ? 'aligned' : 'GPS'} · grid ${turn}°`;
    const p = world.perf;
    if (p) html += `\nchunk ${(p.genMs / p.chunks).toFixed(1)}+${(p.meshMs / p.chunks).toFixed(1)} ms · far ${(p.farMs / (p.far || 1)).toFixed(1)} ms · tile decoding ${p.tileMs.toFixed(0)} ms`;
    html += '</span>';
  }
  ui.setInfo(html);
}

function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  clock += dt;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

  const focusX = (missiles && missiles.activeMissile) ? missiles.activeMissile.x : player.x;
  const focusZ = (missiles && missiles.activeMissile) ? missiles.activeMissile.z : player.z;
  world.pinned = (missiles && missiles.activeMissile && missiles.launchOrigin) ? missiles.launchOrigin : null;
  world.maxInflight = (missiles && missiles.activeMissile) ? 22 : 14;
  world.update(focusX, focusZ);
  // voxel chunks render inside the ring, the coarse skyline outside; shrink at once, grow smoothly
  const loaded = world.loadedRadius();
  clip = loaded < clip ? loaded : Math.min(loaded, clip + dt * 160);
  panos.update(dt, stand, player, clip, spawned && arrived && roam && !inNether(player.x, player.y, player.z));

  if (!spawned) {
    const p = world.progress(3);
    $('bar-fill').style.width = `${Math.round(p * 100)}%`;
    $('status-text').textContent = world.ready ? tx('{0}: downloading map data…', tx(loc.name)) : tx('Fetching elevation data…');
    if (p >= 1) {
      const [sx, sz] = findSpawn();
      player.placeAt(sx, sz);
      const top = world.topY(sx, sz);
      if (top > 40) player.y = top + 3;
      player.yaw = Math.PI;
      spawned = true;
      spawnedAt = clock;
    }
  } else if (!arrived) {
    // stand in the street photo nearest to the chosen coordinates as soon as one is known
    const n = panos.nearest(0, 0, 600);
    if (n) {
      panos.goTo(n, true);
      arrived = true;
    } else if ((!panos.searching() && panos.cells.size) || (clock - spawnedAt > 1.2)) {
      arrived = true;
      stranded = true;
    }
    $('status-text').textContent = tx('Looking for 360° street photos…');
    if (stranded) {
      roam = true;
      photoOn = false;
      setPhoto();
      const [sx, sz] = findSpawn();
      const top = Math.max(world.topY(sx, sz), world.topY(0, 0));
      if (top > 40) {
        player.x = sx + 0.5;
        player.z = sz + 0.5;
        player.y = top + 3;
        player.vy = 0;
      }
      $('status-text').textContent = tx('{0} is ready (Block World).', tx(loc.name));
      $('play').disabled = false;
      $('play').textContent = tx('Play');
      ui.updatePlace(player.x, player.z);
      if (params.has('play')) showClickToPlayPrompt();
    } else if (arrived) {
      if (cars.cars.length === 0) {
        const cx = player.x - Math.sin(player.yaw) * 3.5;
        const cz = player.z - Math.cos(player.yaw) * 3.5;
        cars.spawnCar(cx, undefined, cz, player.yaw);
      }
      $('status-text').textContent = tx('{0} is ready.', tx(loc.name));
      $('play').disabled = false;
      $('play').textContent = tx('Play');
      ui.updatePlace(player.x, player.z);
      if (params.has('play')) showClickToPlayPrompt();
    }
  }

  // the first photo: look down the street, where the first arrow points
  if (!faced && panos.snapped) {
    const l = panos.links(panos.snapped)[0];
    if (l) player.yaw = -l.az;
    faced = true;
  }

  // a held direction key keeps stepping from photo to photo
  if (wasHop && !panos.hop) arrivedAt = clock;
  if (panos.hop && !wasHop) sfx.step(soundOf(world.getBlock(Math.floor(player.x), Math.floor(player.y - 0.5), Math.floor(player.z))));
  wasHop = !!panos.hop;
  if (playing && !dead && !roam && !calibrating && !ui.inventoryOpen && !worldMap?.isOpen && panos.snapped && !panos.pending && clock - arrivedAt > 0.1 / paceNow) {
    for (const code in HOPS) {
      if (!keys.has(code)) continue;
      hop(HOPS[code], true);
      break;
    }
  }

  // inside a street photo the eye sits at the height the photo was taken from, so the view is
  // the photo itself; without one it is the usual 1.62 m
  const eye = photoOn && panos.current ? panos.seqCalib(panos.current).height : EYE;
  player.eye += (eye - player.eye) * Math.min(1, dt * 6);
  if (missiles && missiles.activeMissile) {
    roam = true;
    missiles.update(dt, keys, world, fx, sfx, camera, player);
    if (missiles.launchOrigin) {
      player.x = missiles.launchOrigin.x;
      player.y = missiles.launchOrigin.y;
      player.z = missiles.launchOrigin.z;
    }
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    stand.set(player.x, player.eyeY + world.groundDelta(player.x, player.y, player.z), player.z);
    cars.update(dt, keys, player, camera, roam);
  } else if (cars.activeCar) {
    roam = true;
    cars.update(dt, keys, player, camera, roam);
    stand.copy(camera.position);
  } else if (cars.isRagdolling) {
    roam = true;
    cars.update(dt, keys, player, camera, roam);
    stand.copy(camera.position);
  } else if (!roam && panos.viewPos(stand)) {
    // standing in (or gliding to) a panorama: the camera sits where the photo was taken, but
    // for a jump, which takes it straight up from there and back
    player.x = stand.x;
    player.z = stand.z;
    player.y = stand.y - player.eye;
    player.vx = player.vz = 0;
    player.headInWater = false;
    player.y += player.leap(dt, keys.has('Space'));
    camera.position.set(stand.x, player.eyeY, stand.z);
    cars.update(dt, keys, player, camera, roam);
  } else {
    if (spawned && playing && roam && !dead && !ui.inventoryOpen) player.update(dt, keys);
    // the drawn ground follows the measured height, the blocks under it are whole metres
    camera.position.set(player.x, player.eyeY + world.groundDelta(player.x, player.y, player.z), player.z);
    stand.copy(camera.position);
    cars.update(dt, keys, player, camera, roam);
  }
  shake *= Math.exp(-dt * 5);
  const jolt = () => (Math.random() - 0.5) * shake * 0.09;
  if (!cars.activeCar && !cars.isRagdolling && !(missiles && missiles.activeMissile)) {
    camera.rotation.set(player.pitch + jolt(), player.yaw + jolt(), jolt() * 0.7);
    camera.updateMatrixWorld();
  }
  bendView();
  setPhoto();
  sky.mesh.position.copy(camera.position);
  const drop = Math.max(0, camera.position.y - SEA_Y);
  const fogFar = Math.max(FAR_RADIUS * FAR_TILE * 0.95, Math.hypot(FAR_RADIUS * FAR_TILE, drop) * 0.95);
  sky.update(0, fogFar);
  const nether = inNether(camera.position.x, camera.position.y, camera.position.z);
  if (nether) {
    // down in the cavern: close murk in the colour of the region, instead of the day's haze
    const f = REGION_FOG[netherRegion(Math.floor(camera.position.x), Math.floor(camera.position.z))];
    netherFog.lerp(tmpColor.setRGB(f[0], f[1], f[2]), Math.min(1, dt * 1.5));
    materials.uniforms.uFogColor.value.copy(netherFog);
    materials.uniforms.uFogNear.value = 8;
    materials.uniforms.uFogFar.value = 68;
    // and the same murk wherever the rock is not drawn (yet): no daylight shows down here
    renderer.setClearColor(netherFog);
  }
  sky.mesh.visible = !nether;
  if (netherCheck) arriveInNether();
  let inPortal = false;
  if (roam && playing && !dead) {
    // standing in a portal sets it going; lava burns
    const at = (dy) => world.getBlock(Math.floor(player.x), Math.floor(player.y + dy), Math.floor(player.z));
    inPortal = at(0.2) === B.PORTAL || at(1.2) === B.PORTAL;
    if (at(0.2) === B.LAVA && clock - lavaAt > 0.5) {
      lavaAt = clock;
      damage(3);
    }
    if (nether && !netherCheck) netherLife();
  }
  if (dead || panos.hop) warpHeld = false;
  if ((inPortal || warpHeld) && clock - portalAt > 2.5) {
    if (warp === 0) sfx.portal(WARP_SECONDS);
    warp = Math.min(1, warp + dt / WARP_SECONDS);
    if (warp >= 1) throughPortal();
  } else warp = Math.max(0, warp - dt); // lets go again in a second
  drawVeil();
  const cullX = (missiles && missiles.activeMissile) ? camera.position.x : player.x;
  const cullZ = (missiles && missiles.activeMissile) ? camera.position.z : player.z;
  materials.uniforms.uClip.value.set(cullX, cullZ, clip);
  world.cull(cullX, cullZ, clip);
  if (nether) for (const t of world.far.values()) t.mesh.visible = false; // nor the skyline
  $('underwater').style.opacity = player.headInWater ? 1 : 0;

  // health comes back on a full stomach
  if (!dead && stats.health < 20 && stats.food >= 18 && clock - stats.hurtAt > 4 && clock - stats.healAt > 1.2) {
    stats.healAt = clock;
    stats.health = Math.min(20, stats.health + 1);
    tire(0.35);
  }
  const [level, progress] = levelOf(stats.xp);
  ui.setStats(stats.health, stats.food, progress, level);

  const active = spawned && playing && !dead && !ui.inventoryOpen;
  fx.update(dt);
  mobs.update(dt, player, camera.position, active);
  hand.pull = drawing >= 0 && ui.held === I.BOW ? Math.min(1, (clock - drawing) / 0.9) : 0;

  const t = active && !(missiles && missiles.activeMissile) ? aim() : null;
  outline.visible = !!t;
  if (t && MODEL[t.id]) {
    // a shaped block is outlined as far as it reaches, not as its whole cell
    const lo = [1, 1, 1], hi = [0, 0, 0];
    for (const b of world.boxesAt(t.x, t.y, t.z, t.id, true)) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], b[a]);
        hi[a] = Math.max(hi[a], b[a + 3]);
      }
    }
    outline.scale.set(hi[0] - lo[0] + 0.004, hi[1] - lo[1] + 0.004, hi[2] - lo[2] + 0.004);
    outline.position.set(t.x + (lo[0] + hi[0]) / 2, t.y + (lo[1] + hi[1]) / 2, t.z + (lo[2] + hi[2]) / 2);
  } else if (t) {
    outline.scale.set(1, 1, 1);
    outline.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
  }
  panos.updateArrows(-player.yaw, active && !roam && !panos.hop);
  const node = active && !roam ? panos.snapped : null;
  ui.setNav(node && [0, -Math.PI / 2, Math.PI, Math.PI / 2].map((off) => panos.linkToward(node, -player.yaw + off, off ? 0.85 : 1.15)));

  renderer.render(scene, camera);
  if (spawned && playing && !dead) {
    hand.hold(ui.held);
    hand.update(dt, !cars.activeCar && !cars.isRagdolling && !(missiles && missiles.activeMissile) && (!!panos.hop || (roam && Math.hypot(player.vx, player.vz) > 0.6)));
    if (!cars.isRagdolling && !(missiles && missiles.activeMissile) && (!cars.activeCar || cars.camMode === 'COCKPIT')) {
      hand.render(renderer);
    }
  }

  slow += dt;
  if (slow > 0.2 && spawned) {
    slow = 0;
    hud();
    ui.drawMap(world, player, panos);
    if (active) describeTarget();
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  frame(now);
}

buildMenu();
setPhoto();
requestAnimationFrame(loop);

// Debug handle for the console; step(n) advances n frames of 50 ms by hand.
window.game = {
  world, player, cars, sky, ui, camera, renderer, scene, proj, materials, panos, fx, mobs, hand, stats, keys, aim, act, hop, travel,
  step: (n = 1) => {
    for (let i = 0; i < n; i++) frame(last + 50);
  },
  state: () => ({ playing, dragLook, spawned, arrived, roam, dead }),
};
