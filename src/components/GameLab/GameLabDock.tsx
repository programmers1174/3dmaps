import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import {
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import {
  GAMELAB_STORAGE_KEY,
  PERSIST_VERSION,
  coerceEntityKind,
  defaultEntity,
  emptyConcept,
  emptyGdd,
  emptyTesting,
  type GameConcept,
  type GameDesignDoc,
  type MapLabEntity,
  type MapLabEntityKind,
  type TestingState,
} from '../../gamelab/projectTypes';
import { attachSceneEntitiesLayer } from '../../gamelab/attachSceneEntitiesLayer';
import { runVisualGraph } from '../../gamelab/runVisualGraph';
import { GameLabFlowContext } from './GameLabFlowContext';
import { VisualLogicEditor } from './VisualLogicEditor';

export interface GameLabDockProps {
  getMap: () => mapboxgl.Map | null;
  /** Increments when the Mapbox instance is ready (see Map.tsx). */
  mapEpoch: number;
  gameAreaPolygon: [number, number][];
}

const DEFAULT_START: Node = {
  id: 'start-1',
  type: 'gameStart',
  position: { x: 32, y: 28 },
  data: {},
};

const GENRES = [
  'Platformer',
  'Puzzle',
  'RPG',
  'Racing / driving',
  'Simulation',
  'Adventure',
  'Shooter',
  'Other',
];

const STAGES = [
  { id: 'preprod' as const, step: 1, label: 'Pre-production' },
  { id: 'production' as const, step: 2, label: 'Production' },
  { id: 'test' as const, step: 3, label: 'Test & polish' },
  { id: 'launch' as const, step: 4, label: 'Launch' },
];

const ASSET_GROUPS: {
  title: string;
  items: { kind: MapLabEntityKind; name: string; describe: string }[];
}[] = [
  {
    title: 'Characters',
    items: [
      { kind: 'player', name: 'Player', describe: 'Hero spawn — you’ll see a green figure on the 3D map.' },
      { kind: 'npc', name: 'NPC', describe: 'Anyone else in the scene — orange figure placeholder.' },
    ],
  },
  {
    title: 'Camera viewpoints',
    items: [
      {
        kind: 'viewpoint',
        name: 'Camera viewpoint',
        describe:
          'A saved angle. Click “Capture current map view” in the list, then use “Move camera” in Visual logic during playtest.',
      },
    ],
  },
  {
    title: 'Objects',
    items: [
      { kind: 'box', name: 'Prop / crate', describe: 'Obstacle or set dressing.' },
      { kind: 'sphere', name: 'Collectible', describe: 'Pickup or goal orb.' },
      { kind: 'marker', name: 'Waypoint pin', describe: 'Path or objective marker.' },
    ],
  },
];

function normalizeTesting(raw: unknown): TestingState {
  const d = emptyTesting();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  if (typeof o.qaNotes === 'string') d.qaNotes = o.qaNotes;
  const c = o.checklist;
  if (c && typeof c === 'object') {
    const ch = c as Record<string, unknown>;
    d.checklist.playedBuild = Boolean(ch.playedBuild);
    d.checklist.notedIssues = Boolean(ch.notedIssues);
    d.checklist.tweakedAfterFeedback = Boolean(ch.tweakedAfterFeedback);
  }
  return d;
}

function normalizeConcept(raw: unknown): GameConcept {
  const d = emptyConcept();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  if (typeof o.title === 'string') d.title = o.title;
  if (typeof o.genre === 'string') d.genre = o.genre;
  if (typeof o.audience === 'string') d.audience = o.audience;
  if (typeof o.elevatorPitch === 'string') d.elevatorPitch = o.elevatorPitch;
  return d;
}

function normalizeGdd(raw: unknown): GameDesignDoc {
  const d = emptyGdd();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  if (typeof o.story === 'string') d.story = o.story;
  if (typeof o.coreMechanics === 'string') d.coreMechanics = o.coreMechanics;
  if (typeof o.artStyle === 'string') d.artStyle = o.artStyle;
  if (typeof o.coreLoop === 'string') d.coreLoop = o.coreLoop;
  return d;
}

function loadSnapshot(): {
  concept: GameConcept;
  gdd: GameDesignDoc;
  testing: TestingState;
  entities: MapLabEntity[];
  nodes: Node[];
  edges: Edge[];
} {
  try {
    const raw = localStorage.getItem(GAMELAB_STORAGE_KEY);
    if (!raw) throw new Error('empty');
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      concept: normalizeConcept(p.concept),
      gdd: normalizeGdd(p.gdd),
      testing: normalizeTesting(p.testing),
      entities: Array.isArray(p.entities)
        ? (p.entities as MapLabEntity[]).map((e) => ({
            ...e,
            kind: coerceEntityKind(typeof e.kind === 'string' ? e.kind : undefined),
          }))
        : [],
      nodes: Array.isArray(p.flowNodes) && (p.flowNodes as Node[]).length ? (p.flowNodes as Node[]) : [DEFAULT_START],
      edges: Array.isArray(p.flowEdges) ? (p.flowEdges as Edge[]) : [],
    };
  } catch {
    return {
      concept: emptyConcept(),
      gdd: emptyGdd(),
      testing: emptyTesting(),
      entities: [],
      nodes: [DEFAULT_START],
      edges: [],
    };
  }
}

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  borderRadius: 12,
  padding: 12,
  marginBottom: 12,
  border: '1px solid rgba(255,255,255,0.07)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  opacity: 0.65,
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(0,0,0,0.35)',
  color: '#eceff4',
  fontSize: 13,
  fontFamily: 'inherit',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 72,
  resize: 'vertical' as const,
};

