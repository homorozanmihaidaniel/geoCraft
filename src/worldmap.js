import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet's default icon path in bundlers so it never makes 404 requests
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '',
  iconUrl: '',
  shadowUrl: '',
});

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export class WorldMap {
  constructor(options = {}) {
    this.getPlayerCoords = options.getPlayerCoords || (() => ({ lat: 0, lon: 0 }));
    this.getLocations = options.getLocations || (() => []);
    this.getMyPlaces = options.getMyPlaces || (() => []);
    this.onTeleport = options.onTeleport || (() => {});
    this.onSavePlace = options.onSavePlace || (() => {});
    this.onClose = options.onClose || (() => {});

    this.modal = document.getElementById('world-map-modal');
    this.mapEl = document.getElementById('wm-map');
    this.searchInput = document.getElementById('wm-search-input');
    this.searchForm = document.getElementById('wm-search-form');
    this.destNameEl = document.getElementById('wm-dest-name');
    this.destCoordsEl = document.getElementById('wm-dest-coords');
    this.destDistEl = document.getElementById('wm-dest-dist');
    this.teleportBtn = document.getElementById('wm-teleport-btn');
    this.saveBtn = document.getElementById('wm-save-btn');
    this.closeBtn = document.getElementById('wm-close');
    this.locateBtn = document.getElementById('wm-locate-me');
    this.presetsWrap = document.getElementById('wm-presets');

    this.map = null;
    this.currentTileLayer = null;
    this.layers = {};
    this.activeLayerKey = 'osm';

    this.playerMarker = null;
    this.targetMarker = null;
    this.presetMarkers = [];
    this.pois = [];
    this.poiSet = new Set();
    this.poiMarkers = [];
    this.showPois = true;
    this.selected = null; // { lat, lon, name }
    this.isOpen = false;
    this.reverseGeocodeTimeout = null;

    this.initDOM();
  }

  initDOM() {
    if (!this.modal) return;

    // Close button
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }

    // Modal background click to close
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });

    // Locate player button
    if (this.locateBtn) {
      this.locateBtn.addEventListener('click', () => {
        const p = this.getPlayerCoords();
        if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
          this.map.flyTo([p.lat, p.lon], Math.max(this.map.getZoom(), 14), { duration: 1.2 });
        }
      });
    }

    // Search form
    if (this.searchForm) {
      this.searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleSearch();
      });
    }

    // Preset chips
    if (this.presetsWrap) {
      this.presetsWrap.addEventListener('click', (e) => {
        const chip = e.target.closest('.wm-chip');
        if (chip) {
          const lat = parseFloat(chip.dataset.lat);
          const lon = parseFloat(chip.dataset.lon);
          const name = chip.dataset.name || chip.textContent.trim();
          this.selectLocation({ lat, lon, name }, true);
        }
      });
    }

    // Layer switch buttons
    const layerBtns = document.querySelectorAll('.wm-layer-btn');
    layerBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        layerBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.switchLayer(btn.dataset.layer);
      });
    });

    // Teleport button
    if (this.teleportBtn) {
      this.teleportBtn.addEventListener('click', () => {
        if (!this.selected) return;
        const target = { ...this.selected };
        this.close(true);
        this.onTeleport(target);
      });
    }

    // Save button
    if (this.saveBtn) {
      this.saveBtn.addEventListener('click', () => {
        if (!this.selected) return;
        this.onSavePlace(this.selected);
        this.saveBtn.disabled = true;
        this.saveBtn.textContent = '✓ Salvat!';
        setTimeout(() => {
          if (this.saveBtn) {
            this.saveBtn.textContent = '⭐ Salvează';
            this.saveBtn.disabled = false;
          }
        }, 2000);
        this.updatePresetMarkers();
      });
    }

    // Toggle POI visibility button
    const poiToggle = document.getElementById('wm-toggle-pois');
    if (poiToggle) {
      poiToggle.addEventListener('click', () => {
        this.showPois = !this.showPois;
        poiToggle.classList.toggle('active', this.showPois);
        this.updatePoiMarkers();
      });
    }

    // WASD / Arrow keys smooth map panning
    const mapKeys = new Set();
    this.mapKeys = mapKeys;
    let panRaf = null;

    const panLoop = () => {
      if (!this.isOpen || !this.map || mapKeys.size === 0) {
        panRaf = null;
        return;
      }
      if (document.activeElement === this.searchInput) {
        panRaf = null;
        return;
      }

      let dx = 0, dy = 0;
      const step = 20;
      if (mapKeys.has('KeyW') || mapKeys.has('ArrowUp')) dy -= step;
      if (mapKeys.has('KeyS') || mapKeys.has('ArrowDown')) dy += step;
      if (mapKeys.has('KeyA') || mapKeys.has('ArrowLeft')) dx -= step;
      if (mapKeys.has('KeyD') || mapKeys.has('ArrowRight')) dx += step;

      if (dx !== 0 || dy !== 0) {
        this.map.panBy([dx, dy], { animate: false });
      }
      panRaf = requestAnimationFrame(panLoop);
    };

    // ESC or M inside window to close, WASD/arrows to pan
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.code === 'Escape' || (e.code === 'KeyM' && document.activeElement !== this.searchInput)) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }
      if (document.activeElement === this.searchInput) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
        mapKeys.add(e.code);
        if (!panRaf) panRaf = requestAnimationFrame(panLoop);
      }
    }, true);

    window.addEventListener('keyup', (e) => {
      if (!this.isOpen) return;
      mapKeys.delete(e.code);
    }, true);

    window.addEventListener('blur', () => {
      mapKeys.clear();
      if (panRaf) {
        cancelAnimationFrame(panRaf);
        panRaf = null;
      }
    });
  }

  initMap() {
    if (this.map || !this.mapEl) return;

    this.map = L.map(this.mapEl, {
      center: [20, 0],
      zoom: 3,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: true,
      worldCopyJump: true,
    });

    // Base Tile Layers
    this.layers.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
    });

    this.layers.satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '© Esri, Maxar, Earthstar Geographics',
        maxZoom: 18,
      }
    );

    this.layers.dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap, © CARTO',
      subdomains: ['a', 'b', 'c', 'd'],
      maxZoom: 19,
    });

    this.currentTileLayer = this.layers[this.activeLayerKey] || this.layers.osm;
    this.currentTileLayer.addTo(this.map);

    // Click anywhere on map to select teleport destination
    this.map.on('click', (e) => {
      const lat = +(e.latlng.lat).toFixed(5);
      const lon = +(e.latlng.lng).toFixed(5);
      this.selectLocation({ lat, lon, name: `Locație (${lat.toFixed(4)}, ${lon.toFixed(4)})` }, false);
      this.scheduleReverseGeocode(lat, lon);
    });

    // Double click to instant teleport
    this.map.on('dblclick', (e) => {
      const lat = +(e.latlng.lat).toFixed(5);
      const lon = +(e.latlng.lng).toFixed(5);
      this.selectLocation({ lat, lon, name: `Locație (${lat.toFixed(4)}, ${lon.toFixed(4)})` }, false);
      if (this.teleportBtn) this.teleportBtn.click();
    });

    // Update POI markers when zoom or view changes (clustering depends on zoom level)
    this.map.on('zoomend', () => this.schedulePoiUpdate());
    this.map.on('moveend', () => this.schedulePoiUpdate());
  }

  switchLayer(key) {
    if (!this.map || !this.layers[key] || this.activeLayerKey === key) return;
    this.map.removeLayer(this.currentTileLayer);
    this.activeLayerKey = key;
    this.currentTileLayer = this.layers[key];
    this.currentTileLayer.addTo(this.map);
  }

  open() {
    if (!this.modal) return;
    this.isOpen = true;
    this.modal.classList.remove('hidden');

    // Make sure map is initialized
    if (!this.map) {
      this.initMap();
    }

    setTimeout(() => {
      if (this.map) {
        this.map.invalidateSize();
        this.updatePlayerMarker();
        this.updatePresetMarkers();
        this.updatePoiMarkers();

        const p = this.getPlayerCoords();
        if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && (p.lat !== 0 || p.lon !== 0)) {
          this.map.setView([p.lat, p.lon], Math.max(this.map.getZoom(), 12));
          if (!this.selected) {
            this.selectLocation({ lat: p.lat, lon: p.lon, name: 'Locația ta actuală' }, false);
          }
        }
      }
    }, 50);
  }

  close(isTeleporting = false) {
    if (!this.modal) return;
    this.isOpen = false;
    if (this.mapKeys) this.mapKeys.clear();
    this.modal.classList.add('hidden');
    if (!isTeleporting && this.onClose) this.onClose();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  updatePlayerMarker() {
    if (!this.map) return;
    const p = this.getPlayerCoords();
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;

    const icon = L.divIcon({
      className: 'wm-marker-wrap',
      html: `
        <div class="wm-pin-player">
          <div class="wm-player-pulse"></div>
          <div class="wm-pin-core">🧑‍🚀</div>
          <div class="wm-pin-name">Tu ești aici</div>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    if (this.playerMarker) {
      this.playerMarker.setLatLng([p.lat, p.lon]);
    } else {
      this.playerMarker = L.marker([p.lat, p.lon], { icon, zIndexOffset: 1000 }).addTo(this.map);
      this.playerMarker.on('click', () => {
        this.selectLocation({ lat: p.lat, lon: p.lon, name: 'Locația ta actuală' }, true);
      });
    }
  }

  updatePresetMarkers() {
    if (!this.map) return;

    // Clear old preset markers
    this.presetMarkers.forEach((m) => this.map.removeLayer(m));
    this.presetMarkers = [];

    const allPresets = [...this.getLocations(), ...this.getMyPlaces()];
    const seen = new Set();

    for (const place of allPresets) {
      if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue;
      const key = `${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const isMine = this.getMyPlaces().includes(place);
      const icon = L.divIcon({
        className: 'wm-marker-wrap',
        html: `
          <div class="wm-pin-preset ${isMine ? 'wm-mine' : ''}">
            <div class="wm-pin-core">${isMine ? '📌' : '⭐'}</div>
            <div class="wm-pin-name">${place.name}</div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const m = L.marker([place.lat, place.lon], { icon, zIndexOffset: 500 }).addTo(this.map);
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.selectLocation(place, true);
      });
      this.presetMarkers.push(m);
    }
  }

  schedulePoiUpdate() {
    if (this._poiTimer) return;
    this._poiTimer = setTimeout(() => {
      this._poiTimer = null;
      if (this.isOpen && this.map) {
        this.updatePoiMarkers();
      }
    }, 80);
  }

  addPois(list) {
    if (!list || !list.length) return;
    let added = false;
    for (const p of list) {
      if (!p || !p.lat || !p.lon) continue;
      const key = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
      if (this.poiSet.has(key)) continue;
      this.poiSet.add(key);
      this.pois.push(p);
      added = true;
    }
    if (added && this.isOpen && this.map && this.showPois) {
      this.schedulePoiUpdate();
    }
  }

  updatePoiMarkers() {
    if (!this.map) return;

    // Clear old POI markers
    this.poiMarkers.forEach((m) => this.map.removeLayer(m));
    this.poiMarkers = [];
    if (!this.showPois) return;

    // Determine how many POIs to show based on zoom level.
    // At low zoom (zoomed out) show none or very few; at high zoom show more.
    const zoom = this.map.getZoom();

    // Zoom tiers:
    //   zoom < 10:   0 (hide completely on country/region level so map never lags)
    //   zoom 10-11:  max 8
    //   zoom 12-13:  max 20
    //   zoom 14:     max 40
    //   zoom >= 15:  max 65
    let maxPois = 0;
    if (zoom >= 15) maxPois = 65;
    else if (zoom >= 14) maxPois = 40;
    else if (zoom >= 12) maxPois = 20;
    else if (zoom >= 10) maxPois = 8;
    else maxPois = 0;

    if (maxPois <= 0) return;

    const bounds = this.map.getBounds();

    // Filter to only POIs visible in the current viewport
    let visible = this.pois.filter((poi) =>
      bounds.contains([poi.lat, poi.lon])
    );

    if (visible.length === 0) return;

    // Grid-based clustering: divide the viewport into cells and pick one representative per cell
    if (visible.length > maxPois) {
      const latSpan = Math.max(1e-5, bounds.getNorth() - bounds.getSouth());
      const lonSpan = Math.max(1e-5, bounds.getEast() - bounds.getWest());
      const gridSize = Math.max(3, Math.ceil(Math.sqrt(maxPois * 1.3)));
      const cellLat = latSpan / gridSize;
      const cellLon = lonSpan / gridSize;
      const grid = new Map();
      for (const poi of visible) {
        const row = Math.floor((poi.lat - bounds.getSouth()) / cellLat);
        const col = Math.floor((poi.lon - bounds.getWest()) / cellLon);
        const cellKey = `${row},${col}`;
        if (!grid.has(cellKey)) grid.set(cellKey, poi);
      }
      visible = [...grid.values()];
      if (visible.length > maxPois) visible = visible.slice(0, maxPois);
    }

    // Only render text label pill when zoomed in close (zoom >= 14) to prevent overlap clutter
    const showLabels = zoom >= 14;

    for (const poi of visible) {
      const color = poi.color || '#3b82f6';
      const labelHtml = showLabels ? `<div class="wm-poi-name">${poi.name}</div>` : '';
      const icon = L.divIcon({
        className: 'wm-marker-wrap',
        html: `
          <div class="wm-pin-poi" style="--poi-color: ${color};" title="${poi.name} (${poi.category || ''})">
            <div class="wm-poi-core" style="background: ${color};">${poi.icon || '📍'}</div>
            ${labelHtml}
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const m = L.marker([poi.lat, poi.lon], { icon, zIndexOffset: 350 }).addTo(this.map);
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.selectLocation({ lat: poi.lat, lon: poi.lon, name: `${poi.icon} ${poi.name}` }, true);
      });
      this.poiMarkers.push(m);
    }
  }

  selectLocation(place, fly = false) {
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return;
    this.selected = {
      lat: +(+place.lat).toFixed(5),
      lon: +(+place.lon).toFixed(5),
      name: place.name || `Locație (${place.lat.toFixed(4)}, ${place.lon.toFixed(4)})`,
    };

    if (fly && this.map) {
      this.map.flyTo([this.selected.lat, this.selected.lon], Math.max(this.map.getZoom(), 14), { duration: 1.2 });
    }

    // Place / move target marker
    const targetIcon = L.divIcon({
      className: 'wm-marker-wrap',
      html: `
        <div class="wm-pin-target">
          <div class="wm-target-pulse"></div>
          <div class="wm-pin-core">🎯</div>
          <div class="wm-target-reticle"></div>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    if (this.targetMarker) {
      this.targetMarker.setLatLng([this.selected.lat, this.selected.lon]);
    } else if (this.map) {
      this.targetMarker = L.marker([this.selected.lat, this.selected.lon], {
        icon: targetIcon,
        zIndexOffset: 2000,
      }).addTo(this.map);
    }

    this.updateFooter();
  }

  updateFooter() {
    if (!this.selected) {
      if (this.destNameEl) this.destNameEl.textContent = 'Nicio destinație selectată';
      if (this.destCoordsEl) this.destCoordsEl.textContent = '—';
      if (this.destDistEl) this.destDistEl.textContent = '';
      if (this.teleportBtn) this.teleportBtn.disabled = true;
      if (this.saveBtn) this.saveBtn.disabled = true;
      return;
    }

    if (this.destNameEl) this.destNameEl.textContent = this.selected.name;
    if (this.destCoordsEl) {
      const latDir = this.selected.lat >= 0 ? 'N' : 'S';
      const lonDir = this.selected.lon >= 0 ? 'E' : 'V';
      this.destCoordsEl.textContent = `📍 ${Math.abs(this.selected.lat).toFixed(5)}° ${latDir}, ${Math.abs(this.selected.lon).toFixed(5)}° ${lonDir}`;
    }

    const p = this.getPlayerCoords();
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && (p.lat !== 0 || p.lon !== 0)) {
      const dist = getDistanceKm(p.lat, p.lon, this.selected.lat, this.selected.lon);
      if (this.destDistEl) {
        if (dist < 1) {
          this.destDistEl.textContent = `📏 ${Math.round(dist * 1000)} m de tine`;
        } else {
          this.destDistEl.textContent = `📏 ${dist.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} km de tine`;
        }
      }
    } else if (this.destDistEl) {
      this.destDistEl.textContent = '';
    }

    if (this.teleportBtn) this.teleportBtn.disabled = false;
    if (this.saveBtn) this.saveBtn.disabled = false;
  }

  scheduleReverseGeocode(lat, lon) {
    if (this.reverseGeocodeTimeout) clearTimeout(this.reverseGeocodeTimeout);
    this.reverseGeocodeTimeout = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'ro,en' } });
        if (res.ok) {
          const data = await res.json();
          if (data && data.display_name && this.selected && this.selected.lat === lat && this.selected.lon === lon) {
            const addr = data.address || {};
            const road = addr.road || addr.pedestrian || addr.street || addr.suburb || '';
            const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
            const country = addr.country || '';
            const parts = [road, city, country].filter(Boolean);
            const niceName = parts.length > 0 ? parts.join(', ') : data.display_name.split(',').slice(0, 3).join(',');
            this.selected.name = niceName || this.selected.name;
            this.updateFooter();
          }
        }
      } catch (err) {
        // Silently keep coordinate label on rate-limit or offline
      }
    }, 450);
  }

  async handleSearch() {
    const q = this.searchInput ? this.searchInput.value.trim() : '';
    if (!q) return;

    // Check for coordinates or Google link: @lat,lon or lat, lon
    const m = q.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || q.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
    if (m && Math.abs(+m[1]) <= 85 && Math.abs(+m[2]) <= 180) {
      const lat = +(+m[1]).toFixed(5);
      const lon = +(+m[2]).toFixed(5);
      this.selectLocation({ lat, lon, name: `Coordonate (${lat}, ${lon})` }, true);
      this.scheduleReverseGeocode(lat, lon);
      return;
    }

    // Nominatim Search
    const searchBtn = document.getElementById('wm-search-btn');
    if (searchBtn) searchBtn.textContent = '⏳ Căutare...';

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'ro,en' } });
      if (res.ok) {
        const results = await res.json();
        if (results && results.length > 0) {
          const item = results[0];
          const lat = parseFloat(item.lat);
          const lon = parseFloat(item.lon);
          const parts = item.display_name.split(',').slice(0, 3).map((s) => s.trim());
          const name = parts.join(', ');
          this.selectLocation({ lat, lon, name }, true);
        } else {
          alert(`Nu am găsit nicio locație pentru: "${q}". Încearcă alt oraș sau coordonate.`);
        }
      }
    } catch (err) {
      console.warn('Search geocode failed:', err);
    } finally {
      if (searchBtn) searchBtn.textContent = '🔍 Caută';
    }
  }
}
