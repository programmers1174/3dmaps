import { useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader';

// URL to a public low-poly car model (GLTF)
const CAR_MODEL_URL = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/VC/glTF/VC.gltf';

// Sample highway paths (GeoJSON LineStrings in San Francisco)
const HIGHWAY_PATHS = [
  {
    type: 'LineString',
    coordinates: [
      [-122.507640, 37.708075],
      [-122.482248, 37.721897],
      [-122.447303, 37.735969],
      [-122.419416, 37.774929],
      [-122.393391, 37.792872],
      [-122.370987, 37.807999]
    ]
  },
  {
    type: 'LineString',
    coordinates: [
      [-122.393391, 37.792872],
      [-122.386202, 37.765050],
      [-122.389145, 37.749231],
      [-122.400000, 37.730000]
    ]
  }
];

// Helper: interpolate along a LineString
function interpolateLine(line: any, t: number) {
  const coords = line.coordinates;
  if (coords.length < 2) return coords[0];
  const total = coords.length - 1;
  const idx = Math.floor(t * total);
  const frac = (t * total) - idx;
  if (idx >= total) return coords[total];
  const [lon1, lat1] = coords[idx];
  const [lon2, lat2] = coords[idx + 1];
  return [
    lon1 + (lon2 - lon1) * frac,
    lat1 + (lat2 - lat1) * frac
  ];
}

// Helper: convert lng/lat to Mercator meters
function lngLatToWorld([lng, lat]: [number, number]) {
  const R = 6378137;
  const x = R * THREE.MathUtils.degToRad(lng);
  const y = R * Math.log(Math.tan(Math.PI / 4 + THREE.MathUtils.degToRad(lat) / 2));
  return [x, y];
}

const ThreeDCarLayer = ({ map }: { map: mapboxgl.Map }) => {
  useEffect(() => {
    if (!map) return;
    let scene: THREE.Scene;
    let camera: THREE.Camera;
    let renderer: THREE.WebGLRenderer;
    let cars: THREE.Group[] = [];
    let model: THREE.Group | null = null;
    let initialized = false;

    // Custom Mapbox layer definition
    const customLayer = {
      id: 'threejs-cars',
      type: 'custom' as const,
      renderingMode: '3d' as const,
      onAdd: function (map: mapboxgl.Map, gl: WebGLRenderingContext) {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera();
        renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true
        });
        renderer.autoClear = false;

        // Add ambient and directional light
        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(0, 100, 200);
        scene.add(dirLight);

        // Load car model
        const loader = new GLTFLoader();
        loader.load(CAR_MODEL_URL, (gltf: GLTF) => {
          model = gltf.scene;
          // Scale and center the model
          model.scale.set(10, 10, 10);
          model.rotation.x = Math.PI / 2;
          // Create multiple cars
          for (let i = 0; i < HIGHWAY_PATHS.length; i++) {
            const car = model.clone();
            scene.add(car);
            cars.push(car);
          }
          initialized = true;
        });
      },
      render: function (gl: WebGLRenderingContext, matrix: number[]) {
        if (!initialized) return;
        // Animate cars along their paths
        const now = performance.now();
        cars.forEach((car, i) => {
          const t = ((now / 10000 + i / cars.length) % 1);
          const pos = interpolateLine(HIGHWAY_PATHS[i % HIGHWAY_PATHS.length], t);
          const [x, y] = lngLatToWorld(pos);
          car.position.set(x, y, 0);
          // Optionally, orient the car along the path
        });
        // Sync camera with Mapbox
        const m = new THREE.Matrix4().fromArray(matrix);
        camera.projectionMatrix = m;
        renderer.state.reset();
        renderer.render(scene, camera);
        map.triggerRepaint();
      },
      onRemove: function () {
        renderer.dispose();
      }
    };

    // Add the custom layer to the map
    map.addLayer(customLayer);

    // Cleanup
    return () => {
      if (map.getLayer('threejs-cars')) map.removeLayer('threejs-cars');
      if (map.getSource('threejs-cars')) map.removeSource('threejs-cars');
    };
  }, [map]);

  return null;
};

export default ThreeDCarLayer; 