const GameLabDockInner: React.FC<GameLabDockProps> = ({ getMap, mapEpoch, gameAreaPolygon }) => {
  const snapshot = useMemo(() => loadSnapshot(), []);
  const [stage, setStage] = useState<(typeof STAGES)[number]['id']>('preprod');
  const [prodTab, setProdTab] = useState<'assets' | 'logic' | 'audio'>('assets');

  const [concept, setConcept] = useState<GameConcept>(() => snapshot.concept);
  const [gdd, setGdd] = useState<GameDesignDoc>(() => snapshot.gdd);
  const [testing, setTesting] = useState<TestingState>(() => snapshot.testing);

  const [entities, setEntities] = useState<MapLabEntity[]>(() => snapshot.entities);
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const [nodes, setNodes, onNodesChange] = useNodesState(snapshot.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(snapshot.edges);

  const [placingKind, setPlacingKind] = useState<MapLabEntityKind | null>(null);

  const viewpointOptions = useMemo(
    () =>
      entities
        .filter((e) => e.kind === 'viewpoint')
        .map((e) => ({ id: e.id, label: e.label || `Viewpoint …${e.id.slice(-5)}` })),
    [entities]
  );
  const [playing, setPlaying] = useState(false);
  const [scriptToast, setScriptToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const getMapRef = useRef(getMap);
  getMapRef.current = getMap;

  const notify = useCallback((msg: string) => {
    setScriptToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setScriptToast(null), 4200);
  }, []);

  const stopPlay = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(
          GAMELAB_STORAGE_KEY,
          JSON.stringify({
            version: PERSIST_VERSION,
            concept,
            gdd,
            testing,
            entities,
            flowNodes: nodes,
            flowEdges: edges,
          })
        );
      } catch {
        /* quota */
      }
    }, 450);
    return () => clearTimeout(id);
  }, [concept, gdd, testing, entities, nodes, edges]);

  useEffect(() => {
    if (stage !== 'test' && playing) stopPlay();
  }, [stage, playing, stopPlay]);

  /** Live 3D preview of placed entities (not only during playtest). Re-syncs when style reloads. */
  useEffect(() => {
    const map = getMapRef.current();
    if (!map) return;
    let cleanup: (() => void) | undefined;

    const syncScene = () => {
      cleanup?.();
      cleanup = undefined;
      if (!map.isStyleLoaded()) return;
      const list = entitiesRef.current;
      if (list.length > 0) {
        cleanup = attachSceneEntitiesLayer(map, list);
      }
    };

    syncScene();
    map.on('style.load', syncScene);

    return () => {
      map.off('style.load', syncScene);
      cleanup?.();
    };
  }, [entities, mapEpoch]);

  /**
   * Mapbox Draw often eats `map.on('click')`. Use capture on the map canvas + unproject so drops always register.
   * `getMap` is read from ref so parent re-renders do not tear this listener down.
   */
  useEffect(() => {
    if (playing || !placingKind) return;
    const map = getMapRef.current();
    if (!map) return;
    const canvas = map.getCanvas();
    const kind = placingKind;

    const onCanvasClick = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (
        ev.clientX < rect.left ||
        ev.clientX > rect.right ||
        ev.clientY < rect.top ||
        ev.clientY > rect.bottom
      ) {
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const lngLat = map.unproject([x, y]);
      setEntities((prev) => [...prev, defaultEntity(kind, lngLat.lng, lngLat.lat)]);
      setPlacingKind(null);
    };

    canvas.addEventListener('click', onCanvasClick, true);
    canvas.style.cursor = 'crosshair';
    return () => {
      canvas.removeEventListener('click', onCanvasClick, true);
      canvas.style.cursor = '';
    };
  }, [placingKind, playing]);

  const blankProject = () => {
    if (playing) return;
    setConcept(emptyConcept());
    setGdd(emptyGdd());
    setTesting(emptyTesting());
    setEntities([]);
    setNodes([DEFAULT_START]);
    setEdges([]);
    setPlacingKind(null);
    setStage('preprod');
  };

  const removeEntity = (id: string) => {
    setEntities((prev) => prev.filter((e) => e.id !== id));
  };

  const runPlay = async () => {
    const map = getMap();
    if (!map || playing) return;

    stopPlay();
    setPlaying(true);
    setTesting((t) => ({
      ...t,
      checklist: { ...t.checklist, playedBuild: true },
    }));

    await new Promise<void>((resolve) => {
      if (map.isStyleLoaded()) resolve();
      else map.once('style.load', () => resolve());
    });

    const ac = new AbortController();
    abortRef.current = ac;

    const snaps = nodes.map((n) => ({
      id: n.id,
      type: n.type,
      data: n.data as Record<string, unknown> | undefined,
    }));
    const link = edges.map((e) => ({ source: e.source, target: e.target }));

    try {
      await runVisualGraph(snaps, link, {
        onToast: notify,
        signal: ac.signal,
        entities,
        map,
      });
    } catch {
      /* aborted */
    } finally {
      abortRef.current = null;
      setPlaying(false);
    }
  };

  const exportProject = () => {
    const payload = {
      version: PERSIST_VERSION,
      concept,
      gdd,
      testing,
      entities,
      flowNodes: nodes,
      flowEdges: edges,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safe = (concept.title || 'my-game').replace(/[^\w\d-_]+/g, '-').slice(0, 48);
    a.download = `${safe}-gamelab.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const areaActive = gameAreaPolygon.length >= 3;
  const widePanel = stage === 'production' && prodTab === 'logic';
  const panelW = widePanel ? 'min(94vw, 560px)' : 'min(94vw, 420px)';

  const updateCheck = (key: keyof TestingState['checklist'], v: boolean) => {
    setTesting((t) => ({
      ...t,
      checklist: { ...t.checklist, [key]: v },
    }));
  };

  return (
    <>
      <div
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          width: panelW,
          maxHeight: 'min(82vh, 680px)',
          overflowY: 'auto',
          zIndex: 1200,
          background: 'linear-gradient(165deg, rgba(22,22,30,0.98) 0%, rgba(14,14,20,0.99) 100%)',
          color: '#eceff4',
          borderRadius: 18,
          padding: 16,
          boxShadow: '0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(124,77,255,0.12)',
          border: '1px solid rgba(255,255,255,0.06)',
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <header style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#b39ddb', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Game production studio
          </div>
          <h2 style={{ margin: '6px 0 4px', fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em' }}>GameLab</h2>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.72, lineHeight: 1.45 }}>
            Follow the same stages real studios use: plan a small scope, build a prototype, test, then think about launch.
          </p>
        </header>

        <nav
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 6,
            marginBottom: 16,
          }}
          aria-label="Production stages"
        >
          {STAGES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStage(s.id)}
              style={{
                padding: '8px 6px',
                borderRadius: 10,
                border: stage === s.id ? '1px solid rgba(124,77,255,0.65)' : '1px solid rgba(255,255,255,0.08)',
                background: stage === s.id ? 'rgba(124, 77, 255, 0.2)' : 'rgba(255,255,255,0.03)',
                color: '#fff',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 10, opacity: 0.7 }}>Stage {s.step}</div>
              <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>{s.label}</div>
            </button>
          ))}
        </nav>

        {stage === 'preprod' && (
          <div>
            <div style={card}>
              <strong style={{ color: '#90caf9' }}>Develop the game concept</strong>
              <p style={{ margin: '8px 0 12px', fontSize: 12, opacity: 0.8 }}>
                Lock in genre and audience early so you do not drown in scope creep.
              </p>
              <label style={labelStyle}>Working title</label>
              <input
                style={inputStyle}
                value={concept.title}
                onChange={(e) => setConcept((c) => ({ ...c, title: e.target.value }))}
                placeholder="My first map game"
              />
              <label style={{ ...labelStyle, marginTop: 10 }}>Genre</label>
              <select
                style={inputStyle}
                value={concept.genre}
                onChange={(e) => setConcept((c) => ({ ...c, genre: e.target.value }))}
              >
                <option value="">Choose…</option>
                {GENRES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <label style={{ ...labelStyle, marginTop: 10 }}>Target audience</label>
              <input
                style={inputStyle}
                value={concept.audience}
                onChange={(e) => setConcept((c) => ({ ...c, audience: e.target.value }))}
                placeholder="Friends, classroom, jam judges…"
              />
              <label style={{ ...labelStyle, marginTop: 10 }}>Elevator pitch (one or two sentences)</label>
              <textarea
                style={textareaStyle}
                value={concept.elevatorPitch}
                onChange={(e) => setConcept((c) => ({ ...c, elevatorPitch: e.target.value }))}
                placeholder="What does the player do, and why is it fun?"
                rows={3}
              />
            </div>

            <div style={card}>
              <strong style={{ color: '#a5d6a7' }}>Start small</strong>
              <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.82 }}>
                Your first shipped idea should be tiny: one core loop, one map area, one reason to replay. GameLab is built
                for that—real geography as your stage, props as stand-in art, visual logic as your first “code.”
              </p>
            </div>

            <div style={card}>
              <strong style={{ color: '#ffcc80' }}>Game Design Document (living doc)</strong>
              <p style={{ margin: '8px 0 12px', fontSize: 12, opacity: 0.8 }}>
                Update this when something stops being fun. It is okay to delete ideas.
              </p>
              <label style={labelStyle}>Story / fantasy (optional)</label>
              <textarea
                style={textareaStyle}
                value={gdd.story}
                onChange={(e) => setGdd((g) => ({ ...g, story: e.target.value }))}
                rows={2}
              />
              <label style={{ ...labelStyle, marginTop: 10 }}>Gameplay mechanics (bullets or short notes)</label>
              <textarea
                style={textareaStyle}
                value={gdd.coreMechanics}
                onChange={(e) => setGdd((g) => ({ ...g, coreMechanics: e.target.value }))}
                placeholder="e.g. Click map to place props; visual script runs on Play…"
                rows={3}
              />
              <label style={{ ...labelStyle, marginTop: 10 }}>Art direction</label>
              <textarea
                style={textareaStyle}
                value={gdd.artStyle}
                onChange={(e) => setGdd((g) => ({ ...g, artStyle: e.target.value }))}
                placeholder="Colors, mood, reference games…"
                rows={2}
              />
              <label style={{ ...labelStyle, marginTop: 10 }}>Core loop</label>
              <textarea
                style={textareaStyle}
                value={gdd.coreLoop}
                onChange={(e) => setGdd((g) => ({ ...g, coreLoop: e.target.value }))}
                placeholder="What does the player repeat? e.g. Place → Play → tweak script → repeat"
                rows={2}
              />
            </div>

            <div style={card}>
              <strong style={{ color: '#ce93d8' }}>Prototype</strong>
              <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.85 }}>
                A prototype here means: props on the map + a short visual script you can playtest. Move to{' '}
                <strong>Production</strong> to place assets and wire logic, then <strong>Test & polish</strong> to see if the
                loop feels good before you expand.
              </p>
            </div>
          </div>
        )}

        {stage === 'production' && (
          <div>
            <div style={card}>
              <strong>Your “engine” in GameLab</strong>
              <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.82 }}>
                Commercial engines include Unity, Unreal, Godot, GameMaker. Here you get <strong>Mapbox</strong> (world +
                terrain), <strong>Three.js</strong> (3D props), and <strong>visual logic</strong> (your first scripts)—enough
                to prove a mechanic on a real place.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {(
                [
                  ['assets', 'Assets'],
                  ['logic', 'Visual logic'],
                  ['audio', 'Audio'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setProdTab(id)}
                  style={{
                    flex: 1,
                    padding: '8px 6px',
                    borderRadius: 10,
                    border: prodTab === id ? '1px solid rgba(129,199,132,0.55)' : '1px solid rgba(255,255,255,0.1)',
                    background: prodTab === id ? 'rgba(129, 199, 132, 0.15)' : 'rgba(255,255,255,0.03)',
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 12,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {prodTab === 'assets' && (
              <>
                <div style={{ ...card, marginBottom: 14, borderColor: 'rgba(129,199,132,0.25)' }}>
                  <strong style={{ color: '#a5d6a7' }}>The map is your level</strong>
                  <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.88, lineHeight: 1.5 }}>
                    Everything <strong>behind this panel</strong> is the game world (real Mapbox terrain and buildings). Drag to
                    pan, scroll to zoom, right-drag (or Ctrl+drag) to rotate. Move to your play area, <em>then</em> choose a
                    tool below and <strong>click on the map</strong> to drop that character, camera, or object there. During
                    playtest you’ll see 3D figures at those spots.
                  </p>
                </div>
                <p style={{ margin: '0 0 10px', fontSize: 12, opacity: 0.78 }}>
                  <strong>Place on map:</strong> select one tool → click the map once. Your list below is the cast & set list.
                </p>
                {ASSET_GROUPS.map((group) => (
                  <div key={group.title} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#b39ddb', marginBottom: 8, letterSpacing: '0.04em' }}>
                      {group.title}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {group.items.map((item) => (
                        <button
                          key={item.kind + item.name}
                          type="button"
                          disabled={playing}
                          onClick={() => setPlacingKind((k) => (k === item.kind ? null : item.kind))}
                          style={{
                            textAlign: 'left',
                            padding: '10px 12px',
                            borderRadius: 10,
                            border:
                              placingKind === item.kind ? '2px solid #66bb6a' : '1px solid rgba(255,255,255,0.12)',
                            background:
                              placingKind === item.kind ? 'rgba(102, 187, 106, 0.18)' : 'rgba(255,255,255,0.04)',
                            color: '#fff',
                            cursor: playing ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{item.name}</div>
                          <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4, lineHeight: 1.35 }}>{item.describe}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {placingKind && !playing && (
                  <div style={{ fontSize: 12, color: '#a5d6a7', marginBottom: 10, fontWeight: 600 }}>
                    Now click the map to place this item…
                  </div>
                )}
                <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 12 }}>
                  {entities.length === 0 ? (
                    <div style={{ fontSize: 12, opacity: 0.5 }}>Nothing placed yet — pick Player, NPC, Camera, or an object.</div>
                  ) : (
                    entities.map((e) => (
                      <EditableEntityRow
                        key={e.id}
                        entity={e}
                        onUpdate={setEntities}
                        onRemove={() => removeEntity(e.id)}
                        disabled={playing}
                        getMap={getMap}
                      />
                    ))
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={blankProject}
                    disabled={playing}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.15)',
                      background: 'rgba(0,0,0,0.25)',
                      color: '#ffab91',
                      cursor: playing ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Reset entire project
                  </button>
                  <span style={{ fontSize: 11, opacity: 0.5 }}>
                    Autosaves ·{areaActive ? ' Top-bar region can anchor future rules.' : ''}
                  </span>
                </div>
              </>
            )}

            {prodTab === 'logic' && (
              <GameLabFlowContext.Provider value={{ viewpointOptions }}>
                <VisualLogicEditor
                  tabVisible={prodTab === 'logic'}
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  setNodes={setNodes}
                  setEdges={setEdges}
                  readOnly={playing}
                />
              </GameLabFlowContext.Provider>
            )}

            {prodTab === 'audio' && (
              <div style={card}>
                <strong>Audio design</strong>
                <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.82 }}>
                  Music, SFX, and VO come after the core loop feels good. This tab is a placeholder—import or record audio in a
                  future version. For now, note ideas in your GDD.
                </p>
              </div>
            )}

            <div
              style={{
                marginTop: 14,
                padding: 10,
                borderRadius: 10,
                background: 'rgba(100, 181, 246, 0.08)',
                border: '1px solid rgba(100, 181, 246, 0.2)',
                fontSize: 12,
              }}
            >
              Ready to see if it is fun? Go to <strong>Stage 3 — Test & polish</strong> and run a playtest.
            </div>
          </div>
        )}

        {stage === 'test' && (
          <div>
            <div style={card}>
              <strong style={{ color: '#ffab91' }}>Testing (QA)</strong>
              <p style={{ margin: '8px 0 12px', fontSize: 12, opacity: 0.85 }}>
                Alpha = you and friends; beta = wider players. Play repeatedly, log weird behavior, then polish mechanics and
                UI—not the other way around.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {(
                  [
                    ['playedBuild', 'I ran a full playtest this session'] as const,
                    ['notedIssues', 'I wrote down bugs or confusing moments'] as const,
                    ['tweakedAfterFeedback', 'I changed something based on what I learned'] as const,
                  ] as const
                ).map(([key, text]) => (
                  <label
                    key={key}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={testing.checklist[key]}
                      onChange={(e) => updateCheck(key, e.target.checked)}
                    />
                    {text}
                  </label>
                ))}
              </div>
              <label style={labelStyle}>QA notes & polish backlog</label>
              <textarea
                style={{ ...textareaStyle, minHeight: 100 }}
                value={testing.qaNotes}
                onChange={(e) => setTesting((t) => ({ ...t, qaNotes: e.target.value }))}
                placeholder="Bug: …  /  Feels slow when…  /  Next: add sound when…"
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {!playing ? (
                <button
                  type="button"
                  onClick={runPlay}
                  style={{
                    flex: 1,
                    padding: '14px 16px',
                    borderRadius: 12,
                    border: 'none',
                    fontWeight: 800,
                    cursor: 'pointer',
                    color: '#0d1117',
                    background: 'linear-gradient(135deg, #c5e1a5, #7cb342)',
                    fontSize: 15,
                  }}
                >
                  Playtest
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopPlay}
                  style={{
                    flex: 1,
                    padding: '14px 16px',
                    borderRadius: 12,
                    border: 'none',
                    fontWeight: 800,
                    cursor: 'pointer',
                    color: '#fff',
                    background: '#c62828',
                    fontSize: 15,
                  }}
                >
                  Stop playtest
                </button>
              )}
            </div>
          </div>
        )}

        {stage === 'launch' && (
          <div>
            <div style={card}>
              <strong>Release</strong>
              <p style={{ margin: '8px 0 12px', fontSize: 12, opacity: 0.85 }}>
                Web builds can go to itch.io, your own site, or GitHub Pages. Mobile and console need their own pipelines—plan
                that when the prototype earns more time.
              </p>
              <button
                type="button"
                onClick={exportProject}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(124, 77, 255, 0.25)',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Download project JSON (backup / portfolio)
              </button>
            </div>
            <div style={card}>
              <strong>Marketing (when you have something shareable)</strong>
              <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.82 }}>
                Short clip or GIF, one sentence pitch, post where your audience hangs out. Post-launch: patches, small updates,
                maybe DLC-sized ideas—only after the core game is solid.
              </p>
            </div>
            <div style={card}>
              <strong>Level up as a hobbyist</strong>
              <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.82 }}>
                Try a game jam (48h scope), join r/gamedev or engine Discords, and keep shrinking scope until you finish—then
                grow the next project.
              </p>
            </div>
          </div>
        )}
      </div>

      {scriptToast && (
        <div
          style={{
            position: 'absolute',
            top: 72,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1250,
            maxWidth: 'min(90vw, 420px)',
            padding: '12px 18px',
            borderRadius: 12,
            background: 'rgba(20, 24, 32, 0.94)',
            color: '#e3f2fd',
            fontSize: 14,
            border: '1px solid rgba(100, 181, 246, 0.4)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
            textAlign: 'center',
          }}
        >
          {scriptToast}
        </div>
      )}
    </>
  );
};

const KIND_LABEL: Record<MapLabEntityKind, string> = {
  player: 'Player',
  npc: 'NPC',
  viewpoint: 'Camera',
  box: 'Prop',
  sphere: 'Orb',
  marker: 'Pin',
};

function EditableEntityRow({
  entity,
  onUpdate,
  onRemove,
  disabled,
  getMap,
}: {
  entity: MapLabEntity;
  onUpdate: React.Dispatch<React.SetStateAction<MapLabEntity[]>>;
  onRemove: () => void;
  disabled: boolean;
  getMap: () => mapboxgl.Map | null;
}) {
  const setNum = (field: 'altitudeM' | 'viewBearing' | 'viewPitch' | 'viewZoom', v: number) => {
    onUpdate((list) => list.map((x) => (x.id === entity.id ? { ...x, [field]: v } : x)));
  };

  return (
    <div
      style={{
        marginBottom: 10,
        padding: 10,
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 10,
        fontSize: 11,
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, minWidth: 72 }}>{KIND_LABEL[entity.kind]}</span>
        <input
          type="text"
          disabled={disabled}
          placeholder="Label"
          value={entity.label ?? ''}
          onChange={(ev) =>
            onUpdate((list) => list.map((x) => (x.id === entity.id ? { ...x, label: ev.target.value } : x)))
          }
          style={{
            flex: 1,
            minWidth: 100,
            padding: '4px 6px',
            borderRadius: 6,
            border: '1px solid #444',
            background: '#1e1e24',
            color: '#fff',
            fontSize: 11,
          }}
        />
        <input
          type="color"
          value={entity.color}
          disabled={disabled}
          onChange={(ev) =>
            onUpdate((list) => list.map((x) => (x.id === entity.id ? { ...x, color: ev.target.value } : x)))
          }
          style={{ width: 28, height: 24, border: 'none', padding: 0, background: 'transparent' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          alt m
          <input
            type="number"
            disabled={disabled}
            value={entity.altitudeM}
            step={1}
            onChange={(ev) => setNum('altitudeM', Number(ev.target.value))}
            style={{ width: 44, fontSize: 11, borderRadius: 4, border: '1px solid #444', background: '#222', color: '#fff' }}
          />
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          style={{
            marginLeft: 'auto',
            border: 'none',
            background: 'rgba(198,40,40,0.5)',
            color: '#fff',
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          Remove
        </button>
      </div>
      {entity.kind === 'viewpoint' && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 6 }}>Saved camera (used by “Move camera” in Visual logic)</div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const m = getMap();
              if (!m) return;
              const c = m.getCenter();
              onUpdate((list) =>
                list.map((x) =>
                  x.id === entity.id
                    ? {
                        ...x,
                        lng: c.lng,
                        lat: c.lat,
                        viewBearing: m.getBearing(),
                        viewPitch: m.getPitch(),
                        viewZoom: m.getZoom(),
                      }
                    : x
                )
              );
            }}
            style={{
              width: '100%',
              marginBottom: 8,
              padding: '6px 8px',
              borderRadius: 8,
              border: '1px solid rgba(255,213,79,0.45)',
              background: 'rgba(255,213,79,0.12)',
              color: '#fff9c4',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Capture current map view (position + angle + zoom)
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <label>
              <span style={{ display: 'block', opacity: 0.6, fontSize: 9 }}>bearing°</span>
              <input
                type="number"
                disabled={disabled}
                value={entity.viewBearing ?? 0}
                onChange={(ev) => setNum('viewBearing', Number(ev.target.value))}
                style={{ width: '100%', fontSize: 11, borderRadius: 4, border: '1px solid #444', background: '#222', color: '#fff' }}
              />
            </label>
            <label>
              <span style={{ display: 'block', opacity: 0.6, fontSize: 9 }}>pitch°</span>
              <input
                type="number"
                disabled={disabled}
                value={entity.viewPitch ?? 55}
                onChange={(ev) => setNum('viewPitch', Number(ev.target.value))}
                style={{ width: '100%', fontSize: 11, borderRadius: 4, border: '1px solid #444', background: '#222', color: '#fff' }}
              />
            </label>
            <label>
              <span style={{ display: 'block', opacity: 0.6, fontSize: 9 }}>zoom</span>
              <input
                type="number"
                disabled={disabled}
                value={entity.viewZoom ?? 17}
                step={0.25}
                onChange={(ev) => setNum('viewZoom', Number(ev.target.value))}
                style={{ width: '100%', fontSize: 11, borderRadius: 4, border: '1px solid #444', background: '#222', color: '#fff' }}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GameLabDock(props: GameLabDockProps) {
  return (
    <ReactFlowProvider>
      <GameLabDockInner {...props} />
    </ReactFlowProvider>
  );
}

