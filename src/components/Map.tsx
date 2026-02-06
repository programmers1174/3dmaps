import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import * as THREE from 'three';
import Draggable from 'react-draggable';
import FreehandMode from 'mapbox-gl-draw-freehand-mode';

// Type extensions for MapboxDraw
interface MapboxDrawModes {
  [key: string]: unknown;
}

interface MapboxDrawConstructor {
  new (options?: {
    displayControlsDefault?: boolean;
    controls?: Record<string, boolean>;
    modes?: MapboxDrawModes;
  }): MapboxDraw;
  modes?: MapboxDrawModes;
}

// Extended mapboxgl.Map type to include internal _removed property
type MapboxMapWithInternal = mapboxgl.Map & {
  _removed?: boolean;
};

interface MapProps {
  accessToken: string;
  initialZoom?: number;
}

interface Layer3D {
  id: string;
  name: string;
  enabled: boolean;
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

interface Keyframe {
  time: number;
  value?: number | [number, number, number] | Record<string, unknown>;
  position?: [number, number, number];
  easing?: string;
}

interface Animation {
  id: string;
  name: string;
  startTime: number;
  duration: number;
  type: 'move' | 'rotate' | 'scale' | 'custom';
  keyframes: Keyframe[];
}

interface EffectParameters {
  intensity?: number;
  color?: string;
  position?: [number, number, number];
  size?: number;
  speed?: number;
  [key: string]: unknown;
}

interface Effect {
  id: string;
  name: string;
  type: 'particle' | 'light' | 'weather' | 'custom';
  parameters: EffectParameters;
  startTime: number;
  duration: number;
}


const Map: React.FC<MapProps> = ({
  accessToken,
  initialZoom = 15
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [style, setStyle] = useState('mapbox://styles/mapbox/standard');
  const [showSettings, setShowSettings] = useState(false);
  const [layers3D, setLayers3D] = useState<Layer3D[]>([
    { id: 'terrain', name: 'Terrain', enabled: true },
    { id: 'buildings', name: '3D Buildings', enabled: true }
  ]);
  const [draw, setDraw] = useState<MapboxDraw | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  
  // Game area selection state
  const [isSelectingGameArea, setIsSelectingGameArea] = useState(false);
  const [gameAreaBounds, setGameAreaBounds] = useState<mapboxgl.LngLatBounds | null>(null);
  const [gameAreaPolygon, setGameAreaPolygon] = useState<[number, number][]>([]);
  const gameAreaPointsRef = useRef<[number, number][]>([]);
  const gameAreaHandlersRef = useRef<{
    handleClick?: (e: mapboxgl.MapMouseEvent) => void;
    handleDoubleClick?: (e: mapboxgl.MapMouseEvent) => void;
    handleMouseMove?: (e: mapboxgl.MapMouseEvent) => void;
    updatePreview?: (points: [number, number][], currentPoint?: [number, number]) => void;
  }>({});

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
  const [cameraPathLayer, setCameraPathLayer] = useState<mapboxgl.Layer | null>(null);
  const [cameraDirectionLayer, setCameraDirectionLayer] = useState<mapboxgl.Layer | null>(null);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [selectedKeyframe, setSelectedKeyframe] = useState<number | null>(null);


  const [isSlideshowMode, setIsSlideshowMode] = useState(false);
  const [skyType, setSkyType] = useState<'blue' | 'evening' | 'night' | 'sunrise'>('blue');
  const [isContinuousCycle, setIsContinuousCycle] = useState(false);
  const [cycleProgress, setCycleProgress] = useState(0); // 0-1 progress through cycle
  const [cycleDuration, setCycleDuration] = useState(24); // Duration in seconds (default 24)
  const cycleIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Sky layer properties for customization
  const [skyLayerType, setSkyLayerType] = useState<'atmosphere' | 'gradient'>('atmosphere');
  const [skyGradientRadius, setSkyGradientRadius] = useState(90);
  const [sunAzimuth, setSunAzimuth] = useState(200); // 0-360 degrees
  const [sunElevation, setSunElevation] = useState(90); // 60-90 degrees
  const [sunIntensity, setSunIntensity] = useState(5); // Higher default for bright afternoon (1–15)
  const [sunColor, setSunColor] = useState('#ffffff');
  const [haloColor, setHaloColor] = useState('#FFFBF0'); // Warm white – soft, natural sun glow (not harsh circle)
  const [haloOpacity, setHaloOpacity] = useState(0.55); // Softer halo that blends into sky (not a hard ring)
  const [atmosphereColor, setAtmosphereColor] = useState('#385bad');
  const [backgroundColor, setBackgroundColor] = useState('#00b3ff'); // Default blue background
  const [backgroundOpacity, setBackgroundOpacity] = useState(1);
  
  // Sun cycle state
  const [isSunCycleEnabled, setIsSunCycleEnabled] = useState(false); // OFF by default
  const [sunCycleDuration, setSunCycleDuration] = useState(30); // Duration in seconds
  const sunCycleIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isCycleRunningRef = useRef(false);

  // Refs to store latest sun cycle values to avoid recreating initializeLayers
  const sunAzimuthRef = useRef(sunAzimuth);
  const sunElevationRef = useRef(sunElevation);
  const sunIntensityRef = useRef(sunIntensity);
  const haloColorRef = useRef(haloColor);
  const haloOpacityRef = useRef(haloOpacity);
  const atmosphereColorRef = useRef(atmosphereColor);
  const backgroundColorRef = useRef(backgroundColor);
  
  // Keep refs in sync with state
  useEffect(() => {
    sunAzimuthRef.current = sunAzimuth;
    sunElevationRef.current = sunElevation;
    sunIntensityRef.current = sunIntensity;
    haloColorRef.current = haloColor;
    haloOpacityRef.current = haloOpacity;
    atmosphereColorRef.current = atmosphereColor;
    backgroundColorRef.current = backgroundColor;
  }, [sunAzimuth, sunElevation, sunIntensity, haloColor, haloOpacity, atmosphereColor, backgroundColor]);


 

  // Replace showTopBar with showSidePanel
  const [showSidePanel, setShowSidePanel] = useState(true);

  const [terrainExaggeration, setTerrainExaggeration] = useState(1);
  const [buildingColor, setBuildingColor] = useState('#ffffff');

  // Mapbox Features Panel State
  const [showMapboxFeatures, setShowMapboxFeatures] = useState(false);
  
  // Map Styles
  const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/standard');
  const availableStyles = [
    { id: 'standard', name: 'Standard', url: 'mapbox://styles/mapbox/standard' },
    { id: 'streets', name: 'Streets', url: 'mapbox://styles/mapbox/streets-v12' },
    { id: 'outdoors', name: 'Outdoors', url: 'mapbox://styles/mapbox/outdoors-v12' },
    { id: 'light', name: 'Light', url: 'mapbox://styles/mapbox/light-v11' },
    { id: 'dark', name: 'Dark', url: 'mapbox://styles/mapbox/dark-v11' },
    { id: 'satellite', name: 'Satellite', url: 'mapbox://styles/mapbox/satellite-v9' },
    { id: 'satellite-streets', name: 'Satellite Streets', url: 'mapbox://styles/mapbox/satellite-streets-v12' },
    { id: 'navigation-day', name: 'Navigation Day', url: 'mapbox://styles/mapbox/navigation-day-v1' },
    { id: 'navigation-night', name: 'Navigation Night', url: 'mapbox://styles/mapbox/navigation-night-v1' },
  ];

  // Navigation Controls
  const [showZoomControls, setShowZoomControls] = useState(true);
  const [showCompass, setShowCompass] = useState(true);
  const [showRotationControls, setShowRotationControls] = useState(true);
  const [showPitchControls, setShowPitchControls] = useState(true);
  const [showGeolocation, setShowGeolocation] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [showScale, setShowScale] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(initialZoom);
  const [mapRotation, setMapRotation] = useState(0);
  const [mapPitch, setMapPitch] = useState(0);

  // Fog Controls (careful not to interfere with sky)
  const [fogEnabled, setFogEnabled] = useState(false);
  const [fogColor, setFogColor] = useState('#ffffff');
  const [fogRange, setFogRange] = useState([0.5, 8]);
  const [fogHighColor, setFogHighColor] = useState('#add8e6');
  const [fogSpaceColor, setFogSpaceColor] = useState('#000000');
  const [fogStarIntensity, setFogStarIntensity] = useState(0.35);

  // Cloud Controls
  const [cloudsEnabled, setCloudsEnabled] = useState(false);
  const [cloudDensity, setCloudDensity] = useState(5); // Number of clouds
  const [cloudOpacity, setCloudOpacity] = useState(0.6);
  const [cloudColor, setCloudColor] = useState('#ffffff');
  const [cloudSize, setCloudSize] = useState(0.5); // Size multiplier (0.1 to 2.0)
  const [cloudHeight, setCloudHeight] = useState(2000); // Cloud height/thickness in meters
  const [cloudSpeed, setCloudSpeed] = useState(0.1); // Animation speed (0 to 1)
  const [cloudPolygonDetail, setCloudPolygonDetail] = useState(16); // Number of points per cloud circle (8-32, lower = better performance)
  const cloudAnimationRef = useRef<NodeJS.Timeout | null>(null);
  
  // Cloud brush mode state - new system
  const [isCloudBrushMode, setIsCloudBrushMode] = useState(false);
  const [brushSize, setBrushSize] = useState(1000); // Brush size in meters (diameter)
  const [brushIntensity, setBrushIntensity] = useState(0.026); // How fast clouds grow when holding (0.001–0.1)
  const [mousePosition, setMousePosition] = useState<mapboxgl.LngLat | null>(null);
  const [brushClouds, setBrushClouds] = useState<Array<{
    id: string;
    center: [number, number]; // [lng, lat]
    size: number; // Cloud size in meters (fixed per cloud)
    height: number; // Cloud altitude
    clickCount: number; // Number of times clicked at this location
  }>>([]);
  const brushCloudsRef = useRef<Array<{
    id: string;
    center: [number, number];
    size: number;
    height: number;
    clickCount: number;
  }>>([]);
  const cloudHeightRef = useRef(cloudHeight);
  const cloudOpacityRef = useRef(cloudOpacity);
  const cloudColorRef = useRef(cloudColor);
  const brushSizeRef = useRef(brushSize);
  const brushIntensityRef = useRef(brushIntensity);
  const brushIntensityAccumulatorRef = useRef(0);
  const cloudsEnabledRef = useRef(cloudsEnabled);
  const brushModeHandlersRef = useRef<{
    handleMouseMove?: (e: mapboxgl.MapMouseEvent) => void;
    handleMouseDown?: (e: mapboxgl.MapMouseEvent) => void;
    handleMouseUp?: (e: mapboxgl.MapMouseEvent) => void;
    handleMouseLeave?: () => void;
  }>({});
  const cloudBrushIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const cloudBrushHoldTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMouseDownRef = useRef(false);
  const brushActiveRef = useRef(false); // true only after hold delay (avoids double-click / zoom)
  const currentBrushPositionRef = useRef<[number, number] | null>(null);
  
  // Performance optimization: Cache generated clouds per brush cloud ID
  type CloudCacheEntry = {
    features: GeoJSON.Feature[];
    brushCloud: { id: string; center: [number, number]; size: number; height: number; clickCount: number };
    brushSize: number;
    cloudPolygonDetail: number;
    cloudPositions: Array<{ lng: number; lat: number }>; // Store fixed positions
    numClouds: number; // Store fixed number of clouds
  };
  const cloudCacheRef = useRef<globalThis.Map<string, CloudCacheEntry>>(new globalThis.Map());
  
  // Seeded random number generator for fixed positions
  const seededRandom = (seed: number) => {
    let value = seed;
    return () => {
      value = (value * 9301 + 49297) % 233280;
      return value / 233280;
    };
  };
  
  // Track last brushClouds state to detect changes
  const lastBrushCloudsRef = useRef<Array<{
    id: string;
    center: [number, number];
    size: number;
    height: number;
    clickCount: number;
  }>>([]);
  
  // Debounce timer for parameter changes
  const cloudRegenDebounceRef = useRef<NodeJS.Timeout | null>(null);


  // Terrain Controls
  const [terrainSource, setTerrainSource] = useState('mapbox-dem');
  const [terrainEnabled, setTerrainEnabled] = useState(true);

  // Layer Visibility Controls
  const [trafficLayerVisible, setTrafficLayerVisible] = useState(false);
  const [transitLayerVisible, setTransitLayerVisible] = useState(false);
  const [waterLayerVisible, setWaterLayerVisible] = useState(true);
  const [landuseLayerVisible, setLanduseLayerVisible] = useState(true);
  const [placeLabelsVisible, setPlaceLabelsVisible] = useState(true);
  const [poiLabelsVisible, setPoiLabelsVisible] = useState(true);
  const [roadLabelsVisible, setRoadLabelsVisible] = useState(true);
  const [transportLabelsVisible, setTransportLabelsVisible] = useState(true);

  // 3D Building Controls
  const [buildings3DEnabled, setBuildings3DEnabled] = useState(true);
  const [buildingExtrusionHeight, setBuildingExtrusionHeight] = useState(0);
  const [buildingOpacity, setBuildingOpacity] = useState(0.8);

  // Marker and Popup Management
  const [markers, setMarkers] = useState<Array<{
    id: string;
    position: [number, number];
    popup?: string;
  }>>([]);
  const [showMarkerTools, setShowMarkerTools] = useState(false);


  // Source Management
  type GeoJSONData = GeoJSON.Feature | GeoJSON.FeatureCollection | GeoJSON.Geometry;
  const [customSources, setCustomSources] = useState<Array<{
    id: string;
    type: 'geojson' | 'image' | 'video' | 'raster' | 'vector';
    url?: string;
    tiles?: string[];
    data?: GeoJSONData | string;
  }>>([]);

  // Language/Localization
  const [mapLanguage, setMapLanguage] = useState('en');
  const availableLanguages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ru', name: 'Russian' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
  ];

  // Attribution
  const [showAttribution, setShowAttribution] = useState(true);

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
            
            // Removed duplicate label/road visibility control (managed in the other panel)

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
        
        // Remove draw control if it exists (use ref to get current value to avoid stale closure)
        const currentDraw = drawRef.current;
        if (currentDraw && map.current) {
          try {
          map.current.removeControl(currentDraw);
          drawRef.current = null;
          setDraw(null); // Clear the state when removing the control
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
        
        // Add draw control back if it doesn't exist (use ref to get current value to avoid stale closure)
        const currentDraw = drawRef.current;
        if (!currentDraw && map.current) {
          try {
          const DrawConstructor = MapboxDraw as unknown as MapboxDrawConstructor;
          const drawInstance = new DrawConstructor({
            displayControlsDefault: false,
            controls: { polygon: false, trash: false },
            modes: {
              ...(DrawConstructor.modes || {}),
              draw_polygon: FreehandMode
            }
          });
          map.current.addControl(drawInstance, 'top-left');
          drawRef.current = drawInstance;
          setDraw(drawInstance);
          } catch (error) {
            console.log('Error adding draw control:', error);
          }
        }
      }
    }
  }, [isSlideshowMode]); // draw accessed via ref to avoid stale closure and logic errors














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

  // Game area selection functions
  const startGameAreaSelection = () => {
    if (!map.current) return;
    
    // If already selecting, finish the polygon
    if (isSelectingGameArea) {
      finishGameAreaSelection();
      return;
    }
    
    setIsSelectingGameArea(true);
    setGameAreaPolygon([]);
    gameAreaPointsRef.current = [];
    
    // Create sources and layers for polygon preview
    if (!map.current.getSource('game-area-preview')) {
      map.current.addSource('game-area-preview', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[]]
          }
        }
      });
    }
    
    if (!map.current.getSource('game-area-points')) {
      map.current.addSource('game-area-points', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        }
      });
    }
    
    if (!map.current.getLayer('game-area-preview')) {
      map.current.addLayer({
        id: 'game-area-preview',
        type: 'fill',
        source: 'game-area-preview',
        paint: {
          'fill-color': '#2196f3',
          'fill-opacity': 0.2
        }
      });
      
      map.current.addLayer({
        id: 'game-area-preview-outline',
        type: 'line',
        source: 'game-area-preview',
        paint: {
          'line-color': '#2196f3',
          'line-width': 2,
          'line-dasharray': [2, 2]
        }
      });
      
      map.current.addLayer({
        id: 'game-area-points',
        type: 'circle',
        source: 'game-area-points',
        paint: {
          'circle-radius': 6,
          'circle-color': '#2196f3',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });
    }
    
    const updatePreview = (points: [number, number][], currentPoint?: [number, number]) => {
      if (!map.current) return;
      
      const source = map.current.getSource('game-area-preview') as mapboxgl.GeoJSONSource;
      const pointsSource = map.current.getSource('game-area-points') as mapboxgl.GeoJSONSource;
      
      if (points.length === 0) {
        if (source) {
          source.setData({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [[]]
            }
          });
        }
        if (pointsSource) {
          pointsSource.setData({
            type: 'FeatureCollection',
            features: []
          });
        }
        return;
      }
      
      // Create polygon coordinates (close the polygon)
      let polygonCoords = [...points];
      if (currentPoint) {
        polygonCoords = [...points, currentPoint];
      }
      // Close the polygon by adding the first point at the end
      if (polygonCoords.length > 0) {
        polygonCoords.push(polygonCoords[0]);
      }
      
      if (source) {
        source.setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [polygonCoords]
          }
        });
      }
      
      // Update points
      if (pointsSource) {
        pointsSource.setData({
          type: 'FeatureCollection',
          features: points.map((point, index) => ({
            type: 'Feature',
            properties: { index },
            geometry: {
              type: 'Point',
              coordinates: point
            }
          }))
        });
      }
    };
    
    const handleClick = (e: mapboxgl.MapMouseEvent) => {
      e.originalEvent?.preventDefault();
      e.originalEvent?.stopPropagation();
      
      const newPoint: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      gameAreaPointsRef.current = [...gameAreaPointsRef.current, newPoint];
      setGameAreaPolygon([...gameAreaPointsRef.current]);
      if (gameAreaHandlersRef.current.updatePreview) {
        gameAreaHandlersRef.current.updatePreview(gameAreaPointsRef.current);
      }
    };
    
    const handleDoubleClick = (e: mapboxgl.MapMouseEvent) => {
      e.originalEvent?.preventDefault();
      e.originalEvent?.stopPropagation();
      
      // Finish the polygon on double click
      finishGameAreaSelection();
    };
    
    const handleMouseMove = (e: mapboxgl.MapMouseEvent) => {
      const currentPoint: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      if (gameAreaPointsRef.current.length > 0 && gameAreaHandlersRef.current.updatePreview) {
        gameAreaHandlersRef.current.updatePreview(gameAreaPointsRef.current, currentPoint);
      }
    };
    
    // Store handlers and updatePreview in ref
    gameAreaHandlersRef.current = {
      handleClick,
      handleDoubleClick,
      handleMouseMove,
      updatePreview
    };
    
    // Add event listeners
    map.current.on('click', handleClick);
    map.current.on('dblclick', handleDoubleClick);
    map.current.on('mousemove', handleMouseMove);
    
    // Change cursor to crosshair
    if (map.current.getCanvas()) {
      map.current.getCanvas().style.cursor = 'crosshair';
    }
  };
  
  const finishGameAreaSelection = () => {
    const points = gameAreaPointsRef.current;
    if (!map.current || points.length < 3) {
      alert('Please add at least 3 points to create a polygon');
      return;
    }
    
    // Calculate bounds from polygon
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    
    points.forEach(([lng, lat]) => {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    });
    
    const bounds = new mapboxgl.LngLatBounds(
      [minLng, minLat],
      [maxLng, maxLat]
    );
    
    // Set the map bounds
    map.current.setMaxBounds(bounds);
    setGameAreaBounds(bounds);
    
    // Store the polygon
    const closedPolygon = [...points, points[0]]; // Close the polygon
    
    // Update the preview to show the final polygon
    const source = map.current.getSource('game-area-preview') as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [closedPolygon]
        }
      });
    }
    
    // Fit map to the selected area
    map.current.fitBounds(bounds, {
      padding: 50,
      duration: 1000
    });
    
    // Remove event listeners
    if (gameAreaHandlersRef.current.handleClick) {
      map.current.off('click', gameAreaHandlersRef.current.handleClick);
    }
    if (gameAreaHandlersRef.current.handleDoubleClick) {
      map.current.off('dblclick', gameAreaHandlersRef.current.handleDoubleClick);
    }
    if (gameAreaHandlersRef.current.handleMouseMove) {
      map.current.off('mousemove', gameAreaHandlersRef.current.handleMouseMove);
    }
    
    // Clear handlers
    gameAreaHandlersRef.current = {};
    
    // Exit selection mode
    setIsSelectingGameArea(false);
    
    // Reset cursor
    if (map.current.getCanvas()) {
      map.current.getCanvas().style.cursor = '';
    }
  };

  const clearGameArea = () => {
    if (map.current) {
      // Remove event listeners if in selection mode
      if (isSelectingGameArea && gameAreaHandlersRef.current) {
        if (gameAreaHandlersRef.current.handleClick) {
          map.current.off('click', gameAreaHandlersRef.current.handleClick);
        }
        if (gameAreaHandlersRef.current.handleDoubleClick) {
          map.current.off('dblclick', gameAreaHandlersRef.current.handleDoubleClick);
        }
        if (gameAreaHandlersRef.current.handleMouseMove) {
          map.current.off('mousemove', gameAreaHandlersRef.current.handleMouseMove);
        }
        gameAreaHandlersRef.current = {};
      }
      
      map.current.setMaxBounds(undefined as any);
      setGameAreaBounds(null);
      setGameAreaPolygon([]);
      gameAreaPointsRef.current = [];
      
      // Clean up preview layers if they exist
      if (map.current.getLayer('game-area-preview')) {
        map.current.removeLayer('game-area-preview');
        map.current.removeLayer('game-area-preview-outline');
        map.current.removeLayer('game-area-points');
      }
      if (map.current.getSource('game-area-preview')) {
        map.current.removeSource('game-area-preview');
      }
      if (map.current.getSource('game-area-points')) {
        map.current.removeSource('game-area-points');
      }
      
      // Reset cursor
      if (map.current.getCanvas()) {
        map.current.getCanvas().style.cursor = '';
      }
    }
    
    // Exit selection mode if active
    if (isSelectingGameArea) {
      setIsSelectingGameArea(false);
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


  // Helper function to create a circle polygon from center and radius (in meters)
  const createCirclePolygon = (center: [number, number], radiusMeters: number, numPoints = 32): [number, number][] => {
    const points: [number, number][] = [];
    const centerLat = center[1];
    
    // Convert meters to degrees (approximate, works well for small distances)
    // 1 degree latitude ≈ 111,000 meters
    // Longitude conversion depends on latitude
    const radiusLat = radiusMeters / 111000;
    const radiusLng = radiusMeters / (111000 * Math.cos(centerLat * Math.PI / 180));
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      const lat = centerLat + radiusLat * Math.sin(angle);
      const lng = center[0] + radiusLng * Math.cos(angle);
      points.push([lng, lat]);
    }
    
    // Close the polygon
    points.push(points[0]);
    return points;
  };

  // Organic cloud blob: radius varies smoothly by angle (deterministic from seed) for a natural, puffy shape
  const createCloudBlobPolygon = (
    center: [number, number],
    radiusMeters: number,
    numPoints: number,
    seed: number
  ): [number, number][] => {
    const points: [number, number][] = [];
    const centerLat = center[1];
    const radiusLat = radiusMeters / 111000;
    const radiusLng = radiusMeters / (111000 * Math.cos(centerLat * Math.PI / 180));
    const s1 = seed * 0.1;
    const s2 = seed * 0.17;
    const s3 = seed * 0.23;
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      // Smooth, billowy variation: combine several waves so outline is irregular but soft
      const n = 0.72 + 0.28 * (
        Math.sin(angle * 2 + s1) * 0.5 +
        Math.sin(angle * 4 + s2) * 0.3 +
        Math.sin(angle * 7 + s3) * 0.2
      );
      const r = Math.max(0.4, n);
      const lat = centerLat + radiusLat * r * Math.sin(angle);
      const lng = center[0] + radiusLng * r * Math.cos(angle);
      points.push([lng, lat]);
    }
    points.push(points[0]);
    return points;
  };

  // Start cloud brush mode
  const startCloudBrushMode = () => {
    if (!map.current) return;
    
    setIsCloudBrushMode(true);
    
    // Create preview circle source and layer
    if (!map.current.getSource('cloud-brush-preview')) {
      map.current.addSource('cloud-brush-preview', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[]]
          }
        }
      });
      
      map.current.addLayer({
        id: 'cloud-brush-preview',
        type: 'fill',
        source: 'cloud-brush-preview',
        paint: {
          'fill-color': '#4CAF50',
          'fill-opacity': 0.2
        }
      });
      
      map.current.addLayer({
        id: 'cloud-brush-preview-outline',
        type: 'line',
        source: 'cloud-brush-preview',
        paint: {
          'line-color': '#4CAF50',
          'line-width': 2,
          'line-opacity': 0.8
        }
      });
    }
    
    // Mouse move handler to update preview circle and dots
    const handleMouseMove = (e: mapboxgl.MapMouseEvent) => {
      setMousePosition(e.lngLat);
      
      // Update preview circle (use ref to get current brushSize to avoid stale closure)
      const currentBrushSize = brushSizeRef.current;
      const circle = createCirclePolygon([e.lngLat.lng, e.lngLat.lat], currentBrushSize);
      const source = map.current?.getSource('cloud-brush-preview') as mapboxgl.GeoJSONSource;
      if (source) {
        source.setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [circle]
          }
        });
      }
      
      // Show preview dots for where clouds would appear
      const previewClouds: GeoJSON.Feature[] = [];
      const brushArea = Math.PI * Math.pow(currentBrushSize, 2);
      const baseCloudDensity = 0.0001;
      const previewCount = Math.min(20, Math.floor(brushArea * baseCloudDensity)); // Max 20 preview dots
      
      for (let i = 0; i < previewCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * currentBrushSize;
        const centerLat = e.lngLat.lat;
        const radiusLat = distance / 111000;
        const radiusLng = distance / (111000 * Math.cos(centerLat * Math.PI / 180));
        const cloudLat = centerLat + radiusLat * Math.sin(angle);
        const cloudLng = e.lngLat.lng + radiusLng * Math.cos(angle);
        
        previewClouds.push({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [cloudLng, cloudLat]
          }
        });
      }
      
      // Update preview points source
      if (map.current) {
        if (!map.current.getSource('cloud-brush-preview-points')) {
          map.current.addSource('cloud-brush-preview-points', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: previewClouds
            }
          });
          
          map.current.addLayer({
            id: 'cloud-brush-preview-points',
            type: 'circle',
            source: 'cloud-brush-preview-points',
            paint: {
              'circle-radius': 4,
              'circle-color': '#4CAF50',
              'circle-opacity': 0.6
            }
          });
        } else {
          const pointsSource = map.current.getSource('cloud-brush-preview-points') as mapboxgl.GeoJSONSource;
          if (pointsSource) {
            pointsSource.setData({
              type: 'FeatureCollection',
              features: previewClouds
            });
          }
        }
      }
    };
    
    // Function to increment cloud at a specific position
    const incrementCloudAtPosition = (center: [number, number]) => {
      // Use ref to get current brushClouds to avoid stale closure
      const currentClouds = brushCloudsRef.current;
      
      // Check if there's already a cloud at this location (within 50m)
      const existingCloudIndex = currentClouds.findIndex(cloud => {
        const distance = Math.sqrt(
          Math.pow((cloud.center[0] - center[0]) * 111000 * Math.cos(center[1] * Math.PI / 180), 2) +
          Math.pow((cloud.center[1] - center[1]) * 111000, 2)
        );
        return distance < 50; // 50 meter threshold
      });
      
      if (existingCloudIndex >= 0) {
        // Increase click count for existing cloud
        const updatedClouds = [...currentClouds];
        updatedClouds[existingCloudIndex].clickCount += 1;
        brushCloudsRef.current = updatedClouds;
        setBrushClouds(updatedClouds);
      } else {
        // Create new cloud group (use ref to get current cloudHeight to avoid stale closure)
        const newCloud = {
          id: `brush-cloud-${Date.now()}-${Math.random()}`,
          center,
          size: 0, // Size will be calculated based on clickCount in generateCloudsFromBrush
          height: cloudHeightRef.current,
          clickCount: 1
        };
        const updatedClouds = [...currentClouds, newCloud];
        brushCloudsRef.current = updatedClouds;
        setBrushClouds(updatedClouds);
      }
      
      // Regenerate clouds (use ref to get current cloudsEnabled to avoid stale closure)
      if (cloudsEnabledRef.current) {
        addClouds();
      }
    };
    
    // Mouse down handler: only start cloud creation after a short hold (avoids double-click zoom)
    const HOLD_DELAY_MS = 200;
    const handleMouseDown = (e: mapboxgl.MapMouseEvent) => {
      const center: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      currentBrushPositionRef.current = center;
      isMouseDownRef.current = true;
      brushActiveRef.current = false;
      
      // Clear any previous hold timeout (e.g. from previous press)
      if (cloudBrushHoldTimeoutRef.current) {
        clearTimeout(cloudBrushHoldTimeoutRef.current);
        cloudBrushHoldTimeoutRef.current = null;
      }
      
      // Only start creating clouds after holding for HOLD_DELAY_MS (double-click zoom won't trigger)
      cloudBrushHoldTimeoutRef.current = setTimeout(() => {
        cloudBrushHoldTimeoutRef.current = null;
        if (!isMouseDownRef.current || !currentBrushPositionRef.current) return;
        brushActiveRef.current = true;
        brushIntensityAccumulatorRef.current = 0;
        incrementCloudAtPosition(currentBrushPositionRef.current);
        cloudBrushIntervalRef.current = setInterval(() => {
          if (!isMouseDownRef.current || !currentBrushPositionRef.current) return;
          const intensity = brushIntensityRef.current;
          brushIntensityAccumulatorRef.current += intensity;
          while (brushIntensityAccumulatorRef.current >= 1) {
            brushIntensityAccumulatorRef.current -= 1;
            incrementCloudAtPosition(currentBrushPositionRef.current);
          }
        }, 100);
      }, HOLD_DELAY_MS);
    };
    
    // Mouse up handler to stop continuous cloud creation
    const handleMouseUp = () => {
      if (cloudBrushHoldTimeoutRef.current) {
        clearTimeout(cloudBrushHoldTimeoutRef.current);
        cloudBrushHoldTimeoutRef.current = null;
      }
      brushActiveRef.current = false;
      isMouseDownRef.current = false;
      currentBrushPositionRef.current = null;
      
      if (cloudBrushIntervalRef.current) {
        clearInterval(cloudBrushIntervalRef.current);
        cloudBrushIntervalRef.current = null;
      }
    };
    
    // Mouse leave handler to stop cloud creation if mouse leaves map
    const handleMouseLeave = () => {
      handleMouseUp();
    };
    
    // Update mouse move to also create clouds while dragging
    const handleMouseMoveWithBrush = (e: mapboxgl.MapMouseEvent) => {
      // Call original mouse move handler for preview
      handleMouseMove(e);
      
      // If brush is active (held past delay), update position and create clouds while dragging
      if (brushActiveRef.current) {
        const center: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        currentBrushPositionRef.current = center;
        incrementCloudAtPosition(center);
      } else if (isMouseDownRef.current) {
        currentBrushPositionRef.current = [e.lngLat.lng, e.lngLat.lat];
      }
    };
    
    brushModeHandlersRef.current = { handleMouseMove: handleMouseMoveWithBrush, handleMouseDown, handleMouseUp, handleMouseLeave };
    
    map.current.on('mousemove', handleMouseMoveWithBrush);
    map.current.on('mousedown', handleMouseDown);
    map.current.on('mouseup', handleMouseUp);
    map.current.on('mouseleave', handleMouseLeave);
    
    // Change cursor
    if (map.current.getCanvas()) {
      map.current.getCanvas().style.cursor = 'crosshair';
    }
  };

  // Stop cloud brush mode
  const stopCloudBrushMode = () => {
    if (!map.current) return;
    
    setIsCloudBrushMode(false);
    setMousePosition(null);
    
    if (cloudBrushHoldTimeoutRef.current) {
      clearTimeout(cloudBrushHoldTimeoutRef.current);
      cloudBrushHoldTimeoutRef.current = null;
    }
    if (cloudBrushIntervalRef.current) {
      clearInterval(cloudBrushIntervalRef.current);
      cloudBrushIntervalRef.current = null;
    }
    brushActiveRef.current = false;
    isMouseDownRef.current = false;
    currentBrushPositionRef.current = null;
    
    // Remove event listeners
    if (brushModeHandlersRef.current.handleMouseMove) {
      map.current.off('mousemove', brushModeHandlersRef.current.handleMouseMove);
    }
    if (brushModeHandlersRef.current.handleMouseDown) {
      map.current.off('mousedown', brushModeHandlersRef.current.handleMouseDown);
    }
    if (brushModeHandlersRef.current.handleMouseUp) {
      map.current.off('mouseup', brushModeHandlersRef.current.handleMouseUp);
    }
    if (brushModeHandlersRef.current.handleMouseLeave) {
      map.current.off('mouseleave', brushModeHandlersRef.current.handleMouseLeave);
    }
    
    brushModeHandlersRef.current = {};
    
    // Remove preview layers
    if (map.current.getLayer('cloud-brush-preview-points')) {
      map.current.removeLayer('cloud-brush-preview-points');
    }
    if (map.current.getLayer('cloud-brush-preview-outline')) {
      map.current.removeLayer('cloud-brush-preview-outline');
    }
    if (map.current.getLayer('cloud-brush-preview')) {
      map.current.removeLayer('cloud-brush-preview');
    }
    if (map.current.getSource('cloud-brush-preview-points')) {
      map.current.removeSource('cloud-brush-preview-points');
    }
    if (map.current.getSource('cloud-brush-preview')) {
      map.current.removeSource('cloud-brush-preview');
    }
    
    // Reset cursor
    if (map.current.getCanvas()) {
      map.current.getCanvas().style.cursor = '';
    }
  };

  // Add stars for night sky
  const addStars = useCallback(() => {
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
  }, []); // generateStars is stable, map.current is a ref

  // Remove stars
  const removeStars = useCallback(() => {
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
  }, []); // map.current is a ref

  // Generate clouds for a single brush cloud (for caching and incremental updates)
  // Positions are FIXED on first click - only size changes on subsequent clicks
  const generateCloudsForBrushCloud = useCallback((
    brushCloud: { id: string; center: [number, number]; size: number; height: number; clickCount: number },
    brushSizeMeters: number,
    detail: number
  ): GeoJSON.Feature[] => {
    const clouds: GeoJSON.Feature[] = [];
    
    // Check if we have cached positions (from first click)
    const cached = cloudCacheRef.current.get(brushCloud.id);
    let cloudPositions: Array<{ lng: number; lat: number }>;
    let numClouds: number;
    
    if (cached && cached.cloudPositions && cached.numClouds && cached.cloudPositions.length > 0) {
      // Use cached positions (fixed positions from first click)
      cloudPositions = cached.cloudPositions;
      numClouds = cached.numClouds;
    } else {
      // First click: generate fixed positions based on brush size only (not clickCount)
      const brushArea = Math.PI * Math.pow(brushSizeMeters, 2); // Area in square meters
      const baseCloudDensity = 0.000002; // Reduced density: ~6-7 clouds on first click with 1000m brush
      numClouds = Math.max(1, Math.floor(brushArea * baseCloudDensity)); // Fixed number based on area only
      
      // Use seeded random based on brushCloud.id to ensure fixed positions
      const seed = brushCloud.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const random = seededRandom(seed);
      cloudPositions = [];
      
      const centerLat = brushCloud.center[1];
      for (let i = 0; i < numClouds; i++) {
        // Generate fixed positions using seeded random
        const angle = random() * Math.PI * 2;
        const distance = random() * brushSizeMeters;
        const radiusLat = distance / 111000;
        const radiusLng = distance / (111000 * Math.cos(centerLat * Math.PI / 180));
        const cloudLat = centerLat + radiusLat * Math.sin(angle);
        const cloudLng = brushCloud.center[0] + radiusLng * Math.cos(angle);
        cloudPositions.push({ lng: cloudLng, lat: cloudLat });
      }
      
      // Store positions and numClouds in cache immediately
      const existingCache = cloudCacheRef.current.get(brushCloud.id);
      if (existingCache) {
        existingCache.cloudPositions = cloudPositions;
        existingCache.numClouds = numClouds;
      } else {
        cloudCacheRef.current.set(brushCloud.id, {
          features: [],
          brushCloud: { ...brushCloud },
          brushSize: brushSizeMeters,
          cloudPolygonDetail: detail,
          cloudPositions: cloudPositions,
          numClouds: numClouds
        });
      }
    }
    
    // Cloud size scales with clickCount: starts at 60m, grows by 40m per click
    // clickCount 1: 60m, 2: 100m, 3: 140m, 4: 180m, 5: 220m, etc.
    const baseCloudSize = 60; // Starting size in meters
    const cloudSizeGrowth = 40; // Size increase per click in meters
    const cloudSize = baseCloudSize + (brushCloud.clickCount - 1) * cloudSizeGrowth;
    
    // Cloud thickness scales with clickCount: starts at 10m, grows per click, max 500m
    const baseThickness = 10; // Starting thickness in meters
    const thicknessGrowth = 55; // Thickness increase per click in meters
    const maxThickness = 500; // Maximum thickness (current max)
    const cloudThickness = Math.min(baseThickness + (brushCloud.clickCount - 1) * thicknessGrowth, maxThickness);
    
    // Generate clouds at fixed positions with updated sizes (organic blob + optional second puff)
    const centerLat = brushCloud.center[1];
    for (let i = 0; i < numClouds; i++) {
      const position = cloudPositions[i];
      const seed = brushCloud.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) + i * 31;
      const rand = seededRandom(seed);
      // Main organic blob
      const cloudPolygon = createCloudBlobPolygon([position.lng, position.lat], cloudSize, detail, seed);
      clouds.push({
        type: 'Feature',
        id: `${brushCloud.id}-${i}`,
        properties: {
          id: `${brushCloud.id}-${i}`,
          opacity: cloudOpacityRef.current,
          baseAltitude: brushCloud.height,
          height: cloudThickness
        },
        geometry: {
          type: 'Polygon',
          coordinates: [cloudPolygon]
        }
      });
      // Second smaller blob offset for a more natural, billowy look
      const offsetDist = cloudSize * (0.25 + 0.2 * rand());
      const offsetAngle = rand() * Math.PI * 2;
      const radiusLat = offsetDist / 111000;
      const radiusLng = offsetDist / (111000 * Math.cos(centerLat * Math.PI / 180));
      const puffLng = position.lng + radiusLng * Math.cos(offsetAngle);
      const puffLat = position.lat + radiusLat * Math.sin(offsetAngle);
      const puffPolygon = createCloudBlobPolygon([puffLng, puffLat], cloudSize * 0.6, detail, seed + 1);
      clouds.push({
        type: 'Feature',
        id: `${brushCloud.id}-${i}-puff`,
        properties: {
          id: `${brushCloud.id}-${i}-puff`,
          opacity: cloudOpacityRef.current,
          baseAltitude: brushCloud.height,
          height: cloudThickness * 0.85
        },
        geometry: {
          type: 'Polygon',
          coordinates: [puffPolygon]
        }
      });
    }
    
    return clouds;
  }, []); // cloudOpacity accessed via ref

  // Generate clouds from brush mode clicks (with caching support)
  const generateCloudsFromBrush = useCallback((brushCloudsData: Array<{
    id: string;
    center: [number, number];
    size: number;
    height: number;
    clickCount: number;
  }>, brushSizeMeters: number, useCache = true) => {
    const clouds: GeoJSON.Feature[] = [];
    const currentDetail = cloudPolygonDetail;
    
    brushCloudsData.forEach((brushCloud) => {
      // Check cache first if enabled - but don't use cached features if clickCount changed
      // (we need to regenerate with new sizes but same positions)
      if (useCache) {
        const cacheKey = brushCloud.id;
        const cached = cloudCacheRef.current.get(cacheKey);
        
        // Only use cached features if clickCount hasn't changed (positions are the same)
        // If clickCount changed, we still regenerate to update sizes but use cached positions
        if (cached && 
            cached.brushCloud.clickCount === brushCloud.clickCount &&
            cached.brushSize === brushSizeMeters &&
            cached.cloudPolygonDetail === currentDetail &&
            cached.brushCloud.height === brushCloud.height) {
          clouds.push(...cached.features);
          return;
        }
      }
      
      // Generate new clouds for this brush cloud (will use cached positions if available)
      const newClouds = generateCloudsForBrushCloud(brushCloud, brushSizeMeters, currentDetail);
      clouds.push(...newClouds);
      
      // Get positions and numClouds from cache (they were stored during generation)
      const cached = cloudCacheRef.current.get(brushCloud.id);
      
      // Update cache
      if (useCache) {
        cloudCacheRef.current.set(brushCloud.id, {
          features: newClouds,
          brushCloud: { ...brushCloud },
          brushSize: brushSizeMeters,
          cloudPolygonDetail: currentDetail,
          cloudPositions: cached?.cloudPositions || [],
          numClouds: cached?.numClouds || newClouds.length
        });
      }
    });
    
    return {
      type: 'FeatureCollection' as const,
      features: clouds
    };
  }, [cloudPolygonDetail, generateCloudsForBrushCloud]); // cloudOpacity accessed via ref


  // Add clouds to the map (optimized with incremental updates and setData)
  const addClouds = useCallback((forceRegenerate = false) => {
    if (map.current && map.current.isStyleLoaded()) {
      try {
        const source = map.current.getSource('clouds') as mapboxgl.GeoJSONSource | null;
        const layer = map.current.getLayer('clouds');
        const currentBrushSize = brushSizeRef.current;
        
        // Generate clouds from brush mode
        if (brushClouds.length === 0) {
          // Remove clouds if no brush clouds exist
          if (layer) {
            map.current.removeLayer('clouds');
          }
          if (source) {
            map.current.removeSource('clouds');
          }
          cloudCacheRef.current.clear();
          lastBrushCloudsRef.current = [];
          console.log('No clouds to display');
          return;
        }
        
        // Detect new and changed brush clouds for incremental updates
        const lastBrushClouds = lastBrushCloudsRef.current;
        const brushCloudsMap = new globalThis.Map<string, typeof brushClouds[0]>(brushClouds.map(bc => [bc.id, bc]));
        const lastBrushCloudsMap = new globalThis.Map<string, typeof lastBrushClouds[0]>(lastBrushClouds.map(bc => [bc.id, bc]));
        
        // Find new brush clouds (not in last state)
        const newBrushClouds = brushClouds.filter(bc => !lastBrushCloudsMap.has(bc.id));
        
        // Find changed brush clouds (exists but parameters changed)
        const changedBrushClouds = brushClouds.filter(bc => {
          const last = lastBrushCloudsMap.get(bc.id);
          if (!last) return false;
          return last.clickCount !== bc.clickCount || 
                 last.height !== bc.height ||
                 Math.abs(lastBrushCloudsMap.get(bc.id)!.size - bc.size) > 0.001;
        });
        
        // Find removed brush clouds (in last state but not in current)
        const removedBrushCloudIds = lastBrushClouds
          .filter(bc => !brushCloudsMap.has(bc.id))
          .map(bc => bc.id);
        
        // If source exists, use incremental update
        if (source && layer && !forceRegenerate) {
          // Get current data
          const currentData = source._data as GeoJSON.FeatureCollection;
          const currentFeatures = currentData?.features || [];
          
          // Remove features for deleted brush clouds
          const featuresToKeep = currentFeatures.filter((feature: GeoJSON.Feature) => {
            const brushCloudId = feature.id?.toString().split('-')[0];
            return !removedBrushCloudIds.includes(brushCloudId || '');
          });
          
          // Remove cached entries for deleted brush clouds
          removedBrushCloudIds.forEach(id => cloudCacheRef.current.delete(id));
          
          // Generate new clouds for new brush clouds
          const newClouds: GeoJSON.Feature[] = [];
          newBrushClouds.forEach(brushCloud => {
            const clouds = generateCloudsForBrushCloud(brushCloud, currentBrushSize, cloudPolygonDetail);
            newClouds.push(...clouds);
            // Cache the generated clouds (positions already stored during generation)
            const existingCache = cloudCacheRef.current.get(brushCloud.id);
            cloudCacheRef.current.set(brushCloud.id, {
              features: clouds,
              brushCloud: { ...brushCloud },
              brushSize: currentBrushSize,
              cloudPolygonDetail: cloudPolygonDetail,
              cloudPositions: existingCache?.cloudPositions || [],
              numClouds: existingCache?.numClouds || clouds.length
            });
          });
          
          // Regenerate clouds for changed brush clouds
          const changedClouds: GeoJSON.Feature[] = [];
          const changedFeatureIds = new Set<string>();
          changedBrushClouds.forEach(brushCloud => {
            // Remove old cached features
            const oldFeatures = cloudCacheRef.current.get(brushCloud.id)?.features || [];
            oldFeatures.forEach(f => {
              if (f.id) changedFeatureIds.add(f.id.toString());
            });
            
            // Generate new clouds
            const clouds = generateCloudsForBrushCloud(brushCloud, currentBrushSize, cloudPolygonDetail);
            changedClouds.push(...clouds);
            
            // Update cache (positions already stored during generation)
            const existingCache = cloudCacheRef.current.get(brushCloud.id);
            cloudCacheRef.current.set(brushCloud.id, {
              features: clouds,
              brushCloud: { ...brushCloud },
              brushSize: currentBrushSize,
              cloudPolygonDetail: cloudPolygonDetail,
              cloudPositions: existingCache?.cloudPositions || [],
              numClouds: existingCache?.numClouds || clouds.length
            });
          });
          
          // Remove old features for changed brush clouds
          const filteredFeatures = featuresToKeep.filter((feature: GeoJSON.Feature) => {
            const featureId = feature.id?.toString();
            return !changedFeatureIds.has(featureId || '');
          });
          
          // Combine all features
          const allFeatures = [...filteredFeatures, ...newClouds, ...changedClouds];
          
          // Update source with setData (much faster than remove/add)
          source.setData({
            type: 'FeatureCollection',
            features: allFeatures
          });
          
          console.log(`Clouds updated incrementally: ${newClouds.length} new, ${changedClouds.length} changed, ${removedBrushCloudIds.length} removed`);
        } else {
          // Initial load or force regenerate: generate all clouds
          const cloudData = generateCloudsFromBrush(brushClouds, currentBrushSize, false); // Don't use cache on full regenerate
          
          if (source && layer) {
            // Source exists, just update data
            source.setData(cloudData);
          } else {
            // Source doesn't exist, create it
            map.current.addSource('clouds', {
              type: 'geojson',
              data: cloudData
            });
            
            // Add 3D cloud layer above buildings but below sky
            const beforeLayer = map.current.getLayer('sky') ? 'sky' : undefined;
            map.current.addLayer({
              id: 'clouds',
              type: 'fill-extrusion',
              source: 'clouds',
              paint: {
                'fill-extrusion-color': cloudColorRef.current,
                'fill-extrusion-opacity': cloudOpacityRef.current,
                'fill-extrusion-base': ['get', 'baseAltitude'] as any,
                'fill-extrusion-height': ['+', ['get', 'baseAltitude'], ['get', 'height']] as any,
                'fill-extrusion-vertical-gradient': true
              } as any
            }, beforeLayer);
          }
          
          console.log('Clouds generated:', cloudData.features.length, 'features');
        }
        
        // Update last brush clouds state
        lastBrushCloudsRef.current = brushClouds.map(bc => ({ ...bc }));
        
      } catch (error) {
        console.error('Error adding clouds:', error);
      }
    }
  }, [brushClouds, brushSize, generateCloudsFromBrush, generateCloudsForBrushCloud, cloudPolygonDetail]); // cloudOpacity, cloudColor, cloudHeight accessed via refs

  // Remove clouds from the map
  const removeClouds = useCallback(() => {
    if (map.current && map.current.isStyleLoaded()) {
      try {
        if (map.current.getLayer('clouds')) {
          map.current.removeLayer('clouds');
        }
        if (map.current.getSource('clouds')) {
          map.current.removeSource('clouds');
        }
        if (cloudAnimationRef.current) {
          clearTimeout(cloudAnimationRef.current);
          cloudAnimationRef.current = null;
        }
        console.log('Clouds removed');
      } catch (error) {
        console.error('Error removing clouds:', error);
      }
    }
  }, []);

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
      
      // Cycle: 0-37.5% = First half (90° azimuth, 90° to 70° elevation), 37.5-75% = Second half (180° azimuth, 70° to 90° elevation), 75-100% = Night (no sun)
      let newAzimuth, newElevation;
      let newHaloOpacity = 1.0;
      
      if (progress < 0.375) {
        // First half (0 to 37.5%): Azimuth 90° (East), Elevation goes from 90° to 70°
        const halfProgress = progress / 0.375; // 0 to 1 within first half
        newElevation = 90 - (halfProgress * 20); // 90° to 70°
        newAzimuth = 90;
        
        // Halo: Disappear from 80° to 70°
        if (newElevation <= 80) {
          const fadeProgress = (80 - newElevation) / 10; // 0 at 80°, 1 at 70°
          newHaloOpacity = 1.0 - fadeProgress;
        }
      } else if (progress < 0.75) {
        // Second half (37.5 to 75%): Azimuth 180° (South), Elevation goes from 70° to 90°
        const halfProgress = (progress - 0.375) / 0.375; // 0 to 1 within second half
        newElevation = 70 + (halfProgress * 20); // 70° to 90°
        newAzimuth = 180;
        
        // Halo: Appear from 70° to 80°
        if (newElevation <= 80) {
          const fadeProgress = (newElevation - 70) / 10; // 0 at 70°, 1 at 80°
          newHaloOpacity = fadeProgress;
        }
      } else {
        // Night (75 to 100%): Hide the sun
        newAzimuth = 0;
        newElevation = -90; // Position sun below horizon
        newHaloOpacity = 0;
      }
      
      // Update state
      setSunAzimuth(newAzimuth);
      setSunElevation(newElevation);
      setHaloOpacity(newHaloOpacity);
      
      // Apply sky properties immediately for smooth animation even during map interaction
      if (map.current && map.current.isStyleLoaded()) {
        try {
          map.current.setPaintProperty('sky', 'sky-atmosphere-sun', [newAzimuth, newElevation]);
          
          // Apply halo color with current opacity (use ref to get latest value)
          const rgb = haloColorRef.current.replace('#', '').match(/.{2}/g)?.map(x => parseInt(x, 16)) || [255, 255, 255];
          const haloColorWithOpacity = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${newHaloOpacity})`;
          map.current.setPaintProperty('sky', 'sky-atmosphere-halo-color', haloColorWithOpacity);
          
          map.current.triggerRepaint();
        } catch (error) {
          // Ignore errors during animation
        }
      }

      // Continue animation
      sunCycleIntervalRef.current = setTimeout(animate, 50); // Update every 50ms for smooth animation
    };

    animate();
  };


  // Function to apply sky layer properties
  const applySkyProperties = useCallback(() => {
    if (map.current && map.current.isStyleLoaded()) {
      try {
        // Apply sky layer type
        map.current.setPaintProperty('sky', 'sky-type', skyLayerType);
        
        // Apply gradient radius
        map.current.setPaintProperty('sky', 'sky-gradient-radius', skyGradientRadius);
        
        // Apply sun properties with enhanced intensity for visible atmosphere
        map.current.setPaintProperty('sky', 'sky-atmosphere-sun', [sunAzimuth, sunElevation]);
        // Use higher intensity floor so atmosphere stays bright and cheerful (not gloomy)
        const currentZoom = map.current.getZoom();
        const minBrightIntensity = 4; // Keep sky clearly daytime even at low slider
        const enhancedIntensity = currentZoom < 5 ? Math.max(sunIntensity * 1.5, minBrightIntensity) : Math.max(sunIntensity, minBrightIntensity);
        map.current.setPaintProperty('sky', 'sky-atmosphere-sun-intensity', enhancedIntensity);
        
        // Apply halo color with current opacity
        const rgb = haloColor.replace('#', '').match(/.{2}/g)?.map(x => parseInt(x, 16)) || [255, 255, 255];
        const haloColorWithOpacity = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${haloOpacity})`;
        map.current.setPaintProperty('sky', 'sky-atmosphere-halo-color', haloColorWithOpacity);
        
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
  }, [skyLayerType, skyGradientRadius, sunAzimuth, sunElevation, sunIntensity, haloColor, haloOpacity, atmosphereColor, backgroundColor, backgroundOpacity]);

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
      
      // Check if we should force space view based on zoom (starts at zoom 9)
      const currentZoom = currentMap.getZoom();
      const shouldForceSpaceView = currentZoom < 9;
      
      if (shouldForceSpaceView || skyLayerType === 'atmosphere') {
        // Use atmosphere sky type – halo with opacity for soft, natural sun glow
        const haloRgb = haloColorRef.current.replace('#', '').match(/.{2}/g)?.map(x => parseInt(x, 16)) || [255, 251, 240];
        const haloColorRgba = `rgba(${haloRgb[0]}, ${haloRgb[1]}, ${haloRgb[2]}, ${haloOpacityRef.current})`;
        currentMap.addLayer({
          'id': 'sky',
          'type': 'sky',
          'paint': {
            'sky-type': 'atmosphere',
            'sky-atmosphere-sun': [sunAzimuthRef.current, sunElevationRef.current],
            'sky-atmosphere-sun-intensity': sunIntensityRef.current,
            'sky-atmosphere-halo-color': haloColorRgba,
            'sky-atmosphere-color': atmosphereColorRef.current,
            'sky-opacity': 1.0
          } as any
        });
        
        // Set background - force black for space view
        const bgColor = shouldForceSpaceView ? '#000000' : backgroundColorRef.current;
        if (currentMap.getLayer('background')) {
          currentMap.setPaintProperty('background', 'background-color', bgColor);
        } else {
          currentMap.addLayer({
            'id': 'background',
            'type': 'background',
            'paint': { 'background-color': bgColor }
          }, 'sky');
        }
      } else if (!shouldForceSpaceView && skyType === 'blue') {
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
      } else if (!shouldForceSpaceView && skyType === 'evening') {
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
      } else if (!shouldForceSpaceView && skyType === 'night') {
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
      } else if (!shouldForceSpaceView && skyType === 'sunrise') {
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
  }, [layers3D, style, terrainExaggeration, skyLayerType, skyType, buildingColor, addStars, removeStars]);
  // Note: Removed sunAzimuth, sunElevation, sunIntensity, haloColor, atmosphereColor, backgroundColor
  // from dependencies because these are updated during sun cycle animation and should not
  // trigger full layer re-initialization. They are updated via applySkyProperties instead.

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
  }, [buildingColor, updateBuildingColors]);

  // Apply sky properties when they change
  useEffect(() => {
    if (map.current && map.current.isStyleLoaded()) {
      applySkyProperties();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skyLayerType, skyGradientRadius, sunAzimuth, sunElevation, sunIntensity, sunColor, haloColor, haloOpacity, atmosphereColor, backgroundColor, backgroundOpacity]); // applySkyProperties excluded - it depends on the same variables above

  // Auto-start sun cycle when enabled by default
  useEffect(() => {
    if (map.current && map.current.isStyleLoaded() && isSunCycleEnabled && !isCycleRunningRef.current) {
      // Wait a bit for everything to initialize, then start
      setTimeout(() => {
        if (map.current && isSunCycleEnabled && !isCycleRunningRef.current) {
          isCycleRunningRef.current = true;
          startSunCycle();
        }
      }, 1500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSunCycleEnabled]); // map.current is a ref, startSunCycle is stable

  // Restart sun cycle when duration changes
  useEffect(() => {
    if (isCycleRunningRef.current) {
      startSunCycle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sunCycleDuration]); // startSunCycle is stable

  // Cleanup sun cycle on unmount
  useEffect(() => {
    return () => {
      isCycleRunningRef.current = false;
      if (sunCycleIntervalRef.current) {
        clearTimeout(sunCycleIntervalRef.current);
      }
    };
  }, []);




  // Keep drawRef in sync with draw state
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // Cleanup effect for draw control
  useEffect(() => {
    return () => {
      const currentDraw = drawRef.current;
      if (currentDraw && map.current) {
        try {
          map.current.removeControl(currentDraw);
        } catch (error) {
          console.log('Error removing draw control during cleanup:', error);
        }
      }
    };
  }, []); // draw accessed via ref

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
                console.log('Auto-converting new dark overlay to vibrant blue:', element);
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
        if (!map.current) return closest;
        const keyframePoint = map.current.project([keyframe.position[0], keyframe.position[1]]);
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


  // Implement Mapbox Features - Navigation Controls
  useEffect(() => {
    if (!map.current) return;

    // Wait for style to load
    const setupControls = () => {
      try {
        // Remove existing controls
        if (navControlRef.current && map.current) {
          try { map.current.removeControl(navControlRef.current); } catch (e) {
            // Control may not exist, ignore error
          }
          navControlRef.current = null;
        }
        if (geolocateControlRef.current && map.current) {
          try { map.current.removeControl(geolocateControlRef.current); } catch (e) {
            // Control may not exist, ignore error
          }
          geolocateControlRef.current = null;
        }
        if (fullscreenControlRef.current && map.current) {
          try { map.current.removeControl(fullscreenControlRef.current); } catch (e) {
            // Control may not exist, ignore error
          }
          fullscreenControlRef.current = null;
        }
        if (scaleControlRef.current && map.current) {
          try { map.current.removeControl(scaleControlRef.current); } catch (e) {
            // Control may not exist, ignore error
          }
          scaleControlRef.current = null;
        }

        // Add navigation controls based on state
        if (!map.current) return;
        
        if (showZoomControls || showCompass || showRotationControls || showPitchControls) {
          const navControl = new mapboxgl.NavigationControl({
            showZoom: showZoomControls,
            showCompass: showCompass,
            visualizePitch: showPitchControls
          });
          map.current.addControl(navControl, 'top-right');
          navControlRef.current = navControl;
        }

        if (showGeolocation) {
          const geolocate = new mapboxgl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: true
          });
          map.current.addControl(geolocate, 'top-right');
          geolocateControlRef.current = geolocate;
        }

        if (showFullscreen) {
          const fullscreen = new mapboxgl.FullscreenControl();
          map.current.addControl(fullscreen, 'top-right');
          fullscreenControlRef.current = fullscreen;
        }

        if (showScale) {
          const scale = new mapboxgl.ScaleControl();
          map.current.addControl(scale, 'bottom-right');
          scaleControlRef.current = scale;
        }
      } catch (e) {
        console.warn('Error managing navigation controls:', e);
      }
    };

    if (map.current.isStyleLoaded()) {
      setupControls();
    } else {
      map.current.once('style.load', setupControls);
    }

    return () => {
      const currentMap = map.current as MapboxMapWithInternal | null;
      if (currentMap && !currentMap._removed) {
        try {
          if (navControlRef.current) currentMap.removeControl(navControlRef.current);
          if (geolocateControlRef.current) currentMap.removeControl(geolocateControlRef.current);
          if (fullscreenControlRef.current) currentMap.removeControl(fullscreenControlRef.current);
          if (scaleControlRef.current) currentMap.removeControl(scaleControlRef.current);
        } catch (e) {
          // Controls may not exist, ignore error
        }
      }
    };
  }, [showZoomControls, showCompass, showRotationControls, showPitchControls, showGeolocation, showFullscreen, showScale]);

  // Keep brushCloudsRef in sync with brushClouds state
  useEffect(() => {
    brushCloudsRef.current = brushClouds;
  }, [brushClouds]);

  // Keep cloud parameter refs in sync with state
  useEffect(() => {
    cloudHeightRef.current = cloudHeight;
    cloudOpacityRef.current = cloudOpacity;
    cloudColorRef.current = cloudColor;
    brushSizeRef.current = brushSize;
    brushIntensityRef.current = brushIntensity;
    cloudsEnabledRef.current = cloudsEnabled;
  }, [cloudHeight, cloudOpacity, cloudColor, brushSize, brushIntensity, cloudsEnabled]);

  // Implement Clouds
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    
    if (cloudsEnabled) {
      addClouds();
    } else {
      removeClouds();
    }
    
    return () => {
      if (!cloudsEnabled) {
        removeClouds();
      }
    };
  }, [cloudsEnabled, addClouds, removeClouds]);

  // Update cloud properties when they change
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded() || !cloudsEnabled) return;
    
    try {
      if (map.current.getLayer('clouds')) {
        map.current.setPaintProperty('clouds', 'fill-extrusion-color', cloudColor);
        map.current.setPaintProperty('clouds', 'fill-extrusion-opacity', cloudOpacity);
      }
    } catch (error) {
      console.error('Error updating cloud properties:', error);
    }
  }, [cloudColor, cloudOpacity, cloudsEnabled]);

  // Regenerate clouds when height or polygons change
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded() || !cloudsEnabled) return;
    
    // Small delay to avoid too frequent updates
    const timeoutId = setTimeout(() => {
      addClouds();
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [cloudHeight, brushClouds, brushSize, cloudsEnabled, addClouds]); // Note: addClouds handles debouncing internally for parameter changes

  // Implement Fog (careful not to interfere with sky)
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    
    try {
      if (fogEnabled && map.current.getLayer('sky')) {
        // Only add fog if sky exists and we want fog
        const fogLayer = map.current.getLayer('fog');
        if (!fogLayer) {
          // Fog layer type is valid but may not be in types
          const mapWithFog = map.current as mapboxgl.Map & {
            addLayer: (layer: unknown, beforeId?: string) => void;
            setPaintProperty: (layer: string, property: string, value: unknown) => void;
          };
          mapWithFog.addLayer({
            id: 'fog',
            type: 'fog',
            paint: {
              'fog-color': fogColor,
              'fog-high-color': fogHighColor,
              'fog-space-color': fogSpaceColor,
              'fog-star-intensity': fogStarIntensity,
              'fog-range': fogRange,
              'fog-horizon-blend': 0.1
            }
          }, 'sky');
        } else {
          const mapWithFog = map.current as mapboxgl.Map & {
            setPaintProperty: (layer: string, property: string, value: unknown) => void;
          };
          mapWithFog.setPaintProperty('fog', 'fog-color', fogColor);
          mapWithFog.setPaintProperty('fog', 'fog-high-color', fogHighColor);
          mapWithFog.setPaintProperty('fog', 'fog-space-color', fogSpaceColor);
          mapWithFog.setPaintProperty('fog', 'fog-star-intensity', fogStarIntensity);
          mapWithFog.setPaintProperty('fog', 'fog-range', fogRange);
        }
      } else {
        // Remove fog layer if disabled
        if (map.current.getLayer('fog')) {
          map.current.removeLayer('fog');
        }
      }
    } catch (e) {
      console.warn('Fog layer management error:', e);
    }
  }, [fogEnabled, fogColor, fogHighColor, fogSpaceColor, fogStarIntensity, fogRange]);

  // Implement Terrain
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    
    try {
      if (terrainEnabled && terrainSource === 'mapbox-dem') {
        // Check if source exists, if not add it
        if (!map.current.getSource('mapbox-dem')) {
          map.current.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14
          });
        }
        
        // Set terrain with current exaggeration
        // Note: setTerrain is available in mapbox-gl but may not be in types
        const mapWithTerrain = map.current as mapboxgl.Map & { setTerrain?: (terrain: { source: string; exaggeration: number } | null) => void };
        if (mapWithTerrain.setTerrain) {
          mapWithTerrain.setTerrain({ 
          source: 'mapbox-dem', 
          exaggeration: terrainExaggeration 
        });
        }
      } else {
        // Remove terrain if disabled
        const mapWithTerrain = map.current as mapboxgl.Map & { setTerrain?: (terrain: { source: string; exaggeration: number } | null) => void };
        if (mapWithTerrain.setTerrain) {
          mapWithTerrain.setTerrain(null);
        }
      }
    } catch (e) {
      console.warn('Terrain management error:', e);
    }
  }, [terrainEnabled, terrainSource, terrainExaggeration]);

  // Implement Layer Visibility
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    
    const toggleLayerVisibility = (layerId: string, visible: boolean) => {
      try {
        if (!map.current) return;
        const layer = map.current.getLayer(layerId);
        if (layer) {
          map.current.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
        }
      } catch (e) {
        // Layer might not exist in current style
      }
    };

    const style = map.current.getStyle();
    if (style && style.layers) {
      style.layers.forEach((layer: any) => {
        const layerId = layer.id.toLowerCase();
        
        // Traffic layers
        if (layerId.includes('traffic')) {
          toggleLayerVisibility(layer.id, trafficLayerVisible);
        }
        // Transit layers (but not transit labels - those are handled separately)
        if (layerId.includes('transit') && layer.type !== 'symbol') {
          toggleLayerVisibility(layer.id, transitLayerVisible);
        }
        // Water layers (but not labels or boundaries)
        if ((layerId.includes('water') || layerId.includes('ocean') || layerId.includes('sea')) && 
            !layerId.includes('label') && !layerId.includes('boundary') && layer.type !== 'symbol') {
          toggleLayerVisibility(layer.id, waterLayerVisible);
        }
        // Landuse layers
        if (layerId.includes('landuse') || layerId.includes('landcover')) {
          toggleLayerVisibility(layer.id, landuseLayerVisible);
        }
        // Place labels (city, town, etc.)
        if ((layerId.includes('place') || layerId.includes('city') || layerId.includes('town')) && 
            layer.type === 'symbol') {
          toggleLayerVisibility(layer.id, placeLabelsVisible);
        }
        // POI labels
        if (layerId.includes('poi') && layer.type === 'symbol') {
          toggleLayerVisibility(layer.id, poiLabelsVisible);
        }
        // Road labels
        if (layerId.includes('road') && layerId.includes('label') && layer.type === 'symbol') {
          toggleLayerVisibility(layer.id, roadLabelsVisible);
        }
        // Transport labels
        if (layerId.includes('transit') && layer.type === 'symbol') {
          toggleLayerVisibility(layer.id, transportLabelsVisible);
        }
      });
    }
  }, [trafficLayerVisible, transitLayerVisible, waterLayerVisible, landuseLayerVisible, placeLabelsVisible, poiLabelsVisible, roadLabelsVisible, transportLabelsVisible]); // All dependencies included

  // Re-run layer visibility when style loads
  useEffect(() => {
    if (!map.current) return;
    
    const handleStyleLoad = () => {
      // Trigger layer visibility update by setting state (will trigger the useEffect above)
      if (map.current && map.current.isStyleLoaded()) {
        // Force a re-render of layer visibility
        setTimeout(() => {
          setTrafficLayerVisible(trafficLayerVisible);
        }, 100);
      }
    };

    map.current.on('style.load', handleStyleLoad);
    return () => {
      const currentMap = map.current as MapboxMapWithInternal | null;
      if (currentMap && !currentMap._removed) {
        currentMap.off('style.load', handleStyleLoad);
      }
    };
  }, []);

  // Implement 3D Buildings
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    
    try {
      const currentMap = map.current;
      if (!currentMap) return;
      const style = currentMap.getStyle();
      if (style && style.layers) {
        style.layers.forEach((layer: any) => {
          if (layer.type === 'fill-extrusion') {
            const layerId = layer.id.toLowerCase();
            if (layerId.includes('building') || layerId.includes('extrusion')) {
              currentMap.setLayoutProperty(layer.id, 'visibility', buildings3DEnabled ? 'visible' : 'none');
              
              // Get current height expression or use buildingExtrusionHeight
              const currentHeight = layer.paint?.['fill-extrusion-height'];
              if (buildingExtrusionHeight > 0 && typeof currentHeight === 'number') {
                // If it's a simple number, we can override it
                currentMap.setPaintProperty(layer.id, 'fill-extrusion-height', buildingExtrusionHeight);
              } else if (buildingExtrusionHeight > 0) {
                // If it's an expression (like ['get', 'height']), we can't easily override
                // But we can set a base height
                try {
                  currentMap.setPaintProperty(layer.id, 'fill-extrusion-base', 0);
                } catch (e) {
                  // Ignore if can't set base
                }
              }
              currentMap.setPaintProperty(layer.id, 'fill-extrusion-opacity', buildingOpacity);
            }
          }
        });
      }
    } catch (e) {
      console.warn('3D Building management error:', e);
    }
  }, [buildings3DEnabled, buildingExtrusionHeight, buildingOpacity]); // All dependencies included

  // Re-run 3D buildings when style loads
  useEffect(() => {
    if (!map.current) return;
    
    const handleStyleLoad = () => {
      if (map.current && map.current.isStyleLoaded()) {
        setTimeout(() => {
          setBuildings3DEnabled(buildings3DEnabled);
        }, 100);
      }
    };

    map.current.on('style.load', handleStyleLoad);
    return () => {
      const currentMap = map.current as MapboxMapWithInternal | null;
      if (currentMap && !currentMap._removed) {
        currentMap.off('style.load', handleStyleLoad);
      }
    };
  }, []);

  // Sync zoom, rotation, pitch from map and enhance atmosphere when zoomed out
  useEffect(() => {
    if (!map.current) return;
    
    const updateMapState = () => {
      if (!map.current) return;
      const currentZoom = map.current.getZoom();
      setZoomLevel(currentZoom);
      setMapRotation(map.current.getBearing());
      setMapPitch(map.current.getPitch());

      // Gradually transition to black space with stars as zoom decreases below 9
      if (map.current.isStyleLoaded() && map.current.getLayer('sky')) {
        try {
          const atmosphereRgb = atmosphereColor.replace('#', '').match(/.{2}/g)?.map(x => parseInt(x, 16)) || [56, 91, 173];
          
          if (currentZoom < 9) {
            // Calculate transition progress (0 at zoom 9, 1 at zoom 0)
            // Smooth transition from zoom 9 down to zoom 0
            const transitionProgress = Math.max(0, Math.min(1, (9 - currentZoom) / 9));
            
            if (!map.current) return;
            // Force sky to atmosphere mode for space view
            map.current.setPaintProperty('sky', 'sky-type', 'atmosphere');
            map.current.setPaintProperty('sky', 'sky-atmosphere-sun', [sunAzimuth, sunElevation]);
            
            // Gradually increase sun intensity as we zoom out
            const intensityMultiplier = 1.5 + (transitionProgress * 1.0); // 1.5x at zoom 9, 2.5x at zoom 0
            map.current.setPaintProperty('sky', 'sky-atmosphere-sun-intensity', Math.max(sunIntensity * intensityMultiplier, 4));
            map.current.setPaintProperty('sky', 'sky-atmosphere-color', atmosphereColor);
            
            // Gradually transition background from normal to black space
            const bgRgb = backgroundColor.replace('#', '').match(/.{2}/g)?.map(x => parseInt(x, 16)) || [0, 179, 255];
            const blackBgRgb = [0, 0, 0];
            const interpolatedBg = [
              Math.round(bgRgb[0] * (1 - transitionProgress) + blackBgRgb[0] * transitionProgress),
              Math.round(bgRgb[1] * (1 - transitionProgress) + blackBgRgb[1] * transitionProgress),
              Math.round(bgRgb[2] * (1 - transitionProgress) + blackBgRgb[2] * transitionProgress)
            ];
            const interpolatedBgColor = `#${interpolatedBg.map(x => x.toString(16).padStart(2, '0')).join('')}`;
            map.current.setPaintProperty('background', 'background-color', interpolatedBgColor);
            
            // Gradually increase star intensity (0 at zoom 9, up to 0.8 at very low zoom)
            const starIntensity = transitionProgress * 0.8;
            
            // Gradually transition horizon blend for atmospheric rim
            const horizonBlend = 0.1 + (transitionProgress * 0.2); // 0.1 at zoom 9, 0.3 at zoom 0
            
            // Set fog for gradual space transition - black space with stars
            (map.current.setFog as any)({
              'color': interpolatedBgColor, // Gradually blacker
              'high-color': currentZoom < 3 ? 
                `rgba(${atmosphereRgb[0]}, ${atmosphereRgb[1]}, ${atmosphereRgb[2]}, ${0.4 * transitionProgress})` : // Atmospheric glow at horizon when very zoomed out
                interpolatedBgColor, // Match background
              'horizon-blend': horizonBlend,
              'space-color': '#000000', // Black space
              'star-intensity': starIntensity // Gradually increase stars
            });
          } else {
            if (!map.current) return;
            // Normal view (zoom >= 9) - use standard sky settings
            map.current.setPaintProperty('sky', 'sky-atmosphere-sun-intensity', Math.max(sunIntensity, 4));
            // Remove stars and reset fog when zoomed in
            try {
              (map.current.setFog as any)(null);
            } catch (e) {
              // Ignore if fog doesn't exist
            }
          }
        } catch (e) {
          // Ignore errors during updates
        }
      }
    };

    map.current.on('move', updateMapState);
    map.current.on('zoom', updateMapState);
    map.current.on('rotate', updateMapState);
    map.current.on('pitch', updateMapState);

    return () => {
      const currentMap = map.current as MapboxMapWithInternal | null;
      if (currentMap && !currentMap._removed) {
        currentMap.off('move', updateMapState);
        currentMap.off('zoom', updateMapState);
        currentMap.off('rotate', updateMapState);
        currentMap.off('pitch', updateMapState);
      }
    };
  }, [sunIntensity, atmosphereColor, backgroundColor, sunAzimuth, sunElevation]);

  // Marker Tools Implementation
  useEffect(() => {
    if (!map.current || !showMarkerTools) return;

    const handleMapClick = (e: mapboxgl.MapMouseEvent) => {
      const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const popup = prompt('Enter popup text (optional):') || undefined;
      const markerId = `marker-${Date.now()}`;
      const newMarker = {
        id: markerId,
        position: coords,
        popup
      };
      
      // Add visual marker
      const markerElement = document.createElement('div');
      markerElement.style.width = '30px';
      markerElement.style.height = '30px';
      markerElement.style.borderRadius = '50%';
      markerElement.style.backgroundColor = '#ff0000';
      markerElement.style.border = '3px solid white';
      markerElement.style.cursor = 'pointer';

      if (!map.current) return;
      const marker = new mapboxgl.Marker(markerElement)
        .setLngLat(coords)
        .addTo(map.current);

      if (popup) {
        marker.setPopup(new mapboxgl.Popup().setText(popup));
      }

      // Store marker reference
      mapboxMarkersRef.current[markerId] = marker;
      setMarkers(prev => [...prev, newMarker]);
    };

    map.current.on('click', handleMapClick);
    return () => {
      const currentMap = map.current as MapboxMapWithInternal | null;
      if (currentMap && !currentMap._removed) {
        currentMap.off('click', handleMapClick);
      }
    };
  }, [showMarkerTools]);

  // Remove markers when deleted from state
  useEffect(() => {
    if (!map.current) return;
    
    const currentMarkerIds = new Set(markers.map(m => m.id));
    
    // Remove markers that are no longer in state
    Object.keys(mapboxMarkersRef.current).forEach(id => {
      if (!currentMarkerIds.has(id)) {
        mapboxMarkersRef.current[id].remove();
        delete mapboxMarkersRef.current[id];
      }
    });
  }, [markers]);

  // Implement Language/Localization
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    
    try {
      // Language in Mapbox is handled through style specification
      // We need to modify the style's language property
      const style = map.current.getStyle();
      if (style && style.glyphs) {
        // Update glyph URL to include language
        // This is a simplified approach - full implementation would require style modification
        console.log('Language set to:', mapLanguage);
        // Note: Full language support requires custom style modifications
      }
    } catch (e) {
      console.warn('Language setting error:', e);
    }
  }, [mapLanguage]);

  // Implement Attribution visibility
  useEffect(() => {
    if (!map.current) return;
    
    const updateAttribution = () => {
      try {
        // Find attribution control - it might not exist immediately
        const attributionControl = document.querySelector('.mapboxgl-ctrl-attrib');
        if (attributionControl) {
          (attributionControl as HTMLElement).style.display = showAttribution ? 'block' : 'none';
        } else {
          // Try again after a short delay if not found
          setTimeout(updateAttribution, 100);
        }
      } catch (e) {
        console.warn('Attribution control error:', e);
      }
    };

    updateAttribution();
    
    // Also check after style loads
    if (map.current.isStyleLoaded()) {
      setTimeout(updateAttribution, 500);
    } else {
      map.current.once('style.load', () => {
        setTimeout(updateAttribution, 500);
      });
    }
  }, [showAttribution]);


  useEffect(() => {
    if (!mapContainer.current || map.current) return; // Initialize only once

    mapboxgl.accessToken = accessToken;

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [-122.431297, 37.773972], // San Francisco downtown
      zoom: initialZoom, // Use the initialZoom prop
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

    // Get default modes from DrawConstructor (avoid creating temporary instance to prevent memory leak)
    const DrawConstructor = MapboxDraw as unknown as MapboxDrawConstructor;
    const defaultModes = DrawConstructor.modes || {};

    const drawInstance = new DrawConstructor({
      displayControlsDefault: false,
      controls: { polygon: false, trash: false, rectangle: true },
      modes: {
        ...defaultModes,
        draw_polygon: FreehandMode
      }
    });
    // Add draw control only in editor mode
    if (!isSlideshowMode) {
      mapInstance.addControl(drawInstance, 'top-left');
      drawRef.current = drawInstance;
      setDraw(drawInstance);
    }

    // Wait for the style to load before adding custom layers
    mapInstance.on('style.load', () => {
        // Automatically refresh 3D features when style loads (default behavior)
        setTimeout(() => {
          if (map.current && map.current.isStyleLoaded()) {
            console.log('🔄 Auto-refreshing 3D features on style load');
            initializeLayers();
          }
        }, 300);
        
        // Add sky layer immediately to prevent white screen
        try {
          // Check if we should force space view based on zoom (starts at zoom 9)
          const currentZoom = mapInstance.getZoom();
          const shouldForceSpaceView = currentZoom < 9;
          
          // Add sky based on skyLayerType first, then skyType
          if (shouldForceSpaceView || skyLayerType === 'atmosphere') {
            // Use atmosphere sky type – halo with opacity for soft, natural sun glow
            const haloRgb = haloColor.replace('#', '').match(/.{2}/g)?.map(x => parseInt(x, 16)) || [255, 251, 240];
            const haloColorRgba = `rgba(${haloRgb[0]}, ${haloRgb[1]}, ${haloRgb[2]}, ${haloOpacity})`;
            mapInstance.addLayer({
              'id': 'sky',
              'type': 'sky',
              'paint': {
                'sky-type': 'atmosphere',
                'sky-atmosphere-sun': [sunAzimuth, sunElevation],
                'sky-atmosphere-sun-intensity': Math.max(sunIntensity, 4), // Bright daytime atmosphere
                'sky-atmosphere-halo-color': haloColorRgba,
                'sky-atmosphere-color': atmosphereColor,
                'sky-opacity': 1.0
              } as any
            });
            
            // Add background - force black for space view
            const bgColor = shouldForceSpaceView ? '#000000' : backgroundColor;
            mapInstance.addLayer({
              'id': 'background',
              'type': 'background',
              'paint': { 'background-color': bgColor }
            }, 'sky');
          } else if (!shouldForceSpaceView && skyType === 'blue') {
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
          } else if (!shouldForceSpaceView && skyType === 'evening') {
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
          } else if (!shouldForceSpaceView && skyType === 'night') {
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
          } else if (!shouldForceSpaceView && skyType === 'sunrise') {
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
        
        // Set fog for space view - will be updated dynamically based on zoom
        try {
          if (mapInstance.getStyle().layers) {
            // Default to space view (black with stars)
            const atmosphereRgb = atmosphereColor.replace('#', '').match(/.{2}/g)?.map(x => parseInt(x, 16)) || [56, 91, 173];
            (mapInstance.setFog as any)({
              'color': '#000000', // Black space
              'high-color': '#000000', // Black space
              'horizon-blend': 0.2,
              'space-color': '#000000', // Black space
              'star-intensity': 0.5 // Visible stars
            });
          }
        } catch (e) {
          console.log('Could not set fog for space view:', e);
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

      // Initialize layers immediately and after a delay to ensure they load (auto-refresh 3D features)
      console.log('🔄 Auto-refreshing 3D features on map load');
      initializeLayers();
      setTimeout(() => {
        console.log('🔄 Auto-refreshing 3D features (delayed)');
        initializeLayers();
        
        // Don't auto-start continuous cycle - sun cycle is OFF by default
        // User can manually start it if desired
      }, 1000);
      
      // Additional refresh after a longer delay to ensure everything loads
      setTimeout(() => {
        if (map.current && map.current.isStyleLoaded()) {
          console.log('🔄 Auto-refreshing 3D features (final refresh)');
          initializeLayers();
        }
      }, 2000);
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
  }, [accessToken, initialZoom]); // Include initialZoom in dependencies

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



  // Add refs for draggable components with proper types
  const filmControlsRef = useRef<HTMLDivElement>(null);
  const timelinePanelRef = useRef<HTMLDivElement>(null);
  const actorPanelRef = useRef<HTMLDivElement>(null);
  const effectsPanelRef = useRef<HTMLDivElement>(null);
  const settingsContainerRef = useRef<HTMLDivElement>(null);
  const mapboxFeaturesPanelRef = useRef<HTMLDivElement>(null);
  // Store control references to avoid duplicates
  const navControlRef = useRef<mapboxgl.NavigationControl | null>(null);
  const geolocateControlRef = useRef<mapboxgl.GeolocateControl | null>(null);
  const fullscreenControlRef = useRef<mapboxgl.FullscreenControl | null>(null);
  const scaleControlRef = useRef<mapboxgl.ScaleControl | null>(null);
  const mapboxMarkersRef = useRef<{ [key: string]: mapboxgl.Marker }>({});
  const cubeSliderRef = useRef<HTMLDivElement>(null);

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
              onClick={() => setShowMapboxFeatures(!showMapboxFeatures)}
              style={{
                width: 'auto',
                height: '40px',
                borderRadius: '20px',
                padding: '0 16px',
                background: showMapboxFeatures ? '#f1f3f4' : 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.2s',
                color: '#5f6368',
                fontSize: '14px',
                fontWeight: '500'
              }}
              title="Mapbox Features"
            >
              Features
            </button>
            <div style={{ width: '1px', height: '24px', background: '#dadce0' }}></div>
            <button
              onClick={startGameAreaSelection}
              style={{
                width: 'auto',
                height: '40px',
                borderRadius: '20px',
                padding: '0 16px',
                background: isSelectingGameArea ? '#4CAF50' : (gameAreaBounds ? '#2196f3' : 'transparent'),
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.2s',
                color: (isSelectingGameArea || gameAreaBounds) ? 'white' : '#5f6368',
                fontSize: '14px',
                fontWeight: '500'
              }}
              title={isSelectingGameArea ? "Click points on map to create polygon. Double-click to finish." : (gameAreaBounds ? "Game area selected - Click to select new area" : "Select Game Area (Polygon)")}
            >
              {isSelectingGameArea ? `Points: ${gameAreaPolygon.length}` : (gameAreaBounds ? 'Game Area' : 'Select Area')}
            </button>
            {isSelectingGameArea && gameAreaPolygon.length >= 3 && (
              <button
                onClick={finishGameAreaSelection}
                style={{
                  width: 'auto',
                  height: '40px',
                  borderRadius: '20px',
                  padding: '0 12px',
                  background: '#4CAF50',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginLeft: '8px'
                }}
                title="Finish Polygon"
              >
                Finish
              </button>
            )}
            {gameAreaBounds && !isSelectingGameArea && (
              <button
                onClick={clearGameArea}
                style={{
                  width: 'auto',
                  height: '40px',
                  borderRadius: '20px',
                  padding: '0 12px',
                  background: '#f44336',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginLeft: '8px'
                }}
                title="Clear Game Area"
              >
                Clear
              </button>
            )}
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
                  setSunAzimuth(200);
                  setSunElevation(90);
                  setSunIntensity(1);
                  setSunColor('#ffffff');
                  setHaloColor('#ffffff');
                  setHaloOpacity(1.0);
                  setAtmosphereColor('#00bfff');
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
                  Duration:
                </label>
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={sunCycleDuration}
                  onChange={(e) => setSunCycleDuration(Number(e.target.value))}
                  style={{ 
                    width: '80px', 
                    padding: '4px 8px', 
                    border: '1px solid #ccc', 
                    borderRadius: '4px',
                    fontSize: '12px'
                  }}
                  disabled={isSunCycleEnabled}
                />
                <span style={{ fontSize: '12px', color: '#666' }}>seconds</span>
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
                    min="0.5"
                    max="15"
                    step="0.5"
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
          </div>
        </div>
      )}

      {/* Mapbox Features Panel */}
      {showMapboxFeatures && !isSlideshowMode && (
        <div ref={mapboxFeaturesPanelRef} style={{
          position: 'fixed',
          top: '80px',
          right: '20px',
          width: '380px',
          maxHeight: 'calc(100vh - 120px)',
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          zIndex: 1001,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          pointerEvents: 'auto'
        }}>
            {/* Header */}
            <div style={{
              height: '64px',
              background: '#ffffff',
              borderBottom: '1px solid #dadce0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0 20px',
              flexShrink: 0
            }}>
              <h3 style={{ margin: 0, color: '#202124', fontSize: '18px', fontWeight: '500' }}>Mapbox Features</h3>
              <button
                onClick={() => setShowMapboxFeatures(false)}
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
              {/* Map Styles */}
              <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
                <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333' }}>Map Styles</h4>
                <select
                  value={mapStyle}
                  onChange={(e) => {
                    const newStyle = e.target.value;
                    setMapStyle(newStyle);
                    if (map.current) {
                      try {
                        map.current.setStyle(newStyle);
                        // Wait for style to load before doing anything else
                        map.current.once('style.load', () => {
                          console.log('Style loaded successfully');
                        });
                      } catch (error) {
                        console.error('Error changing map style:', error);
                      }
                    }
                  }}
                  style={{ width: '100%', padding: '8px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '4px' }}
                >
                  {availableStyles.map(style => (
                    <option key={style.id} value={style.url}>{style.name}</option>
                  ))}
                </select>
              </div>

              {/* Navigation Controls */}
              <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
                <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333' }}>Navigation Controls</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Zoom Controls</label>
                    <input type="checkbox" checked={showZoomControls} onChange={(e) => setShowZoomControls(e.target.checked)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Compass</label>
                    <input type="checkbox" checked={showCompass} onChange={(e) => setShowCompass(e.target.checked)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Rotation Controls</label>
                    <input type="checkbox" checked={showRotationControls} onChange={(e) => setShowRotationControls(e.target.checked)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Pitch Controls</label>
                    <input type="checkbox" checked={showPitchControls} onChange={(e) => setShowPitchControls(e.target.checked)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Geolocation</label>
                    <input type="checkbox" checked={showGeolocation} onChange={(e) => setShowGeolocation(e.target.checked)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Fullscreen</label>
                    <input type="checkbox" checked={showFullscreen} onChange={(e) => setShowFullscreen(e.target.checked)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Scale</label>
                    <input type="checkbox" checked={showScale} onChange={(e) => setShowScale(e.target.checked)} />
                  </div>
                  <div style={{ marginTop: '10px' }}>
              <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>
                      Zoom Level: {zoomLevel}
              </label>
              <input
                type="range"
                min="0"
                      max="24"
                      step="0.1"
                      value={zoomLevel}
                      onChange={(e) => {
                        const zoom = Number(e.target.value);
                        setZoomLevel(zoom);
                        if (map.current) map.current.zoomTo(zoom);
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div style={{ marginTop: '10px' }}>
                    <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>
                      Map Rotation: {mapRotation}°
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="360"
                step="1"
                      value={mapRotation}
                      onChange={(e) => {
                        const rotation = Number(e.target.value);
                        setMapRotation(rotation);
                        if (map.current) map.current.setBearing(rotation);
                      }}
                style={{ width: '100%' }}
              />
                  </div>
                  <div style={{ marginTop: '10px' }}>
                    <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>
                      Map Pitch: {mapPitch}°
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="85"
                      step="1"
                      value={mapPitch}
                      onChange={(e) => {
                        const pitch = Number(e.target.value);
                        setMapPitch(pitch);
                        if (map.current) map.current.setPitch(pitch);
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>
              </div>
            </div>

              {/* Fog Controls (careful not to interfere with sky) */}
              <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#fff3cd', borderRadius: '8px', border: '1px solid #ffeaa7' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#856404' }}>⚠️ Fog Controls</h4>
                <p style={{ fontSize: '12px', color: '#856404', margin: '0 0 15px 0' }}>
                  Note: Fog may interact with sky settings. Adjust carefully.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Enable Fog</label>
                    <input type="checkbox" checked={fogEnabled} onChange={(e) => setFogEnabled(e.target.checked)} />
                  </div>
                  {fogEnabled && (
                    <>
                      <div>
                        <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>Fog Color</label>
                        <input
                          type="color"
                          value={fogColor}
                          onChange={(e) => setFogColor(e.target.value)}
                          style={{ width: '100%', height: '40px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
                        />
                      </div>
                      <div>
              <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>
                          Fog Range: [{fogRange[0].toFixed(1)}, {fogRange[1].toFixed(1)}]
              </label>
                        <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="range"
                min="0"
                            max="5"
                            step="0.1"
                            value={fogRange[0]}
                            onChange={(e) => setFogRange([Number(e.target.value), fogRange[1]])}
                            style={{ flex: 1 }}
                          />
                          <input
                            type="range"
                            min="5"
                            max="20"
                            step="0.1"
                            value={fogRange[1]}
                            onChange={(e) => setFogRange([fogRange[0], Number(e.target.value)])}
                            style={{ flex: 1 }}
                          />
                        </div>
                      </div>
                      <div>
                        <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>Fog High Color</label>
                        <input
                          type="color"
                          value={fogHighColor}
                          onChange={(e) => setFogHighColor(e.target.value)}
                          style={{ width: '100%', height: '40px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>Fog Space Color</label>
                        <input
                          type="color"
                          value={fogSpaceColor}
                          onChange={(e) => setFogSpaceColor(e.target.value)}
                          style={{ width: '100%', height: '40px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>
                          Star Intensity: {fogStarIntensity.toFixed(2)}
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={fogStarIntensity}
                          onChange={(e) => setFogStarIntensity(Number(e.target.value))}
                style={{ width: '100%' }}
              />
                      </div>
                    </>
                  )}
              </div>
            </div>

              {/* Cloud Controls */}
              <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#e3f2fd', borderRadius: '8px', border: '1px solid #90caf9' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#1565c0' }}>☁️ Cloud Controls</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Enable Clouds</label>
                    <input type="checkbox" checked={cloudsEnabled} onChange={(e) => setCloudsEnabled(e.target.checked)} />
                  </div>
                  {cloudsEnabled && (
                    <>
                      <div style={{
                        padding: '12px',
                        background: '#2d2d2d',
                        borderRadius: '6px',
                        marginBottom: '10px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                          <label style={{ fontSize: '14px', color: '#e0e0e0', minWidth: '110px' }}>Brush Diameter</label>
                          <input
                            type="range"
                            min="500"
                            max="50000"
                            step="100"
                            value={brushSize}
                            onChange={(e) => {
                              const newSize = Number(e.target.value);
                              setBrushSize(newSize);
                              if (isCloudBrushMode && mousePosition && map.current) {
                                const circle = createCirclePolygon([mousePosition.lng, mousePosition.lat], newSize);
                                const source = map.current.getSource('cloud-brush-preview') as mapboxgl.GeoJSONSource;
                                if (source) {
                                  source.setData({
                                    type: 'Feature',
                                    properties: {},
                                    geometry: { type: 'Polygon', coordinates: [circle] }
                                  });
                                }
                                const previewClouds: GeoJSON.Feature[] = [];
                                const brushArea = Math.PI * Math.pow(newSize, 2);
                                const baseCloudDensity = 0.0001;
                                const previewCount = Math.min(20, Math.floor(brushArea * baseCloudDensity));
                                const centerLat = mousePosition.lat;
                                for (let i = 0; i < previewCount; i++) {
                                  const angle = Math.random() * Math.PI * 2;
                                  const distance = Math.random() * newSize;
                                  const radiusLat = distance / 111000;
                                  const radiusLng = distance / (111000 * Math.cos(centerLat * Math.PI / 180));
                                  previewClouds.push({
                                    type: 'Feature',
                                    properties: {},
                                    geometry: {
                                      type: 'Point',
                                      coordinates: [
                                        mousePosition.lng + radiusLng * Math.cos(angle),
                                        centerLat + radiusLat * Math.sin(angle)
                                      ]
                                    }
                                  });
                                }
                                const pointsSource = map.current.getSource('cloud-brush-preview-points') as mapboxgl.GeoJSONSource;
                                if (pointsSource) {
                                  pointsSource.setData({ type: 'FeatureCollection', features: previewClouds });
                                }
                              }
                              if (cloudsEnabled && brushClouds.length > 0) {
                                if (cloudRegenDebounceRef.current) clearTimeout(cloudRegenDebounceRef.current);
                                cloudRegenDebounceRef.current = setTimeout(() => addClouds(true), 300);
                              }
                            }}
                            style={{ flex: 1, accentColor: '#90caf9' }}
                          />
                          <span style={{ fontSize: '14px', color: '#90caf9', minWidth: '44px', textAlign: 'right' }}>{brushSize}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <label style={{ fontSize: '14px', color: '#e0e0e0', minWidth: '110px' }}>Brush Intensity</label>
                          <input
                            type="range"
                            min="0.001"
                            max="0.1"
                            step="0.001"
                            value={brushIntensity}
                            onChange={(e) => setBrushIntensity(Number(e.target.value))}
                            style={{ flex: 1, accentColor: '#90caf9' }}
                          />
                          <span style={{ fontSize: '14px', color: '#90caf9', minWidth: '44px', textAlign: 'right' }}>{brushIntensity.toFixed(3)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (isCloudBrushMode) {
                            stopCloudBrushMode();
                          } else {
                            startCloudBrushMode();
                          }
                        }}
                        style={{
                          background: isCloudBrushMode ? '#f44336' : '#4caf50',
                          color: 'white',
                          border: 'none',
                          padding: '10px 16px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          width: '100%',
                          marginTop: '10px',
                          fontWeight: '500'
                        }}
                      >
                        {isCloudBrushMode ? 'Exit Brush Mode' : 'Start Brush Mode'}
                      </button>
                      {brushClouds.length > 0 && (
                        <button
                          onClick={() => {
                            brushCloudsRef.current = [];
                            setBrushClouds([]);
                            if (cloudsEnabled) {
                              addClouds();
                            }
                          }}
                          style={{
                            background: '#ff9800',
                            color: 'white',
                            border: 'none',
                            padding: '8px 16px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            width: '100%',
                            marginTop: '10px'
                          }}
                        >
                          Clear All Brush Clouds ({brushClouds.length})
                        </button>
                      )}
                      <div>
                        <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>
                          Cloud Opacity: {cloudOpacity.toFixed(2)}
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={cloudOpacity}
                          onChange={(e) => setCloudOpacity(Number(e.target.value))}
                          style={{ width: '100%' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>Cloud Color</label>
                        <input
                          type="color"
                          value={cloudColor}
                          onChange={(e) => setCloudColor(e.target.value)}
                          style={{ width: '100%', height: '40px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>
                          Cloud Altitude (meters)
                        </label>
                        <input
                          type="number"
                          min="100"
                          max="10000"
                          step="100"
                          value={cloudHeight}
                          onChange={(e) => {
                            const value = parseFloat(e.target.value);
                            if (!isNaN(value) && value >= 100 && value <= 10000) {
                              setCloudHeight(value);
                            }
                          }}
                          style={{ 
                            width: '100%', 
                            padding: '8px', 
                            fontSize: '14px', 
                            border: '1px solid #ccc', 
                            borderRadius: '4px' 
                          }}
                          placeholder="2000"
                        />
                        <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                          Altitude/height of clouds in meters above ground. Recommended: 1000-5000m
                        </div>
                      </div>
                      <div>
                        <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>
                          Cloud Detail: {cloudPolygonDetail} points
                        </label>
                        <input
                          type="range"
                          min="3"
                          max="32"
                          step="1"
                          value={cloudPolygonDetail}
                          onChange={(e) => {
                            const newDetail = Number(e.target.value);
                            setCloudPolygonDetail(newDetail);
                            // Regenerate clouds with new detail level (debounced)
                            if (cloudsEnabled && brushClouds.length > 0) {
                              // Clear existing debounce timer
                              if (cloudRegenDebounceRef.current) {
                                clearTimeout(cloudRegenDebounceRef.current);
                              }
                              // Debounce regeneration by 300ms
                              cloudRegenDebounceRef.current = setTimeout(() => {
                                addClouds(true); // Force regenerate when detail changes
                              }, 300);
                            }
                          }}
                          style={{ width: '100%' }}
                        />
                        <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                          Lower = better performance (weaker computers). Higher = smoother circles (stronger computers). Range: 3-32 points.
                        </div>
                      </div>
                    </>
                  )}
              </div>
            </div>

              {/* Terrain Controls */}
              <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
                <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333' }}>Terrain Controls</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Enable Terrain</label>
                    <input type="checkbox" checked={terrainEnabled} onChange={(e) => setTerrainEnabled(e.target.checked)} />
                  </div>
            <div>
                    <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>Terrain Source</label>
                    <select
                      value={terrainSource}
                      onChange={(e) => setTerrainSource(e.target.value)}
                      style={{ width: '100%', padding: '8px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '4px' }}
                    >
                      <option value="mapbox-dem">Mapbox DEM</option>
                      <option value="custom">Custom Source</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Layer Visibility Controls */}
              <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
                <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333' }}>Layer Visibility</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Traffic Layer</label>
                    <input type="checkbox" checked={trafficLayerVisible} onChange={(e) => setTrafficLayerVisible(e.target.checked)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Transit Layer</label>
                    <input type="checkbox" checked={transitLayerVisible} onChange={(e) => setTransitLayerVisible(e.target.checked)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Water Layer</label>
                    <input type="checkbox" checked={waterLayerVisible} onChange={(e) => setWaterLayerVisible(e.target.checked)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Land Use Layer</label>
                    <input type="checkbox" checked={landuseLayerVisible} onChange={(e) => setLanduseLayerVisible(e.target.checked)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Place Labels</label>
                    <input type="checkbox" checked={placeLabelsVisible} onChange={(e) => setPlaceLabelsVisible(e.target.checked)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>POI Labels</label>
                    <input type="checkbox" checked={poiLabelsVisible} onChange={(e) => setPoiLabelsVisible(e.target.checked)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Road Labels</label>
                    <input type="checkbox" checked={roadLabelsVisible} onChange={(e) => setRoadLabelsVisible(e.target.checked)} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Transport Labels</label>
                    <input type="checkbox" checked={transportLabelsVisible} onChange={(e) => setTransportLabelsVisible(e.target.checked)} />
                  </div>
                </div>
              </div>

              {/* 3D Building Controls */}
              <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
                <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333' }}>3D Buildings</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: '14px', color: '#333' }}>Enable 3D Buildings</label>
                    <input type="checkbox" checked={buildings3DEnabled} onChange={(e) => setBuildings3DEnabled(e.target.checked)} />
                  </div>
                  <div>
                    <label style={{ fontSize: '14px', color: '#333', display: 'block', marginBottom: '5px' }}>
                      Building Opacity: {buildingOpacity.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={buildingOpacity}
                      onChange={(e) => setBuildingOpacity(Number(e.target.value))}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              </div>

              {/* Language/Localization */}
              <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
                <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333' }}>Language</h4>
                <select
                  value={mapLanguage}
                  onChange={(e) => setMapLanguage(e.target.value)}
                  style={{ width: '100%', padding: '8px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '4px' }}
                >
                  {availableLanguages.map(lang => (
                    <option key={lang.code} value={lang.code}>{lang.name}</option>
                  ))}
                </select>
              </div>

              {/* Attribution */}
              <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
                <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333' }}>Attribution</h4>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '14px', color: '#333' }}>Show Attribution</label>
                  <input type="checkbox" checked={showAttribution} onChange={(e) => setShowAttribution(e.target.checked)} />
                </div>
              </div>

              {/* Marker Tools */}
              <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
                <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#333' }}>Marker Tools</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                    onClick={() => setShowMarkerTools(!showMarkerTools)}
                  style={{
                      padding: '8px 16px',
                      fontSize: '14px',
                      backgroundColor: showMarkerTools ? '#dc3545' : '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                    {showMarkerTools ? 'Stop Adding Markers' : 'Add Marker Mode'}
                </button>
                  {markers.length > 0 && (
                    <div>
                      <h5 style={{ margin: '10px 0 5px 0', fontSize: '14px', color: '#333' }}>Markers ({markers.length})</h5>
                      <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
                        {markers.map((marker) => (
                          <div key={marker.id} style={{
                            padding: '8px',
                            marginBottom: '5px',
                            backgroundColor: '#fff',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}>
                            <div>Position: {marker.position[0].toFixed(4)}, {marker.position[1].toFixed(4)}</div>
                            {marker.popup && <div style={{ color: '#666', marginTop: '4px' }}>Popup: {marker.popup}</div>}
                <button
                              onClick={() => setMarkers(markers.filter(m => m.id !== marker.id))}
                  style={{
                                marginTop: '5px',
                    padding: '4px 8px',
                    fontSize: '11px',
                                backgroundColor: '#dc3545',
                    color: 'white',
                    border: 'none',
                                borderRadius: '3px',
                    cursor: 'pointer'
                  }}
                >
                              Remove
                </button>
              </div>
                        ))}
            </div>
          </div>
                  )}
            </div>
          </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Map; 