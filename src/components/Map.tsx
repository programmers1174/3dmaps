import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
// @ts-ignore
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

interface MapProps {
  accessToken: string;
  initialCoordinates?: [number, number];
  initialZoom?: number;
  initialStyle?: string;
}

interface Layer3D {
  id: string;
  name: string;
  enabled: boolean;
}

interface Building {
  id: string;
  feature: any;
  height: number;
  name: string;
  color: string;
}

interface Model3D {
  id: string;
  name: string;
  url: string;
  position: [number, number];
  scale: number;
  rotation: number;
}

// New interfaces for film-making features
interface Scene {
  id: string;
  name: string;
  duration: number;
  cameraPath: CameraKeyframe[];
  actors: Actor[];
  effects: Effect[];
}

interface CameraKeyframe {
  time: number;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

interface Actor {
  id: string;
  name: string;
  modelUrl: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  animations: Animation[];
}

interface Animation {
  id: string;
  name: string;
  startTime: number;
  duration: number;
  type: 'move' | 'rotate' | 'scale' | 'custom';
  keyframes: any[];
}

interface Effect {
  id: string;
  name: string;
  type: 'particle' | 'light' | 'weather' | 'custom';
  parameters: any;
  startTime: number;
  duration: number;
}

const Map: React.FC<MapProps> = ({
  accessToken,
  initialCoordinates = [-122.4194, 37.7749], // San Francisco
  initialZoom = 15,
  initialStyle = 'https://api.mapbox.com/styles/v1/adhvikvarshney/cmaa157g800fv01si1xlegcep.html?title=view&access_token=pk.eyJ1IjoiYWRodmlrdmFyc2huZXkiLCJhIjoiY21hYTl4ZjBoMXkwbTJycHp2Nzhia2c2eCJ9.BNlpn1zEm1-G7FBeMPYBUA&zoomwheel=true&fresh=true#14.43/37.79105/-122.40187/31/66' //mapbox://styles/mapbox/streets-v12
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [style, setStyle] = useState(initialStyle);
  const [showSettings, setShowSettings] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [layers3D, setLayers3D] = useState<Layer3D[]>([
    { id: 'buildings', name: '3D Buildings', enabled: true },
    { id: 'terrain', name: 'Terrain', enabled: true }
  ]);
  const [draw, setDraw] = useState<MapboxDraw | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [models3D, setModels3D] = useState<Model3D[]>([]);
  const [showModelImport, setShowModelImport] = useState(false);
  const [isPlacingModel, setIsPlacingModel] = useState(false);
  const [selectedModelUrl, setSelectedModelUrl] = useState<string>('');
  const [modelScale, setModelScale] = useState(1);
  const [modelRotation, setModelRotation] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New state variables for film-making
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [currentScene, setCurrentScene] = useState<Scene | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showActorPanel, setShowActorPanel] = useState(false);
  const [showEffectsPanel, setShowEffectsPanel] = useState(false);
  const [selectedActor, setSelectedActor] = useState<Actor | null>(null);
  const [recordingMediaRecorder, setRecordingMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordingChunks, setRecordingChunks] = useState<Blob[]>([]);

  const mapStyles = [
    { id: 'mapbox://styles/mapbox/streets-v12', name: 'Streets' },
    { id: 'mapbox://styles/mapbox/satellite-v9', name: 'Satellite' },
    { id: 'mapbox://styles/mapbox/satellite-streets-v12', name: 'Satellite Streets' },
    { id: 'mapbox://styles/mapbox/dark-v11', name: 'Dark' },
    { id: 'mapbox://styles/mapbox/light-v11', name: 'Light' }
  ];

  const toggle3DLayer = (layerId: string) => {
    setLayers3D(prevLayers =>
      prevLayers.map(layer =>
        layer.id === layerId ? { ...layer, enabled: !layer.enabled } : layer
      )
    );
  };

  const toggleLabels = () => {
    if (!map.current) return;
    
    setShowLabels(prev => {
      const newShowLabels = !prev;
      const layers = map.current!.getStyle().layers;
      
      layers?.forEach(layer => {
        if (layer.type === 'symbol') {
          map.current!.setLayoutProperty(
            layer.id,
            'visibility',
            newShowLabels ? 'visible' : 'none'
          );
        }
      });
      
      return newShowLabels;
    });
  };

  const changeMapStyle = (newStyle: string) => {
    if (!map.current) return;
    setStyle(newStyle);
    
    // Store current camera position
    const currentCenter = map.current.getCenter();
    const currentZoom = map.current.getZoom();
    const currentPitch = map.current.getPitch();
    const currentBearing = map.current.getBearing();

    map.current.setStyle(newStyle);

    // Re-add 3D layers after style change and restore camera
    map.current.once('style.load', () => {
      // Restore camera position
      map.current?.setCenter(currentCenter);
      map.current?.setZoom(currentZoom);
      map.current?.setPitch(currentPitch);
      map.current?.setBearing(currentBearing);

      // Re-initialize layers
      setTimeout(() => {
        initializeLayers();
        
        // Restore label visibility
        if (!showLabels) {
          const layers = map.current?.getStyle().layers;
          layers?.forEach(layer => {
            if (layer.type === 'symbol') {
              map.current!.setLayoutProperty(
                layer.id,
                'visibility',
                'none'
              );
            }
          });
        }
      }, 1000); // Give time for style to fully load
    });
  };

  const initializeLayers = () => {
    if (!map.current || !map.current.isStyleLoaded()) {
      setTimeout(initializeLayers, 300); // Try again soon
      return;
    }
    const currentMap = map.current;

    // Wait for the 'composite' source (for buildings) and 'mapbox-dem' (for terrain)
    if (!currentMap.getSource('composite')) {
      setTimeout(initializeLayers, 300);
      return;
    }

    console.log("Initializing layers, map style:", currentMap.getStyle().name);

    // Clear everything first
    try {
      if (currentMap.getTerrain()) {
        currentMap.setTerrain(null);
      }
      ['mapbox-dem', 'satellite'].forEach(sourceId => {
        if (currentMap.getSource(sourceId)) {
          currentMap.removeSource(sourceId);
        }
      });
      ['sky', '3d-buildings', 'terrain-contours'].forEach(layerId => {
        if (currentMap.getLayer(layerId)) {
          currentMap.removeLayer(layerId);
        }
      });
    } catch (e) {
      console.error("Error cleaning up layers:", e);
    }

    // Add sky layer first
    try {
      currentMap.addLayer({
        'id': 'sky',
        'type': 'sky',
        'paint': {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0.0, 45.0],
          'sky-atmosphere-sun-intensity': 5,
          'sky-atmosphere-color': '#89b0f5',
          'sky-opacity': 0.9,
          'sky-gradient-center': [0, 0],
          'sky-gradient': [
            'interpolate',
            ['linear'],
            ['sky-radial-progress'],
            0.0,
            '#1e90ff',
            0.5,
            '#87ceeb',
            1.0,
            '#ffffff'
          ]
        }
      });
    } catch (e) {
      console.error("Error adding sky layer:", e);
    }

    // Add terrain if enabled
    if (layers3D.find(l => l.id === 'terrain')?.enabled) {
      console.log("Adding terrain...");
      try {
        currentMap.addSource('mapbox-dem', {
          'type': 'raster-dem',
          'url': 'mapbox://mapbox.terrain-rgb',
          'tileSize': 512,
          'maxzoom': 14
        });

        currentMap.setTerrain({
          'source': 'mapbox-dem',
          'exaggeration': 1.5 // Reduced exaggeration for more realistic look
        });

        // Add contour lines
        currentMap.addLayer({
          'id': 'terrain-contours',
          'type': 'line',
          'source': 'mapbox-dem',
          'source-layer': 'contour',
          'layout': {
            'line-join': 'round',
            'line-cap': 'round'
          },
          'paint': {
            'line-color': '#ffffff',
            'line-width': 1,
            'line-opacity': 0.5
          }
        });

        console.log("Terrain added successfully");
      } catch (e) {
        console.error("Error adding terrain:", e);
      }
    }

    // Add 3D buildings if enabled
    if (layers3D.find(l => l.id === 'buildings')?.enabled) {
      console.log("Adding 3D buildings...");
      try {
        // Add custom building layer with modified settings
        currentMap.addLayer({
          'id': '3d-buildings',
          'source': 'composite',
          'source-layer': 'building',
          'filter': ['all',
            ['==', 'extrude', 'true'],
            ['has', 'height']
          ],
          'type': 'fill-extrusion',
          'minzoom': 0,
          'maxzoom': 24,
          'layout': {
            'visibility': 'visible'
          },
          'paint': {
            'fill-extrusion-color': [
              'interpolate',
              ['linear'],
              ['get', 'height'],
              0, '#ffffff',
              50, '#dad8d8',
              100, '#b8b8b8',
              200, '#969696',
              400, '#747474'
            ],
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 1.0,
            'fill-extrusion-vertical-gradient': true
          }
        });

        // Add a simplified building layer for lower zoom levels
        currentMap.addLayer({
          'id': '3d-buildings-simple',
          'source': 'composite',
          'source-layer': 'building',
          'filter': ['all',
            ['==', 'extrude', 'true'],
            ['has', 'height']
          ],
          'type': 'fill-extrusion',
          'minzoom': 0,
          'maxzoom': 24,
          'layout': {
            'visibility': 'visible'
          },
          'paint': {
            'fill-extrusion-color': '#808080',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.7,
            'fill-extrusion-vertical-gradient': true
          }
        });

        // Add a fallback layer for very low zoom levels
        currentMap.addLayer({
          'id': '3d-buildings-fallback',
          'source': 'composite',
          'source-layer': 'building',
          'filter': ['all',
            ['==', 'extrude', 'true'],
            ['has', 'height']
          ],
          'type': 'fill-extrusion',
          'minzoom': 0,
          'maxzoom': 24,
          'layout': {
            'visibility': 'visible'
          },
          'paint': {
            'fill-extrusion-color': '#a0a0a0',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.5,
            'fill-extrusion-vertical-gradient': true
          }
        });

        console.log("3D buildings added successfully");
      } catch (e) {
        console.error("Error adding 3D buildings:", e);
      }
    }

    // Add zoom level change listener
    currentMap.on('zoom', () => {
      const zoom = currentMap.getZoom();
      console.log('Current zoom level:', zoom);
      
      // Ensure all building layers stay visible
      ['3d-buildings', '3d-buildings-simple', '3d-buildings-fallback'].forEach(layerId => {
        if (currentMap.getLayer(layerId)) {
          currentMap.setLayoutProperty(layerId, 'visibility', 'visible');
        }
      });

      // Adjust layer opacity based on zoom level
      if (currentMap.getLayer('3d-buildings')) {
        const opacity = Math.min(1, Math.max(0.3, zoom / 15));
        currentMap.setPaintProperty('3d-buildings', 'fill-extrusion-opacity', opacity);
      }
    });

    // Add a style change listener to reinitialize layers
    currentMap.on('style.load', () => {
      // Wait a bit for the style to fully load
      setTimeout(() => {
        if (layers3D.find(l => l.id === 'buildings')?.enabled) {
          initializeLayers();
        }
      }, 1000);
    });

    // Add a moveend listener to ensure layers stay visible after map movement
    currentMap.on('moveend', () => {
      ['3d-buildings', '3d-buildings-simple', '3d-buildings-fallback'].forEach(layerId => {
        if (currentMap.getLayer(layerId)) {
          currentMap.setLayoutProperty(layerId, 'visibility', 'visible');
        }
      });
    });

    // Remove the zoom change handler as we don't need it anymore
    currentMap.off('zoom', () => {});

    // Force a repaint
    currentMap.triggerRepaint();
  };

