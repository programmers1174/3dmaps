import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl, { Point } from 'mapbox-gl';
import type { Feature, Polygon, GeoJsonProperties } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable';
import FreehandMode from 'mapbox-gl-draw-freehand-mode';

interface MapProps {
  accessToken: string;
  initialCoordinates?: [number, number];
  initialZoom?: number;
  skyGradient?: 'blue' | 'sunset' | 'night';
  onSkyGradientChange?: (gradient: 'blue' | 'sunset' | 'night') => void;
}

interface Layer3D {
  id: string;
  name: string;
  enabled: boolean;
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
  direction?: [number, number];
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
  skyGradient: externalSkyGradient,
  onSkyGradientChange
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [style, setStyle] = useState('mapbox://styles/mapbox/standard');
  const [showSettings, setShowSettings] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [layers3D, setLayers3D] = useState<Layer3D[]>([
    { id: 'terrain', name: 'Terrain', enabled: true },
    { id: 'buildings', name: '3D Buildings', enabled: true }
  ]);
  const [draw, setDraw] = useState<MapboxDraw | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [models3D, setModels3D] = useState<Model3D[]>([]);
  const [showModelImport, setShowModelImport] = useState(false);
  const [isPlacingModel, setIsPlacingModel] = useState(false);
  const [selectedModelUrl, setSelectedModelUrl] = useState<string>('');
  const [modelScale, setModelScale] = useState(1);
  const [modelRotation, setModelRotation] = useState(0);
  const [isCloudMode, setIsCloudMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New state variables for film-making
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [currentScene, setCurrentScene] = useState<Scene | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPath, setIsRecordingPath] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showActorPanel, setShowActorPanel] = useState(false);
  const [showEffectsPanel, setShowEffectsPanel] = useState(false);
  const [selectedActor, setSelectedActor] = useState<Actor | null>(null);
  const [recordingMediaRecorder, setRecordingMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordingChunks, setRecordingChunks] = useState<Blob[]>([]);
  const [cameraPathLayer, setCameraPathLayer] = useState<mapboxgl.Layer | null>(null);
  const [cameraDirectionLayer, setCameraDirectionLayer] = useState<mapboxgl.Layer | null>(null);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [selectedKeyframe, setSelectedKeyframe] = useState<number | null>(null);
  const [recordingPoints, setRecordingPoints] = useState<[number, number][]>([]);
  const [recordingLines, setRecordingLines] = useState<Array<{
    id: string;
    start: [number, number];
    end: [number, number];
    name: string;
  }>>([]);


  const [isSlideshowMode, setIsSlideshowMode] = useState(false);
  const [skyType, setSkyType] = useState<'blue' | 'evening' | 'night' | 'sunrise'>('blue');
  const [isContinuousCycle, setIsContinuousCycle] = useState(false);
  const [cycleProgress, setCycleProgress] = useState(0); // 0-1 progress through cycle
  const [cycleDuration, setCycleDuration] = useState(24); // Duration in seconds (default 24)
  const cycleIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Sky layer properties for customization
  const [skyLayerType] = useState<'atmosphere' | 'gradient'>('atmosphere');
  const [skyGradientRadius, setSkyGradientRadius] = useState(90);
  const [sunAzimuth, setSunAzimuth] = useState(200); // 0-360 degrees
  const [sunElevation, setSunElevation] = useState(90); // 60-90 degrees
  const [sunIntensity, setSunIntensity] = useState(1.0);
  const [sunColor, setSunColor] = useState('#ffffff');
  const [haloColor, setHaloColor] = useState('#ffffff');
  const [atmosphereColor, setAtmosphereColor] = useState('#ffffff');
  const [backgroundColor, setBackgroundColor] = useState('#F3E5F5');
  const [backgroundOpacity, setBackgroundOpacity] = useState(1);
  
  // Sun cycle state
  const [isSunCycleEnabled, setIsSunCycleEnabled] = useState(false);
  const [sunCycleDuration, setSunCycleDuration] = useState(30); // Duration in seconds
  const sunCycleIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isCycleRunningRef = useRef(false);

  // Camera angle state for low-angle shots
  const [cameraPitch, setCameraPitch] = useState(0); // 0-85 degrees (0 = straight down, 85 = nearly horizontal)
  const [cameraBearing, setCameraBearing] = useState(0); // 0-360 degrees (compass direction)



  // Replace showTopBar with showSidePanel
  const [showSidePanel, setShowSidePanel] = useState(true);

  const [terrainExaggeration, setTerrainExaggeration] = useState(1);
  const [buildingColor, setBuildingColor] = useState('#ffffff');
  const [buildingReplacements, setBuildingReplacements] = useState<Array<{
    id: string;
    buildingName: string;
    modelUrl: string;
    position: [number, number];
    scale: number;
    rotation: number;
    originalBuildingId?: string;
  }>>([]);
  const [showBuildingReplacement, setShowBuildingReplacement] = useState(false);
  const [selectedReplacementBuilding, setSelectedReplacementBuilding] = useState<string>('');
  const [replacementModelUrl, setReplacementModelUrl] = useState<string>('');
  const [replacementScale, setReplacementScale] = useState(1);
  const [replacementRotation, setReplacementRotation] = useState(0);
  const buildingReplacementFileRef = useRef<HTMLInputElement>(null);

  // 3D Building Designer State
  const [isBuildingDesignerMode, setIsBuildingDesignerMode] = useState(false);
  const [customBuildings, setCustomBuildings] = useState<Array<{
    id: string;
    name: string;
    position: [number, number];
    height: number;
    width: number;
    length: number;
    color: string;
    style: 'box' | 'pyramid' | 'cylinder' | 'tower';
    rotation: number;
    points?: [number, number][];
  }>>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const [buildingDesignerProperties, setBuildingDesignerProperties] = useState({
    height: 50,
    width: 20,
    length: 20,
    color: '#ffffff',
    style: 'box' as 'box' | 'pyramid' | 'cylinder' | 'tower',
    rotation: 0
  });
  
  // Point selection for building creation
  const [isSelectingPoints, setIsSelectingPoints] = useState(false);
  const [selectedPoints, setSelectedPoints] = useState<[number, number][]>([]);
  const [isCreatingBuilding, setIsCreatingBuilding] = useState(false);
  const [pointMarkers, setPointMarkers] = useState<mapboxgl.Marker[]>([]);
  const [isSelectingBuilding, setIsSelectingBuilding] = useState(false);
  const [selectedBuildingCoords, setSelectedBuildingCoords] = useState<[number, number] | null>(null);
  const [selectedBuildingName, setSelectedBuildingName] = useState<string>('');
  
  // Building editing state
  const [isEditingBuilding, setIsEditingBuilding] = useState(false);
  const [editingBuilding, setEditingBuilding] = useState<typeof customBuildings[0] | null>(null);
  const [editingBuildingProperties, setEditingBuildingProperties] = useState({
    height: 50,
    color: '#ffffff',
    style: 'box' as 'box' | 'pyramid' | 'cylinder' | 'tower',
    rotation: 0
  });

  // Add new state for panel type



  const toggle3DLayer = (layerId: string) => {
    console.log('Toggling 3D layer:', layerId);
    try {
      const currentLayer = layers3D.find(l => l.id === layerId);
      const newEnabled = !currentLayer?.enabled;
      
      setLayers3D(prevLayers =>
        prevLayers.map(layer =>
          layer.id === layerId ? { ...layer, enabled: newEnabled } : layer
        )
      );

      // Immediately remove layer if disabling
      if (!newEnabled && map.current) {
        if (layerId === 'buildings') {
          ['3d-buildings', '3d-buildings-simple', '3d-buildings-fallback'].forEach(layerName => {
            if (map.current?.getLayer(layerName)) {
              map.current.removeLayer(layerName);
            }
          });
        } else if (layerId === 'terrain') {
          if (map.current.getLayer('terrain-contours')) {
            map.current.removeLayer('terrain-contours');
          }
          if (map.current.getSource('mapbox-dem')) {
            map.current.removeSource('mapbox-dem');
          }
          map.current.setTerrain(null);
        }
      }
      
      console.log('Updated layers:', layers3D);
    } catch (error) {
      console.error('Error toggling 3D layer:', error);
    }
  };

  const toggleLabels = () => {
    console.log('Toggling labels, current state:', showLabels);
    if (!map.current) {
      console.warn('Map not initialized when trying to toggle labels');
      return;
    }
    
    try {
      setShowLabels(prev => {
        const newShowLabels = !prev;
        const layers = map.current!.getStyle().layers;
        console.log('Found layers:', layers?.length);
        
        layers?.forEach(layer => {
          if (layer.type === 'symbol') {
            console.log('Setting visibility for layer:', layer.id);
            map.current!.setLayoutProperty(
              layer.id,
              'visibility',
              newShowLabels ? 'visible' : 'none'
            );
          }
        });
        
        return newShowLabels;
      });
    } catch (error) {
      console.error('Error toggling labels:', error);
    }
  };

  const changeMapStyle = (newStyle: string) => {
    console.log('Changing map style to:', newStyle);
    if (!map.current) {
      console.warn('Map not initialized when trying to change style');
      return;
    }

    try {
      setStyle(newStyle);
      
      // Store current camera position
      const currentCenter = map.current.getCenter();
      const currentZoom = map.current.getZoom();
      const currentPitch = map.current.getPitch();
      const currentBearing = map.current.getBearing();
      console.log('Stored camera position:', { currentCenter, currentZoom, currentPitch, currentBearing });

      // Wait for style to be loaded before making changes
      map.current.once('style.load', () => {
        // Remove any fog from the style (in case the style has default fog)
        if (map.current) {
          try { map.current.setFog({}); } catch (e) { /* ignore */ }
        }
        console.log('Style loaded, restoring camera position');
        // Restore camera position
        map.current?.setCenter(currentCenter);
        map.current?.setZoom(currentZoom);
        map.current?.setPitch(currentPitch);
        map.current?.setBearing(currentBearing);

        // Set building style based on map style
        const isSatellite = newStyle.includes('satellite');
        console.log('Is satellite style:', isSatellite);
        
        // Multiple attempts to initialize layers with increasing delays
        const attemptLayerInitialization = (attempt = 1) => {
          console.log(`Attempting layer initialization (attempt ${attempt})`);
          
          setTimeout(() => {
            console.log('Re-initializing layers after style change');
            initializeLayers();
            
            // Restore label visibility
            if (!showLabels && map.current) {
              try {
                const layers = map.current.getStyle().layers;
                console.log('Restoring label visibility, found layers:', layers?.length);
                layers?.forEach(layer => {
                  if (layer.type === 'symbol') {
                    map.current!.setLayoutProperty(
                      layer.id,
                      'visibility',
                      'none'
                    );
                  }
                  // Hide highway road layers (orange/yellow markings)
                  if (layer.id && (
                    layer.id.includes('road') || 
                    layer.id.includes('highway') || 
                    layer.id.includes('motorway') || 
                    layer.id.includes('primary') || 
                    layer.id.includes('secondary') ||
                    layer.id.includes('tertiary')
                  )) {
                    map.current!.setLayoutProperty(
                      layer.id,
                      'visibility',
                      'none'
                    );
                  }
                });
              } catch (e) {
                console.error("Error setting label visibility:", e);
              }
            }

            // Check if layers were added successfully and retry if needed
            if (attempt < 3) {
              setTimeout(() => {
                const hasBuildings = map.current?.getLayer('3d-buildings') || map.current?.getLayer('3d-buildings-simple');
                const hasTerrain = map.current?.getLayer('terrain-contours');
                
                if (!hasBuildings && layers3D.find(l => l.id === 'buildings')?.enabled) {
                  console.log(`Buildings not found, retrying (attempt ${attempt + 1})`);
                  attemptLayerInitialization(attempt + 1);
                } else if (!hasTerrain && layers3D.find(l => l.id === 'terrain')?.enabled) {
                  console.log(`Terrain not found, retrying (attempt ${attempt + 1})`);
                  attemptLayerInitialization(attempt + 1);
                } else {
                  console.log('All layers initialized successfully');
                }
              }, 2000);
            }
          }, attempt * 1000); // Increasing delay for each attempt
        };

        // Start the initialization process
        attemptLayerInitialization();
      });

      map.current.setStyle(newStyle);
    } catch (error) {
      console.error('Error changing map style:', error);
    }
  };












  const toggleSlideshowMode = () => {
    setIsSlideshowMode(!isSlideshowMode);
  };

  // Toggle map interactions and controls based on slideshow mode
  useEffect(() => {
    if (map.current) {
      if (isSlideshowMode) {
        // Disable all map interactions in slideshow mode
        map.current.dragPan.disable();
        map.current.dragRotate.disable();
        map.current.scrollZoom.disable();
        map.current.touchZoomRotate.disable();
        map.current.keyboard.disable();
        map.current.doubleClickZoom.disable();
        map.current.boxZoom.disable();
        
        // Remove draw control if it exists
        if (draw && map.current) {
          try {
          map.current.removeControl(draw);
          } catch (error) {
            console.log('Error removing draw control:', error);
          }
        }
      } else {
        // Enable all map interactions in editor mode
        map.current.dragPan.enable();
        map.current.dragRotate.enable();
        map.current.scrollZoom.enable();
        map.current.touchZoomRotate.enable();
        map.current.keyboard.enable();
        map.current.doubleClickZoom.enable();
        map.current.boxZoom.enable();
        
        // Add draw control back if it doesn't exist
        if (!draw && map.current) {
          try {
          const drawInstance = new (MapboxDraw as any)({
            displayControlsDefault: false,
            controls: { polygon: false, trash: false },
            modes: {
              ...(MapboxDraw as any).modes,
              draw_polygon: FreehandMode
            }
          });
          map.current.addControl(drawInstance, 'top-left');
          setDraw(drawInstance);
          } catch (error) {
            console.log('Error adding draw control:', error);
          }
        }
      }
    }
  }, [isSlideshowMode]);














  const refresh3DFeatures = () => {
    console.log('Manually refreshing 3D features');
    if (map.current && map.current.isStyleLoaded()) {
          initializeLayers();
          // Ensure atmosphere skies are maintained after refresh
          setTimeout(() => {
            applySkyProperties();
          }, 100);
    }
  };

  // Simple stars generation
  const generateStars = () => {
    const stars: any[] = [];
    for (let i = 0; i < 150; i++) {
      stars.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            -122.4194 + (Math.random() - 0.5) * 0.1, // Random longitude around San Francisco
            37.7749 + (Math.random() - 0.5) * 0.1   // Random latitude around San Francisco
          ]
        },
        properties: {
          id: `star-${i}`,
          size: Math.random() * 0.8 + 0.3 // Random size between 0.3 and 1.1
        }
      });
    }
    return {
      type: 'FeatureCollection' as const,
      features: stars
    };
  };

  // Add stars for night sky
  const addStars = () => {
    if (map.current && map.current.isStyleLoaded()) {
      try {
        // Remove existing stars first
        if (map.current.getLayer('stars')) {
          map.current.removeLayer('stars');
        }
        if (map.current.getSource('stars')) {
          map.current.removeSource('stars');
        }
        
        // Add stars
        map.current.addSource('stars', {
          type: 'geojson',
          data: generateStars()
        });
        map.current.addLayer({
          id: 'stars',
          type: 'symbol',
          source: 'stars',
          layout: {
            'text-field': '⭐',
            'text-size': ['get', 'size'],
            'text-allow-overlap': true,
            'text-ignore-placement': true
          },
          paint: {
            'text-color': '#FFFFFF',
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 0.5
          }
        });
        console.log('Stars added to night sky');
      } catch (error) {
        console.error('Error adding stars:', error);
      }
    }
  };

  // Remove stars
  const removeStars = () => {
    if (map.current && map.current.isStyleLoaded()) {
      try {
        if (map.current.getLayer('stars')) {
          map.current.removeLayer('stars');
        }
        if (map.current.getSource('stars')) {
          map.current.removeSource('stars');
        }
        console.log('Stars removed');
      } catch (error) {
        console.error('Error removing stars:', error);
      }
    }
  };

  // Function to interpolate between colors
  const interpolateColor = (color1: string, color2: string, factor: number): string => {
    const hex1 = color1.replace('#', '');
    const hex2 = color2.replace('#', '');
    
    const r1 = parseInt(hex1.substr(0, 2), 16);
    const g1 = parseInt(hex1.substr(2, 2), 16);
    const b1 = parseInt(hex1.substr(4, 2), 16);
    
    const r2 = parseInt(hex2.substr(0, 2), 16);
    const g2 = parseInt(hex2.substr(2, 2), 16);
    const b2 = parseInt(hex2.substr(4, 2), 16);
    
    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // Function to start/stop sun cycle
  const toggleSunCycle = () => {
    if (isSunCycleEnabled) {
      // Stop the cycle
      if (sunCycleIntervalRef.current) {
        clearTimeout(sunCycleIntervalRef.current);
        sunCycleIntervalRef.current = null;
      }
      isCycleRunningRef.current = false;
      setIsSunCycleEnabled(false);
      console.log('Sun cycle stopped');
    } else {
      // Start the cycle
      isCycleRunningRef.current = true;
      setIsSunCycleEnabled(true);
      console.log('Sun cycle started');
      startSunCycle();
    }
  };

  // Function to start the sun cycle animation
  const startSunCycle = () => {
    if (sunCycleIntervalRef.current) {
      clearTimeout(sunCycleIntervalRef.current);
    }

    const startTime = Date.now();
    const duration = sunCycleDuration * 1000; // Convert to milliseconds

    const animate = () => {
      // Check if cycle is still running using ref
      if (!isCycleRunningRef.current) {
        return;
      }

      const elapsed = Date.now() - startTime;
      const progress = (elapsed % duration) / duration; // 0 to 1, then resets to 0
      
        // Consistent pace cycle: Sun moves from 90° to 60° over the full duration
        const newElevation = 90 - (progress * 30); // 90° to 60° over full cycle
      
      setSunElevation(newElevation);

      // Continue animation
      sunCycleIntervalRef.current = setTimeout(animate, 50); // Update every 50ms for smooth animation
    };

    animate();
  };

  // Function to apply camera angle changes
  const applyCameraAngle = () => {
    if (map.current) {
      try {
        // Set the camera pitch (0 = straight down, 85 = nearly horizontal)
        map.current.setPitch(cameraPitch);
        
        // Set the camera bearing (0-360 degrees)
        map.current.setBearing(cameraBearing);
        
        console.log(`Camera angle set: Pitch=${cameraPitch}°, Bearing=${cameraBearing}°`);
      } catch (error) {
        console.error('Error setting camera angle:', error);
      }
    }
  };

  // Function to apply sky layer properties
  const applySkyProperties = () => {
    if (map.current && map.current.isStyleLoaded()) {
      try {
        // Apply sky layer type
        map.current.setPaintProperty('sky', 'sky-type', skyLayerType);
        
        // Apply gradient radius
        map.current.setPaintProperty('sky', 'sky-gradient-radius', skyGradientRadius);
        
        // Apply sun properties with lighter atmospheric colors
        map.current.setPaintProperty('sky', 'sky-atmosphere-sun', [sunAzimuth, sunElevation]);
        map.current.setPaintProperty('sky', 'sky-atmosphere-sun-intensity', sunIntensity);
        map.current.setPaintProperty('sky', 'sky-atmosphere-halo-color', haloColor);
        map.current.setPaintProperty('sky', 'sky-atmosphere-color', atmosphereColor);
        
        // Apply background properties
        map.current.setPaintProperty('background', 'background-color', backgroundColor);
        map.current.setPaintProperty('background', 'background-opacity', backgroundOpacity);
        
        map.current.triggerRepaint();
        console.log('Sky properties applied');
      } catch (error) {
        console.error('Error applying sky properties:', error);
      }
    }
  };

  // Function to change sky type
  const changeSkyType = (newSkyType: 'blue' | 'evening' | 'night' | 'sunrise') => {
    setSkyType(newSkyType);
    
    if (map.current && map.current.isStyleLoaded()) {
      try {
        if (newSkyType === 'blue') {
          // Serene clear blue gradient like the first image
          map.current.setPaintProperty('sky', 'sky-gradient', [
            'interpolate',
            ['linear'],
            ['sky-radial-progress'],
            0.0, '#64B5F6',    // Medium blue at zenith
            0.2, '#79BEEF',    // Lighter blue
            0.4, '#90CAF9',    // Even lighter blue
            0.6, '#BBDEFB',    // Very pale blue
            0.8, '#E3F2FD',    // Almost white-blue
            1.0, '#F3E5F5'     // Very pale lavender at horizon
          ]);
          map.current.setPaintProperty('background', 'background-color', '#F3E5F5');
        } else if (newSkyType === 'evening') {
          // Bright and warm evening sky colors
          map.current.setPaintProperty('sky', 'sky-gradient', [
            'interpolate',
            ['linear'],
            ['sky-radial-progress'],
            0.0, '#FFB6C1',    // Light pink at top
            0.2, '#FFA07A',    // Light salmon
            0.4, '#FFD700',    // Gold
            0.6, '#FF8C00',    // Dark orange
            0.8, '#FF6347',    // Tomato
            0.9, '#FF4500',    // Orange red
            1.0, '#FFE4B5'     // Moccasin at horizon
          ]);
          map.current.setPaintProperty('background', 'background-color', '#FFE4B5');
        } else if (newSkyType === 'sunrise') {
          // Bright and cheerful sunrise sky colors
            map.current.setPaintProperty('sky', 'sky-gradient', [
              'interpolate',
              ['linear'],
              ['sky-radial-progress'],
            0.0, '#FFE4B5',    // Moccasin at top
            0.3, '#FFDAB9',    // Peach puff
            0.6, '#FFB6C1',    // Light pink
            1.0, '#FFA07A'     // Light salmon at horizon
          ]);
          map.current.setPaintProperty('background', 'background-color', '#FFA07A');
          } else {
          // Night sky colors (darker/more black)
            map.current.setPaintProperty('sky', 'sky-gradient', [
              'interpolate',
              ['linear'],
              ['sky-radial-progress'],
            0.0, '#000000',    // Pure black at top
            0.4, '#0a0a0a',    // Almost black
            0.7, '#1a1a1a',    // Very dark gray
            1.0, '#2a2a2a'     // Dark gray at horizon
          ]);
          map.current.setPaintProperty('background', 'background-color', '#1a1a1a');
          
          // Add stars for night sky
          addStars();
        }
        
        // Remove stars for non-night skies
        if (newSkyType !== 'night') {
          removeStars();
        }
        
        // Force repaint
        map.current.triggerRepaint();
        console.log('Sky changed to:', newSkyType);
      } catch (error) {
        console.error('Error changing sky type:', error);
      }
    }
  };

  // Function to apply smooth sky transition based on cycle progress
  const applyContinuousSkyTransition = (progress: number) => {
    if (!map.current || !map.current.isStyleLoaded()) return;

    // Realistic day-night color transitions - natural sky colors only
    // Based on actual morning and evening sky observations
    const dayColorStops = [
      // Deep Night (0.0) - Pure black night sky
      { 
        progress: 0.0, 
        colors: ['#000000', '#0A0A0A', '#141414', '#1E1E1E', '#282828'], 
        background: '#0A0A0A', 
        phase: 'night' 
      },
      
      // Late Night (0.2) - Still black but slightly lighter
      { 
        progress: 0.2, 
        colors: ['#000000', '#0A0A0A', '#141414', '#1E1E1E', '#282828'], 
        background: '#0A0A0A', 
        phase: 'night' 
      },
      
      // Very Early Pre-Dawn (0.25) - First hint of change
      { 
        progress: 0.25, 
        colors: ['#0A0A0A', '#141414', '#1A1A1A', '#1E1E1E', '#2A2A2A'], 
        background: '#141414', 
        phase: 'night' 
      },
      
      // Pre-Dawn (0.3) - Very early morning, warm orange hints
      { 
        progress: 0.3, 
        colors: ['#1A1A1A', '#2A2A1A', '#3A3A1A', '#4A4A2A', '#6A5A3A'], 
        background: '#2A2A1A', 
        phase: 'sunrise' 
      },
      
      // Early Pre-Dawn (0.35) - Slightly more warmth
      { 
        progress: 0.35, 
        colors: ['#1E1E1A', '#2E2E1E', '#3E3E2A', '#5A5A3A', '#6A6A4A'], 
        background: '#2E2E1E', 
        phase: 'sunrise' 
      },
      
      // Early Dawn (0.38) - First warm orange light
      { 
        progress: 0.38, 
        colors: ['#2A2A1A', '#3A3A2A', '#4A4A3A', '#6A5A4A', '#8A6A5A', '#AA7A6A'], 
        background: '#3A3A2A', 
        phase: 'sunrise' 
      },
      
      // Dawn (0.42) - Enhanced dawn with blue tones
      { 
        progress: 0.42, 
        colors: ['#2A2A3A', '#3A3A4A', '#4A4A5A', '#5A5A6A', '#6A6A7A', '#7A7A8A', '#8A8A9A'], 
        background: '#4A4A5A', 
        phase: 'sunrise' 
      },
      
      // Sunrise (0.44) - Enhanced dawn with subtle warmth
      { 
        progress: 0.44, 
        colors: ['#3A3A4A', '#4A4A5A', '#5A5A6A', '#6A6A7A', '#7A7A8A', '#8A8A9A', '#9A9AAA'], 
        background: '#5A5A6A', 
        phase: 'sunrise' 
      },
      
      // Post-Sunrise (0.46) - Enhanced transition to blue
      { 
        progress: 0.46, 
        colors: ['#4A4A5A', '#5A5A6A', '#6A6A7A', '#7A7A8A', '#8A8A9A', '#9A9AAA', '#AAAAAA'], 
        background: '#6A6A7A', 
        phase: 'sunrise' 
      },
      
      // Transition to Blue (0.48) - Enhanced transition to light blue
      { 
        progress: 0.48, 
        colors: ['#6A6A7A', '#7A7A8A', '#8A8A9A', '#9A9AAA', '#AAAAAA', '#BBDDFF', '#AAEEFF'], 
        background: '#8A8A9A', 
        phase: 'blue' 
      },
      
      // Early Morning (0.52) - Enhanced light blue sky
      { 
        progress: 0.52, 
        colors: ['#7A7A8A', '#8A8A9A', '#9A9AAA', '#AAAAAA', '#CCDDFF', '#BBDDFF', '#AAEEFF'], 
        background: '#9A9AAA', 
        phase: 'blue' 
      },
      
      // Morning (0.62) - Vibrant blue sky with rich gradients
      { 
        progress: 0.62, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#93C5FD', 
        phase: 'blue' 
      },
      
      // Full Day (0.7) - Enhanced vibrant blue sky
      { 
        progress: 0.7, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#60A5FA', 
        phase: 'blue' 
      },
      
      // Afternoon (0.78) - Enhanced bright blue sky
      { 
        progress: 0.78, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Late Afternoon (0.83) - Enhanced pure blue sky
      { 
        progress: 0.83, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#2563EB', 
        phase: 'blue' 
      },
      
      // Pre-Evening (0.85) - Extended morning blue sky
      { 
        progress: 0.85, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#1E3A8A', 
        phase: 'blue' 
      },
      
      // Late Evening (0.90) - Extended morning blue sky continues
      { 
        progress: 0.90, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#2563EB', 
        phase: 'blue' 
      },
      
      // Very Late Evening (0.93) - Extended morning blue sky continues
      { 
        progress: 0.93, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Extended Evening 1 (0.94) - Really long evening blue sky
      { 
        progress: 0.94, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Extended Evening 2 (0.95) - Really long evening blue sky
      { 
        progress: 0.95, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Extended Evening 3 (0.96) - Really long evening blue sky
      { 
        progress: 0.96, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Extended Evening 4 (0.97) - Really long evening blue sky
      { 
        progress: 0.97, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Extended Evening 5 (0.98) - Really long evening blue sky
      { 
        progress: 0.98, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Extended Evening 6 (0.985) - Really long evening blue sky
      { 
        progress: 0.985, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Extended Evening 7 (0.988) - Really long evening blue sky
      { 
        progress: 0.988, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Extended Evening 8 (0.99) - Really long evening blue sky
      { 
        progress: 0.99, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Extended Evening 9 (0.992) - Really long evening blue sky
      { 
        progress: 0.992, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Extended Evening 10 (0.994) - Really long evening blue sky
      { 
        progress: 0.994, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Extended Evening 11 (0.996) - Really long evening blue sky
      { 
        progress: 0.996, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Extended Evening 12 (0.998) - Really long evening blue sky
      { 
        progress: 0.998, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'], 
        background: '#3B82F6', 
        phase: 'blue' 
      },
      
      // Blue to Dark Transition 1 (0.999) - Very slow transition from blue to night
      { 
        progress: 0.999, 
        colors: ['#0F172A', '#1E3A8A', '#2563EB', '#3B82F6', '#1E3A8A', '#0F172A', '#1A1A2E'], 
        background: '#1E3A8A', 
        phase: 'night' 
      },
      
      // Direct to Night (0.9995) - Final transition from blue to night
      { 
        progress: 0.9995, 
        colors: ['#3B82F6', '#1E3A8A', '#0F172A', '#1A1A2E', '#16213E', '#0F3460', '#000000'], 
        background: '#0F172A', 
        phase: 'night' 
      },
      
      // Back to Night (1.0) - Pure black night
      { 
        progress: 1.0, 
        colors: ['#000000', '#0A0A0A', '#141414', '#1E1E1E', '#282828'], 
        background: '#0A0A0A', 
        phase: 'night' 
      }
    ];

    // Find the two color stops to interpolate between
    let beforeStop = dayColorStops[0];
    let afterStop = dayColorStops[1];
    
    for (let i = 0; i < dayColorStops.length - 1; i++) {
      if (progress >= dayColorStops[i].progress && progress <= dayColorStops[i + 1].progress) {
        beforeStop = dayColorStops[i];
        afterStop = dayColorStops[i + 1];
        break;
      }
    }

    // Calculate interpolation factor between the two stops
    const stopRange = afterStop.progress - beforeStop.progress;
    const localProgress = stopRange > 0 ? (progress - beforeStop.progress) / stopRange : 0;
    
    // Smoother interpolation with more linear easing to prevent abrupt transitions
    // Use a gentler easing function that's more linear to avoid sudden changes
    const easedProgress = localProgress < 0.5 
      ? 2 * localProgress * localProgress 
      : 1 - Math.pow(-2 * localProgress + 2, 2) / 2; // Ease-in-out quad
    
    // Interpolate colors - handle different gradient lengths
    const maxColors = Math.max(beforeStop.colors.length, afterStop.colors.length);
    const interpolatedColors: string[] = [];
    
    for (let i = 0; i < maxColors; i++) {
      const beforeColor = beforeStop.colors[Math.min(i, beforeStop.colors.length - 1)];
      const afterColor = afterStop.colors[Math.min(i, afterStop.colors.length - 1)];
      interpolatedColors.push(interpolateColor(beforeColor, afterColor, easedProgress));
    }
    
    // Interpolate background color
    const interpolatedBackground = interpolateColor(
      beforeStop.background, 
      afterStop.background, 
      easedProgress
    );

    try {
      // Build dynamic gradient with all interpolated colors
      const gradientStops: (number | string)[] = [];
      for (let i = 0; i < interpolatedColors.length; i++) {
        const position = i / (interpolatedColors.length - 1);
        gradientStops.push(position);
        gradientStops.push(interpolatedColors[i]);
      }

      // Calculate sun position for sky integration
      const sunPos = getSunPosition();
      let skyGradient: any[] = [
        'interpolate',
        ['linear'],
        ['sky-radial-progress'],
        ...gradientStops
      ];

      // Add sun to sky gradient if visible
      if (sunPos) {
        const sunY = sunPos.y / 100;
        console.log('Adding sun to sky at position:', sunY);
        
        // Insert sun gradient stops into the existing gradient
        const sunGradientStops = [
          sunY - 0.03, 'transparent',
          sunY - 0.01, '#FFFF00',
          sunY, '#FFFFFF',
          sunY + 0.01, '#FFFF00',
          sunY + 0.03, 'transparent'
        ];
        
        // Insert sun stops at the appropriate position
        skyGradient = [
          'interpolate',
          ['linear'],
          ['sky-radial-progress'],
          ...gradientStops.slice(0, 2), // Keep the first two elements
          ...sunGradientStops,
          ...gradientStops.slice(2) // Add the rest
        ];
      }

      // Apply the sky gradient with sun
      map.current.setPaintProperty('sky', 'sky-gradient', skyGradient as [string, ...any[]]);
      
      // Apply background color
      map.current.setPaintProperty('background', 'background-color', interpolatedBackground);
      
      
      // Handle stars - only visible during deepest night (0.0-0.15 and 0.95-1.0)
      if ((progress >= 0.0 && progress <= 0.15) || (progress >= 0.95 && progress <= 1.0)) {
        addStars();
      } else {
        removeStars();
      }
      
      // Update sky type state to match current phase (for UI display)
      setSkyType(beforeStop.phase as 'blue' | 'evening' | 'night' | 'sunrise');
      
      } catch (error) {
      console.error('Error applying continuous sky transition:', error);
    }
  };

  // Function to start continuous sky cycle
  const startContinuousCycle = () => {
    setIsContinuousCycle(true);
    
    const startTime = Date.now();
    const cycleDurationMs = cycleDuration * 1000; // Convert seconds to milliseconds
    
    const updateCycle = () => {
      const elapsed = Date.now() - startTime;
      const progress = (elapsed % cycleDurationMs) / cycleDurationMs; // Loop continuously using modulo
      
      setCycleProgress(progress);
      applyContinuousSkyTransition(progress);
      
      // Continue looping automatically - no stopping!
      // The cycle repeats seamlessly from 0 to 1 to 0 again
      if (cycleIntervalRef.current) {
        cycleIntervalRef.current = setTimeout(updateCycle, 50); // 20 FPS
      }
    };
    
    cycleIntervalRef.current = setTimeout(updateCycle, 0);
  };

  // Function to stop continuous sky cycle
  const stopContinuousCycle = () => {
    setIsContinuousCycle(false);
    setCycleProgress(0);
    
    if (cycleIntervalRef.current) {
      clearTimeout(cycleIntervalRef.current);
      cycleIntervalRef.current = null;
    }
  };

  const initializeLayers = useCallback(() => {
    console.log('Initializing layers');
    if (!map.current) {
      console.warn('Map not initialized when trying to initialize layers');
      setTimeout(initializeLayers, 300);
      return;
    }

    // Wait for style to be fully loaded
    if (!map.current.isStyleLoaded()) {
      console.log('Style not loaded, waiting...');
      map.current.once('style.load', () => {
        setTimeout(initializeLayers, 100);
      });
      return;
    }

    const currentMap = map.current;
    const isSatellite = style.includes('satellite');
    console.log('Current style:', style, 'Is satellite:', isSatellite);

    // Wait for the 'composite' source (for buildings) and 'mapbox-dem' (for terrain)
    if (!currentMap.getSource('composite')) {
      console.log('Composite source not ready, retrying...');
      setTimeout(initializeLayers, 500);
      return;
    }

    try {
      console.log("Initializing layers, map style:", currentMap.getStyle().name);
    } catch (e) {
      console.error("Error getting map style:", e);
      setTimeout(initializeLayers, 500);
      return;
    }

    // Clear everything first
    try {
      if (
        currentMap &&
        currentMap.style &&
        typeof currentMap.getTerrain === 'function' &&
        typeof currentMap.getSource === 'function' &&
        !(currentMap as any)._removed
      ) {
        // Always unset terrain before removing the source
        if (currentMap.getTerrain()) {
          try {
            currentMap.setTerrain(null);
          } catch (e) {
            console.error('Error unsetting terrain:', e);
          }
        }
        // Remove sources safely
        ['mapbox-dem', 'satellite'].forEach(sourceId => {
          if (currentMap.getSource(sourceId)) {
            try {
              currentMap.removeSource(sourceId);
            } catch (e) {
              console.error(`Error removing source ${sourceId}:`, e);
            }
          }
        });
        ['sky', '3d-buildings', 'terrain-contours', '3d-buildings-simple', '3d-buildings-fallback'].forEach(layerId => {
          if (currentMap.getLayer(layerId)) {
            try {
              currentMap.removeLayer(layerId);
            } catch (e) {
              console.error(`Error removing layer ${layerId}:`, e);
            }
          }
        });
      }
    } catch (e) {
      console.error("Error cleaning up layers:", e);
    }

    // Add sky layer based on selected type
    try {
      console.log('Adding sky layer, skyLayerType:', skyLayerType, 'skyType:', skyType);
      
      if (skyLayerType === 'atmosphere') {
        // Use atmosphere sky type
        currentMap.addLayer({
          'id': 'sky',
          'type': 'sky',
          'paint': {
            'sky-type': 'atmosphere',
            'sky-atmosphere-sun': [sunAzimuth, sunElevation],
            'sky-atmosphere-sun-intensity': sunIntensity,
            'sky-atmosphere-halo-color': haloColor,
            'sky-atmosphere-color': atmosphereColor,
            'sky-opacity': 1.0
          } as any
        });
        
        // Set background
        if (currentMap.getLayer('background')) {
          currentMap.setPaintProperty('background', 'background-color', backgroundColor);
        } else {
          currentMap.addLayer({
            'id': 'background',
            'type': 'background',
            'paint': { 'background-color': backgroundColor }
          }, 'sky');
        }
      } else if (skyType === 'blue') {
        // Enhanced blue sky - more vibrant and lively
      currentMap.addLayer({
        'id': 'sky',
        'type': 'sky',
        'paint': {
          'sky-type': 'gradient',
          'sky-gradient-center': [0, 0],
          'sky-gradient-radius': 90,
            'sky-gradient': [
            'interpolate',
            ['linear'],
            ['sky-radial-progress'],
              0.0, '#64B5F6',    // Medium blue at zenith
              0.2, '#79BEEF',    // Lighter blue
              0.4, '#90CAF9',    // Even lighter blue
              0.6, '#BBDEFB',    // Very pale blue
              0.8, '#E3F2FD',    // Almost white-blue
              1.0, '#F3E5F5'     // Very pale lavender at horizon
            ],
            'sky-opacity': 1.0
          } as any
        });
        
        // Set background to very pale lavender like horizon
        if (currentMap.getLayer('background')) {
          currentMap.setPaintProperty('background', 'background-color', '#F3E5F5');
        } else {
          currentMap.addLayer({
            'id': 'background',
            'type': 'background',
            'paint': { 'background-color': '#F3E5F5' }
          }, 'sky');
        }
      } else if (skyType === 'evening') {
        // Enhanced dusk sky - more blue, less orange
        currentMap.addLayer({
          'id': 'sky',
          'type': 'sky',
          'paint': {
            'sky-type': 'gradient',
            'sky-gradient-center': [0, 0],
            'sky-gradient-radius': 90,
            'sky-gradient': [
            'interpolate',
            ['linear'],
            ['sky-radial-progress'],
              0.0, '#93C5FD',    // Soft blue at top
              0.2, '#7DD3FC',    // Light blue
              0.4, '#60A5FA',    // Medium blue
              0.6, '#3B82F6',    // Vibrant blue
              0.75, '#6366F1',   // Blue-purple transition
              0.85, '#8B5CF6',   // Purple-blue
              0.95, '#A78BFA',   // Light purple
              1.0, '#C4B5FD'     // Very light purple at horizon
            ],
            'sky-opacity': 1.0
          } as any
        });
        
        // Set background to light purple
        if (currentMap.getLayer('background')) {
          currentMap.setPaintProperty('background', 'background-color', '#C4B5FD');
        } else {
          currentMap.addLayer({
            'id': 'background',
            'type': 'background',
            'paint': { 'background-color': '#C4B5FD' }
          }, 'sky');
        }
      } else if (skyType === 'night') {
        // Night sky
        currentMap.addLayer({
          'id': 'sky',
          'type': 'sky',
          'paint': {
            'sky-type': 'gradient',
            'sky-gradient-center': [0, 0],
            'sky-gradient-radius': 90,
            'sky-gradient': [
            'interpolate',
            ['linear'],
            ['sky-radial-progress'],
              0.0, '#000000',    // Pure black at top
              0.4, '#0a0a0a',    // Almost black
              0.7, '#1a1a1a',    // Very dark gray
              1.0, '#2a2a2a'     // Dark gray at horizon
          ],
          'sky-opacity': 1.0
        } as any
        });
        
        // Set background to dark gray
        if (currentMap.getLayer('background')) {
          currentMap.setPaintProperty('background', 'background-color', '#1a1a1a');
        } else {
          currentMap.addLayer({
            'id': 'background',
            'type': 'background',
            'paint': { 'background-color': '#1a1a1a' }
          }, 'sky');
        }
        
        // Add stars for night sky
        setTimeout(() => {
          addStars();
        }, 500);
      } else if (skyType === 'sunrise') {
        // Sunrise sky (less blue, warmer tones)
        currentMap.addLayer({
          'id': 'sky',
          'type': 'sky',
          'paint': {
            'sky-type': 'gradient',
            'sky-gradient-center': [0, 0],
            'sky-gradient-radius': 90,
            'sky-gradient': [
              'interpolate',
              ['linear'],
              ['sky-radial-progress'],
              0.0, '#2a2a2a',    // Dark gray at top (same as night sky bottom)
              0.3, '#5a4a5a',    // Purple-gray
              0.6, '#b8809a',    // Light purple-pink
              1.0, '#f0c8a8'     // Light peach at horizon
            ],
            'sky-opacity': 1.0
          } as any
        });
        
        // Set background to light peach
      if (currentMap.getLayer('background')) {
          currentMap.setPaintProperty('background', 'background-color', '#f0c8a8');
      } else {
        currentMap.addLayer({
          'id': 'background',
          'type': 'background',
            'paint': { 'background-color': '#f0c8a8' }
        }, 'sky');
        }
      }
      
      // Remove stars for non-night skies
      if (skyType !== 'night') {
        removeStars();
      }

      // Remove fog completely
      try {
        currentMap.setFog(null);
      } catch (e) {
        console.log('Could not remove fog');
      }
    } catch (e) {
      console.error("Error adding sky layer:", e);
    }

    // Add terrain with retry logic
    const addTerrain = () => {
      // Add terrain
      if (layers3D.find(l => l.id === 'terrain')?.enabled) {
        console.log("Adding terrain...");
        try {
          if (currentMap.getSource('mapbox-dem')) {
            currentMap.removeSource('mapbox-dem');
          }
          
          currentMap.addSource('mapbox-dem', {
            'type': 'raster-dem',
            'url': 'mapbox://mapbox.terrain-rgb',
            'tileSize': 512,
            'maxzoom': 22
          });

          currentMap.setTerrain({
            'source': 'mapbox-dem',
            'exaggeration': terrainExaggeration
          });

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
          // Retry terrain addition
          setTimeout(() => {
            if (layers3D.find(l => l.id === 'terrain')?.enabled) {
              addTerrain();
            }
          }, 1000);
          return;
        }
      }

      // Force a repaint
      currentMap.triggerRepaint();
    };


      // Add 3D buildings
    const addBuildings = () => {
      if (layers3D.find(l => l.id === 'buildings')?.enabled) {
        console.log("Adding 3D buildings...");
        try {
          // Check if composite source exists (needed for buildings)
          if (!currentMap.getSource('composite')) {
            console.log('Composite source not ready for buildings, retrying...');
            setTimeout(() => {
              if (layers3D.find(l => l.id === 'buildings')?.enabled) {
                addBuildings();
              }
            }, 1000);
            return;
          }

          // Remove existing building layers if they exist
          ['3d-buildings', '3d-buildings-simple', '3d-buildings-fallback'].forEach(layerId => {
            if (currentMap.getLayer(layerId)) {
              currentMap.removeLayer(layerId);
            }
          });

          // Add 3D buildings layer
          currentMap.addLayer({
            'id': '3d-buildings',
            'source': 'composite',
            'source-layer': 'building',
            'filter': ['==', 'extrude', 'true'],
            'type': 'fill-extrusion',
            'minzoom': 15,
            'paint': {
              'fill-extrusion-color': [
                'interpolate',
                ['linear'],
                ['get', 'height'],
                0,
                buildingColor,
                50,
                buildingColor,
                100,
                `rgb(${Math.floor(parseInt(buildingColor.slice(1,3), 16) * 0.85)}, ${Math.floor(parseInt(buildingColor.slice(3,5), 16) * 0.85)}, ${Math.floor(parseInt(buildingColor.slice(5,7), 16) * 0.85)})`,
                200,
                `rgb(${Math.floor(parseInt(buildingColor.slice(1,3), 16) * 0.7)}, ${Math.floor(parseInt(buildingColor.slice(3,5), 16) * 0.7)}, ${Math.floor(parseInt(buildingColor.slice(5,7), 16) * 0.7)})`,
                300,
                `rgb(${Math.floor(parseInt(buildingColor.slice(1,3), 16) * 0.7)}, ${Math.floor(parseInt(buildingColor.slice(3,5), 16) * 0.7)}, ${Math.floor(parseInt(buildingColor.slice(5,7), 16) * 0.7)})`
              ],
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'min_height'],
              'fill-extrusion-opacity': 1.0
            }
          });

          console.log("3D buildings added successfully");
        } catch (e) {
          console.error("Error adding 3D buildings:", e);
          // Retry building addition
          setTimeout(() => {
            if (layers3D.find(l => l.id === 'buildings')?.enabled) {
              addBuildings();
            }
          }, 1000);
          return;
        }
      }
    };

    // Start the terrain addition process
    addTerrain();
    
    // Start the buildings addition process
    addBuildings();
  }, [layers3D, style, terrainExaggeration]);

  // Function to update building colors with height-based shading and refresh all 3D features
  const updateBuildingColors = useCallback((baseColor: string) => {
    if (map.current) {
      // Convert hex to RGB for calculations
      const hex = baseColor.replace('#', '');
      const r = parseInt(hex.substr(0, 2), 16);
      const g = parseInt(hex.substr(2, 2), 16);
      const b = parseInt(hex.substr(4, 2), 16);
      
      // Create darker shades for taller buildings
      const darkenFactor = 0.3; // How much darker taller buildings get
      const darkR = Math.max(0, Math.floor(r * (1 - darkenFactor)));
      const darkG = Math.max(0, Math.floor(g * (1 - darkenFactor)));
      const darkB = Math.max(0, Math.floor(b * (1 - darkenFactor)));
      
      const darkColor = `#${darkR.toString(16).padStart(2, '0')}${darkG.toString(16).padStart(2, '0')}${darkB.toString(16).padStart(2, '0')}`;
      
      // Update building colors if the layer exists
      if (map.current.getLayer('3d-buildings')) {
        map.current.setPaintProperty('3d-buildings', 'fill-extrusion-color', [
          'interpolate',
          ['linear'],
          ['get', 'height'],
          0,
          baseColor,
          50,
          baseColor,
          100,
          `rgb(${Math.floor(r * 0.85)}, ${Math.floor(g * 0.85)}, ${Math.floor(b * 0.85)})`,
          200,
          darkColor,
          300,
          darkColor
        ]);
      }
      
      console.log('Building colors updated without refreshing 3D features');
    }
  }, []);

  // 3D Building Designer Functions
  const addCustomBuilding = useCallback((points: [number, number][]) => {
    if (points.length < 3) return; // Need at least 3 points for a polygon
    
    // Calculate center point
    const centerLng = points.reduce((sum, point) => sum + point[0], 0) / points.length;
    const centerLat = points.reduce((sum, point) => sum + point[1], 0) / points.length;
    
    const newBuilding = {
      id: `custom-building-${Date.now()}`,
      name: `Building ${customBuildings.length + 1}`,
      position: [centerLng, centerLat] as [number, number],
      height: buildingDesignerProperties.height,
      width: buildingDesignerProperties.width,
      length: buildingDesignerProperties.length,
      color: buildingDesignerProperties.color,
      style: buildingDesignerProperties.style,
      rotation: buildingDesignerProperties.rotation,
      points: points // Store the original points for rendering
    };
    
    setCustomBuildings(prev => [...prev, newBuilding]);
    setSelectedBuilding(newBuilding.id);
    setSelectedPoints([]);
    setIsSelectingPoints(false);
    setIsCreatingBuilding(false);
    clearPointMarkers(); // Clear visual markers
    console.log('Added custom building:', newBuilding);
  }, [customBuildings.length, buildingDesignerProperties]);

  const updateCustomBuilding = useCallback((buildingId: string, updates: Partial<typeof customBuildings[0]>) => {
    setCustomBuildings(prev => 
      prev.map(building => 
        building.id === buildingId 
          ? { ...building, ...updates }
          : building
      )
    );
  }, []);

  const deleteCustomBuilding = useCallback((buildingId: string) => {
    setCustomBuildings(prev => prev.filter(building => building.id !== buildingId));
    if (selectedBuilding === buildingId) {
      setSelectedBuilding(null);
    }
    // Exit edit mode if deleting the building being edited
    if (editingBuilding?.id === buildingId) {
      setIsEditingBuilding(false);
      setEditingBuilding(null);
    }
  }, [selectedBuilding, editingBuilding]);

  // Function to start editing a building
  const startEditingBuilding = useCallback((building: typeof customBuildings[0]) => {
    setEditingBuilding(building);
    setEditingBuildingProperties({
      height: building.height,
      color: building.color,
      style: building.style,
      rotation: building.rotation
    });
    setIsEditingBuilding(true);
    setSelectedBuilding(building.id);
  }, []);

  // Function to save building changes
  const saveBuildingChanges = useCallback(() => {
    if (!editingBuilding) return;

    const updatedBuilding = {
      ...editingBuilding,
      height: editingBuildingProperties.height,
      color: editingBuildingProperties.color,
      style: editingBuildingProperties.style,
      rotation: editingBuildingProperties.rotation
    };

    setCustomBuildings(prev => 
      prev.map(building => 
        building.id === editingBuilding.id ? updatedBuilding : building
      )
    );

    setIsEditingBuilding(false);
    setEditingBuilding(null);
    console.log('Building updated:', updatedBuilding);
  }, [editingBuilding, editingBuildingProperties]);

  // Function to cancel editing
  const cancelEditingBuilding = useCallback(() => {
    setIsEditingBuilding(false);
    setEditingBuilding(null);
  }, []);

  // Function to create visual markers for selected points
  const createPointMarker = useCallback((coords: [number, number], pointNumber: number) => {
    if (!map.current) return null;

    // Create marker element
    const markerElement = document.createElement('div');
    markerElement.style.width = '24px';
    markerElement.style.height = '24px';
    markerElement.style.borderRadius = '50%';
    markerElement.style.backgroundColor = '#1976d2';
    markerElement.style.border = '3px solid white';
    markerElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    markerElement.style.display = 'flex';
    markerElement.style.alignItems = 'center';
    markerElement.style.justifyContent = 'center';
    markerElement.style.color = 'white';
    markerElement.style.fontSize = '12px';
    markerElement.style.fontWeight = 'bold';
    markerElement.style.cursor = 'pointer';
    markerElement.textContent = pointNumber.toString();

    // Create marker
    const marker = new mapboxgl.Marker(markerElement)
      .setLngLat(coords)
      .addTo(map.current);

    return marker;
  }, []);

  // Function to clear all point markers
  const clearPointMarkers = useCallback(() => {
    pointMarkers.forEach(marker => marker.remove());
    setPointMarkers([]);
    
    // Clear preview line
    if (map.current) {
      if (map.current.getLayer('preview-line')) {
        map.current.removeLayer('preview-line');
      }
      if (map.current.getSource('preview-line')) {
        map.current.removeSource('preview-line');
      }
    }
  }, [pointMarkers]);

  // Function to update preview line for selected points
  const updatePreviewLine = useCallback(() => {
    if (!map.current) return;

    // Remove existing preview line
    if (map.current.getLayer('preview-line')) {
      map.current.removeLayer('preview-line');
    }
    if (map.current.getSource('preview-line')) {
      map.current.removeSource('preview-line');
    }

    // Add preview line if we have 2+ points
    if (selectedPoints.length >= 2) {
      const lineCoordinates = selectedPoints.length >= 3 
        ? [...selectedPoints, selectedPoints[0]] // Close the polygon
        : selectedPoints; // Just connect the points

      map.current.addSource('preview-line', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: lineCoordinates
          }
        }
      });

      map.current.addLayer({
        id: 'preview-line',
        type: 'line',
        source: 'preview-line',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#1976d2',
          'line-width': 3,
          'line-opacity': 0.8
        }
      });
    }
  }, [selectedPoints]);

  const handleMapClickForBuilding = useCallback((e: mapboxgl.MapMouseEvent) => {
    if (isBuildingDesignerMode && isSelectingPoints) {
      const coords = [e.lngLat.lng, e.lngLat.lat] as [number, number];
      const newPoints = [...selectedPoints, coords];
      setSelectedPoints(newPoints);
      
      // Create visual marker for the new point
      const marker = createPointMarker(coords, newPoints.length);
      if (marker) {
        setPointMarkers(prev => [...prev, marker]);
      }
      
      // Update preview line
      setTimeout(() => updatePreviewLine(), 100);
      
      console.log('Added point:', coords, 'Total points:', newPoints.length);
    }
  }, [isBuildingDesignerMode, isSelectingPoints, selectedPoints, createPointMarker]);

  // Function to render custom buildings on the map
  const renderCustomBuildings = useCallback(() => {
    if (!map.current || customBuildings.length === 0) return;

    // Remove existing custom building layers
    if (map.current.getLayer('custom-buildings-fill')) {
      map.current.removeLayer('custom-buildings-fill');
    }
    if (map.current.getLayer('custom-buildings-outline')) {
      map.current.removeLayer('custom-buildings-outline');
    }
    if (map.current.getSource('custom-buildings')) {
      map.current.removeSource('custom-buildings');
    }

    // Create GeoJSON data for custom buildings
    const features = customBuildings.map(building => ({
      type: 'Feature' as const,
      properties: {
        id: building.id,
        name: building.name,
        height: building.height,
        width: building.width,
        length: building.length,
        color: building.color,
        style: building.style,
        rotation: building.rotation
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: building.points ? [building.points.concat([building.points[0]])] : [[
          [building.position[0] - building.width/2/111000, building.position[1] - building.length/2/111000],
          [building.position[0] + building.width/2/111000, building.position[1] - building.length/2/111000],
          [building.position[0] + building.width/2/111000, building.position[1] + building.length/2/111000],
          [building.position[0] - building.width/2/111000, building.position[1] + building.length/2/111000],
          [building.position[0] - building.width/2/111000, building.position[1] - building.length/2/111000]
        ]]
      }
    }));

    const geojson = {
      type: 'FeatureCollection' as const,
      features
    };

    // Add source
    map.current.addSource('custom-buildings', {
      type: 'geojson',
      data: geojson
    });

    // Add fill layer
    map.current.addLayer({
      id: 'custom-buildings-fill',
      type: 'fill-extrusion',
      source: 'custom-buildings',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.8
      }
    });

    // Add outline layer
    map.current.addLayer({
      id: 'custom-buildings-outline',
      type: 'line',
      source: 'custom-buildings',
      paint: {
        'line-color': '#000',
        'line-width': 2,
        'line-opacity': 0.6
      }
    });

    console.log('Rendered custom buildings:', customBuildings.length);
  }, [customBuildings]);

  // Add this useEffect to ensure layers are initialized when the map is ready
  useEffect(() => {
    if (map.current && map.current.isStyleLoaded()) {
      console.log('Map is ready, initializing layers');
      initializeLayers();
    }
  }, [initializeLayers]);


  // Update building colors whenever buildingColor changes
  useEffect(() => {
    if (map.current && map.current.isStyleLoaded()) {
      updateBuildingColors(buildingColor);
    }
  }, [buildingColor]);

  // Apply sky properties when they change
  useEffect(() => {
    if (map.current && map.current.isStyleLoaded()) {
      applySkyProperties();
    }
  }, [skyGradientRadius, sunAzimuth, sunElevation, sunIntensity, sunColor, haloColor, atmosphereColor, backgroundColor, backgroundOpacity]);

  // Apply camera angle when it changes
  useEffect(() => {
    if (map.current) {
      applyCameraAngle();
    }
  }, [cameraPitch, cameraBearing]);

  // Restart sun cycle when duration changes
  useEffect(() => {
    if (isCycleRunningRef.current) {
      startSunCycle();
    }
  }, [sunCycleDuration]);

  // Cleanup sun cycle on unmount
  useEffect(() => {
    return () => {
      isCycleRunningRef.current = false;
      if (sunCycleIntervalRef.current) {
        clearTimeout(sunCycleIntervalRef.current);
      }
    };
  }, []);

  // Render custom buildings when they change
  useEffect(() => {
    if (map.current && map.current.isStyleLoaded()) {
      renderCustomBuildings();
    }
  }, [customBuildings, renderCustomBuildings]);



  // Cleanup effect for draw control
  useEffect(() => {
    return () => {
      if (draw && map.current) {
        try {
          map.current.removeControl(draw);
        } catch (error) {
          console.log('Error removing draw control during cleanup:', error);
        }
      }
    };
  }, [draw]);

  // Force remove any existing dark shade overlay on mount
  useEffect(() => {
    // Remove any existing dark shade overlay that might be lingering
    const existingDarkShade = document.getElementById('dark-shade-overlay');
    if (existingDarkShade) {
      existingDarkShade.remove();
      console.log('Removed existing dark shade overlay');
    }
    
    // Also check for any elements with similar names
    const allElements = document.querySelectorAll('*');
    allElements.forEach(element => {
      if (element.id && element.id.includes('dark') && element.id.includes('shade')) {
        element.remove();
        console.log('Removed dark shade element:', element.id);
      }
    });

    // Convert dark overlays to vibrant blue instead of removing them
    const potentialDarkShades = document.querySelectorAll('div, span, section, article');
    potentialDarkShades.forEach(element => {
      try {
        const style = window.getComputedStyle(element);
        const backgroundColor = style.backgroundColor;
        const opacity = style.opacity;
        const zIndex = style.zIndex;
        
        // Check if this looks like a dark shade overlay
        if (
          (backgroundColor.includes('rgba(0, 0, 0') || backgroundColor.includes('rgb(0, 0, 0)')) &&
          (opacity === '0.3' || opacity === '0.5' || opacity === '0.7' || opacity === '0.8') &&
          (zIndex === '1000' || zIndex === '999' || zIndex === '1001' || zIndex === '9999')
        ) {
          console.log('Converting dark shade to vibrant blue:', element);
          // Convert to vibrant blue instead of removing
          (element as HTMLElement).style.background = 'linear-gradient(180deg, #00BFFF 0%, #1E90FF 50%, #4169E1 100%)';
          (element as HTMLElement).style.opacity = '0.6';
          (element as HTMLElement).style.zIndex = '1000';
        }
      } catch (e) {
        // Ignore errors
      }
    });

    // Force remove any remaining dark elements by searching the entire DOM
    setTimeout(() => {
      const remainingElements = document.querySelectorAll('*');
      remainingElements.forEach(element => {
        if (element.id && (
          element.id.toLowerCase().includes('dark') ||
          element.id.toLowerCase().includes('shade') ||
          element.id.toLowerCase().includes('overlay') ||
          element.id.toLowerCase().includes('shadow')
        )) {
          console.log('Removing remaining dark/shade element:', element.id);
          element.remove();
        }
      });
    }, 100);

    // Set up continuous monitoring for any new dark overlays
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            try {
              const style = window.getComputedStyle(element);
              const backgroundColor = style.backgroundColor;
              const opacity = style.opacity;
              const zIndex = style.zIndex;
              
              // Check if this looks like a dark shade overlay
              if (
                (backgroundColor.includes('rgba(0, 0, 0') || backgroundColor.includes('rgb(0, 0, 0)')) &&
                (opacity === '0.3' || opacity === '0.5' || opacity === '0.7' || opacity === '0.8') &&
                (zIndex === '1000' || zIndex === '999' || zIndex === '1001' || zIndex === '9999')
              ) {
                console.log('🔵 Auto-converting new dark overlay to vibrant blue:', element);
                (element as HTMLElement).style.background = 'linear-gradient(180deg, #00BFFF 0%, #1E90FF 50%, #4169E1 100%)';
                (element as HTMLElement).style.opacity = '0.6';
                (element as HTMLElement).style.zIndex = '1000';
              }
            } catch (e) {
              // Ignore errors
            }
          }
        });
      });
    });

    // Start observing for new elements
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Cleanup observer on unmount
    return () => {
      observer.disconnect();
    };
  }, []);



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

    // Calculate direction vector based on bearing
    const direction: [number, number] = [
      Math.cos(THREE.MathUtils.degToRad(bearing)),
      Math.sin(THREE.MathUtils.degToRad(bearing))
    ];

    const newKeyframe: CameraKeyframe = {
      time: currentTime,
      position: [center.lng, center.lat, zoom],
      target: [center.lng, center.lat, pitch],
      fov: bearing,
      direction
    };

    setCurrentScene(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        cameraPath: [...prev.cameraPath, newKeyframe]
      };
    });

    updateCameraPathVisualization();
  };

  // Scene playback functions
  const playScene = () => {
    if (!currentScene || !map.current) return;

    const startTime = Date.now();
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

  // Update camera path visualization
  const updateCameraPathVisualization = () => {
    if (!map.current || !currentScene) return;

    const coordinates = currentScene.cameraPath.map(keyframe => keyframe.position);
    const source = map.current.getSource('camera-path') as mapboxgl.GeoJSONSource;
    source.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates
      }
    });

    // Update camera direction
    if (currentScene.cameraPath.length > 0) {
      const lastKeyframe = currentScene.cameraPath[currentScene.cameraPath.length - 1];
      const directionSource = map.current.getSource('camera-direction') as mapboxgl.GeoJSONSource;
      
      // Create a triangle shape rotated according to the camera's bearing
      const bearing = lastKeyframe.fov;
      const size = 20;
      const center = lastKeyframe.position;
      
      // Calculate triangle points based on bearing
      const points = [
        [0, 0],
        [size, size / 2],
        [0, size]
      ].map(([x, y]) => {
        const angle = THREE.MathUtils.degToRad(bearing);
        const rotatedX = x * Math.cos(angle) - y * Math.sin(angle);
        const rotatedY = x * Math.sin(angle) + y * Math.cos(angle);
        return [
          center[0] + rotatedX * 0.0001, // Scale factor to make it visible on the map
          center[1] + rotatedY * 0.0001
        ];
      });

      directionSource.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [[...points, points[0]]] // Close the polygon
        }
      });
    }
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
        {!isSlideshowMode && renderPlaybackControls()}
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

  // Add path editing functionality
  const startPathEditing = () => {
    setIsEditingPath(true);
    if (map.current) {
      map.current.on('click', handlePathClick);
      map.current.on('mousemove', handlePathMouseMove);
    }
  };

  const stopPathEditing = () => {
    setIsEditingPath(false);
    setSelectedKeyframe(null);
    if (map.current) {
      map.current.off('click', handlePathClick);
      map.current.off('mousemove', handlePathMouseMove);
    }
  };

  const handlePathClick = (e: mapboxgl.MapMouseEvent) => {
    if (!currentScene || !map.current) return;

    const point = e.point;
    const features = map.current.queryRenderedFeatures(point, {
      layers: ['camera-path']
    });

    if (features.length > 0) {
      // Find the closest keyframe
      const clickedLngLat = e.lngLat;
      const closestKeyframe = currentScene.cameraPath.reduce((closest, keyframe, index) => {
        const keyframePoint = map.current!.project([keyframe.position[0], keyframe.position[1]]);
        const distance = Math.sqrt(
          Math.pow(keyframePoint.x - point.x, 2) + 
          Math.pow(keyframePoint.y - point.y, 2)
        );
        return distance < closest.distance ? { index, distance } : closest;
      }, { index: -1, distance: Infinity });

      if (closestKeyframe.index !== -1) {
        setSelectedKeyframe(closestKeyframe.index);
      }
    }
  };

  const handlePathMouseMove = (e: mapboxgl.MapMouseEvent) => {
    if (!currentScene || !map.current || selectedKeyframe === null) return;

    const newKeyframe = { ...currentScene.cameraPath[selectedKeyframe] };
    newKeyframe.position = [e.lngLat.lng, e.lngLat.lat, newKeyframe.position[2]];
    
    setCurrentScene(prev => {
      if (!prev) return prev;
      const newPath = [...prev.cameraPath];
      newPath[selectedKeyframe] = newKeyframe;
      return {
        ...prev,
        cameraPath: newPath
      };
    });

    updateCameraPathVisualization();
  };

  // Add these buttons to the film controls
  const renderPathControls = () => (
    <div style={{ display: 'flex', gap: '8px' }}>
      <button
        onClick={() => isEditingPath ? stopPathEditing() : startPathEditing()}
        style={{
          background: isEditingPath ? '#f44336' : '#2196f3',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          padding: '8px 16px',
          cursor: 'pointer'
        }}
      >
        {isEditingPath ? 'Stop Editing Path' : 'Edit Path'}
      </button>
    </div>
  );

  const lineCreationGuard = useRef(false);

  const handleStartRecording = () => {
    if (!map.current) return;
    setRecordingPoints([]);
    setIsRecordingPath(true);
    lineCreationGuard.current = false; // Reset guard for new session
  };

  // Define create3DLine before handleMapClick
  const create3DLine = (line: { id: string; start: [number, number]; end: [number, number]; name: string }) => {
    if (!map.current) return;
    
    try {
      console.log('Creating 3D line:', line);
      
      // Create a polygon from the line for 3D extrusion
      const baseWidth = 0.00001; // Base width for the line
      const lineHeight = 50; // Height of the line in meters
      
      // Calculate perpendicular offset for the line
      const dx = line.end[0] - line.start[0];
      const dy = line.end[1] - line.start[1];
      const length = Math.sqrt(dx * dx + dy * dy);
      const perpX = -dy / length * baseWidth;
      const perpY = dx / length * baseWidth;
      
      // Create polygon coordinates for the line
      const polygonCoords = [
        [line.start[0] + perpX, line.start[1] + perpY],
        [line.start[0] - perpX, line.start[1] - perpY],
        [line.end[0] - perpX, line.end[1] - perpY],
        [line.end[0] + perpX, line.end[1] + perpY],
        [line.start[0] + perpX, line.start[1] + perpY] // Close the polygon
      ];
      
      // Create polygon feature for the line
      const polygonFeature: GeoJSON.Feature<GeoJSON.Polygon> = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [polygonCoords]
        }
      };

      // Add source for the line
      map.current.addSource(`recording-path-${line.id}`, {
        type: 'geojson',
        data: polygonFeature
      });

      // Add the 3D line layer
      map.current.addLayer({
        id: `recording-path-${line.id}`,
        type: 'fill-extrusion',
        source: `recording-path-${line.id}`,
        paint: {
          'fill-extrusion-color': 'worldBuildingColor',
          'fill-extrusion-height': lineHeight,
          'fill-extrusion-base': lineHeight,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': true
        }
      });

      // Helper to create a small square polygon at a point
      const makeSquare = (center: [number, number], size: number) => {
        return [
          [center[0] - size, center[1] - size],
          [center[0] + size, center[1] - size],
          [center[0] + size, center[1] + size],
          [center[0] - size, center[1] + size],
          [center[0] - size, center[1] - size]
        ];
      };
      const markerSize = 0.00004; // Slightly larger than line width

      // Start endpoint 3D marker
      const startSquare = makeSquare(line.start, markerSize);
      map.current.addSource(`recording-path-endpoint-start-${line.id}`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [startSquare]
          }
        }
      });
      map.current.addLayer({
        id: `recording-path-endpoint-start-${line.id}`,
        type: 'fill-extrusion',
        source: `recording-path-endpoint-start-${line.id}`,
        paint: {
          'fill-extrusion-color': '#0074D9', // Blue
          'fill-extrusion-height': lineHeight,
          'fill-extrusion-base': lineHeight,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': false
        }
      });

      // End endpoint 3D marker
      const endSquare = makeSquare(line.end, markerSize);
      map.current.addSource(`recording-path-endpoint-end-${line.id}`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [endSquare]
          }
        }
      });
      map.current.addLayer({
        id: `recording-path-endpoint-end-${line.id}`,
        type: 'fill-extrusion',
        source: `recording-path-endpoint-end-${line.id}`,
        paint: {
          'fill-extrusion-color': '#0074D9', // Blue
          'fill-extrusion-height': lineHeight,
          'fill-extrusion-base': lineHeight,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': false
        }
      });

      console.log('Line creation complete');
    } catch (error) {
      console.error('Error creating 3D line:', error);
    }
  };

  // Memoize handleMapClick so it is stable between renders
  const handleMapClick = React.useCallback((e: mapboxgl.MapMouseEvent) => {
    if (!isRecordingPath || !map.current) return;
    if (lineCreationGuard.current) return; // Prevent double creation

    const coordinates: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    setRecordingPoints(prev => {
      const newPoints = [...prev, coordinates];
      if (newPoints.length === 2) {
        if (map.current) {
          lineCreationGuard.current = true; // Set guard before prompt
          const lineId = `line-${Date.now()}`;
          const lineName = prompt('What would you like to name this line?') || `Line ${Date.now()}`;
          const newLine = {
            id: lineId,
            start: newPoints[0],
            end: newPoints[1],
            name: lineName
          };
          create3DLine(newLine);
          setRecordingPoints([]);
          setIsRecordingPath(false);
          map.current.off('click', handleMapClick);
          setRecordingLines(prev => [...prev, newLine]);
        }
      }
      return newPoints;
    });
  }, [isRecordingPath]);

  // Register/unregister the click handler only when isRecordingPath changes
  useEffect(() => {
    if (!map.current) return;
    if (isRecordingPath) {
      map.current.on('click', handleMapClick);
    }
    return () => {
      if (map.current && !(map.current as any)._removed) {
        map.current.off('click', handleMapClick);
      }
    };
  }, [isRecordingPath, handleMapClick]);

  // Register building designer click handler
  useEffect(() => {
    if (!map.current) return;

    if (isBuildingDesignerMode) {
      map.current.on('click', handleMapClickForBuilding);
    } else {
      map.current.off('click', handleMapClickForBuilding);
    }

    return () => {
      if (map.current && !(map.current as any)._removed) {
        map.current.off('click', handleMapClickForBuilding);
      }
    };
  }, [isBuildingDesignerMode, handleMapClickForBuilding]);

  // Update preview line when selectedPoints changes
  useEffect(() => {
    if (isBuildingDesignerMode && selectedPoints.length > 0) {
      updatePreviewLine();
    }
  }, [selectedPoints, isBuildingDesignerMode, updatePreviewLine]);

  // Re-render buildings when customBuildings changes
  useEffect(() => {
    if (customBuildings.length > 0) {
      renderCustomBuildings();
    }
  }, [customBuildings, renderCustomBuildings]);

  useEffect(() => {
    if (!mapContainer.current || map.current) return; // Initialize only once

    mapboxgl.accessToken = accessToken;

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [-122.431297, 37.773972], // San Francisco downtown
      zoom: 15,
      pitch: 40,
      bearing: -30,
      antialias: true,
              maxPitch: 85, // maximum allowed by Mapbox GL JS
      maxZoom: 24, // maximum allowed by Mapbox
      minZoom: 0, // minimum allowed
      renderWorldCopies: false
    });

    map.current = mapInstance;

    // Add navigation controls (only in editor mode)
    if (!isSlideshowMode) {
      mapInstance.addControl(new mapboxgl.NavigationControl());
    }

    // Get default modes from a temporary instance
    const defaultModes = (MapboxDraw as any).modes || (new (MapboxDraw as any)()).modes;

    const drawInstance = new (MapboxDraw as any)({
      displayControlsDefault: false,
      controls: { polygon: false, trash: false },
      modes: {
        ...defaultModes,
        draw_polygon: FreehandMode
      }
    });
    // Add draw control only in editor mode
    if (!isSlideshowMode) {
      mapInstance.addControl(drawInstance, 'top-left');
      setDraw(drawInstance);
    }

    // Wait for the style to load before adding custom layers
    mapInstance.on('style.load', () => {
        // Add sky layer immediately to prevent white screen
        try {
          // Add sky based on skyLayerType first, then skyType
          if (skyLayerType === 'atmosphere') {
            // Use atmosphere sky type
            mapInstance.addLayer({
              'id': 'sky',
              'type': 'sky',
              'paint': {
                'sky-type': 'atmosphere',
                'sky-atmosphere-sun': [sunAzimuth, sunElevation],
                'sky-atmosphere-sun-intensity': sunIntensity,
                'sky-atmosphere-halo-color': haloColor,
                'sky-atmosphere-color': atmosphereColor,
                'sky-opacity': 1.0
              } as any
            });
            
            // Add background
            mapInstance.addLayer({
              'id': 'background',
              'type': 'background',
              'paint': { 'background-color': backgroundColor }
            }, 'sky');
          } else if (skyType === 'blue') {
            // Blue sky
            mapInstance.addLayer({
              'id': 'sky',
              'type': 'sky',
              'paint': {
                'sky-type': 'gradient',
                'sky-gradient-center': [0, 0],
                'sky-gradient-radius': 90,
                'sky-gradient': [
                  'interpolate',
                  ['linear'],
                  ['sky-radial-progress'],
                  0.0, '#1E3A8A',    // Dark blue at top
                  0.5, '#3B82F6',    // Medium blue
                  1.0, '#A9D4FF'     // Light blue at horizon
                ],
                'sky-opacity': 1.0
              } as any
            });
            
            // Add light blue background
            mapInstance.addLayer({
              'id': 'background',
              'type': 'background',
              'paint': { 'background-color': '#A9D4FF' }
            }, 'sky');
          } else if (skyType === 'evening') {
            // Enhanced dusk sky - more blue, less orange
            mapInstance.addLayer({
              'id': 'sky',
              'type': 'sky',
              'paint': {
                'sky-type': 'gradient',
                'sky-gradient-center': [0, 0],
                'sky-gradient-radius': 90,
                'sky-gradient': [
                  'interpolate',
                  ['linear'],
                  ['sky-radial-progress'],
                  0.0, '#93C5FD',    // Soft blue at top
                  0.2, '#7DD3FC',    // Light blue
                  0.4, '#60A5FA',    // Medium blue
                  0.6, '#3B82F6',    // Vibrant blue
                  0.75, '#6366F1',   // Blue-purple transition
                  0.85, '#8B5CF6',   // Purple-blue
                  0.95, '#A78BFA',   // Light purple
                  1.0, '#C4B5FD'     // Very light purple at horizon
                ],
                'sky-opacity': 1.0
              } as any
            });
            
            // Add light purple background
            mapInstance.addLayer({
              'id': 'background',
              'type': 'background',
              'paint': { 'background-color': '#C4B5FD' }
            }, 'sky');
          } else if (skyType === 'night') {
            // Night sky
            mapInstance.addLayer({
              'id': 'sky',
              'type': 'sky',
              'paint': {
                'sky-type': 'gradient',
                'sky-gradient-center': [0, 0],
                'sky-gradient-radius': 90,
                'sky-gradient': [
                  'interpolate',
                  ['linear'],
                  ['sky-radial-progress'],
                  0.0, '#000000',    // Pure black at top
                  0.4, '#0a0a0a',    // Almost black
                  0.7, '#1a1a1a',    // Very dark gray
                  1.0, '#2a2a2a'     // Dark gray at horizon
                ],
                'sky-opacity': 1.0
              } as any
            });
            
            // Add dark gray background
            mapInstance.addLayer({
              'id': 'background',
              'type': 'background',
              'paint': { 'background-color': '#1a1a1a' }
            }, 'sky');
            
            // Add stars for night sky
            setTimeout(() => {
              addStars();
            }, 500);
          } else if (skyType === 'sunrise') {
            // Sunrise sky (less blue, warmer tones)
            mapInstance.addLayer({
              'id': 'sky',
              'type': 'sky',
              'paint': {
                'sky-type': 'gradient',
                'sky-gradient-center': [0, 0],
                'sky-gradient-radius': 90,
                'sky-gradient': [
                  'interpolate',
                  ['linear'],
                  ['sky-radial-progress'],
                  0.0, '#2a2a2a',    // Dark gray at top (same as night sky bottom)
                  0.3, '#5a4a5a',    // Purple-gray
                  0.6, '#b8809a',    // Light purple-pink
                  1.0, '#f0c8a8'     // Light peach at horizon
                ],
                'sky-opacity': 1.0
              } as any
            });
            
            // Add light peach background
            mapInstance.addLayer({
              'id': 'background',
              'type': 'background',
              'paint': { 'background-color': '#f0c8a8' }
            }, 'sky');
          }
          
          console.log('Sky layer added immediately');
        } catch (e) {
          console.log('Could not add sky layer immediately:', e);
        }
        
        // Set maximum render distance and view settings
        try {
          // Extend far clip plane for maximum view distance
          if (mapInstance.getStyle().layers) {
            mapInstance.setFog({
              'color': 'rgba(0, 0, 0, 0)', // Transparent fog
              'high-color': 'rgba(0, 0, 0, 0)', // No high-altitude fog
              'horizon-blend': 0.1, // Minimal horizon blending
              'space-color': 'rgba(0, 0, 0, 0)', // No space fog
              'star-intensity': 0 // Stars handled separately
            });
          }
        } catch (e) {
          console.log('Could not set advanced fog settings:', e);
        }
        
      // Add camera path layer
      mapInstance.addSource('camera-path', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: []
          }
        }
      });

      mapInstance.addLayer({
        id: 'camera-path',
        type: 'line',
        source: 'camera-path',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#2196f3',
          'line-width': 3,
          'line-opacity': 0.8
        }
      });

      // Add camera direction layer
      mapInstance.addSource('camera-direction', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: []
          }
        }
      });

      // Create a custom shape for the direction indicator
      const size = 20;
      const shape = [
        [0, 0],
        [size, size / 2],
        [0, size]
      ];

      mapInstance.addLayer({
        id: 'camera-direction',
        type: 'fill',
        source: 'camera-direction',
        paint: {
          'fill-color': '#ff0000',
          'fill-opacity': 0.8
        },
        layout: {
          'visibility': 'visible'
        }
      });

      // Add a second layer for the direction indicator outline
      mapInstance.addLayer({
        id: 'camera-direction-outline',
        type: 'line',
        source: 'camera-direction',
        paint: {
          'line-color': '#ffffff',
          'line-width': 2
        },
        layout: {
          'visibility': 'visible'
        }
      });

      setCameraPathLayer(mapInstance.getLayer('camera-path') as mapboxgl.Layer);
      setCameraDirectionLayer(mapInstance.getLayer('camera-direction') as mapboxgl.Layer);

      // Note: Removed sky property storage to prevent runtime errors

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
        // Hide highway road layers (orange/yellow markings)
        if (layer.id && (
          layer.id.includes('road') || 
          layer.id.includes('highway') || 
          layer.id.includes('motorway') || 
          layer.id.includes('primary') || 
          layer.id.includes('secondary') ||
          layer.id.includes('tertiary')
        )) {
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
        
        // Auto-start continuous cycle after everything is loaded
        startContinuousCycle();
      }, 1000);
    });




    // Cleanup function
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      // Clean up continuous cycle
      if (cycleIntervalRef.current) {
        clearTimeout(cycleIntervalRef.current);
      }
    };
  }, []);

  // Add BridgeLayer after map initialization
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;

    // Add bridge layer
    const bridgeLayer: mapboxgl.CustomLayerInterface = {
      id: 'bridge-layer',
        type: 'custom',
        renderingMode: '3d',
      onAdd: function(map: mapboxgl.Map, gl: WebGLRenderingContext) {
          (this as any).map = map;
          (this as any).camera = new THREE.Camera();
          (this as any).camera.far = 10000000;
          (this as any).scene = new THREE.Scene();
        (this as any).renderer = new THREE.WebGLRenderer({ 
          canvas: map.getCanvas(), 
          context: gl 
        });
          (this as any).renderer.autoClear = false;

        // Add lighting
        (this as any).scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
          dirLight.position.set(0, 1, 0);
          (this as any).scene.add(dirLight);

        // Define bridge locations
        const bridges = [
          {
            id: 'bridge-1',
            name: 'Main Highway Bridge',
            position: [-122.4194, 37.7749],
            height: 25,
            width: 40,
            length: 200,
            type: 'highway'
          },
          {
            id: 'bridge-2', 
            name: 'Street Overpass',
            position: [-122.4180, 37.7755],
            height: 15,
            width: 20,
            length: 150,
            type: 'street'
          },
          {
            id: 'bridge-3',
            name: 'Railway Bridge',
            position: [-122.4208, 37.7743],
            height: 20,
            width: 15,
            length: 180,
            type: 'railway'
          },
          {
            id: 'bridge-4',
            name: 'Interchange Bridge',
            position: [-122.4175, 37.7735],
            height: 30,
            width: 50,
            length: 250,
            type: 'highway'
          }
        ];

        // Create bridge models
        bridges.forEach(bridge => {
          const bridgeGroup = new THREE.Group();
          
          // Bridge deck (main surface)
          const deckGeometry = new THREE.BoxGeometry(bridge.length, bridge.width, 2);
          const deckMaterial = new THREE.MeshStandardMaterial({ 
            color: bridge.type === 'highway' ? 0x404040 : 
                   bridge.type === 'railway' ? 0x2c2c2c : 0x505050,
            roughness: 0.8,
            metalness: 0.2
          });
          const deck = new THREE.Mesh(deckGeometry, deckMaterial);
          deck.position.y = bridge.height / 2;
          bridgeGroup.add(deck);

          // Bridge supports/pillars
          const supportCount = Math.floor(bridge.length / 50) + 1;
          for (let i = 0; i < supportCount; i++) {
            const supportGeometry = new THREE.CylinderGeometry(2, 3, bridge.height);
            const supportMaterial = new THREE.MeshStandardMaterial({ 
              color: 0x666666,
              roughness: 0.7,
              metalness: 0.3
            });
            const support = new THREE.Mesh(supportGeometry, supportMaterial);
            support.position.set(
              (i - (supportCount - 1) / 2) * (bridge.length / (supportCount - 1)),
              bridge.height / 2,
              0
            );
            bridgeGroup.add(support);
          }

          // Bridge railings
          const railingGeometry = new THREE.BoxGeometry(bridge.length, 1, 1);
          const railingMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x888888,
            roughness: 0.6,
            metalness: 0.4
          });
          
          const leftRailing = new THREE.Mesh(railingGeometry, railingMaterial);
          leftRailing.position.set(0, bridge.height / 2 + 1, bridge.width / 2);
          bridgeGroup.add(leftRailing);
          
          const rightRailing = new THREE.Mesh(railingGeometry, railingMaterial);
          rightRailing.position.set(0, bridge.height / 2 + 1, -bridge.width / 2);
          bridgeGroup.add(rightRailing);

          // Add road markings for highway bridges
          if (bridge.type === 'highway') {
            const lineGeometry = new THREE.BoxGeometry(bridge.length, 0.1, 0.5);
            const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xffff00 });
            
            // Center line
            const centerLine = new THREE.Mesh(lineGeometry, lineMaterial);
            centerLine.position.set(0, bridge.height / 2 + 0.1, 0);
            bridgeGroup.add(centerLine);
            
            // Side lines
            const sideLineGeometry = new THREE.BoxGeometry(bridge.length, 0.1, 0.3);
            const leftSideLine = new THREE.Mesh(sideLineGeometry, lineMaterial);
            leftSideLine.position.set(0, bridge.height / 2 + 0.1, bridge.width / 3);
            bridgeGroup.add(leftSideLine);
            
            const rightSideLine = new THREE.Mesh(sideLineGeometry, lineMaterial);
            rightSideLine.position.set(0, bridge.height / 2 + 0.1, -bridge.width / 3);
            bridgeGroup.add(rightSideLine);
          }

          // Position the bridge
          const [lng, lat] = bridge.position;
          const merc = mapboxgl.MercatorCoordinate.fromLngLat({ lng, lat }, 0);
          bridgeGroup.position.set(merc.x, merc.y, merc.z);
          
          // Rotate bridge to align with road direction (simplified)
          bridgeGroup.rotation.z = Math.PI / 4; // 45 degrees
          
          (this as any).scene.add(bridgeGroup);
          });
        },
      render: function(gl: WebGLRenderingContext, matrix: number[]) {
          const m = new THREE.Matrix4().fromArray(matrix);
          (this as any).camera.projectionMatrix = m;
          (this as any).renderer.resetState();
          (this as any).renderer.render((this as any).scene, (this as any).camera);
          (this as any).map.triggerRepaint();
        }
      };

    // Add the bridge layer to the map
    map.current.addLayer(bridgeLayer);

    return () => {
      if (map.current && map.current.getLayer('bridge-layer')) {
        map.current.removeLayer('bridge-layer');
      }
    };
  }, [map.current]);

  // Effect to handle 3D models
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;

    if (map.current.getLayer('custom-clouds-3d')) {
      map.current.removeLayer('custom-clouds-3d');
    }


    if (models3D.length > 0) {
      // Create a custom layer for 3D models
      const customLayer: mapboxgl.CustomLayerInterface = {
        id: '3d-models',
        type: 'custom',
        onAdd: function(map: mapboxgl.Map, gl: WebGLRenderingContext) {
          (this as any).camera = new THREE.Camera();
          (this as any).camera.far = 10000000;
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
      if (map.current) {
        if (map.current.getLayer('3d-models')) {
            map.current.removeLayer('3d-models');
        }
        map.current.addLayer(customLayer);
      }
    }


    return () => {
      const mapInstance = map.current;
      if (!mapInstance || (mapInstance as any)._removed || !mapInstance.isStyleLoaded()) {
        return;
      }
      try {
        if (mapInstance.getLayer('custom-clouds-3d')) {
          mapInstance.removeLayer('custom-clouds-3d');
        }
      } catch(e) { /* ignore */ }
      try {
        if (mapInstance.getLayer('3d-models')) {
          mapInstance.removeLayer('3d-models');
        }
      } catch(e) { /* ignore */ }
    };
  }, [models3D]);


  // Add refs for draggable components with proper types
  const filmControlsRef = useRef<HTMLDivElement>(null);
  const recordingPathRef = useRef<HTMLDivElement>(null);
  const timelinePanelRef = useRef<HTMLDivElement>(null);
  const actorPanelRef = useRef<HTMLDivElement>(null);
  const effectsPanelRef = useRef<HTMLDivElement>(null);
  const settingsContainerRef = useRef<HTMLDivElement>(null);
  const cubeSliderRef = useRef<HTMLDivElement>(null);
  const sidebarLinesRef = useRef<HTMLDivElement>(null);
  const modelImportModalRef = useRef<HTMLDivElement>(null);
  const modelListRef = useRef<HTMLDivElement>(null);
  const placingModelRef = useRef<HTMLDivElement>(null);

  const initializeTerrain = useCallback(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;

    try {
      // Remove existing terrain and source
      if (map.current.getTerrain()) {
        map.current.setTerrain(null);
      }
      if (map.current.getSource('mapbox-dem')) {
        map.current.removeSource('mapbox-dem');
      }

      // Add new source and terrain
      map.current.addSource('mapbox-dem', {
        'type': 'raster-dem',
        'url': 'mapbox://mapbox.terrain-rgb',
        'tileSize': 512,
        'maxzoom': 14
      });

      map.current.setTerrain({
        'source': 'mapbox-dem',
        'exaggeration': terrainExaggeration
      });
    } catch (error) {
      console.error('Error initializing terrain:', error);
    }
  }, []);







  // Debug function to list available layers
  const debugLayers = () => {
    if (!map.current) {
      console.log('❌ Map not available');
      return;
    }
    
    console.log('🔍 Available layers:');
    const style = map.current.getStyle();
    if (style && style.layers) {
      style.layers.forEach((layer, index) => {
        console.log(`  ${index}: ${layer.id} (${layer.type})`);
      });
    }
  };











  // Effect to handle terrain exaggeration changes
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    
    const terrain = map.current.getTerrain();
    if (terrain) {
      try {
        map.current.setTerrain({
          source: 'mapbox-dem',
          exaggeration: terrainExaggeration
        });
      } catch (error) {
        console.error('Error updating terrain exaggeration:', error);
      }
    }
  }, [terrainExaggeration]);



  // Calculate sun position for sky integration
  const getSunPosition = () => {
    // Sun should be visible during day phases (0.4 to 0.95)
    const isVisible = cycleProgress >= 0.4 && cycleProgress <= 0.95;
    
    if (!isVisible) {
      return null;
    }
    
    // Calculate sun position along an arc from east to west
    const sunProgress = (cycleProgress - 0.4) / (0.95 - 0.4); // 0 to 1
    const angle = sunProgress * Math.PI; // 0 to π (east to west)
    
    // Calculate position on screen (arc from top-left to top-right across the sky)
    const centerX = 50; // Center horizontally
    const centerY = 30; // Higher in sky
    const radius = 35; // Arc radius
    
    // Use a flatter arc to prevent sun from going too high
    const x = centerX + radius * Math.cos(angle);
    const y = centerY - radius * Math.sin(angle) * 0.3; // Flatten the arc more
    
    console.log('Sun position:', { x, y, cycleProgress, sunProgress });
    
    return { x, y };
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      

      {/* Collapsible Top Bar for Controls */}
      {!isSlideshowMode && (
        <div>
          <div
            className={`side-panel-glass${showSidePanel ? ' open' : ' closed'}`}
            style={{
              position: 'absolute',
              top: showSidePanel ? 0 : -100,
              left: 0,
              right: 0,
              width: '100%',
              minHeight: 0,
              zIndex: 1100,
              background: '#ffffff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              borderRadius: 0,
              padding: '12px 20px',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              transition: 'top 0.35s cubic-bezier(.4,1.4,.6,1)',
              borderBottom: '1px solid #dadce0',
              pointerEvents: showSidePanel ? 'auto' : 'none',
            }}
          >
          {/* Left Section - App Logo/Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ 
              width: '32px', 
              height: '32px', 
              borderRadius: '50%', 
              background: 'linear-gradient(135deg, #4285f4, #34a853, #fbbc04, #ea4335)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '18px',
              fontWeight: 'bold'
            }}>
              M
            </div>
            <span style={{ fontSize: '18px', fontWeight: '500', color: '#202124' }}>Map Studio</span>
          </div>

          {/* Center Section - Tool Icons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setShowSettings(!showSettings)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: showSettings ? '#f1f3f4' : 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.2s',
                color: '#5f6368'
              }}
              title="World Layout"
            >
              World
            </button>
            <div style={{ width: '1px', height: '24px', background: '#dadce0' }}></div>
            <button
              onClick={() => setShowModelImport(!showModelImport)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: showModelImport ? '#f1f3f4' : 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.2s',
                color: '#5f6368'
              }}
              title="Import Models"
            >
              Import
            </button>
            <div style={{ width: '1px', height: '24px', background: '#dadce0' }}></div>
            <button
              onClick={() => setIsDrawing(!isDrawing)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: isDrawing ? '#f1f3f4' : 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.2s',
                color: '#5f6368'
              }}
              title="Drawing Tools"
            >
              Draw
            </button>
            <div style={{ width: '1px', height: '24px', background: '#dadce0' }}></div>
            <button
              onClick={() => setShowSidePanel(!showSidePanel)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: showSidePanel ? '#f1f3f4' : 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.2s',
                color: '#5f6368'
              }}
              title="Toggle Panel"
            >
              Settings
            </button>
          </div>

          {/* Right Section - Status/Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '14px', color: '#5f6368' }}>Ready</span>
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              background: '#34a853' 
            }}></div>
          </div>
        </div>
        {/* Separate toggle button that stays visible when panel is collapsed */}
        {!showSidePanel && (
          <button
            className="sidepanel-toggle-btn"
            style={{
              position: 'absolute',
              top: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'rgba(0, 170, 255, 0.92)',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              border: '1px solid #e5e7eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: 16,
              transition: 'background 0.18s',
              outline: 'none',
              color: '#1976d2',
              zIndex: 1200,
            }}
            title="Show panel"
            onClick={() => setShowSidePanel(true)}
          >
            <span role="img" aria-label="Show">▼</span>
          </button>
        )}
        <style>{`
          .side-panel-glass.open { pointer-events: auto; }
          .side-panel-glass.closed { pointer-events: none; }
          .sidepanel-btn:hover, .sidepanel-btn:focus {
            background: #f5f6fa;
            box-shadow: 0 1px 4px rgba(0,0,0,0.04);
            border-color: #d1d5db;
          }
          .sidepanel-btn:active {
            background: #f0f1f3;
            box-shadow: 0 1px 2px rgba(0,0,0,0.03);
            border-color: #cfd8dc;
          }
          .sidepanel-toggle-btn:hover {
            background: #e3f2fd;
          }
        `}</style>
      </div>
      )}

      {isRecordingPath && (
        <Draggable nodeRef={recordingPathRef as React.RefObject<HTMLElement>}>
          <div ref={recordingPathRef} style={{
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '16px',
            borderRadius: '8px',
            zIndex: 1000
          }}>
            Click to place {recordingPoints.length === 0 ? 'first' : 'second'} point
          </div>
        </Draggable>
      )}

      {/* Timeline Panel */}
      {showTimeline && (
        <Draggable nodeRef={timelinePanelRef as React.RefObject<HTMLElement>}>
          <div ref={timelinePanelRef}>
            {!isSlideshowMode && renderTimelinePanel()}
          </div>
        </Draggable>
      )}

      {/* Actor Panel */}
      {showActorPanel && !isSlideshowMode && (
        <Draggable nodeRef={actorPanelRef as React.RefObject<HTMLElement>}>
          <div ref={actorPanelRef}>
            {renderActorPanel()}
          </div>
        </Draggable>
      )}

      {/* Effects Panel */}
      {showEffectsPanel && !isSlideshowMode && (
        <Draggable nodeRef={effectsPanelRef as React.RefObject<HTMLElement>}>
          <div ref={effectsPanelRef} className="effects-panel" style={{
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
        </Draggable>
      )}

      {/* Slideshow Mode Toggle Button */}
      <button 
        onClick={toggleSlideshowMode}
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          background: isSlideshowMode ? '#FF9800' : '#4CAF50',
                border: 'none',
          borderRadius: '8px',
          padding: '10px 16px',
          fontSize: '14px',
                cursor: 'pointer',
          color: 'white',
          fontWeight: 'bold',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          transition: 'all 0.2s ease',
          zIndex: 1000,
          backdropFilter: 'blur(10px)'
        }}
        title={isSlideshowMode ? 'Switch to Editor Mode' : 'Switch to Slideshow Mode'}
      >
        {isSlideshowMode ? 'Slideshow' : 'Editor'}
            </button>

      {/* Slideshow Mode Settings Access */}
      {isSlideshowMode && (
              <button
          onClick={() => setShowSettings(!showSettings)}
                style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'rgba(0,0,0,0.3)',
                  border: 'none',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            fontSize: '16px',
                  cursor: 'pointer',
            color: 'white',
            backdropFilter: 'blur(10px)',
            transition: 'all 0.2s ease',
            zIndex: 1000
                }}
          title="Settings"
              >
          Settings
              </button>
      )}

      {/* Settings Button */}
      {!isSlideshowMode && (
                <button
          className="settings-button"
          onClick={() => setShowSettings(!showSettings)}
                  style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '12px',
            padding: '12px 16px',
            fontSize: '14px',
            fontWeight: '600',
            color: '#333',
                    cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            transition: 'all 0.2s ease',
            zIndex: 1000
                  }}
                >
          Settings
                </button>
      )}

      {/* Settings Button */}
      {!isSlideshowMode && (
                      <button
          className="settings-button"
          onClick={() => setShowSettings(!showSettings)}
                        style={{
            background: '#ffffff',
                          border: 'none',
            borderRadius: '8px',
            padding: '12px 16px',
            fontSize: '14px',
            fontWeight: '600',
            color: '#333',
                          cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            transition: 'all 0.2s ease',
            position: 'absolute',
            top: '20px',
            right: '20px',
            zIndex: 1000
          }}
        >
          Settings
                      </button>
      )}


      {/* Settings Button */}
      {!isSlideshowMode && (
        <button 
          className="settings-button"
          onClick={() => setShowSettings(!showSettings)}
          style={{
            background: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            fontSize: '16px',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            transition: 'all 0.2s ease'
          }}
        >
          Settings
        </button>
      )}

      {/* Slideshow Mode Toggle Button */}
      <button 
        onClick={toggleSlideshowMode}
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          background: isSlideshowMode ? '#FF9800' : '#4CAF50',
          border: 'none',
          borderRadius: '8px',
          padding: '10px 16px',
          fontSize: '14px',
          cursor: 'pointer',
          color: 'white',
          fontWeight: 'bold',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          transition: 'all 0.2s ease',
          zIndex: 1000,
          backdropFilter: 'blur(10px)'
        }}
        title={isSlideshowMode ? 'Switch to Editor Mode' : 'Switch to Slideshow Mode'}
      >
        {isSlideshowMode ? 'Slideshow' : 'Editor'}
      </button>

      {/* Slideshow Mode Settings Access */}
      {isSlideshowMode && (
        <button 
          onClick={() => setShowSettings(!showSettings)}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'rgba(0,0,0,0.3)',
            border: 'none',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            fontSize: '16px',
            cursor: 'pointer',
            color: 'white',
            backdropFilter: 'blur(10px)',
            transition: 'all 0.2s ease',
            zIndex: 1000
          }}
          title="Settings"
        >
          Settings
        </button>
      )}



      {/* Line List */}
      {!isSlideshowMode && (
        <Draggable nodeRef={sidebarLinesRef as React.RefObject<HTMLElement>}>
        <div ref={sidebarLinesRef} className="sidebar-lines-list" style={{
          position: 'absolute',
          top: '80px',
          right: '20px',
          zIndex: 1000,
          background: 'white',
          padding: '16px',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          minWidth: '220px',
          maxWidth: '260px',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Your Lines</div>
          {recordingLines.length === 0 && (
            <div style={{ color: '#888', fontSize: '14px' }}>No lines yet</div>
          )}
          {recordingLines.map((line) => (
            <div key={line.id} style={{ marginBottom: 12, padding: 6, borderRadius: 6, background: '#f7f7f7' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>
                  <span style={{
                    display: 'inline-block',
                    width: '12px',
                    height: '12px',
                    backgroundColor: '#ff0000',
                    marginRight: '8px',
                    borderRadius: '2px'
                  }}></span>
                  {line.name}
                </span>
                <button
                  style={{
                    marginLeft: 10,
                    background: '#e53935',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    padding: '2px 8px',
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    // Remove the line's individual source and layer from the map
                    if (map.current) {
                      try {
                        if (
                          map.current &&
                          map.current.style &&
                          typeof map.current.getLayer === 'function' &&
                          typeof map.current.getSource === 'function' &&
                          !(map.current as any)._removed
                        ) {
                          const mapInstance = map.current!;
                          if (mapInstance.getLayer(`recording-path-${line.id}`)) {
                            try { mapInstance.removeLayer(`recording-path-${line.id}`); } catch (e) { console.error(e); }
                          }
                          if (mapInstance.getSource(`recording-path-${line.id}`)) {
                            try { mapInstance.removeSource(`recording-path-${line.id}`); } catch (e) { console.error(e); }
                          }
                          if (mapInstance.getLayer(`recording-path-endpoint-start-${line.id}`)) {
                            try { mapInstance.removeLayer(`recording-path-endpoint-start-${line.id}`); } catch (e) { console.error(e); }
                          }
                          if (mapInstance.getSource(`recording-path-endpoint-start-${line.id}`)) {
                            try { mapInstance.removeSource(`recording-path-endpoint-start-${line.id}`); } catch (e) { console.error(e); }
                          }
                          if (mapInstance.getLayer(`recording-path-endpoint-end-${line.id}`)) {
                            try { mapInstance.removeLayer(`recording-path-endpoint-end-${line.id}`); } catch (e) { console.error(e); }
                          }
                        }
                      } catch (e) { console.error(e); }
                          }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </Draggable>
      )}


      {/* Settings Panel */}
      {showSettings && !isSlideshowMode && (
        <div style={{
          position: 'absolute',
          top: '0px',
          left: '0px',
          right: '0px',
          bottom: '0px',
          background: '#ffffff',
          zIndex: 1000,
          minWidth: '320px',
          maxWidth: '400px',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Header - matches top panel height */}
          <div style={{
            height: '64px', // Matches top panel height
            background: '#ffffff',
            borderBottom: '1px solid #dadce0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0 20px',
            flexShrink: 0
          }}>
            <h3 style={{ margin: 0, color: '#202124', fontSize: '18px', fontWeight: '500' }}>World Layout Settings</h3>
            <button
              onClick={() => setShowSettings(false)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.2s',
                color: '#5f6368',
                fontSize: '20px'
              }}
              title="Close"
            >
              ×
            </button>
          </div>
          
          {/* Scrollable Content */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px'
          }}>

          {/* Building Color Control */}
          <div style={{ marginBottom: '20px' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#333' }}>Building Appearance</h4>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label htmlFor="building-color" style={{ fontSize: '14px', color: '#333' }}>
                Building Color:
                </label>
              <input
                type="color"
                id="building-color"
                value={buildingColor}
                onChange={(e) => setBuildingColor(e.target.value)}
                style={{
                  width: '40px',
                  height: '30px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              />
              <span style={{ fontSize: '12px', color: '#666' }}>
                {buildingColor}
              </span>
            </div>
          </div>

          {/* 3D Building Designer */}
          <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
            <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333', display: 'flex', alignItems: 'center', gap: '10px' }}>
              3D Building Designer
              <button
                onClick={() => setIsBuildingDesignerMode(!isBuildingDesignerMode)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  backgroundColor: isBuildingDesignerMode ? '#dc3545' : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {isBuildingDesignerMode ? 'Exit Designer' : 'Enter Designer'}
              </button>
            </h4>

            {isBuildingDesignerMode && (
              <div>
                <p style={{ fontSize: '12px', color: '#666', margin: '0 0 15px 0' }}>
                  Click &quot;Start Selecting Points&quot; below, then click on the map to add points (minimum 3 points)
                </p>

                {/* Point Selection Controls */}
                <div style={{ marginBottom: '15px' }}>
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <button
                      onClick={() => {
                        setIsSelectingPoints(!isSelectingPoints);
                        if (isSelectingPoints) {
                          setSelectedPoints([]);
                          clearPointMarkers();
                        }
                      }}
              style={{
                    padding: '6px 12px',
                        fontSize: '12px',
                        backgroundColor: isSelectingPoints ? '#dc3545' : '#007bff',
                        color: 'white',
                        border: 'none',
                borderRadius: '4px',
                    cursor: 'pointer',
                        flex: 1
                      }}
                    >
                      {isSelectingPoints ? 'Stop Selecting' : 'Start Selecting Points'}
                    </button>
                    <button
                      onClick={() => {
                        if (selectedPoints.length >= 3) {
                          addCustomBuilding(selectedPoints);
                        }
                      }}
                      disabled={selectedPoints.length < 3}
                      style={{
                        padding: '6px 12px',
                    fontSize: '12px',
                        backgroundColor: selectedPoints.length >= 3 ? '#28a745' : '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: selectedPoints.length >= 3 ? 'pointer' : 'not-allowed',
                        flex: 1
                      }}
                    >
                      Create Building ({selectedPoints.length})
                </button>
                  </div>

                  {selectedPoints.length > 0 && (
                    <div style={{ marginBottom: '10px' }}>
                      <h5 style={{ margin: '0 0 5px 0', fontSize: '12px', color: '#333' }}>Selected Points ({selectedPoints.length})</h5>
                      <div style={{ maxHeight: '80px', overflowY: 'auto', fontSize: '11px', color: '#666' }}>
                        {selectedPoints.map((point, index) => (
                          <div key={index} style={{ marginBottom: '2px' }}>
                            Point {index + 1}: {point[0].toFixed(6)}, {point[1].toFixed(6)}
                          </div>
                        ))}
                      </div>
                <button
                        onClick={() => {
                          setSelectedPoints([]);
                          clearPointMarkers();
                        }}
                  style={{
                          padding: '3px 6px',
                          fontSize: '10px',
                          backgroundColor: '#dc3545',
                          color: 'white',
                    border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          marginTop: '5px'
                        }}
                      >
                        Clear Points
                      </button>
                    </div>
                  )}
                </div>

                {/* Building Properties */}
                <div style={{ marginBottom: '15px' }}>
                  <h5 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#333' }}>Building Properties</h5>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <div>
                      <label style={{ fontSize: '12px', color: '#333', display: 'block', marginBottom: '4px' }}>Height (m)</label>
                      <input
                        type="number"
                        value={buildingDesignerProperties.height}
                        onChange={(e) => setBuildingDesignerProperties(prev => ({ ...prev, height: Number(e.target.value) }))}
                        style={{ width: '100%', padding: '4px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px' }}
                        min="1"
                        max="500"
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', color: '#333', display: 'block', marginBottom: '4px' }}>Color</label>
                      <input
                        type="color"
                        value={buildingDesignerProperties.color}
                        onChange={(e) => setBuildingDesignerProperties(prev => ({ ...prev, color: e.target.value }))}
                        style={{ width: '100%', height: '30px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', color: '#333', display: 'block', marginBottom: '4px' }}>Style</label>
                      <select
                        value={buildingDesignerProperties.style}
                        onChange={(e) => setBuildingDesignerProperties(prev => ({ ...prev, style: e.target.value as any }))}
                        style={{ width: '100%', padding: '4px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px' }}
                      >
                        <option value="box">Box</option>
                        <option value="pyramid">Pyramid</option>
                        <option value="cylinder">Cylinder</option>
                        <option value="tower">Tower</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', color: '#333', display: 'block', marginBottom: '4px' }}>Rotation (°)</label>
                      <input
                        type="number"
                        value={buildingDesignerProperties.rotation}
                        onChange={(e) => setBuildingDesignerProperties(prev => ({ ...prev, rotation: Number(e.target.value) }))}
                        style={{ width: '100%', padding: '4px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px' }}
                        min="0"
                        max="360"
                      />
                    </div>
                  </div>
                </div>

                {/* Custom Buildings List */}
                {customBuildings.length > 0 && (
                  <div>
                    <h5 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#333' }}>Custom Buildings ({customBuildings.length})</h5>
                    <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
                      {customBuildings.map((building) => (
                        <div
                          key={building.id}
                          style={{
                            padding: '8px',
                            marginBottom: '5px',
                            backgroundColor: selectedBuilding === building.id ? '#e3f2fd' : '#fff',
                            border: selectedBuilding === building.id ? '2px solid #1976d2' : '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: 'pointer',
                            fontSize: '12px'
                          }}
                          onClick={() => setSelectedBuilding(building.id)}
                        >
                          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{building.name}</div>
                          <div style={{ color: '#666', marginBottom: '4px' }}>
                            {building.style} • {building.height}m • {building.points?.length || 4} points
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#666', fontSize: '11px' }}>
                              {building.position[0].toFixed(4)}, {building.position[1].toFixed(4)}
                            </span>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEditingBuilding(building);
                                }}
                                style={{
                                  padding: '3px 6px',
                                  fontSize: '10px',
                                  backgroundColor: '#007bff',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: 'pointer'
                                }}
                              >
                                Edit
                </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteCustomBuilding(building.id);
                                }}
                                style={{
                                  padding: '3px 6px',
                                  fontSize: '10px',
                                  backgroundColor: '#dc3545',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: 'pointer'
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Building Edit Interface */}
                {isEditingBuilding && editingBuilding && (
                  <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#fff3cd', borderRadius: '6px', border: '1px solid #ffeaa7' }}>
                    <h5 style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#856404', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      Editing: {editingBuilding.name}
                    </h5>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                      <div>
                        <label style={{ fontSize: '11px', color: '#333', display: 'block', marginBottom: '3px' }}>Height (m)</label>
                        <input
                          type="number"
                          value={editingBuildingProperties.height}
                          onChange={(e) => setEditingBuildingProperties(prev => ({ ...prev, height: Number(e.target.value) }))}
                          style={{ width: '100%', padding: '4px', fontSize: '11px', border: '1px solid #ccc', borderRadius: '3px' }}
                          min="1"
                          max="500"
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '11px', color: '#333', display: 'block', marginBottom: '3px' }}>Color</label>
                        <input
                          type="color"
                          value={editingBuildingProperties.color}
                          onChange={(e) => setEditingBuildingProperties(prev => ({ ...prev, color: e.target.value }))}
                          style={{ width: '100%', height: '28px', border: '1px solid #ccc', borderRadius: '3px', cursor: 'pointer' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '11px', color: '#333', display: 'block', marginBottom: '3px' }}>Style</label>
                        <select
                          value={editingBuildingProperties.style}
                          onChange={(e) => setEditingBuildingProperties(prev => ({ ...prev, style: e.target.value as any }))}
                          style={{ width: '100%', padding: '4px', fontSize: '11px', border: '1px solid #ccc', borderRadius: '3px' }}
                        >
                          <option value="box">Box</option>
                          <option value="pyramid">Pyramid</option>
                          <option value="cylinder">Cylinder</option>
                          <option value="tower">Tower</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: '11px', color: '#333', display: 'block', marginBottom: '3px' }}>Rotation (°)</label>
                        <input
                          type="number"
                          value={editingBuildingProperties.rotation}
                          onChange={(e) => setEditingBuildingProperties(prev => ({ ...prev, rotation: Number(e.target.value) }))}
                          style={{ width: '100%', padding: '4px', fontSize: '11px', border: '1px solid #ccc', borderRadius: '3px' }}
                          min="0"
                          max="360"
                        />
              </div>
          </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
              <button
                        onClick={saveBuildingChanges}
                style={{
                          padding: '6px 12px',
                          fontSize: '11px',
                          backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  flex: 1
                }}
              >
                        Save Changes
                      </button>
                      <button
                        onClick={cancelEditingBuilding}
                        style={{
                          padding: '6px 12px',
                          fontSize: '11px',
                          backgroundColor: '#6c757d',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          flex: 1
                        }}
                      >
                        Cancel
              </button>
            </div>
                </div>
                )}
                </div>
            )}
          </div>


          {/* 3D Layer Controls */}
          <div style={{ marginBottom: '20px' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#333' }}>3D Features</h4>
            {layers3D.map(layer => (
              <div key={layer.id} style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                <input
                  type="checkbox"
                  id={layer.id}
                  checked={layer.enabled}
                  onChange={() => toggle3DLayer(layer.id)}
                  style={{ marginRight: '8px' }}
                />
                <label htmlFor={layer.id} style={{ fontSize: '14px', cursor: 'pointer' }}>
                  {layer.name}
                </label>
              </div>
            ))}
          </div>

          {/* Label Toggle */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
              <input
                type="checkbox"
                id="show-labels"
                checked={showLabels}
                onChange={toggleLabels}
                style={{ marginRight: '8px' }}
              />
              <label htmlFor="show-labels" style={{ fontSize: '14px', cursor: 'pointer' }}>
                Show Map Labels
              </label>
            </div>
          </div>


          {/* Refresh Button */}
          <div style={{ marginBottom: '20px' }}>
            <button
              onClick={refresh3DFeatures}
              style={{
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                width: '100%',
                marginBottom: '8px',
                animation: 'fadeInUp 0.5s'
              }}
            >
              Refresh 3D Features
            </button>
            <button
              onClick={() => {
                if (map.current) {
                  console.log('Available layers:');
                  const layers = map.current.getStyle().layers;
                  layers?.forEach(layer => {
                    if (layer.type === 'fill-extrusion') {
                      console.log(`- ${layer.id} (${layer.type})`);
                    }
                  });
                }
              }}
              style={{
                background: '#2196f3',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                width: '100%',
                animation: 'fadeInUp 0.5s 0.1s'
              }}
            >
              Debug Layers
            </button>


            
            {/* Add the fadeInUp animation CSS */}
            <style>{`
              @keyframes fadeInUp {
                from { 
                  opacity: 0; 
                  transform: translateY(20px);
                }
                to { 
                  opacity: 1; 
                  transform: translateY(0);
                }
              }
            `}</style>
          </div>

          {/* Sky Layer Controls */}
          <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f0f8ff', borderRadius: '8px', border: '1px solid #b3d9ff' }}>
            <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333', display: 'flex', alignItems: 'center', gap: '10px' }}>
              Sky Layer Controls
              <button
                onClick={() => {
                  setSkyGradientRadius(90);
                  setSunAzimuth(0);
                  setSunElevation(90);
                  setSunIntensity(1);
                  setSunColor('#ffffff');
                  setHaloColor('#ffffff');
                  setAtmosphereColor('#ffffff');
                  setBackgroundColor('#DBEAFE');
                  setBackgroundOpacity(1);
                  setIsSunCycleEnabled(false);
                  setSunCycleDuration(30);
                  isCycleRunningRef.current = false;
                  if (sunCycleIntervalRef.current) {
                    clearTimeout(sunCycleIntervalRef.current);
                    sunCycleIntervalRef.current = null;
                  }
                }}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Reset
              </button>
            </h4>
            

            {/* Gradient Radius */}
            <div style={{ marginBottom: '15px' }}>
              <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>
                Gradient Radius: {skyGradientRadius}°
              </label>
              <input
                type="range"
                min="0"
                max="180"
                step="1"
                value={skyGradientRadius}
                onChange={(e) => setSkyGradientRadius(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            {/* Sun Position */}
            <div style={{ marginBottom: '15px' }}>
              <h5 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#333' }}>Sun Position</h5>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '3px' }}>
                    Azimuth: {sunAzimuth}°
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    step="1"
                    value={sunAzimuth}
                    onChange={(e) => setSunAzimuth(Number(e.target.value))}
                    style={{ width: '100%' }}
                    disabled={isSunCycleEnabled}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '3px' }}>
                    Elevation: {sunElevation}°
                  </label>
                  <input
                    type="range"
                    min="60"
                    max="90"
                    step="1"
                    value={sunElevation}
                    onChange={(e) => setSunElevation(Number(e.target.value))}
                    style={{ width: '100%' }}
                    disabled={isSunCycleEnabled}
                  />
                </div>
              </div>
            </div>

            {/* Sun Cycle Controls */}
            <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '6px', border: '1px solid #e9ecef' }}>
              <h5 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#333' }}>Sun Cycle</h5>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <button
                  onClick={toggleSunCycle}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    backgroundColor: isSunCycleEnabled ? '#dc3545' : '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  {isSunCycleEnabled ? 'Stop Cycle' : 'Start Cycle'}
                </button>
                <span style={{ fontSize: '12px', color: '#666' }}>
                  {isSunCycleEnabled ? 'Sun is cycling: Consistent pace from 90° to 60° over full duration' : 'Manual sun control'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label style={{ fontSize: '12px', color: '#666', minWidth: '60px' }}>
                  Duration: {sunCycleDuration}s
                </label>
                <input
                  type="range"
                  min="5"
                  max="120"
                  step="5"
                  value={sunCycleDuration}
                  onChange={(e) => setSunCycleDuration(Number(e.target.value))}
                  style={{ flex: 1 }}
                  disabled={isSunCycleEnabled}
                />
              </div>
            </div>

            {/* Sun Properties */}
            <div style={{ marginBottom: '15px' }}>
              <h5 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#333' }}>Sun Properties</h5>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <label style={{ fontSize: '12px', color: '#666', minWidth: '60px' }}>
                    Intensity: {sunIntensity}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="3"
                    step="0.1"
                    value={sunIntensity}
                    onChange={(e) => setSunIntensity(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <label style={{ fontSize: '12px', color: '#666', minWidth: '60px' }}>
                    Sun Color:
                  </label>
                  <input
                    type="color"
                    value={sunColor}
                    onChange={(e) => setSunColor(e.target.value)}
                    style={{ width: '40px', height: '30px', border: '1px solid #ccc', borderRadius: '4px' }}
                  />
                  <span style={{ fontSize: '11px', color: '#666' }}>{sunColor}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <label style={{ fontSize: '12px', color: '#666', minWidth: '60px' }}>
                    Halo Color:
                  </label>
                  <input
                    type="color"
                    value={haloColor}
                    onChange={(e) => setHaloColor(e.target.value)}
                    style={{ width: '40px', height: '30px', border: '1px solid #ccc', borderRadius: '4px' }}
                  />
                  <span style={{ fontSize: '11px', color: '#666' }}>{haloColor}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label style={{ fontSize: '12px', color: '#666', minWidth: '60px' }}>
                    Atmosphere Color:
                  </label>
                  <input
                    type="color"
                    value={atmosphereColor}
                    onChange={(e) => setAtmosphereColor(e.target.value)}
                    style={{ width: '40px', height: '30px', border: '1px solid #ccc', borderRadius: '4px' }}
                  />
                  <span style={{ fontSize: '11px', color: '#666' }}>{atmosphereColor}</span>
                </div>
              </div>

            {/* Background Properties */}
            <div>
              <h5 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#333' }}>Background Properties</h5>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <label style={{ fontSize: '12px', color: '#666', minWidth: '60px' }}>
                  Color:
                </label>
                <input
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  style={{ width: '40px', height: '30px', border: '1px solid #ccc', borderRadius: '4px' }}
                />
                <span style={{ fontSize: '11px', color: '#666' }}>{backgroundColor}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label style={{ fontSize: '12px', color: '#666', minWidth: '60px' }}>
                  Opacity: {backgroundOpacity}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={backgroundOpacity}
                  onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
              </div>
            </div>
          </div>

          {/* Camera Angle Controls */}
          <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#fff3cd', borderRadius: '8px', border: '1px solid #ffeaa7' }}>
            <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333', display: 'flex', alignItems: 'center', gap: '10px' }}>
              📷 Camera Angle Controls
              <button
                onClick={() => {
                  setCameraPitch(0);
                  setCameraBearing(0);
                }}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Reset
              </button>
            </h4>
            
            {/* Camera Pitch */}
            <div style={{ marginBottom: '15px' }}>
              <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>
                Camera Pitch: {cameraPitch}°
                <span style={{ fontSize: '12px', color: '#666', marginLeft: '8px' }}>
                  {cameraPitch === 0 ? '(Top-down view)' : 
                   cameraPitch < 30 ? '(Slight angle)' :
                   cameraPitch < 60 ? '(Low-angle shot)' :
                   cameraPitch < 85 ? '(Dramatic low-angle)' :
                   '(Horizontal view - MAXIMUM DRAMA!)'}
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="90"
                step="1"
                value={cameraPitch}
                onChange={(e) => setCameraPitch(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666', marginTop: '5px' }}>
                <span>0° (Top-down)</span>
                <span>45° (Diagonal)</span>
                <span>90° (Horizontal)</span>
              </div>
            </div>

            {/* Camera Bearing */}
            <div style={{ marginBottom: '15px' }}>
              <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>
                Camera Direction: {cameraBearing}°
                <span style={{ fontSize: '12px', color: '#666', marginLeft: '8px' }}>
                  {cameraBearing === 0 || cameraBearing === 360 ? '(North)' :
                   cameraBearing === 90 ? '(East)' :
                   cameraBearing === 180 ? '(South)' :
                   cameraBearing === 270 ? '(West)' :
                   cameraBearing < 90 ? '(Northeast)' :
                   cameraBearing < 180 ? '(Southeast)' :
                   cameraBearing < 270 ? '(Southwest)' : '(Northwest)'}
                </span>
              </label>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={cameraBearing}
                onChange={(e) => setCameraBearing(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666', marginTop: '5px' }}>
                <span>0° (N)</span>
                <span>90° (E)</span>
                <span>180° (S)</span>
                <span>270° (W)</span>
              </div>
            </div>

            {/* Quick Preset Buttons */}
            <div>
              <h5 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#333' }}>Quick Presets</h5>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => { setCameraPitch(0); setCameraBearing(0); }}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  📐 Top-down
                </button>
                <button
                  onClick={() => { setCameraPitch(45); setCameraBearing(0); }}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    backgroundColor: '#17a2b8',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  📐 Diagonal
                </button>
                <button
                  onClick={() => { setCameraPitch(45); setCameraBearing(0); }}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    backgroundColor: '#fd7e14',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Low-angle
                </button>
                <button
                  onClick={() => { setCameraPitch(35); setCameraBearing(45); }}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    backgroundColor: '#6f42c1',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Perfect Sun View
                </button>
              </div>
            </div>
          </div>

          {/* Terrain Exaggeration */}
          <div style={{ marginBottom: '20px' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#333' }}>Terrain Exaggeration</h4>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.1"
                value={terrainExaggeration}
                onChange={(e) => setTerrainExaggeration(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: '#666', fontSize: '14px', minWidth: '40px' }}>
                {terrainExaggeration}x
              </span>
            </div>
          </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Map; 
