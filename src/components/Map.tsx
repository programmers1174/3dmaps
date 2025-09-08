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
  const [style, setStyle] = useState('mapbox://styles/mapbox/satellite-streets-v12');
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


  const [fogColor, setFogColor] = useState('#1E3A8A'); // Default sky color for fog/sky
  const [internalSkyGradient, setInternalSkyGradient] = useState<'blue' | 'sunset' | 'night'>('sunset');
  
  // Use external sky gradient if provided, otherwise use internal state
  const skyGradient = externalSkyGradient !== undefined ? externalSkyGradient : internalSkyGradient;
  
  // Update internal state when external changes
  useEffect(() => {
    if (externalSkyGradient !== undefined) {
      setInternalSkyGradient(externalSkyGradient);
    }
  }, [externalSkyGradient]);
  const [dayNightCycle, setDayNightCycle] = useState(true);
  const [cycleTime, setCycleTime] = useState(0); // 0-24 seconds
  const [transitionProgress, setTransitionProgress] = useState(0); // 0-1 for smooth transitions
  const [isSlideshowMode, setIsSlideshowMode] = useState(false); // Default to blue gradient
  const [skyPattern, setSkyPattern] = useState<'blue-dominant' | 'night-dominant'>('blue-dominant'); // Sky pattern selector



  // Replace showTopBar with showSidePanel
  const [showSidePanel, setShowSidePanel] = useState(true);

  const [terrainExaggeration, setTerrainExaggeration] = useState(1);
  const [buildingColor, setBuildingColor] = useState('#a0a0a0');
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
  const [isSelectingBuilding, setIsSelectingBuilding] = useState(false);
  const [selectedBuildingCoords, setSelectedBuildingCoords] = useState<[number, number] | null>(null);
  const [selectedBuildingName, setSelectedBuildingName] = useState<string>('');

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


  const generateStars = () => {
    const stars: any[] = [];
    for (let i = 0; i < 200; i++) {
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
          size: Math.random() * 0.5 + 0.5 // Random size between 0.5 and 1
        }
      });
    }
    return {
      type: 'FeatureCollection' as const,
      features: stars
    };
  };



  const getSkyGradientColors = (gradientType: 'blue' | 'sunset' | 'night') => {
    if (gradientType === 'blue') {
      return {
        top: '#1E3A8A',    // Dark blue
        middle1: '#3B82F6', // Medium blue
        middle2: '#60A5FA', // Light blue
        bottom: '#A9D4FF'  // Very light blue
      };
    } else if (gradientType === 'sunset') {
      return {
        top: '#45496E',    
        middle1: '#A0808A', 
        middle2: '#CC9E8C', 
        bottom: '#CC9E8C'  
      };
    } else {
      return {
        top: '#000000',    // Pure black
        middle1: '#000000', // Pure black
        middle2: '#000000', // Pure black
        bottom: '#000000'  // Pure black
      };
    }
  };



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
      } catch (error) {
        console.error('Error adding stars:', error);
      }
    }
  };

  const removeStars = () => {
    if (map.current && map.current.isStyleLoaded()) {
      try {
        if (map.current.getLayer('stars')) {
          map.current.removeLayer('stars');
        }
        if (map.current.getSource('stars')) {
          map.current.removeSource('stars');
        }
      } catch (error) {
        console.error('Error removing stars:', error);
      }
    }
  };



  const startDayNightCycle = () => {
    setDayNightCycle(true);
    setCycleTime(0);
  };

  const stopDayNightCycle = () => {
    setDayNightCycle(false);
    setCycleTime(0);
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

  const interpolateColors = (color1: string, color2: string, progress: number) => {
    // Convert hex to RGB
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : null;
    };

    // Convert RGB to hex
    const rgbToHex = (r: number, g: number, b: number) => {
      return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    };

    const rgb1 = hexToRgb(color1);
    const rgb2 = hexToRgb(color2);

    if (!rgb1 || !rgb2) return color1;

    // Apply smooth easing to the progress
    const easedProgress = easeInOutCubic(progress);
    
    const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * easedProgress);
    const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * easedProgress);
    const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * easedProgress);

    return rgbToHex(r, g, b);
  };

  const applySmoothSkyTransition = (fromGradient: 'blue' | 'sunset' | 'night', toGradient: 'blue' | 'sunset' | 'night', progress: number) => {
    if (map.current && map.current.isStyleLoaded()) {
      try {
        const fromColors = getSkyGradientColors(fromGradient);
        const toColors = getSkyGradientColors(toGradient);

        const interpolatedTop = interpolateColors(fromColors.top || '#000000', toColors.top || '#000000', progress);
        const interpolatedMiddle1 = interpolateColors(fromColors.middle1 || '#000000', toColors.middle1 || '#000000', progress);
        const interpolatedMiddle2 = interpolateColors(fromColors.middle2 || '#000000', toColors.middle2 || '#000000', progress);
        const interpolatedBottom = interpolateColors(fromColors.bottom || '#000000', toColors.bottom || '#000000', progress);

        if (map.current.getLayer('sky')) {
          map.current.setPaintProperty('sky', 'sky-gradient', [
            'interpolate',
            ['linear'],
            ['sky-radial-progress'],
            0.0, interpolatedTop,
            0.4, interpolatedMiddle1,
            0.7, interpolatedMiddle2,
            1.0, interpolatedBottom
          ]);
        }

        // Handle stars for night sky transitions - make them fade in/out smoothly
        if (toGradient === 'night' && progress > 0.2) {
          // Start adding stars when transitioning to night (at 20% progress)
          addStars();
        } else if (fromGradient === 'night' && progress > 0.8) {
          // Start removing stars when transitioning away from night (at 80% progress)
          removeStars();
        }
      } catch (error) {
        console.error('Error applying smooth sky transition:', error);
      }
    }
  };

  const changeSkyGradient = (gradientType: 'blue' | 'sunset' | 'night') => {
    console.log('Changing sky gradient to:', gradientType);
    
    // Safety check - only transition if map is ready
    if (!map.current || !map.current.isStyleLoaded()) {
      console.log('Map not ready, applying colors directly');
      setInternalSkyGradient(gradientType);
      if (onSkyGradientChange) {
        onSkyGradientChange(gradientType);
      }
      return;
    }
    
    // Get current and target colors
    const currentColors = getSkyGradientColors(skyGradient);
    const targetColors = getSkyGradientColors(gradientType);
    
    // Start smooth transition
    try {
      smoothSkyTransition(currentColors, targetColors, gradientType);
    } catch (error) {
      console.error('Error in smooth transition, falling back to direct change:', error);
      // Fallback to direct color change
      applySkyColorsDirectly(gradientType);
    }
    
    setInternalSkyGradient(gradientType);
    if (onSkyGradientChange) {
      onSkyGradientChange(gradientType);
    }
  };

  // Fallback function for direct color application
  const applySkyColorsDirectly = (gradientType: 'blue' | 'sunset' | 'night') => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    
      try {
        const colors = getSkyGradientColors(gradientType);
        if (map.current.getLayer('sky')) {
          if (gradientType === 'sunset') {
            map.current.setPaintProperty('sky', 'sky-gradient', [
              'interpolate',
              ['linear'],
              ['sky-radial-progress'],
            0.0, colors.top,
            0.4, colors.middle1,
            0.7, colors.middle2,
            1.0, colors.bottom
            ]);
          } else if (gradientType === 'night') {
            map.current.setPaintProperty('sky', 'sky-gradient', [
              'interpolate',
              ['linear'],
              ['sky-radial-progress'],
            0.0, colors.top,
            0.3, colors.middle1,
            0.6, colors.middle2,
            1.0, colors.bottom
          ]);
            addStars();
          } else {
            removeStars();
            map.current.setPaintProperty('sky', 'sky-gradient', [
              'interpolate',
              ['linear'],
              ['sky-radial-progress'],
              0.0, colors.top,
            0.5, colors.middle1,
              1.0, colors.bottom
            ]);
          }
        }
      
        if (map.current.getLayer('background')) {
          map.current.setPaintProperty('background', 'background-color', colors.bottom);
        }
      
      map.current.triggerRepaint();
    } catch (error) {
      console.error('Error applying colors directly:', error);
    }
  };

  // Smooth sky transition function
  const smoothSkyTransition = (fromColors: any, toColors: any, targetGradient: 'blue' | 'sunset' | 'night') => {
    // Enhanced safety checks
    if (!map.current || !map.current.isStyleLoaded()) {
      console.log('Map not ready for smooth transition');
      return;
    }
    
    // Validate colors exist
    if (!fromColors || !toColors || !fromColors.top || !toColors.top) {
      console.log('Invalid colors for transition, falling back to direct change');
      applySkyColorsDirectly(targetGradient);
      return;
    }
    
    const duration = 1500; // 1.5 seconds for smooth transition
    const steps = 60; // 60 steps for 60fps
    const stepDuration = duration / steps;
    let currentStep = 0;
    
    const transitionInterval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;
      const easedProgress = easeInOutCubic(progress);
      
      // Interpolate between colors
      const interpolatedTop = interpolateColors(fromColors.top, toColors.top, easedProgress);
      const interpolatedMiddle1 = interpolateColors(fromColors.middle1, toColors.middle1, easedProgress);
      const interpolatedMiddle2 = interpolateColors(fromColors.middle2, toColors.middle2, easedProgress);
      const interpolatedBottom = interpolateColors(fromColors.bottom, toColors.bottom, easedProgress);
      
      // Apply interpolated colors to sky
      if (map.current && map.current.getLayer('sky')) {
        map.current.setPaintProperty('sky', 'sky-gradient', [
          'interpolate',
          ['linear'],
          ['sky-radial-progress'],
          0.0, interpolatedTop,
          0.4, interpolatedMiddle1,
          0.7, interpolatedMiddle2,
          1.0, interpolatedBottom
        ]);
      }
      
      // Update background color smoothly
      if (map.current && map.current.getLayer('background')) {
        map.current.setPaintProperty('background', 'background-color', interpolatedBottom);
      }
      
      // Handle stars transition
      if (targetGradient === 'night' && progress > 0.5) {
        // Start adding stars halfway through transition to night
        if (map.current && !map.current.getLayer('stars')) {
          addStars();
        }
      } else if (targetGradient !== 'night' && progress > 0.5) {
        // Start removing stars halfway through transition away from night
        if (map.current && map.current.getLayer('stars')) {
          removeStars();
        }
      }
      
      // Force repaint for smooth animation
      if (map.current) {
        map.current.triggerRepaint();
      }
      
      // Complete transition
      if (currentStep >= steps) {
        clearInterval(transitionInterval);
        
        // Apply final colors to ensure accuracy
        const finalColors = getSkyGradientColors(targetGradient);
        if (map.current && map.current.getLayer('sky')) {
          if (targetGradient === 'sunset') {
            map.current.setPaintProperty('sky', 'sky-gradient', [
              'interpolate',
              ['linear'],
              ['sky-radial-progress'],
              0.0, finalColors.top,
              0.4, finalColors.middle1,
              0.7, finalColors.middle2,
              1.0, finalColors.bottom
            ]);
          } else if (targetGradient === 'night') {
            map.current.setPaintProperty('sky', 'sky-gradient', [
              'interpolate',
              ['linear'],
              ['sky-radial-progress'],
              0.0, finalColors.top,
              0.3, finalColors.middle1,
              0.6, finalColors.middle2,
              1.0, finalColors.bottom
            ]);
            addStars();
          } else {
            removeStars();
            map.current.setPaintProperty('sky', 'sky-gradient', [
              'interpolate',
              ['linear'],
              ['sky-radial-progress'],
              0.0, finalColors.top,
              0.5, finalColors.middle1,
              1.0, finalColors.bottom
            ]);
          }
        }
        
        // Update final background color
        if (map.current && map.current.getLayer('background')) {
          map.current.setPaintProperty('background', 'background-color', finalColors.bottom);
        }
        
        try {
          if (map.current) {
            map.current.setFog(null);
          }
        } catch (e) {
          console.log('Could not remove fog effects');
        }
        
        if (map.current) {
        map.current.triggerRepaint();
      }
        console.log('Sky transition completed');
    }
    }, stepDuration);
  };

  // Smooth easing function for transitions
  const easeInOutCubic = (t: number): number => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  // Apply continuous sky blending for truly smooth transitions
  const applyContinuousSkyBlending = (blueIntensity: number, sunsetIntensity: number, nightIntensity: number) => {
    if (map.current && map.current.isStyleLoaded()) {
      try {
        if (nightIntensity > 0) {
          // Pattern 2: Sunset → Night → Sunset (with night sky)
          const sunsetColors = getSkyGradientColors('sunset');
          const nightColors = getSkyGradientColors('night');
          
          // Blend sunset and night colors
          const blendedTop = blendTwoColors(
            sunsetColors.top || '#000000',
            nightColors.top || '#000000', 
            sunsetIntensity, nightIntensity
          );
          
          const blendedMiddle1 = blendTwoColors(
            sunsetColors.middle1 || '#000000',
            nightColors.middle1 || '#000000',
            sunsetIntensity, nightIntensity
          );
          
          const blendedMiddle2 = blendTwoColors(
            sunsetColors.middle2 || '#000000',
            nightColors.middle2 || '#000000',
            sunsetIntensity, nightIntensity
          );
          
          const blendedBottom = blendTwoColors(
            sunsetColors.bottom || '#000000',
            nightColors.bottom || '#000000',
            sunsetIntensity, nightIntensity
          );
          
          if (map.current.getLayer('sky')) {
            map.current.setPaintProperty('sky', 'sky-gradient', [
              'interpolate',
              ['linear'],
              ['sky-radial-progress'],
              0.0, blendedTop,
              0.4, blendedMiddle1,
              0.7, blendedMiddle2,
              1.0, blendedBottom
            ]);
          }
          
          // Add stars when night sky is present
          if (nightIntensity > 0.3) {
            addStars();
          } else {
            removeStars();
          }
        } else {
          // Pattern 1: Sunset → Blue Sky → Sunset (no night sky)
          const blueColors = getSkyGradientColors('blue');
          const sunsetColors = getSkyGradientColors('sunset');
          
          // Blend only blue and sunset colors
          const blendedTop = blendTwoColors(
            sunsetColors.top || '#000000',
            blueColors.top || '#000000', 
            sunsetIntensity, blueIntensity
          );
          
          const blendedMiddle1 = blendTwoColors(
            sunsetColors.middle1 || '#000000',
            blueColors.middle1 || '#000000',
            sunsetIntensity, blueIntensity
          );
          
          const blendedMiddle2 = blendTwoColors(
            sunsetColors.middle2 || '#000000',
            blueColors.middle2 || '#000000',
            sunsetIntensity, blueIntensity
          );
          
          const blendedBottom = blendTwoColors(
            sunsetColors.bottom || '#000000',
            blueColors.bottom || '#000000',
            sunsetIntensity, blueIntensity
          );
          
          if (map.current.getLayer('sky')) {
            map.current.setPaintProperty('sky', 'sky-gradient', [
              'interpolate',
              ['linear'],
              ['sky-radial-progress'],
              0.0, blendedTop,
              0.4, blendedMiddle1,
              0.7, blendedMiddle2,
              1.0, blendedBottom
            ]);
          }
          
          // Remove stars since there's no night sky
          removeStars();
        }
      } catch (error) {
        console.error('Error applying continuous sky blending:', error);
      }
    }
  };

  // Get the current time of day based on cycle time
  const getTimeOfDay = (cycleTime: number): string => {
    const cycleProgress = cycleTime / 24;
    
    if (cycleProgress < 0.25) {
      return '🌅 Early Morning';
    } else if (cycleProgress < 0.5) {
      return '☀️ Mid Day';
    } else if (cycleProgress < 0.75) {
      return '🌆 Evening';
    } else {
      return '🌅 Early Morning';
    }
  };

  // Blend two colors based on their intensities
  const blendTwoColors = (color1: string, color2: string, intensity1: number, intensity2: number): string => {
    // Convert hex to RGB using the existing interpolateColors function's helper functions
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : null;
    };

    // Convert RGB to hex using the existing interpolateColors function's helper functions
    const rgbToHex = (r: number, g: number, b: number) => {
      return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    };
    
    const rgb1 = hexToRgb(color1);
    const rgb2 = hexToRgb(color2);
    
    if (!rgb1 || !rgb2) return color1;
    
    // Normalize intensities to sum to 1
    const totalIntensity = intensity1 + intensity2;
    const normalized1 = intensity1 / totalIntensity;
    const normalized2 = intensity2 / totalIntensity;
    
    const r = Math.round(rgb1.r * normalized1 + rgb2.r * normalized2);
    const g = Math.round(rgb1.g * normalized1 + rgb2.g * normalized2);
    const b = Math.round(rgb1.b * normalized1 + rgb2.b * normalized2);
    
    return rgbToHex(r, g, b);
  };



  // Blend three colors based on their intensities
  const blendThreeColors = (color1: string, color2: string, color3: string, intensity1: number, intensity2: number, intensity3: number): string => {
    // Convert hex to RGB using the existing interpolateColors function's helper functions
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : null;
    };

    // Convert RGB to hex using the existing interpolateColors function's helper functions
    const rgbToHex = (r: number, g: number, b: number) => {
      return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    };
    
    const rgb1 = hexToRgb(color1);
    const rgb2 = hexToRgb(color2);
    const rgb3 = hexToRgb(color3);
    
    if (!rgb1 || !rgb2 || !rgb3) return color1;
    
    // Normalize intensities to sum to 1
    const totalIntensity = intensity1 + intensity2 + intensity3;
    const normalized1 = intensity1 / totalIntensity;
    const normalized2 = intensity2 / totalIntensity;
    const normalized3 = intensity3 / totalIntensity;
    
    const r = Math.round(rgb1.r * normalized1 + rgb2.r * normalized2 + rgb3.r * normalized3);
    const g = Math.round(rgb1.g * normalized1 + rgb2.g * normalized2 + rgb3.g * normalized3);
    const b = Math.round(rgb1.b * normalized1 + rgb2.b * normalized2 + rgb3.b * normalized3);
    
    return rgbToHex(r, g, b);
  };

  const changeFogColor = (newColor: string) => {
    console.log('Changing fog color to:', newColor);
    setFogColor(newColor);
    
    // Update fog/sky colors immediately
    if (map.current && map.current.isStyleLoaded()) {
      try {
        // Update sky layer color
        const colors = getSkyGradientColors(skyGradient);
        if (map.current.getLayer('sky')) {
          map.current.setPaintProperty('sky', 'sky-gradient', [
            'interpolate',
            ['linear'],
            ['sky-radial-progress'],
            0.0, colors.top,
            0.5, colors.middle1,
            1.0, colors.bottom
          ]);
        }
        
        // Update background color
        if (map.current.getLayer('background')) {
          map.current.setPaintProperty('background', 'background-color', colors.bottom);
        }
        
        // Completely remove fog/atmospheric haze
        try {
          map.current.setFog(null);
        } catch (e) {
          console.log('Could not remove fog effects');
        }
        
        // Force a repaint to ensure changes are visible
        map.current.triggerRepaint();
        
        console.log('Fog colors updated immediately');
      } catch (error) {
        console.error('Error updating fog colors:', error);
        // Fallback: reinitialize layers if direct update fails
        console.log('Falling back to layer reinitialization');
        setTimeout(() => {
          initializeLayers();
        }, 100);
      }
    }
  };

  const refresh3DFeatures = () => {
    console.log('Manually refreshing 3D features');
    if (map.current && map.current.isStyleLoaded()) {
      initializeLayers();
    }
  };

  // Function to update building colors with height-based shading
  const updateBuildingColors = useCallback((baseColor: string) => {
    if (map.current && map.current.getLayer('3d-buildings')) {
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
      
      // Use height-based interpolation for shading
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
  }, []);

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

    // Add sky layer first
    try {
      console.log('Adding sky layer');
      const colors = getSkyGradientColors(skyGradient);
      currentMap.addLayer({
        'id': 'sky',
        'type': 'sky',
        'paint': {
          'sky-type': 'gradient',
          'sky-gradient-center': [0, 0],
          'sky-gradient-radius': 90,
          'sky-gradient': skyGradient === 'sunset' ? [
            'interpolate',
            ['linear'],
            ['sky-radial-progress'],
            0.0, colors.top,      // Deep blue at top
            0.4, colors.middle1,  // Bright blue
            0.7, colors.middle2,  // Purple-lavender
            1.0, colors.bottom    // Warmer orange
          ] : skyGradient === 'night' ? [
            'interpolate',
            ['linear'],
            ['sky-radial-progress'],
            0.0, colors.top,      // Deep night blue
            0.3, colors.middle1,  // Dark blue-purple
            0.6, colors.middle2,  // Twilight blue
            1.0, colors.bottom    // Slightly lighter night blue
          ] : [
            'interpolate',
            ['linear'],
            ['sky-radial-progress'],
            0.0, colors.top,
            0.5, colors.middle1,
            1.0, colors.bottom
          ],
          'sky-opacity': 1.0
        } as any
      }, map.current.getStyle().layers[map.current.getStyle().layers.length - 1].id);
      
      // Ensure solid blue sky with no fog effects
      
      // Set the background color to match the sky color
      if (currentMap.getLayer('background')) {
        currentMap.setPaintProperty('background', 'background-color', colors.bottom);
      } else {
        currentMap.addLayer({
          'id': 'background',
          'type': 'background',
          'paint': { 'background-color': colors.bottom }
        }, 'sky');
      }

      // Remove fog completely on initialization
      try {
        currentMap.setFog(null);
      } catch (e) {
        console.log('Could not remove fog on initialization');
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
  }, [layers3D, style, terrainExaggeration, fogColor]);

  // Add this useEffect to ensure layers are initialized when the map is ready
  useEffect(() => {
    if (map.current && map.current.isStyleLoaded()) {
      console.log('Map is ready, initializing layers');
      initializeLayers();
    }
  }, [initializeLayers]);

  // Apply default fog color when map is ready
  useEffect(() => {
    if (map.current && map.current.isStyleLoaded()) {
      console.log('Applying default fog color:', fogColor);
      changeFogColor(fogColor);
    }
  }, [map.current, fogColor, changeFogColor]);

  // Apply fog color whenever it changes
  useEffect(() => {
    if (map.current && map.current.isStyleLoaded()) {
      console.log('Fog color changed, applying:', fogColor);
      changeFogColor(fogColor);
    }
  }, [fogColor]);

  // Update building colors whenever buildingColor changes
  useEffect(() => {
    if (map.current && map.current.isStyleLoaded()) {
      updateBuildingColors(buildingColor);
    }
  }, [buildingColor]);

  // Day-Night Cycle Effect
  useEffect(() => {
    if (!dayNightCycle) return;

    const interval = setInterval(() => {
      setCycleTime(prevTime => {
        const newTime = (prevTime + 0.016) % 24; // 24-second cycle, but update every 0.016 seconds for ultra-smooth transitions
        
        // Calculate continuous progress through the cycle (0-1)
        const cycleProgress = newTime / 24;
        
        // Create continuous flowing transitions through all sky colors
        
        // Create truly continuous flowing transitions using mathematical interpolation
        // This creates a smooth, constant motion through all sky colors without phases
        
        // Use trigonometric functions to create smooth, continuous color cycling
        const angle = cycleProgress * 2 * Math.PI; // Convert to radians (0 to 2π)
        
        // Create a continuous mathematical function that smoothly cycles through all colors
        // This eliminates the phase-based approach and creates constant motion
        
                // Calculate continuous color interpolation using sine waves based on selected pattern
        if (skyPattern === 'blue-dominant') {
          // Pattern 1: Sunset → Blue Sky → Sunset (no night)
          const blueIntensity = Math.sin(angle * 0.4) * 0.5 + 0.5; // 0 to 1, much slower cycle for longer blue duration
          const sunsetIntensity = Math.sin(angle + Math.PI/4) * 0.5 + 0.5; // 0 to 1, offset by 45° for better flow
          
          // Apply the continuous color blending directly (no night sky)
          applyContinuousSkyBlending(blueIntensity, sunsetIntensity, 0);
        } else {
          // Pattern 2: Sunset → Night → Sunset
          const sunsetIntensity = Math.sin(angle * 0.6) * 0.5 + 0.5; // 0 to 1, sunset dominates
          const nightIntensity = Math.sin(angle + Math.PI/2) * 0.5 + 0.5; // 0 to 1, night appears in middle
          
          // Apply the continuous color blending with night sky
          applyContinuousSkyBlending(0, sunsetIntensity, nightIntensity);
        }
        
        return newTime;
      });
    }, 16); // Update every 16ms for ultra-smooth 60fps transitions

    return () => clearInterval(interval);
  }, [dayNightCycle, skyPattern]); // Added skyPattern dependency

  // Immediate sky update when pattern changes
  useEffect(() => {
    if (dayNightCycle && map.current && map.current.isStyleLoaded()) {
      // Force an immediate sky update with current pattern
      const currentProgress = cycleTime / 24;
      const angle = currentProgress * 2 * Math.PI;
      
            if (skyPattern === 'blue-dominant') {
        // Pattern 1: Sunset → Blue Sky → Sunset (no night)
        const blueIntensity = Math.sin(angle * 0.4) * 0.5 + 0.5;
        const sunsetIntensity = Math.sin(angle + Math.PI/4) * 0.5 + 0.5;
        applyContinuousSkyBlending(blueIntensity, sunsetIntensity, 0);
      } else {
        // Pattern 2: Sunset → Night → Sunset
        const sunsetIntensity = Math.sin(angle * 0.6) * 0.5 + 0.5;
        const nightIntensity = Math.sin(angle + Math.PI/2) * 0.5 + 0.5;
        applyContinuousSkyBlending(0, sunsetIntensity, nightIntensity);
      }
    }
  }, [skyPattern, dayNightCycle, cycleTime]); // Update when pattern changes

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
          const colors = getSkyGradientColors(skyGradient);
          mapInstance.addLayer({
            'id': 'sky',
            'type': 'sky',
            'paint': {
              'sky-type': 'gradient',
              'sky-gradient-center': [0, 0],
              'sky-gradient-radius': 90,
              'sky-gradient': skyGradient === 'sunset' ? [
                'interpolate',
                ['linear'],
                ['sky-radial-progress'],
                0.0, colors.top,
                0.4, colors.middle1,
                0.7, colors.middle2,
                1.0, colors.bottom
              ] : skyGradient === 'night' ? [
                'interpolate',
                ['linear'],
                ['sky-radial-progress'],
                0.0, colors.top,
                0.3, colors.middle1,
                0.6, colors.middle2,
                1.0, colors.bottom
              ] : [
                'interpolate',
                ['linear'],
                ['sky-radial-progress'],
                0.0, colors.top,
                0.5, colors.middle1,
                1.0, colors.bottom
              ],
              'sky-opacity': 1.0
            } as any
          });
          
          // Add background layer immediately
          mapInstance.addLayer({
            'id': 'background',
            'type': 'background',
            'paint': { 'background-color': colors.bottom }
          }, 'sky');
          
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




    // Cleanup function
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
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
              top: showSidePanel ? 24 : -100,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'auto',
              minHeight: 0,
              zIndex: 1100,
              background: 'rgba(255,255,255,0.75)',
              boxShadow: '2px 0 16px rgba(33,150,243,0.10)',
              borderRadius: '18px',
              padding: '10px 18px',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 18,
              transition: 'top 0.35s cubic-bezier(.4,1.4,.6,1)',
              backdropFilter: 'blur(10px)',
              pointerEvents: showSidePanel ? 'auto' : 'none',
            }}
          >
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="sidepanel-btn"
            style={{
              background: '#fff',
              color: '#222',
              border: '1px solid #e5e7eb',
              borderRadius: 5,
              padding: '13px 14px',
              fontSize: '16px',
              fontWeight: 500,
              fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
              cursor: 'pointer',
              boxShadow: 'none',
              display: 'block',
              textAlign: 'center',
              margin: 0,
              letterSpacing: 0.2,
              transition: 'background 0.15s, box-shadow 0.15s, border 0.15s'
            }}
          >
            World Layout
          </button>
          <button
            onClick={() => setShowModelImport(true)}
            className="sidepanel-btn"
            style={{
              background: '#fff',
              color: '#222',
              border: '1px solid #e5e7eb',
              borderRadius: 5,
              padding: '13px 14px',
              fontSize: '16px',
              fontWeight: 500,
              fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
              cursor: 'pointer',
              boxShadow: 'none',
              display: 'block',
              textAlign: 'center',
              margin: 0,
              letterSpacing: 0.2,
              transition: 'background 0.15s, box-shadow 0.15s, border 0.15s'
            }}
          >
            Import 3D Model
          </button>
          <button
            onClick={handleStartRecording}
            className="sidepanel-btn"
            style={{
              background: '#fff',
              color: '#222',
              border: '1px solid #e5e7eb',
              borderRadius: 5,
              padding: '13px 14px',
              fontSize: '16px',
              fontWeight: 500,
              fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
              cursor: 'pointer',
              boxShadow: 'none',
              display: 'block',
              textAlign: 'center',
              margin: 0,
              letterSpacing: 0.2,
              transition: 'background 0.15s, box-shadow 0.15s, border 0.15s'
            }}
          >
            Start Recording
          </button>
          <button
            onClick={() => {
              const nextGradient = skyGradient === 'blue' ? 'sunset' : skyGradient === 'sunset' ? 'night' : 'blue';
              changeSkyGradient(nextGradient);
              if (onSkyGradientChange) {
                onSkyGradientChange(nextGradient);
              }
            }}
            className="sidepanel-btn"
            style={{
              background: skyGradient === 'blue' ? '#e3f2fd' : skyGradient === 'sunset' ? '#fff3e0' : '#f3e5f5',
              color: '#222',
              border: '1px solid #e5e7eb',
              borderRadius: 5,
              padding: '13px 14px',
              fontSize: '16px',
              fontWeight: 500,
              fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
              cursor: 'pointer',
              boxShadow: 'none',
              display: 'block',
              textAlign: 'center',
              margin: 0,
              letterSpacing: 0.2,
              transition: 'background 0.15s, box-shadow 0.15s, border 0.15s'
            }}
            title={`Current: ${skyGradient} sky - Click to cycle`}
          >
            {skyGradient === 'blue' ? '☀️ Day' : skyGradient === 'sunset' ? '🌅 Sunset' : '🌙 Night'}
          </button>
        </div>
        {/* Separate toggle button that stays visible when panel is collapsed */}
        {!showSidePanel && (
          <button
            className="sidepanel-toggle-btn"
            style={{
              position: 'absolute',
              top: 24,
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
        {isSlideshowMode ? '🎬 Slideshow' : '✏️ Editor'}
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
          ⚙️
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
          ⚙️ Settings
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
          ⚙️ Settings
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
          ⚙️ Settings
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
        {isSlideshowMode ? '🎬 Slideshow' : '✏️ Editor'}
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
          ⚙️
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
          top: '20px',
          left: '20px',
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(10px)',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
          zIndex: 1000,
          minWidth: '300px',
          maxWidth: '400px',
          maxHeight: '80vh',
          overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: '#666'
                }}
              >
                ×
              </button>
              <h3 style={{ margin: 0, color: '#1976d2', fontSize: '18px' }}>World Layout Settings</h3>
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




          {/* Day-Night Cycle */}
          <div style={{ marginBottom: '20px' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#333' }}>Day-Night Cycle</h4>
            
            {/* Sky Pattern Selector */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: '#666' }}>Sky Pattern:</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setSkyPattern('blue-dominant')}
              style={{
                    background: skyPattern === 'blue-dominant' ? '#2196f3' : '#e0e0e0',
                    color: skyPattern === 'blue-dominant' ? 'white' : '#333',
                    border: 'none',
                    padding: '6px 12px',
                borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    flex: '1 1 calc(50% - 4px)',
                    minWidth: '120px'
                  }}
                >
                  🌅 Sunset → ☀️ Blue → 🌅 Sunset
                </button>
                <button
                  onClick={() => setSkyPattern('night-dominant')}
                  style={{
                    background: skyPattern === 'night-dominant' ? '#2196f3' : '#e0e0e0',
                    color: skyPattern === 'night-dominant' ? 'white' : '#333',
                    border: 'none',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    flex: '1 1 calc(50% - 4px)',
                    minWidth: '120px'
                  }}
                >
                  🌅 Sunset → 🌙 Night → 🌅 Sunset
                </button>

              </div>
          </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <button
                onClick={dayNightCycle ? stopDayNightCycle : startDayNightCycle}
                style={{
                  background: dayNightCycle ? '#f44336' : '#4CAF50',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  flex: 1
                }}
              >
                {dayNightCycle ? 'Stop Cycle' : 'Start Cycle'}
              </button>
            </div>

                        {/* Cycle Progress Indicator */}
            {dayNightCycle && (
              <div style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                  <span style={{ flex: '1.0' }}>
                    {skyPattern === 'blue-dominant' ? '🌅 Sunset → ☀️ Blue → 🌅 Sunset' : '🌅 Sunset → 🌙 Night → 🌅 Sunset'}
                  </span>
                </div>
                <div style={{ 
                  width: '100%', 
                  height: '8px', 
                  background: '#e5e7eb', 
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: `${(cycleTime / 24) * 100}%`,
                    height: '100%',
                    background: skyPattern === 'blue-dominant' 
                      ? 'linear-gradient(90deg, #D89060, #3B82F6, #D89060)'
                      : 'linear-gradient(90deg, #D89060, #000000, #D89060)',
                    borderRadius: '4px',
                    transition: 'width 0.1s ease'
                  }} />
                </div>
                <div style={{ textAlign: 'center', fontSize: '11px', color: '#666', marginTop: '4px' }}>
                  {Math.round((cycleTime / 24) * 100)}% complete
          </div>

                {/* Time of Day Indicator */}
                <div style={{ textAlign: 'center', fontSize: '12px', color: '#333', marginTop: '8px', fontWeight: '500' }}>
                  {getTimeOfDay(cycleTime)}
                </div>
              </div>
            )}

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
      )}
    </div>
  );
};

export default Map; 