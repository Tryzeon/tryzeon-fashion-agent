import { useEffect, useRef, useState } from 'react';
import type { Outfit } from '../../shared/protocol';
import type { BodyProfile } from '../../shared/types';
import { toDataUrl } from '../lib/image';
import { Conversation } from './Conversation';
import { SAMPLE_SHOPPERS, STARTERS, type Shopper, type Starter } from './shoppers';
import { Stage } from './Stage';
import { latestOutfit, useAgent } from './useAgent';
import { useTryon } from './useTryon';

const embedded = window.parent !== window;

const MEASURES = [
  ['heightCm', 'Height'],
  ['chestCm', 'Chest'],
  ['waistCm', 'Waist'],
  ['hipCm', 'Hip'],
] as const;

function ShopperPanel({ shopper, onChange }: { shopper: Shopper; onChange: (s: Shopper) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const isSample = SAMPLE_SHOPPERS.some((s) => s.id === shopper.id);

  const upload = async (file: File) => {
    const photo = await toDataUrl(file);
    onChange({ id: `you-${Date.now()}`, name: 'You', photo, profile: shopper.profile });
  };

  const setMeasure = (key: keyof BodyProfile, value: string) =>
    onChange({ ...shopper, profile: { ...shopper.profile, [key]: key === 'gender' ? value : Number(value) } });

  return (
    <div className="shopper-panel">
      <div className="shopper-choices" role="radiogroup" aria-label="Who is trying on">
        {SAMPLE_SHOPPERS.map((s) => (
          <button key={s.id} role="radio" aria-checked={shopper.id === s.id} className="shopper-choice" onClick={() => onChange(s)}>
            <img src={s.photo} alt="" />
            {s.name}
          </button>
        ))}
        <button role="radio" aria-checked={!isSample} className="shopper-choice" onClick={() => fileInput.current?.click()}>
          {isSample ? <span className="shopper-upload" aria-hidden>+</span> : <img src={shopper.photo} alt="" />}
          {isSample ? 'Your photo' : 'You'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
      </div>
      <fieldset className="measures">
        <legend>Fit profile</legend>
        <label>
          Fit
          <select value={shopper.profile.gender} onChange={(e) => setMeasure('gender', e.target.value)}>
            <option value="women">Womenswear</option>
            <option value="men">Menswear</option>
          </select>
        </label>
        {MEASURES.map(([key, label]) => (
          <label key={key}>
            {label}
            <span className="measure-input">
              <input
                type="number"
                inputMode="numeric"
                value={shopper.profile[key]}
                onChange={(e) => setMeasure(key, e.target.value)}
              />
              cm
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string, image: string | null) => void }) {
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim(), image);
    setText('');
    setImage(null);
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {image && (
        <div className="composer-attachment">
          <img src={image} alt="Attached inspiration" />
          <button type="button" onClick={() => setImage(null)} aria-label="Remove photo">
            ×
          </button>
        </div>
      )}
      <div className="composer-row">
        <button type="button" className="btn-icon" onClick={() => fileInput.current?.click()} aria-label="Attach an inspiration photo">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <path d="M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) setImage(await toDataUrl(file, 768));
          }}
        />
        <textarea
          value={text}
          rows={1}
          placeholder="Where are you going, and how should it feel?"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" className="btn-primary" disabled={disabled || !text.trim()}>
          Send
        </button>
      </div>
    </form>
  );
}

export function App() {
  const [shopper, setShopper] = useState<Shopper>(SAMPLE_SHOPPERS[0]!);
  const [view, setView] = useState<'chat' | 'fitting'>('chat');
  const { turns, running, send, reset } = useAgent(shopper.profile);
  const { tryon, start } = useTryon();
  const scroller = useRef<HTMLDivElement>(null);
  const autoSwapped = useRef<Outfit | null>(null);

  const tryOn = async (outfit: Outfit) => {
    setView('fitting');
    const photo = shopper.photo.startsWith('data:') ? shopper.photo : await toDataUrl(shopper.photo);
    void start(outfit, photo, shopper.id);
  };

  const outfit = latestOutfit(turns);
  useEffect(() => {
    if (!outfit || outfit === tryon.outfit || autoSwapped.current === outfit) return;
    if (tryon.status !== 'done' || tryon.result?.personKey !== shopper.id) return;
    autoSwapped.current = outfit;
    void tryOn(outfit);
  });

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  const pickShopper = (next: Shopper) => {
    if (next.profile.gender !== shopper.profile.gender) reset();
    setShopper(next);
  };

  const startWith = async (starter: Starter) => {
    const image = starter.image ? await toDataUrl(starter.image, 768) : null;
    void send(starter.text, image);
  };

  return (
    <div className={`app view-${view}`}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">Tryzeon</span>
          <span className="brand-product">Fashion Agent</span>
        </div>
        <nav className="view-tabs" aria-label="View">
          <button aria-pressed={view === 'chat'} onClick={() => setView('chat')}>
            Stylist
          </button>
          <button aria-pressed={view === 'fitting'} onClick={() => setView('fitting')}>
            Fitting room
          </button>
        </nav>
        {embedded && (
          <button className="btn-icon" onClick={() => window.parent.postMessage({ type: 'tryzeon:close' }, '*')} aria-label="Close">
            ×
          </button>
        )}
      </header>

      <main className="app-body">
        <section className="chat" aria-label="Stylist">
          <div className="chat-scroll" ref={scroller}>
            {turns.length === 0 ? (
              <div className="intro">
                <h1>Tell me where you're going. I'll dress you from what's in stock, in your size, and show it on you.</h1>
                <ShopperPanel shopper={shopper} onChange={pickShopper} />
                <div className="starters">
                  {STARTERS.map((s) => (
                    <button key={s.text} className="starter" onClick={() => void startWith(s)} disabled={running}>
                      {s.image && <img src={s.image} alt="" />}
                      <span>{s.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <Conversation
                turns={turns}
                profile={shopper.profile}
                triedOutfit={tryon.outfit}
                tryonRunning={tryon.status === 'running'}
                onTry={(o) => void tryOn(o)}
              />
            )}
          </div>
          <Composer disabled={running} onSend={(text, image) => void send(text, image)} />
        </section>
        <section className="fitting" aria-label="Fitting room">
          <Stage personPhoto={shopper.photo} tryon={tryon} />
        </section>
      </main>
    </div>
  );
}
