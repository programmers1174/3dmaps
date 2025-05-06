import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

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

const Map: React.FC<MapProps> = ({
  accessToken,
  initialCoordinates = [-122.4194, 37.7749], // San Francisco
  initialZoom = 15,
  initialStyle = 'mapbox://styles/mapbox/streets-v12'
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [style, setStyle] = useState(initialStyle);
  const [layers3D, setLayers3D] = useState<Layer3D[]>([
    { id: 'buildings', name: '3D Buildings', enabled: true },
    { id: 'terrain', name: 'Terrain', enabled: false }
  ]);

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

  const changeMapStyle = (newStyle: string) => {
    setStyle(newStyle);
    if (map.current) {
      map.current.setStyle(newStyle);
    }
  };

  useEffect(() => {
    if (!mapContainer.current) return;

    mapboxgl.accessToken = accessToken;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: style,
      center: initialCoordinates as [number, number],
      zoom: initialZoom,
      pitch: 45,
      bearing: -17.6,
      antialias: true
    });

    map.current.on('style.load', () => {
      if (!map.current) return;

      // Add terrain source and layer if enabled
      if (layers3D.find(l => l.id === 'terrain')?.enabled) {
        map.current.addSource('mapbox-dem', {
          'type': 'raster-dem',
          'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
          'tileSize': 512,
          'maxzoom': 14
        });
        map.current.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
      }

      // Add 3D buildings if enabled
      if (layers3D.find(l => l.id === 'buildings')?.enabled) {
        map.current.addLayer({
          'id': '3d-buildings',
          'source': 'composite',
          'source-layer': 'building',
          'filter': ['==', 'extrude', 'true'],
          'type': 'fill-extrusion',
          'minzoom': 15,
          'paint': {
            'fill-extrusion-color': '#aaa',
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              15,
              0,
              15.05,
              ['get', 'height']
            ],
            'fill-extrusion-base': [
              'interpolate',
              ['linear'],
              ['zoom'],
              15,
              0,
              15.05,
              ['get', 'min_height']
            ],
            'fill-extrusion-opacity': 0.6
          }
        });
      }
    });

    return () => {
      if (map.current) {
        map.current.remove();
      }
    };
  }, [accessToken, initialCoordinates, initialZoom, style, layers3D]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      
      {/* Style Controls */}
      <div className="map-controls style-controls">
        <h3>Map Style</h3>
        {mapStyles.map(mapStyle => (
          <button
            key={mapStyle.id}
            onClick={() => changeMapStyle(mapStyle.id)}
            className={style === mapStyle.id ? 'active' : ''}
          >
            {mapStyle.name}
          </button>
        ))}
      </div>

      {/* 3D Controls */}
      <div className="map-controls feature-controls">
        <h3>3D Features</h3>
        {layers3D.map(layer => (
          <button
            key={layer.id}
            onClick={() => toggle3DLayer(layer.id)}
            className={layer.enabled ? 'active' : ''}
          >
            {layer.name}
          </button>
        ))}
      </div>
    </div>
  );
};

export default Map; 