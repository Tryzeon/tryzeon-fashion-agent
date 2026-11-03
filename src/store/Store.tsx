import { useEffect, useMemo, useState } from 'react';
import type { Product } from '../../shared/types';
import { brandOf, catalog, formatPrice, imageUrl, product as findProduct, thumbUrl } from '../lib/catalog';

const SNIPPET = `<script src="https://tryzeon-fashion-agent.vercel.app/embed.js" defer></script>`;

type Filter = 'all' | string;

declare global {
  interface Window {
    Tryzeon?: { open: () => void; close: () => void };
  }
}

export function Store() {
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Product | null>(null);

  const products = useMemo(
    () => catalog.products.filter((p) => filter === 'all' || p.brandId === filter),
    [filter],
  );

  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get('product');
    const linkedProduct = linked ? findProduct(linked) : undefined;
    if (linkedProduct) setSelected(linkedProduct);
    const onProduct = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail.id;
      const p = findProduct(id);
      if (p) setSelected(p);
    };
    window.addEventListener('tryzeon:product', onProduct);
    return () => window.removeEventListener('tryzeon:product', onProduct);
  }, []);

  return (
    <div className="store">
      <header className="store-header">
        <a className="store-logo" href="/">Season Edit</a>
        <nav className="store-nav" aria-label="Brands">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            All
          </button>
          {catalog.brands.map((b) => (
            <button key={b.id} className={filter === b.id ? 'active' : ''} onClick={() => setFilter(b.id)}>
              {b.name}
            </button>
          ))}
        </nav>
      </header>

      <section className="store-intro">
        <h1>Winter, edited.</h1>
        <p>
          Sixty pieces from three independent labels. Not sure what goes together, or what fits? Ask the stylist in the corner:
          it builds a full outfit from what's in stock in your size, and shows it on you.
        </p>
        <button className="store-cta" onClick={() => window.Tryzeon?.open()}>
          Style me with Tryzeon
        </button>
      </section>

      <ul className="store-grid">
        {products.map((p) => (
          <li key={p.id}>
            <button className="store-card" onClick={() => setSelected(p)}>
              <img src={thumbUrl(p.id)} alt={p.name} loading="lazy" width={512} height={512} />
              <span className="store-card-brand">{brandOf(p).name}</span>
              <span className="store-card-name">{p.name}</span>
              <span className="store-card-price">{formatPrice(p.price)}</span>
            </button>
          </li>
        ))}
      </ul>

      <section className="store-brands">
        <div>
          <h2>Run a fashion brand?</h2>
          <p>
            This stylist is one line on your site. It reads your catalog, checks every recommendation against your size charts,
            and lets shoppers try the whole outfit on before they buy.
          </p>
        </div>
        <pre>
          <code>{SNIPPET}</code>
        </pre>
      </section>

      <footer className="store-footer">
        <p>
          Season Edit is a demo store for the Meta Global AI Developer Hackathon. The brands are fictional, and every product photo
          and description was generated with Meta's Muse Image and Muse Spark.
        </p>
        <p>
          Stylist by <a href="https://tryzeon.com">Tryzeon</a> ·{' '}
          <a href="https://github.com/Tryzeon/tryzeon-fashion-agent">Source on GitHub</a>
        </p>
      </footer>

      {selected && <ProductSheet product={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ProductSheet({ product, onClose }: { product: Product; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <article className="sheet" role="dialog" aria-modal="true" aria-label={product.name} onClick={(e) => e.stopPropagation()}>
        <img src={imageUrl(product.id)} alt="" />
        <div className="sheet-body">
          <span className="store-card-brand">{brandOf(product).name}</span>
          <h2>{product.name}</h2>
          <p className="sheet-price">{formatPrice(product.price)}</p>
          <p>{product.description}</p>
          <dl>
            <dt>Material</dt>
            <dd>{product.material}</dd>
            <dt>Colour</dt>
            <dd>{product.colors.join(', ')}</dd>
            <dt>Sizes in stock</dt>
            <dd>{product.sizes.join(' ')}</dd>
          </dl>
          <button className="store-cta">Add to bag</button>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </article>
    </div>
  );
}
