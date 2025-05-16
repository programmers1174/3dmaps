declare module '@mapbox/mapbox-gl-draw' {
  import { IControl } from 'mapbox-gl';
  import { Feature, GeoJSON } from 'geojson';

  interface DrawStyle {
    'id': string;
    'type': string;
    'filter': any[];
    'paint': {
      [key: string]: any;
    };
    'layout'?: {
      [key: string]: any;
    };
  }

  export default class MapboxDraw implements IControl {
    constructor(options?: {
      displayControlsDefault?: boolean;
      controls?: {
        point?: boolean;
        line_string?: boolean;
        polygon?: boolean;
        trash?: boolean;
        combine_features?: boolean;
        uncombine_features?: boolean;
      };
      defaultMode?: string;
      styles?: DrawStyle[];
    });
    add(geojson: GeoJSON): string[];
    get(ids: string | string[]): Feature[];
    getAll(): { features: Feature[] };
    delete(ids: string | string[]): Feature[];
    deleteAll(): Feature[];
    getMode(): string;
    changeMode(mode: string): void;
    onAdd(map: mapboxgl.Map): HTMLElement;
    onRemove(map: mapboxgl.Map): any;
  }
} 