  // Function to handle model import
  const handleModelImport = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Function to handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Create a local URL for the file
    const modelUrl = URL.createObjectURL(file);
    setSelectedModelUrl(modelUrl);
    setIsPlacingModel(true);
    setShowModelImport(false);

    // Switch to drawing mode for placement
    if (draw && map.current) {
      draw.changeMode('draw_polygon');
      
      // Listen for the draw.create event
      map.current.once('draw.create', (e: any) => {
        const feature = e.features[0];
        const coordinates = feature.geometry.coordinates[0];
        
        // Calculate center point of the drawn area
        const center = coordinates.reduce(
          (acc: [number, number], coord: [number, number]) => [
            acc[0] + coord[0] / coordinates.length,
            acc[1] + coord[1] / coordinates.length
          ],
          [0, 0]
        );

        const modelName = prompt('What would you like to name this model?') || `Model ${models3D.length + 1}`;
        
        setModels3D(prev => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random()}`,
            name: modelName,
            url: modelUrl,
            position: center as [number, number],
            scale: modelScale * 1000, // Increase scale further
            rotation: modelRotation
          }
        ]);

        // Delete the drawn polygon
        draw.delete(feature.id);
        setIsPlacingModel(false);
        setSelectedModelUrl('');
      });
    }

    // Reset the file input
    event.target.value = '';
  };

  // Recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        }
      });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9'
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          setRecordingChunks(prev => [...prev, event.data]);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordingChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `film-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        setRecordingChunks([]);
      };

      mediaRecorder.start();
      setRecordingMediaRecorder(mediaRecorder);
      setIsRecording(true);
    } catch (err) {
      console.error('Error starting recording:', err);
    }
  };

