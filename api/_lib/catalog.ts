import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import catalogJson from '../../shared/catalog.json';
import type { Catalog, Product } from '../../shared/types.js';

export const catalog = catalogJson as Catalog;

const byId = new Map(catalog.products.map((p) => [p.id, p]));

export function findProduct(id: string): Product | undefined {
  return byId.get(id);
}

export function brandName(product: Product): string {
  return catalog.brands.find((b) => b.id === product.brandId)?.name ?? product.brandId;
}

export async function productImageDataUrl(id: string, variant: 'full' | 'small' = 'full'): Promise<string> {
  const dir = variant === 'small' ? ['catalog', 'small'] : ['catalog'];
  const bytes = await readFile(join(process.cwd(), 'public', ...dir, `${id}.webp`));
  return `data:image/webp;base64,${bytes.toString('base64')}`;
}
