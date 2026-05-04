export type MapLabEntityKind = 'player' | 'npc' | 'viewpoint' | 'box' | 'sphere' | 'marker';

export interface MapLabEntity {
  id: string;
  kind: MapLabEntityKind;
  lng: number;
  lat: number;
  altitudeM: number;
  color: string;
  label?: string;
  /** For viewpoint: map camera when “Move camera” runs or when you capture view */
  viewBearing?: number;
  viewPitch?: number;
  viewZoom?: number;
}

/** Stage 1 — what you’re making and for whom */
export interface GameConcept {
  title: string;
  genre: string;
  audience: string;
  elevatorPitch: string;
}

/** Stage 1 — living design doc (keep updating as you learn) */
export interface GameDesignDoc {
  story: string;
  coreMechanics: string;
  artStyle: string;
  coreLoop: string;
}

/** Stage 3 — QA notes + lightweight checklist */
export interface TestingState {
  qaNotes: string;
  checklist: {
    playedBuild: boolean;
    notedIssues: boolean;
    tweakedAfterFeedback: boolean;
  };
}

export const GAMELAB_STORAGE_KEY = 'gamelab-project-v1';

export const PERSIST_VERSION = 2 as const;

export interface PersistedGameLabProjectV2 {
  version: typeof PERSIST_VERSION;
  concept: GameConcept;
  gdd: GameDesignDoc;
  testing: TestingState;
  entities: MapLabEntity[];
  flowNodes: unknown[];
  flowEdges: unknown[];
}

export function emptyConcept(): GameConcept {
  return { title: '', genre: '', audience: '', elevatorPitch: '' };
}

export function emptyGdd(): GameDesignDoc {
  return { story: '', coreMechanics: '', artStyle: '', coreLoop: '' };
}

export function emptyTesting(): TestingState {
  return {
    qaNotes: '',
    checklist: { playedBuild: false, notedIssues: false, tweakedAfterFeedback: false },
  };
}

const KIND_DEFAULTS: Record<
  MapLabEntityKind,
  { altitudeM: number; color: string; viewBearing?: number; viewPitch?: number; viewZoom?: number }
> = {
  player: { altitudeM: 2, color: '#43a047' },
  npc: { altitudeM: 2, color: '#fb8c00' },
  viewpoint: { altitudeM: 35, color: '#fdd835', viewBearing: -24, viewPitch: 58, viewZoom: 17 },
  box: { altitudeM: 4, color: '#ef5350' },
  sphere: { altitudeM: 4, color: '#42a5f5' },
  marker: { altitudeM: 12, color: '#ab47bc' },
};

/** Coerce legacy or edited JSON into a valid kind */
export function coerceEntityKind(k: string | undefined): MapLabEntityKind {
  const allowed: MapLabEntityKind[] = ['player', 'npc', 'viewpoint', 'box', 'sphere', 'marker'];
  if (k && allowed.includes(k as MapLabEntityKind)) return k as MapLabEntityKind;
  return 'box';
}

export function defaultEntity(kind: MapLabEntityKind, lng: number, lat: number): MapLabEntity {
  const d = KIND_DEFAULTS[kind];
  const base: MapLabEntity = {
    id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    lng,
    lat,
    altitudeM: d.altitudeM,
    color: d.color,
  };
  if (kind === 'viewpoint') {
    base.viewBearing = d.viewBearing;
    base.viewPitch = d.viewPitch;
    base.viewZoom = d.viewZoom;
    base.label = 'Camera A';
  }
  if (kind === 'player') base.label = 'Player';
  if (kind === 'npc') base.label = 'NPC';
  return base;
}
