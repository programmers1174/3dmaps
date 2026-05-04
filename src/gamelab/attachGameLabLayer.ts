import mapboxgl from 'mapbox-gl';
import * as THREE from 'three';

export type GameLabMode = 'open_world' | 'driving' | 'flight';

export interface GameLabInputState {
  forward: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  ascend: boolean;
  descend: boolean;
  sprint: boolean;
}

export const emptyGameLabInput = (): GameLabInputState => ({
  forward: false,
  brake: false,
  left: false,
  right: false,
  ascend: false,
  descend: false,
  sprint: false,
});

const LAYER_ID = 'gamelab-player-layer';

function pointInPolygon(lng: number, lat: number, poly: [number, number][]): boolean {
  if (poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const denom = yj - yi || 1e-12;
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / denom + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function moveOnEarth(lng: number, lat: number, bearingDeg: number, distanceM: number): [number, number] {
  const R = 6378137;
  const br = (bearingDeg * Math.PI) / 180;
  const north = distanceM * Math.cos(br);
  const east = distanceM * Math.sin(br);
  const dLat = (north / R) * (180 / Math.PI);
  const dLng = (east / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return [lng + dLng, lat + dLat];
}

export interface AttachGameLabOptions {
  map: mapboxgl.Map;
  mode: GameLabMode;
  getInput: () => GameLabInputState;
  initialCenter: [number, number];
  initialBearing: number;
  gameAreaPolygon?: [number, number][] | null;
  onTick?: (state: { lng: number; lat: number; speed: number; altitude: number; bearing: number }) => void;
}

type LayerThis = {
  map: mapboxgl.Map;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  playerRoot: THREE.Group;
};

export function attachGameLabLayer(options: AttachGameLabOptions): () => void {
  const { map, mode, getInput, gameAreaPolygon, onTick, initialBearing } = options;
  const poly = gameAreaPolygon && gameAreaPolygon.length >= 3 ? gameAreaPolygon : null;

  let lng = options.initialCenter[0];
  let lat = options.initialCenter[1];
  let bearing = initialBearing;
  let speed = 0;
  let altitudeM = mode === 'flight' ? 140 : mode === 'driving' ? 2.5 : 2;

  const modeConfig = {
    open_world: { maxSpeed: 9, accel: 26, turn: 2.0, friction: 0.88, zoom: 18.2, pitch: 64 },
    driving: { maxSpeed: 42, accel: 52, turn: 2.5, friction: 0.91, zoom: 17.5, pitch: 52 },
    flight: { maxSpeed: 110, accel: 42, turn: 0.75, friction: 0.97, zoom: 15, pitch: 48 },
  }[mode];

  let disposed = false;
  let rafId = 0;
  let lastT = performance.now();

  const dragPanWas = map.dragPan.isEnabled();
  const scrollZoomWas = map.scrollZoom.isEnabled();
  const boxZoomWas = map.boxZoom.isEnabled();
  const dblClickZoomWas = map.doubleClickZoom.isEnabled();
  const touchZoomRotateWas = map.touchZoomRotate.isEnabled();

  map.dragPan.disable();
  map.scrollZoom.disable();
  map.boxZoom.disable();
  map.doubleClickZoom.disable();
  map.touchZoomRotate.disable();
  try {
    (map as unknown as { keyboard?: { disable: () => void } }).keyboard?.disable();
  } catch {
    /* ignore */
  }

  const restoreInteractions = () => {
    if (dragPanWas) map.dragPan.enable();
    if (scrollZoomWas) map.scrollZoom.enable();
    if (boxZoomWas) map.boxZoom.enable();
    if (dblClickZoomWas) map.doubleClickZoom.enable();
    if (touchZoomRotateWas) map.touchZoomRotate.enable();
    try {
      (map as unknown as { keyboard?: { enable: () => void } }).keyboard?.enable();
    } catch {
      /* ignore */
    }
  };

  const customLayer: mapboxgl.CustomLayerInterface = {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(mapInstance, gl) {
      const self = this as unknown as LayerThis;
      self.map = mapInstance;
      self.scene = new THREE.Scene();
      self.camera = new THREE.PerspectiveCamera();
      self.renderer = new THREE.WebGLRenderer({
        canvas: mapInstance.getCanvas(),
        context: gl,
        antialias: true,
      });
      self.renderer.autoClear = false;

      self.scene.add(new THREE.AmbientLight(0xffffff, 0.62));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
      dirLight.position.set(120, 320, 180);
      self.scene.add(dirLight);

      const colors = { open_world: 0x1e88e5, driving: 0xc62828, flight: 0x6a1b9a }[mode];
      const group = new THREE.Group();

      if (mode === 'driving') {
        const mat = new THREE.MeshStandardMaterial({ color: colors, metalness: 0.45, roughness: 0.32 });
        const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.2, 2.1), mat);
        chassis.position.y = 0.65;
        group.add(chassis);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.85, 1.95), mat);
        cabin.position.set(0, 1.35, 0);
        group.add(cabin);
      } else if (mode === 'flight') {
        const bodyMat = new THREE.MeshStandardMaterial({ color: colors, metalness: 0.35, roughness: 0.4 });
        const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.1, 4.2, 10), bodyMat);
        fuse.rotation.z = Math.PI / 2;
        group.add(fuse);
        const wing = new THREE.Mesh(
          new THREE.BoxGeometry(7.5, 0.12, 2.2),
          new THREE.MeshStandardMaterial({ color: 0x5e35b1, metalness: 0.2, roughness: 0.45 })
        );
        group.add(wing);
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 1.8), bodyMat);
        tail.position.set(-2.2, 0, 0);
        group.add(tail);
      } else {
        const mat = new THREE.MeshStandardMaterial({ color: colors, roughness: 0.55 });
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.15, 4, 8), mat);
        body.position.y = 0.95;
        group.add(body);
      }

      self.playerRoot = group;
      self.scene.add(group);
    },
    render(_gl, matrix) {
      if (disposed) return;
      const self = this as unknown as LayerThis;
      const merc = mapboxgl.MercatorCoordinate.fromLngLat({ lng, lat }, altitudeM);
      self.playerRoot.position.set(merc.x, merc.y, merc.z);
      const rad = THREE.MathUtils.degToRad(-bearing + 90);
      self.playerRoot.rotation.set(0, 0, rad);
      if (mode === 'flight') {
        self.playerRoot.rotation.x = -Math.min(0.4, Math.max(0, speed) * 0.0035);
      } else {
        self.playerRoot.rotation.x = 0;
      }

      const m = new THREE.Matrix4().fromArray(matrix);
      self.camera.projectionMatrix = m;
      self.renderer.resetState();
      self.renderer.render(self.scene, self.camera);
      self.map.triggerRepaint();
    },
    onRemove() {
      const self = this as unknown as Partial<LayerThis>;
      self.renderer?.dispose();
    },
  };

  if (map.getLayer(LAYER_ID)) {
    try {
      map.removeLayer(LAYER_ID);
    } catch {
      /* */
    }
  }
  map.addLayer(customLayer);

  function tick() {
    if (disposed) return;
    const now = performance.now();
    const dt = Math.min(0.055, (now - lastT) / 1000);
    lastT = now;

    const input = getInput();
    const cfg = modeConfig;

    const turnRate = cfg.turn * (50 + Math.min(45, Math.abs(speed) * 1.8));
    if (input.left) bearing -= turnRate * dt;
    if (input.right) bearing += turnRate * dt;
    bearing = ((bearing % 360) + 360) % 360;

    const sprintMul = input.sprint && mode === 'open_world' ? 1.5 : 1;

    if (input.forward) {
      speed += cfg.accel * dt * sprintMul;
    } else if (input.brake) {
      if (speed > 0.5) speed -= cfg.accel * 1.35 * dt;
      else if (mode === 'driving' || mode === 'open_world') speed -= cfg.accel * 0.55 * dt;
    } else {
      speed *= cfg.friction;
    }

    if (mode === 'flight') {
      if (input.ascend) altitudeM += 32 * dt;
      if (input.descend) altitudeM = Math.max(35, altitudeM - 32 * dt);
    } else {
      altitudeM = mode === 'driving' ? 2.5 : 2;
    }

    let maxSpd = cfg.maxSpeed * sprintMul;
    if (mode === 'flight' && altitudeM > 180) maxSpd *= 1.12;
    const maxRev = mode === 'flight' ? 0 : cfg.maxSpeed * 0.4;
    speed = Math.max(-maxRev, Math.min(maxSpd, speed));
    if (Math.abs(speed) < 0.02 && !input.forward && !input.brake) speed = 0;

    let nextLng = lng;
    let nextLat = lat;
    if (Math.abs(speed) > 0.04) {
      const moved = moveOnEarth(lng, lat, bearing, speed * dt);
      nextLng = moved[0];
      nextLat = moved[1];
    }

    if (poly && !pointInPolygon(nextLng, nextLat, poly)) {
      speed *= -0.28;
    } else {
      lng = nextLng;
      lat = nextLat;
    }

    map.setCenter([lng, lat]);
    map.setBearing(bearing);
    map.setPitch(cfg.pitch);
    map.setZoom(cfg.zoom);

    onTick?.({ lng, lat, speed, altitude: altitudeM, bearing });

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    restoreInteractions();
    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    } catch {
      /* */
    }
  };
}
