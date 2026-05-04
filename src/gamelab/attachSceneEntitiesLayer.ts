import mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import type { MapLabEntity } from './projectTypes';

const LAYER_ID = 'gamelab-entities-scene';

function parseColor(hex: string): number {
  const s = hex.replace('#', '').trim();
  if (s.length === 6) return parseInt(s, 16);
  return 0x888888;
}

type LayerThis = {
  map: mapboxgl.Map;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  roots: Map<string, THREE.Group>;
};

function buildEntityGroup(e: MapLabEntity): THREE.Group {
  const color = parseColor(e.color);
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.22,
    roughness: 0.48,
  });
  const group = new THREE.Group();

  if (e.kind === 'player') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.15, 6, 12), mat);
    body.position.y = 1.15;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), mat);
    head.position.y = 2.05;
    group.add(head);
  } else if (e.kind === 'npc') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.52, 1.45, 6, 12), mat);
    body.position.y = 1.35;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), mat);
    head.position.y = 2.35;
    group.add(head);
  } else if (e.kind === 'viewpoint') {
    const tripod = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.35, 2.2, 6), mat);
    tripod.position.y = 1.1;
    group.add(tripod);
    const camBody = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.8), mat);
    camBody.position.set(0, 2.4, 0);
    group.add(camBody);
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.4, 0.9, 10),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.5, roughness: 0.35 })
    );
    lens.rotation.z = Math.PI / 2;
    lens.position.set(0.95, 2.4, 0);
    group.add(lens);
  } else if (e.kind === 'sphere') {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(3, 18, 12), mat);
    group.add(mesh);
  } else if (e.kind === 'marker') {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6, 10), mat);
    mesh.position.y = 3;
    group.add(mesh);
  } else {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 5), mat);
    mesh.position.y = 2;
    group.add(mesh);
  }

  return group;
}

export function attachSceneEntitiesLayer(map: mapboxgl.Map, entities: MapLabEntity[]): () => void {
  let disposed = false;

  const customLayer: mapboxgl.CustomLayerInterface = {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(mapInstance, gl) {
      const self = this as unknown as LayerThis;
      self.map = mapInstance;
      self.scene = new THREE.Scene();
      self.camera = new THREE.PerspectiveCamera();
      self.roots = new Map();
      self.renderer = new THREE.WebGLRenderer({
        canvas: mapInstance.getCanvas(),
        context: gl,
        antialias: true,
      });
      self.renderer.autoClear = false;
      self.scene.add(new THREE.AmbientLight(0xffffff, 0.58));
      const sun = new THREE.DirectionalLight(0xffffff, 0.92);
      sun.position.set(50, 120, 80);
      self.scene.add(sun);

      for (const e of entities) {
        const g = buildEntityGroup(e);
        self.scene.add(g);
        self.roots.set(e.id, g);
      }
    },
    render(_gl, matrix) {
      if (disposed) return;
      const self = this as unknown as LayerThis;

      for (const e of entities) {
        const group = self.roots.get(e.id);
        if (!group) continue;
        const merc = mapboxgl.MercatorCoordinate.fromLngLat({ lng: e.lng, lat: e.lat }, e.altitudeM);
        group.position.set(merc.x, merc.y, merc.z);
      }

      const m = new THREE.Matrix4().fromArray(matrix);
      self.camera.projectionMatrix = m;
      self.renderer.resetState();
      self.renderer.render(self.scene, self.camera);
      self.map.triggerRepaint();
    },
    onRemove() {
      const self = this as unknown as LayerThis;
      self.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((mm) => mm.dispose());
          else obj.material?.dispose();
        }
      });
      self.roots.clear();
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

  return () => {
    disposed = true;
    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    } catch {
      /* */
    }
  };
}