  const stopRecording = () => {
    if (recordingMediaRecorder) {
      recordingMediaRecorder.stop();
      recordingMediaRecorder.stream.getTracks().forEach(track => track.stop());
      setRecordingMediaRecorder(null);
      setIsRecording(false);
    }
  };

  // Scene management functions
  const createNewScene = () => {
    const newScene: Scene = {
      id: `${Date.now()}-${Math.random()}`,
      name: `Scene ${scenes.length + 1}`,
      duration: 60, // Default 60 seconds
      cameraPath: [],
      actors: [],
      effects: []
    };
    setScenes(prev => [...prev, newScene]);
    setCurrentScene(newScene);
  };

  const addActor = (modelUrl: string) => {
    if (!currentScene) return;

    const newActor: Actor = {
      id: `${Date.now()}-${Math.random()}`,
      name: `Actor ${currentScene.actors.length + 1}`,
      modelUrl,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      animations: []
    };

    setCurrentScene(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        actors: [...prev.actors, newActor]
      };
    });
  };

  const addEffect = (type: Effect['type']) => {
    if (!currentScene) return;

    const newEffect: Effect = {
      id: `${Date.now()}-${Math.random()}`,
      name: `${type} Effect ${currentScene.effects.length + 1}`,
      type,
      parameters: {},
      startTime: currentTime,
      duration: 5 // Default 5 seconds
    };

    setCurrentScene(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        effects: [...prev.effects, newEffect]
      };
    });
  };

  // Animation functions
  const addAnimation = (actorId: string, type: Animation['type']) => {
    if (!currentScene) return;

    const newAnimation: Animation = {
      id: `${Date.now()}-${Math.random()}`,
      name: `${type} Animation`,
      startTime: currentTime,
      duration: 5, // Default 5 seconds
      type,
      keyframes: []
    };

    setCurrentScene(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        actors: prev.actors.map(actor =>
          actor.id === actorId
            ? { ...actor, animations: [...actor.animations, newAnimation] }
            : actor
        )
      };
    });
  };

  // Camera path functions
  const addCameraKeyframe = () => {
    if (!currentScene || !map.current) return;

    const center = map.current.getCenter();
    const zoom = map.current.getZoom();
    const pitch = map.current.getPitch();
    const bearing = map.current.getBearing();

    const newKeyframe: CameraKeyframe = {
      time: currentTime,
      position: [center.lng, center.lat, zoom],
      target: [center.lng, center.lat, pitch],
      fov: bearing
    };

    setCurrentScene(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        cameraPath: [...prev.cameraPath, newKeyframe]
      };
    });
  };

  // Scene playback functions
  const playScene = () => {
    if (!currentScene || !map.current) return;

    let startTime = Date.now();
    const duration = currentScene.duration * 1000; // Convert to milliseconds
    const mapInstance = map.current; // Store reference to avoid null checks

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Update camera position
      if (currentScene.cameraPath.length > 1) {
        const keyframes = currentScene.cameraPath;
        const totalDuration = keyframes[keyframes.length - 1].time - keyframes[0].time;
        const currentTime = keyframes[0].time + progress * totalDuration;

        // Find the two keyframes to interpolate between
        let startKeyframe = keyframes[0];
        let endKeyframe = keyframes[keyframes.length - 1];

        for (let i = 0; i < keyframes.length - 1; i++) {
          if (currentTime >= keyframes[i].time && currentTime <= keyframes[i + 1].time) {
            startKeyframe = keyframes[i];
            endKeyframe = keyframes[i + 1];
            break;
          }
        }

        // Interpolate between keyframes
        const keyframeProgress = (currentTime - startKeyframe.time) / (endKeyframe.time - startKeyframe.time);
        
        const position = [
          startKeyframe.position[0] + (endKeyframe.position[0] - startKeyframe.position[0]) * keyframeProgress,
          startKeyframe.position[1] + (endKeyframe.position[1] - startKeyframe.position[1]) * keyframeProgress,
          startKeyframe.position[2] + (endKeyframe.position[2] - startKeyframe.position[2]) * keyframeProgress
        ];

        const target = [
          startKeyframe.target[0] + (endKeyframe.target[0] - startKeyframe.target[0]) * keyframeProgress,
          startKeyframe.target[1] + (endKeyframe.target[1] - startKeyframe.target[1]) * keyframeProgress,
          startKeyframe.target[2] + (endKeyframe.target[2] - startKeyframe.target[2]) * keyframeProgress
        ];

        const fov = startKeyframe.fov + (endKeyframe.fov - startKeyframe.fov) * keyframeProgress;

        mapInstance.flyTo({
          center: [position[0], position[1]],
          zoom: position[2],
          pitch: target[2],
          bearing: fov,
          duration: 0 // Instant update for smooth animation
        });
      }

      // Update actor positions and animations
      currentScene.actors.forEach(actor => {
        actor.animations.forEach(animation => {
          const animationProgress = (currentTime - animation.startTime) / animation.duration;
          if (animationProgress >= 0 && animationProgress <= 1) {
            // Update actor position based on animation
            if (animation.type === 'move') {
              const startPos = animation.keyframes[0]?.position || actor.position;
              const endPos = animation.keyframes[1]?.position || actor.position;
              
              const newPosition = [
                startPos[0] + (endPos[0] - startPos[0]) * animationProgress,
                startPos[1] + (endPos[1] - startPos[1]) * animationProgress,
                startPos[2] + (endPos[2] - startPos[2]) * animationProgress
              ];

              // Update actor position in the scene
              setCurrentScene(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  actors: prev.actors.map(a =>
                    a.id === actor.id
                      ? { ...a, position: newPosition as [number, number, number] }
                      : a
                  )
                };
              });
            }
          }
        });
      });

      // Update effects
      currentScene.effects.forEach(effect => {
        const effectProgress = (currentTime - effect.startTime) / effect.duration;
        if (effectProgress >= 0 && effectProgress <= 1) {
          // Apply effect based on its type and progress
          switch (effect.type) {
            case 'particle':
              // Update particle system
              break;
            case 'light':
              // Update lighting
              break;
            case 'weather':
              // Update weather effects
              break;
            default:
              break;
          }
        }
      });

      // Update current time
      setCurrentTime(progress * currentScene.duration);

      // Continue animation if not finished
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    // Start animation
    requestAnimationFrame(animate);
  };

  // Add playback controls to the timeline panel
  const renderPlaybackControls = () => (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
      <button
        onClick={playScene}
        style={{
          background: '#2196f3',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          padding: '8px 16px',
          cursor: 'pointer'
        }}
      >
        Play
      </button>
      <button
        onClick={() => setCurrentTime(0)}
        style={{
          background: '#757575',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          padding: '8px 16px',
          cursor: 'pointer'
        }}
      >
        Reset
      </button>
      <button
        onClick={addCameraKeyframe}
        style={{
          background: '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          padding: '8px 16px',
          cursor: 'pointer'
        }}
      >
        Add Camera Keyframe
      </button>
    </div>
  );

  // Update the timeline panel to include playback controls
  const renderTimelinePanel = () => (
    <div className="timeline-panel" style={{
      position: 'absolute',
      bottom: '80px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0, 0, 0, 0.9)',
      padding: '16px',
      borderRadius: '8px',
      width: '80%',
      maxWidth: '1200px',
      zIndex: 1000
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ color: 'white', margin: 0 }}>Timeline</h3>
        {renderPlaybackControls()}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="range"
            min="0"
            max={currentScene?.duration || 100}
            value={currentTime}
            onChange={(e) => setCurrentTime(Number(e.target.value))}
            style={{ width: '200px' }}
          />
          <select
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
            style={{ background: '#333', color: 'white', border: '1px solid #555' }}
          >
            <option value="0.25">0.25x</option>
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="4">4x</option>
          </select>
        </div>
      </div>
      <div style={{ 
        height: '200px', 
        background: '#333', 
        borderRadius: '4px',
        padding: '8px',
        overflowY: 'auto'
      }}>
        {/* Timeline tracks will go here */}
        {currentScene?.actors.map(actor => (
          <div key={actor.id} style={{ marginBottom: '8px' }}>
            <div style={{ color: 'white', marginBottom: '4px' }}>{actor.name}</div>
            <div style={{ 
              height: '40px', 
              background: '#444', 
              borderRadius: '4px',
              position: 'relative'
            }}>
              {actor.animations.map(anim => (
                <div
                  key={anim.id}
                  style={{
                    position: 'absolute',
                    left: `${(anim.startTime / (currentScene?.duration || 100)) * 100}%`,
                    width: `${(anim.duration / (currentScene?.duration || 100)) * 100}%`,
                    height: '100%',
                    background: '#2196f3',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                  title={anim.name}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Actor model management
  const handleActorModelImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // Create a local URL for the file
      const modelUrl = URL.createObjectURL(file);
      
      // Add the actor to the current scene
      addActor(modelUrl);

      // Reset the file input
      event.target.value = '';
    } catch (error) {
      console.error('Error importing actor model:', error);
    }
  };

  // Update the actor panel to include model import
  const renderActorPanel = () => (
    <div className="actor-panel" style={{
      position: 'absolute',
      top: '20px',
      right: '20px',
      background: 'rgba(0, 0, 0, 0.9)',
      padding: '16px',
      borderRadius: '8px',
      width: '300px',
      zIndex: 1000
    }}>
      <h3 style={{ color: 'white', margin: '0 0 16px 0' }}>Actors</h3>
      <div style={{ marginBottom: '16px' }}>
        <input
          type="file"
          accept=".gltf,.glb"
          onChange={handleActorModelImport}
          style={{ display: 'none' }}
          id="actor-model-input"
        />
        <button
          onClick={() => document.getElementById('actor-model-input')?.click()}
          style={{
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            width: '100%',
            marginBottom: '8px',
            cursor: 'pointer'
          }}
        >
          Import Actor Model
        </button>
      </div>
      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {currentScene?.actors.map(actor => (
          <div
            key={actor.id}
            style={{
              background: selectedActor?.id === actor.id ? '#2196f3' : '#333',
              padding: '8px',
              borderRadius: '4px',
              marginBottom: '8px',
              cursor: 'pointer'
            }}
            onClick={() => setSelectedActor(actor)}
          >
            <div style={{ color: 'white' }}>{actor.name}</div>
            <div style={{ color: '#aaa', fontSize: '12px' }}>
              Position: {actor.position.join(', ')}
            </div>
            {selectedActor?.id === actor.id && (
              <div style={{ marginTop: '8px' }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    addAnimation(actor.id, 'move');
                  }}
                  style={{
                    background: '#2196f3',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    marginRight: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Add Movement
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    addAnimation(actor.id, 'rotate');
                  }}
                  style={{
                    background: '#9C27B0',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    marginRight: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Add Rotation
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    addAnimation(actor.id, 'scale');
                  }}
                  style={{
                    background: '#FF9800',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    cursor: 'pointer'
                  }}
                >
                  Add Scale
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  useEffect(() => {
    if (!mapContainer.current) return;
    console.log("Initializing map with token:", accessToken);

    mapboxgl.accessToken = accessToken;

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [-122.431297, 37.773972], // San Francisco downtown
      zoom: 15,
      pitch: 75,
      bearing: -30,
      antialias: true,
      maxPitch: 85,
      maxZoom: 24,
      minZoom: 0,
      projection: 'globe',
      renderWorldCopies: false
    });

    map.current = mapInstance;

    // Add navigation controls
    mapInstance.addControl(new mapboxgl.NavigationControl());

    // Add MapboxDraw
    const drawInstance = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: false, trash: false }
    });
    mapInstance.addControl(drawInstance, 'top-left');
    setDraw(drawInstance);

    // Listen for draw.create event
    mapInstance.on('draw.create', (e: any) => {
      setIsDrawing(false);
      const feature = e.features[0];
      const id = feature.id || `${Date.now()}-${Math.random()}`;
      
      // Ask for building color
      const buildingColor = prompt('What color should the building be? (e.g., red, blue, #ff0000)') || '#808080';
      
      // Then ask for name
      const buildingName = prompt('What would you like to name this building?') || `Building ${buildings.length + 1}`;
      
      setBuildings(prev => [
        ...prev,
        { id, feature, height: 50, name: buildingName, color: buildingColor }
      ]);
    });

    // Add atmosphere effect for globe view
    mapInstance.on('style.load', () => {
      mapInstance.setFog({
        'color': 'rgb(186, 210, 235)',
        'high-color': 'rgb(36, 92, 223)',
        'horizon-blend': 0.02,
        'space-color': 'rgb(11, 11, 25)',
        'star-intensity': 0.6
      });

      // Hide labels initially since showLabels is false
      const layers = mapInstance.getStyle().layers;
      layers?.forEach(layer => {
        if (layer.type === 'symbol') {
          mapInstance.setLayoutProperty(
            layer.id,
            'visibility',
            'none'
          );
        }
      });

      console.log("Map loaded");
      
      // Force 3D view
      mapInstance.setPitch(60);
      mapInstance.setBearing(-30);

      // Initialize layers immediately and after a delay to ensure they load
      initializeLayers();
      setTimeout(() => {
        initializeLayers();
      }, 1000);
    });

    // Add layer visibility change listener
    mapInstance.on('zoomend', () => {
      const zoom = mapInstance.getZoom();
      console.log('Zoom ended at level:', zoom);
      const buildingLayer = mapInstance.getLayer('3d-buildings');
      if (buildingLayer) {
        console.log('Building layer visibility:', mapInstance.getLayoutProperty('3d-buildings', 'visibility'));
      }
    });

    return () => {
      if (map.current) {
        map.current.remove();
      }
      map.current = null;
    };
  }, [accessToken]);

  // Reinitialize when 3D settings change
  useEffect(() => {
    if (map.current && map.current.isStyleLoaded()) {
      console.log("3D settings changed, reinitializing layers");
      initializeLayers();
    }
  }, [layers3D]);

  // Effect to render all buildings as a single GeoJSON source/layer
  useEffect(() => {
    if (!map.current) return;

    // Remove previous cube layer/source if they exist
    if (map.current.getLayer('custom-cube')) map.current.removeLayer('custom-cube');
    if (map.current.getSource('custom-cube')) map.current.removeSource('custom-cube');
    if (map.current.getLayer('building-icons')) map.current.removeLayer('building-icons');

    if (buildings.length === 0) return;

    // Add all buildings as a GeoJSON source
    map.current.addSource('custom-cube', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: buildings.map(b => ({
          ...b.feature,
          properties: { ...b.feature.properties, height: b.height, id: b.id, color: b.color }
        }))
      }
    });

    // Add the fill-extrusion layer with custom colors
    map.current.addLayer({
      id: 'custom-cube',
      type: 'fill-extrusion',
      source: 'custom-cube',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 1.0,
        'fill-extrusion-vertical-gradient': true
      }
    });

    // Clean up on unmount or when buildings change
    return () => {
      if (map.current?.getLayer('custom-cube')) map.current.removeLayer('custom-cube');
      if (map.current?.getSource('custom-cube')) map.current.removeSource('custom-cube');
    };
  }, [buildings]);

  // Effect to handle 3D models
  useEffect(() => {
    if (!map.current || models3D.length === 0) return;

    // Create a custom layer for 3D models
    const customLayer: mapboxgl.CustomLayerInterface = {
      id: '3d-models',
      type: 'custom',
      onAdd: function(map: mapboxgl.Map, gl: WebGLRenderingContext) {
        (this as any).camera = new THREE.Camera();
        (this as any).scene = new THREE.Scene();
        (this as any).renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true
        });
        (this as any).renderer.autoClear = false;
        (this as any).loader = new GLTFLoader();
        (this as any).models = {};
        (this as any).map = map;

        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        (this as any).scene.add(ambientLight);

        // Add directional light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(0, 1, 0);
        (this as any).scene.add(directionalLight);

        // Load all models
        models3D.forEach(model => {
          (this as any).loader.load(model.url, (gltf: { scene: THREE.Object3D }) => {
            const object = gltf.scene;
            
            // Center the model
            const box = new THREE.Box3().setFromObject(object);
            const center = box.getCenter(new THREE.Vector3());
            object.position.sub(center);

            // Scale the model
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = model.scale / maxDim;
            object.scale.set(scale, scale, scale);

            // Rotate the model
            object.rotation.y = model.rotation * (Math.PI / 180);

            // Store the model
            (this as any).models[model.id] = object;
            (this as any).scene.add(object);

            // Force a repaint
            map.triggerRepaint();
          }, 
          // Progress callback
          (xhr: any) => {
            console.log((xhr.loaded / xhr.total * 100) + '% loaded');
          },
          // Error callback
          (error: any) => {
            console.error('Error loading model:', error);
          });
        });
      },
      render: function(gl: WebGLRenderingContext, matrix: number[]) {
        const rotationX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        const rotationZ = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), Math.PI);
        const m = new THREE.Matrix4().fromArray(matrix).multiply(rotationX).multiply(rotationZ);
        (this as any).camera.projectionMatrix = m;

        // Update model positions
        models3D.forEach(model => {
          const object = (this as any).models[model.id];
          if (object && (this as any).map) {
            const position = (this as any).map.project([model.position[0], model.position[1]]);
            object.position.set(position.x, position.y, 0);
          }
        });

        (this as any).renderer.resetState();
        (this as any).renderer.render((this as any).scene, (this as any).camera);
        (this as any).map.triggerRepaint();
      }
    };

    // Add the custom layer
    map.current.addLayer(customLayer);

    return () => {
      if (map.current?.getLayer('3d-models')) {
        map.current.removeLayer('3d-models');
      }
    };
  }, [models3D]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      
      {/* Film-making Controls */}
      <div className="film-controls" style={{
        position: 'absolute',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.8)',
        padding: '16px',
        borderRadius: '8px',
        display: 'flex',
        gap: '12px',
        zIndex: 1000
      }}>
        <button
          onClick={createNewScene}
          style={{
            background: '#2196f3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            cursor: 'pointer'
          }}
        >
          New Scene
        </button>
        <button
          onClick={() => setShowTimeline(!showTimeline)}
          style={{
            background: '#2196f3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            cursor: 'pointer'
          }}
        >
          {showTimeline ? 'Hide Timeline' : 'Show Timeline'}
        </button>
        <button
          onClick={() => setShowActorPanel(!showActorPanel)}
          style={{
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            cursor: 'pointer'
          }}
        >
          {showActorPanel ? 'Hide Actors' : 'Show Actors'}
        </button>
        <button
          onClick={() => setShowEffectsPanel(!showEffectsPanel)}
          style={{
            background: '#9C27B0',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            cursor: 'pointer'
          }}
        >
          {showEffectsPanel ? 'Hide Effects' : 'Show Effects'}
        </button>
        <button
          onClick={() => {
            if (!isRecording) {
              startRecording();
            } else {
              stopRecording();
            }
          }}
          style={{
            background: isRecording ? '#f44336' : '#2196f3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            cursor: 'pointer'
          }}
        >
          {isRecording ? 'Stop Recording' : 'Start Recording'}
        </button>
      </div>

      {/* Timeline Panel */}
      {showTimeline && renderTimelinePanel()}

      {/* Actor Panel */}
      {showActorPanel && renderActorPanel()}

      {/* Effects Panel */}
      {showEffectsPanel && (
        <div className="effects-panel" style={{
          position: 'absolute',
          top: '20px',
          right: '340px',
          background: 'rgba(0, 0, 0, 0.9)',
          padding: '16px',
          borderRadius: '8px',
          width: '300px',
          zIndex: 1000
        }}>
          <h3 style={{ color: 'white', margin: '0 0 16px 0' }}>Effects</h3>
          <button
            onClick={() => {
              // Add new effect logic
            }}
            style={{
              background: '#9C27B0',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              padding: '8px 16px',
              width: '100%',
              marginBottom: '16px',
              cursor: 'pointer'
            }}
          >
            Add Effect
          </button>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {currentScene?.effects.map(effect => (
              <div
                key={effect.id}
                style={{
                  background: '#333',
                  padding: '8px',
                  borderRadius: '4px',
                  marginBottom: '8px'
                }}
              >
                <div style={{ color: 'white' }}>{effect.name}</div>
                <div style={{ color: '#aaa', fontSize: '12px' }}>
                  Type: {effect.type}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Settings Button */}
      <div className="settings-container">
        <button
          className="design-building-button"
          onClick={() => {
            setIsDrawing(true);
            if (draw && map.current) {
              draw.changeMode('draw_polygon');
            }
          }}
          disabled={isDrawing}
        >
          Design a building
        </button>
        <button 
          className="settings-button"
          onClick={() => setShowSettings(!showSettings)}
        >
          ⚙️ Settings
        </button>

        {/* Settings Modal */}
        {showSettings && (
          <div className="settings-modal">
            <div className="settings-section">
              <h3>Map Style</h3>
              {mapStyles.map(mapStyle => (
                <button
                  key={mapStyle.id}
                  onClick={() => changeMapStyle(mapStyle.id)}
                  className={`style-button ${style === mapStyle.id ? 'active' : ''}`}
                >
                  {mapStyle.name}
                </button>
              ))}
            </div>

            <div className="settings-section">
              <h3>3D Features</h3>
              {layers3D.map(layer => (
                <button
                  key={layer.id}
                  onClick={() => toggle3DLayer(layer.id)}
                  className={`feature-button ${layer.enabled ? 'active' : ''}`}
                >
                  {layer.name}
                </button>
              ))}
            </div>

            <div className="settings-section">
              <h3>Labels</h3>
              <button
                onClick={toggleLabels}
                className={`feature-button ${showLabels ? 'active' : ''}`}
              >
                {showLabels ? 'Hide Labels' : 'Show Labels'}
              </button>
            </div>
          </div>
        )}
      </div>

      {buildings.length > 0 && (
        <div className="cube-slider-container">
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Your Buildings</div>
          {buildings.map((b, idx) => (
            <div key={b.id} style={{ marginBottom: 12, background: selectedBuildingId === b.id ? '#f0f8ff' : 'transparent', padding: 6, borderRadius: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>
                  <span style={{ 
                    display: 'inline-block', 
                    width: '12px', 
                    height: '12px', 
                    backgroundColor: b.color, 
                    marginRight: '8px',
                    borderRadius: '2px'
                  }}></span>
                  {b.name} Height: {b.height}m
                </span>
                <button
                  style={{ marginLeft: 10, background: '#e53935', color: 'white', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
                  onClick={() => setBuildings(buildings.filter(x => x.id !== b.id))}
                >
                  Delete
                </button>
              </div>
              <input
                type="range"
                min={1}
                max={500}
                value={b.height}
                onChange={e => {
                  const newHeight = Number(e.target.value);
                  setBuildings(buildings.map(x => x.id === b.id ? { ...x, height: newHeight } : x));
                }}
                style={{ width: 200, marginTop: 4 }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Add Model Import Button */}
      <button
        className="import-model-button"
        onClick={() => setShowModelImport(true)}
        style={{
          position: 'absolute',
          top: '20px',
          left: '400px',
          zIndex: 2,
          background: '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          padding: '8px 16px',
          fontSize: '16px',
          cursor: 'pointer'
        }}
      >
        Import 3D Model
      </button>

      {/* Model Import Modal */}
      {showModelImport && (
        <div className="model-import-modal" style={{
          position: 'absolute',
          top: '70px',
          left: '400px',
          zIndex: 3,
          background: 'white',
          padding: '16px',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }}>
          <h3 style={{ margin: '0 0 16px 0' }}>Import 3D Model</h3>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px' }}>Model Scale:</label>
            <input
              type="range"
              min="0.1"
              max="10"
              step="0.1"
              value={modelScale}
              onChange={(e) => setModelScale(Number(e.target.value))}
              style={{ width: '200px' }}
            />
            <span style={{ marginLeft: '8px' }}>{modelScale}x</span>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px' }}>Model Rotation:</label>
            <input
              type="range"
              min="0"
              max="360"
              value={modelRotation}
              onChange={(e) => setModelRotation(Number(e.target.value))}
              style={{ width: '200px' }}
            />
            <span style={{ marginLeft: '8px' }}>{modelRotation}°</span>
          </div>
          <button
            onClick={handleModelImport}
            style={{
              background: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              padding: '8px 16px',
              cursor: 'pointer',
              marginRight: '8px'
            }}
          >
            Select Model File
          </button>
          <button
            onClick={() => setShowModelImport(false)}
            style={{
              background: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              padding: '8px 16px',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept=".gltf,.glb"
            style={{ display: 'none' }}
          />
        </div>
      )}

      {/* Model List */}
      {models3D.length > 0 && (
        <div className="model-list" style={{
          position: 'absolute',
          top: '70px',
          left: '400px',
          zIndex: 3,
          background: 'white',
          padding: '16px',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          marginTop: showModelImport ? '200px' : '0'
        }}>
          <h3 style={{ margin: '0 0 16px 0' }}>Imported Models</h3>
          {models3D.map(model => (
            <div key={model.id} style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{model.name}</span>
                <button
                  onClick={() => setModels3D(models3D.filter(m => m.id !== model.id))}
                  style={{
                    background: '#f44336',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    cursor: 'pointer'
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isPlacingModel && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '16px',
          borderRadius: '8px',
          zIndex: 1000
        }}>
          Draw an area on the map to place the model
        </div>
      )}

      <style>{`
        .settings-container {
          position: absolute;
          top: 20px;
          left: 20px;
          z-index: 1;
        }

        .settings-button {
          background: #ffffff;
          border: none;
          border-radius: 4px;
          padding: 8px 16px;
          font-size: 16px;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          transition: all 0.2s ease;
        }

        .settings-button:hover {
          background: #f0f0f0;
          box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }

        .settings-modal {
          position: absolute;
          top: calc(100% + 10px);
          left: 0;
          background: #ffffff;
          border-radius: 8px;
          padding: 16px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
          min-width: 200px;
        }

        .settings-section {
          margin-bottom: 16px;
          background: #ffffff;
        }

        .settings-section:last-child {
          margin-bottom: 0;
        }

        .settings-section h3 {
          margin: 0 0 8px 0;
          font-size: 14px;
          color: #666;
        }

        .style-button,
        .feature-button {
          display: block;
          width: 100%;
          padding: 8px 12px;
          margin: 4px 0;
          border: 1px solid #e0e0e0;
          border-radius: 4px;
          background: #ffffff;
          cursor: pointer;
          text-align: left;
          transition: all 0.2s ease;
        }

        .style-button:hover,
        .feature-button:hover {
          background: #f0f0f0;
        }

        .style-button.active,
        .feature-button.active {
          background: #2196f3;
          border-color: #1976d2;
          color: #ffffff;
        }

        .design-building-button {
          position: absolute;
          top: 20px;
          left: 250px;
          z-index: 2;
          background: #2196f3;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 8px 16px;
          font-size: 16px;
          cursor: pointer;
          margin-bottom: 10px;
        }
        .design-building-button:disabled {
          background: #b0b0b0;
          cursor: not-allowed;
        }
        .cube-slider-container {
          position: absolute;
          top: 70px;
          left: 250px;
          z-index: 3;
          background: white;
          padding: 10px 16px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          font-size: 15px;
          min-width: 260px;
        }
        .import-model-button {
          position: absolute;
          top: 20px;
          left: 400px;
          zIndex: 2;
          background: #4CAF50;
          color: white;
          border: none;
          borderRadius: 4px;
          padding: 8px 16px;
          fontSize: 16px;
          cursor: pointer;
        }
        .model-import-modal {
          position: absolute;
          top: 70px;
          left: 400px;
          zIndex: 3;
          background: white;
          padding: 16px;
          borderRadius: 8px;
          boxShadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        .model-list {
          position: absolute;
          top: 70px;
          left: 400px;
          zIndex: 3;
          background: white;
          padding: 16px;
          borderRadius: 8px;
          boxShadow: 0 2px 8px rgba(0,0,0,0.15);
          marginTop: showModelImport ? '200px' : 0;
        }
        .film-controls button:hover {
          opacity: 0.9;
        }

        .timeline-panel input[type="range"] {
          width: 200px;
        }

        .timeline-panel select {
          background: #333;
          color: white;
          border: 1px solid #555;
          padding: 4px 8px;
          border-radius: 4px;
        }

        .actor-panel, .effects-panel {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
      `}</style>
    </div>
  );
};

export default Map; 