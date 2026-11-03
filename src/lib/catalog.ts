import catalogJson from '../../shared/catalog.json';
import type { Brand, Catalog, Product } from '../../shared/types';

export const catalog = catalogJson as Catalog;

const products = new Map(catalog.products.map((p) => [p.id, p]));
const brands = new Map(catalog.brands.map((b) => [b.id, b]));

export function product(id: string): Product | undefined {
  return products.get(id);
}

export function brandOf(p: Product): Brand {
  return brands.get(p.brandId) ?? { id: p.brandId, name: p.brandId, tagline: '' };
}

export function imageUrl(id: string): string {
  return `/catalog/${id}.webp`;
}

export function thumbUrl(id: string): string {
  return `/catalog/small/${id}.webp`;
}

export function formatPrice(usd: number): string {
  return `$${usd.toFixed(0)}`;
}
