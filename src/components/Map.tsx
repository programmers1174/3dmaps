import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
// @ts-ignore
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

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
  type: 'hospital' | 'residential' | 'other';
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
      
      // Ask for building type first
      const buildingType = prompt('What type of building is this? (hospital/residential/other)')?.toLowerCase() || 'other';
      const validType = ['hospital', 'residential', 'other'].includes(buildingType) ? buildingType : 'other';
      
      const buildingName = prompt('What would you like to name this building?') || `Building ${buildings.length + 1}`;
      
      setBuildings(prev => [
        ...prev,
        { 
          id, 
          feature, 
          height: 50, 
          name: buildingName,
          type: validType as 'hospital' | 'residential' | 'other'
        }
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

    if (buildings.length === 0) return;

    // Add all buildings as a GeoJSON source
    map.current.addSource('custom-cube', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: buildings.map(b => ({
          ...b.feature,
          properties: { 
            ...b.feature.properties, 
            height: b.height, 
            id: b.id,
            type: b.type
          }
        }))
      }
    });

    // Add the fill-extrusion layer with type-based styling
    map.current.addLayer({
      id: 'custom-cube',
      type: 'fill-extrusion',
      source: 'custom-cube',
      paint: {
        'fill-extrusion-color': [
          'match',
          ['get', 'type'],
          'hospital', '#ff0000', // Red for hospitals
          'residential', '#4CAF50', // Green for residential
          '#2196F3' // Blue for other
        ],
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

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      
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
                  {b.type === 'hospital' ? '🏥' : b.type === 'residential' ? '🏠' : '🏢'} {b.name} Height: {b.height}m
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
      `}</style>
    </div>
  );
};

export default Map; 