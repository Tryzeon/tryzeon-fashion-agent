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

export async function productImageDataUrl(id: string): Promise<string> {
  const bytes = await readFile(join(process.cwd(), 'public', 'catalog', `${id}.webp`));
  return `data:image/webp;base64,${bytes.toString('base64')}`;
}
