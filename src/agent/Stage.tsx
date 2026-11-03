import { useEffect, useMemo, useState } from 'react';
import type { Outfit, Region } from '../../shared/protocol';
import { brandOf, formatPrice, thumbUrl, product } from '../lib/catalog';
import { FitPill } from './Conversation';
import type { PipelineRow, TryonState } from './useTryon';

const STAGE_COPY: Record<PipelineRow['stage'], { title: string; model: string }> = {
  render: { title: 'Render the outfit on you', model: 'Muse Image' },
  verify: { title: 'Check every piece against its product photo', model: 'Muse Spark' },
  shoppable: { title: 'Make each piece tappable', model: 'SAM 3.1' },
};

function useTick(active: boolean) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
}

function rowTitle(row: PipelineRow): string {
  if (row.stage === 'render' && row.mode === 'fix') return 'Fix what the check found';
  if (row.stage === 'render' && row.mode === 'swap') return 'Swap only the changed pieces';
  return STAGE_COPY[row.stage].title;
}

function Pipeline({ rows }: { rows: PipelineRow[] }) {
  useTick(rows.some((r) => r.status === 'active'));
  return (
    <ol className="pipeline" aria-live="polite">
      {rows.map((row) => (
        <li key={row.key} className={`pipe pipe-${row.status}`}>
          <span className="pipe-marker" aria-hidden />
          <div className="pipe-body">
            <p className="pipe-title">
              {rowTitle(row)}
              <span className="pipe-time">{(((row.endedAt ?? Date.now()) - row.startedAt) / 1000).toFixed(0)}s</span>
            </p>
            <p className="pipe-detail">
              {STAGE_COPY[row.stage].model}
              {row.detail && ` · ${row.detail}`}
            </p>
            {row.verification && (
              <ul className="pipe-checks">
                {row.verification.items.map((item) => (
                  <li key={item.productId} className={item.score >= 7 ? 'check-pass' : 'check-fail'} title={item.issue}>
                    <img src={thumbUrl(item.productId)} alt={product(item.productId)?.name ?? item.productId} />
                    <span>{item.score}/10</span>
                  </li>
                ))}
                <li className={row.verification.identityPreserved ? 'check-pass' : 'check-fail'}>
                  <span className="check-identity">You</span>
                  <span>{row.verification.identityPreserved ? 'kept' : 'changed'}</span>
                </li>
              </ul>
            )}
            {row.verification && !row.verification.passed && (
              <p className="pipe-issue">
                {row.verification.items
                  .filter((i) => i.score < 7)
                  .map((i) => `${product(i.productId)?.garment ?? i.productId}: ${i.issue}`)
                  .join(' · ') || row.verification.summary}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

interface HotspotsProps {
  regions: Region[];
  width: number;
  height: number;
  active: string | null;
  onSelect: (productId: string) => void;
}

function Hotspots({ regions, width, height, active, onSelect }: HotspotsProps) {
  const [hover, setHover] = useState<string | null>(null);
  const byProduct = useMemo(() => {
    const map = new Map<string, Region[]>();
    for (const r of regions) map.set(r.productId, [...(map.get(r.productId) ?? []), r]);
    return map;
  }, [regions]);
  return (
    <svg className="hotspots" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {[...byProduct.entries()].map(([productId, parts]) => {
        const p = product(productId);
        const lit = hover === productId || active === productId;
        return (
          <g
            key={productId}
            className={`hotspot ${lit ? 'hotspot-lit' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`Shop ${p?.name ?? productId}`}
            onMouseEnter={() => setHover(productId)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(productId)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect(productId)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(productId)}
          >
            {parts.map((r, i) => (
              <path
                key={i}
                d={r.path}
                transform={`translate(${r.left} ${r.top}) scale(${(r.right - r.left) / r.maskWidth} ${(r.bottom - r.top) / r.maskHeight})`}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function ProductPopover({ productId, outfit, onClose }: { productId: string; outfit: Outfit | null; onClose: () => void }) {
  const p = product(productId);
  if (!p) return null;
  const item = outfit?.items.find((i) => i.productId === productId);
  const openInStore = () => {
    if (window.parent !== window) window.parent.postMessage({ type: 'tryzeon:product', id: p.id }, '*');
    else window.open(`/?product=${p.id}`, '_blank');
  };
  return (
    <div className="popover" role="dialog" aria-label={p.name}>
      <img src={thumbUrl(p.id)} alt="" />
      <div>
        <span className="outfit-brand">{brandOf(p).name}</span>
        <p className="popover-name">{p.name}</p>
        <p className="popover-meta">
          {formatPrice(p.price)} {item && <FitPill verdict={item.fit} size={item.size} />}
        </p>
        <button className="btn-primary" onClick={openInStore}>
          View in store
        </button>
      </div>
      <button className="popover-close" onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  );
}

interface StageProps {
  personPhoto: string;
  tryon: TryonState;
}

export function Stage({ personPhoto, tryon }: StageProps) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const image = tryon.preview ?? tryon.result?.image ?? personPhoto;
  const rendering = tryon.status === 'running' && tryon.rows.at(-1)?.stage === 'render';
  const showHotspots = tryon.status === 'done' && tryon.regions && size && image === tryon.result?.image;

  useEffect(() => setSelected(null), [tryon.result?.image]);

  return (
    <div className="stage">
      <figure className={`mirror ${rendering ? 'mirror-rendering' : ''}`}>
        <div className="mirror-frame">
          <img
            src={image}
            alt={tryon.result ? 'You wearing the outfit' : 'Your photo'}
            onLoad={(e) => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          />
          {showHotspots && (
            <Hotspots regions={tryon.regions!} width={size.width} height={size.height} active={selected} onSelect={setSelected} />
          )}
          {tryon.result && image === tryon.result.image && (
            <span className={`mirror-badge ${tryon.result.verified ? 'badge-ok' : 'badge-warn'}`}>
              {tryon.result.verified ? 'Checked: every piece matches' : 'Closest render; some details may differ'}
            </span>
          )}
        </div>
        <figcaption>
          {tryon.status === 'idle' && 'This is you. Ask for an outfit, then try it on.'}
          {tryon.status === 'running' && 'Working on your fitting…'}
          {tryon.status === 'done' && (showHotspots ? 'Tap any piece to shop it.' : 'Your fitting is ready.')}
          {tryon.status === 'error' && `The fitting stopped: ${tryon.error}. Try again.`}
        </figcaption>
        {selected && showHotspots && <ProductPopover productId={selected} outfit={tryon.outfit} onClose={() => setSelected(null)} />}
      </figure>
      {tryon.rows.length > 0 && <Pipeline rows={tryon.rows} />}
    </div>
  );
}
