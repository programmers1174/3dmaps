import type mapboxgl from 'mapbox-gl';
import type { MapLabEntity } from './projectTypes';

export interface FlowNodeSnapshot {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
}

export interface FlowEdgeSnapshot {
  source: string;
  target: string;
}

/**
 * Walks a single chain from the first `gameStart` node (first outgoing edge wins if branches).
 */
export async function runVisualGraph(
  nodes: FlowNodeSnapshot[],
  edges: FlowEdgeSnapshot[],
  ctx: {
    onToast: (message: string) => void;
    signal?: AbortSignal;
    entities?: MapLabEntity[];
    map?: mapboxgl.Map | null;
  }
): Promise<void> {
  const start = nodes.find((n) => n.type === 'gameStart');
  if (!start) {
    ctx.onToast('Add a “When game plays” block and connect it to actions.');
    return;
  }

  const waitMs = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (ctx.signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const id = window.setTimeout(() => {
        if (ctx.signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        resolve();
      }, ms);
      const onAbort = () => {
        window.clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      ctx.signal?.addEventListener('abort', onAbort, { once: true });
    });

  let currentId: string | undefined = start.id;

  while (currentId) {
    if (ctx.signal?.aborted) return;

    const node = nodes.find((n) => n.id === currentId);
    if (!node) break;

    const t = node.type;
    if (t === 'toast') {
      const msg = String(node.data?.message ?? '').trim() || '(empty message)';
      ctx.onToast(msg);
    } else if (t === 'wait') {
      const sec = Math.max(0, Number(node.data?.seconds ?? 1));
      try {
        await waitMs(sec * 1000);
      } catch {
        return;
      }
    } else if (t === 'cameraGoto') {
      const eid = String(node.data?.entityId ?? '').trim();
      const ent = ctx.entities?.find((x) => x.id === eid && x.kind === 'viewpoint');
      if (!eid) {
        ctx.onToast('In “Move camera”, choose which camera viewpoint to use.');
      } else if (!ent) {
        ctx.onToast('That viewpoint was not found. Add a Camera viewpoint on the map in Production → Assets.');
      } else if (!ctx.map) {
        ctx.onToast('Map is not ready.');
      } else {
        ctx.map.easeTo({
          center: [ent.lng, ent.lat],
          bearing: ent.viewBearing ?? 0,
          pitch: Math.min(85, Math.max(0, ent.viewPitch ?? 55)),
          zoom: Math.min(22, Math.max(1, ent.viewZoom ?? 17)),
          duration: 1000,
          essential: true,
        });
        try {
          await waitMs(1050);
        } catch {
          return;
        }
      }
    }

    const outs = edges.filter((e) => e.source === currentId);
    currentId = outs[0]?.target;
  }
}
