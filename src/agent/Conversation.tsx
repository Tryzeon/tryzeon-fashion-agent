import { useState } from 'react';
import type { Outfit } from '../../shared/protocol';
import { checkFit, type Verdict } from '../../shared/fit';
import type { BodyProfile } from '../../shared/types';
import { brandOf, formatPrice, thumbUrl, product } from '../lib/catalog';
import type { Step, Turn } from './useAgent';

const VERDICT_LABEL: Record<Verdict, string> = { fits: 'Fits', borderline: 'Close fit', no: 'No size fits' };

export function FitPill({ verdict, size }: { verdict: Verdict | null; size: string | null }) {
  if (!verdict) return <span className="fit-pill fit-none">One size</span>;
  return (
    <span className={`fit-pill fit-${verdict}`}>
      <span className="fit-light" aria-hidden />
      {size ? `${size} · ${VERDICT_LABEL[verdict]}` : VERDICT_LABEL[verdict]}
    </span>
  );
}

function seconds(from: number, to: number | null): string {
  return `${(((to ?? Date.now()) - from) / 1000).toFixed(0)}s`;
}

function ToolStep({ step, profile }: { step: Extract<Step, { kind: 'tool' }>; profile: BodyProfile }) {
  const pending = !step.result;
  const ids = step.result?.productIds ?? [];
  let title: string;
  let body: React.ReactNode = null;
  switch (step.name) {
    case 'search_catalog':
      title = `Searched ${String(step.args.category)} for “${String(step.args.query)}”`;
      body = ids.length > 0 && (
        <div className="step-thumbs">
          {ids.map((id) => (
            <img key={id} src={thumbUrl(id)} alt={product(id)?.name ?? id} title={product(id)?.name} />
          ))}
        </div>
      );
      break;
    case 'check_fit':
      title = `Checked fit on ${ids.length || (step.args.product_ids as string[] | undefined)?.length || 0} pieces`;
      body = ids.length > 0 && (
        <ul className="step-fit">
          {ids.map((id) => {
            const p = product(id);
            if (!p) return null;
            const fit = checkFit(p, profile);
            return (
              <li key={id}>
                <img src={thumbUrl(id)} alt="" />
                <span>{p.name}</span>
                {fit.sizeSensitive ? <FitPill verdict={fit.verdict} size={fit.recommended} /> : <FitPill verdict={null} size={null} />}
              </li>
            );
          })}
        </ul>
      );
      break;
    case 'propose_outfit':
      title = step.result?.ok === false ? 'Outfit rejected by the fit and stock check' : 'Validated the outfit against stock and fit';
      body = step.result && !step.result.ok && <p className="step-problem">{step.result.summary.replace(/^Rejected: /, '')}</p>;
      break;
    default:
      title = step.name;
  }
  const state = pending ? 'pending' : step.result?.ok === false ? 'failed' : 'done';
  return (
    <li className={`step step-tool step-${state}`}>
      <span className="step-marker" aria-hidden />
      <div>
        <p className="step-title">
          {title}
          {!pending && step.result && step.name !== 'propose_outfit' && <span className="step-summary">{step.result.summary}</span>}
        </p>
        {body}
      </div>
    </li>
  );
}

function Trace({ turn, profile }: { turn: Turn; profile: BodyProfile }) {
  const [open, setOpen] = useState(true);
  const done = turn.status !== 'running';
  const toolCount = turn.steps.filter((s) => s.kind === 'tool').length;
  if (turn.steps.length === 0 && !done) {
    return <p className="trace-waiting">Reading your request…</p>;
  }
  return (
    <div className="trace">
      {done && (
        <button className="trace-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide' : 'Show'} how I chose this · {toolCount} tool calls · {seconds(turn.startedAt, turn.endedAt)}
        </button>
      )}
      {(open || !done) && (
        <ol className="steps">
          {turn.steps.map((step, i) =>
            step.kind === 'narration' ? (
              <li key={i} className="step step-narration">
                {step.text}
              </li>
            ) : (
              <ToolStep key={step.id} step={step} profile={profile} />
            ),
          )}
        </ol>
      )}
    </div>
  );
}

interface OutfitCardProps {
  outfit: Outfit;
  previous: Outfit | null;
  tryLabel: string;
  tryDisabled: boolean;
  onTry: () => void;
}

function OutfitCard({ outfit, previous, tryLabel, tryDisabled, onTry }: OutfitCardProps) {
  const total = outfit.items.reduce((sum, i) => sum + (product(i.productId)?.price ?? 0), 0);
  const before = new Set(previous?.items.map((i) => i.productId) ?? []);
  return (
    <article className="outfit">
      <header>
        <h3>{outfit.title}</h3>
        <p>{outfit.rationale}</p>
      </header>
      <ul>
        {outfit.items.map((item) => {
          const p = product(item.productId);
          if (!p) return null;
          return (
            <li key={item.productId} className={previous && !before.has(item.productId) ? 'outfit-new' : ''}>
              <img src={thumbUrl(p.id)} alt="" />
              <div className="outfit-item">
                <span className="outfit-brand">{brandOf(p).name}</span>
                <span className="outfit-name">{p.name}</span>
                <span className="outfit-reason">{item.reason}</span>
              </div>
              <div className="outfit-meta">
                <span className="outfit-price">{formatPrice(p.price)}</span>
                <FitPill verdict={item.fit} size={item.size} />
              </div>
            </li>
          );
        })}
      </ul>
      <footer>
        <span>
          {outfit.items.length} pieces · {formatPrice(total)}
        </span>
        <button className="btn-primary" onClick={onTry} disabled={tryDisabled}>
          {tryLabel}
        </button>
      </footer>
    </article>
  );
}

interface ConversationProps {
  turns: Turn[];
  profile: BodyProfile;
  triedOutfit: Outfit | null;
  tryonRunning: boolean;
  onTry: (outfit: Outfit) => void;
}

export function Conversation({ turns, profile, triedOutfit, tryonRunning, onTry }: ConversationProps) {
  let previousOutfit: Outfit | null = null;
  return (
    <>
      {turns.map((turn) => {
        const prior = previousOutfit;
        if (turn.outfit) previousOutfit = turn.outfit;
        const isTried = turn.outfit !== null && turn.outfit === triedOutfit;
        return (
          <section key={turn.id} className="turn">
            <div className="bubble-user">
              {turn.image && <img src={turn.image} alt="Your inspiration" />}
              <p>{turn.text}</p>
            </div>
            <Trace turn={turn} profile={profile} />
            {turn.outfit && (
              <OutfitCard
                outfit={turn.outfit}
                previous={prior}
                tryLabel={isTried ? (tryonRunning ? 'Trying on…' : 'On you now') : 'Try it on me'}
                tryDisabled={tryonRunning || isTried}
                onTry={() => onTry(turn.outfit!)}
              />
            )}
            {turn.reply && <p className="bubble-agent">{turn.reply}</p>}
            {turn.error && <p className="bubble-error">Something went wrong: {turn.error}. Try sending it again.</p>}
          </section>
        );
      })}
    </>
  );
}
