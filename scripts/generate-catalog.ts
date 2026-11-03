import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { generateImage, meta, SPARK_MODEL } from '../api/_lib/meta.js';
import { CATEGORIES, SIZES, type Brand, type Catalog, type Category, type Product } from '../shared/types.js';

const CATALOG_PATH = 'shared/catalog.json';
const IMAGE_DIR = 'public/catalog';
const DEMO_DIR = 'public/demo';
const IMAGE_SIZE = 1024;
const CONCURRENCY = 6;

const BRANDS: (Brand & { brief: string })[] = [
  {
    id: 'hanul',
    name: 'HANUL STUDIO',
    tagline: 'Seoul street layers',
    brief:
      'Seoul-born streetwear label. Oversized silhouettes, layered knits, puffers, cargo pants, chunky sneakers, beanies. Muted earth tones with one accent color per piece.',
  },
  {
    id: 'lune',
    name: 'Atelier Lune',
    tagline: 'Quiet tailoring for every day',
    brief:
      'Minimalist commuter label. Tailored wool coats, crisp shirts, fine-gauge knits, pleated trousers, midi skirts, loafers, leather bags. Neutral palette: ivory, camel, charcoal, black, navy.',
  },
  {
    id: 'northline',
    name: 'NORTHLINE',
    tagline: 'Built for the cold',
    brief:
      'Outdoor technical label for city and trail. Down jackets, fleece, shell parkas, thermal base layers, hiking pants, waterproof boots, wool scarves and gloves. Forest green, glacier blue, black, safety orange accents.',
  },
];

const PRODUCTS_PER_BRAND: Record<Category, number> = { top: 5, bottom: 4, outerwear: 5, shoes: 3, accessory: 3 };

const productSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['products'],
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name', 'category', 'garment', 'gender', 'price', 'colors', 'material', 'fit',
          'warmth', 'styleTags', 'occasions', 'description', 'imagePrompt', 'sizes',
        ],
        properties: {
          name: { type: 'string' },
          category: { type: 'string', enum: [...CATEGORIES] },
          garment: { type: 'string', description: 'One or two word noun a segmentation model can find, e.g. "sweater", "jeans", "puffer jacket", "boots", "scarf".' },
          gender: { type: 'string', enum: ['women', 'men', 'unisex'] },
          price: { type: 'number', description: 'USD' },
          colors: { type: 'array', items: { type: 'string' } },
          material: { type: 'string' },
          fit: { type: 'string', enum: ['slim', 'regular', 'relaxed', 'oversized'] },
          warmth: { type: 'integer', minimum: 1, maximum: 5 },
          styleTags: { type: 'array', items: { type: 'string' } },
          occasions: { type: 'array', items: { type: 'string' } },
          description: { type: 'string', description: 'Two sentence shopper-facing description.' },
          imagePrompt: { type: 'string', description: 'Purely visual description of the item alone for an image model: exact color, fabric texture, construction details (collar, pockets, buttons, stitching, hardware, logo placement). No people, no setting.' },
          sizes: { type: 'array', items: { type: 'string', enum: [...SIZES] } },
        },
      },
    },
  },
} as const;

async function generateSpecs(): Promise<void> {
  const counts = Object.entries(PRODUCTS_PER_BRAND).map(([c, n]) => `${n} ${c}`).join(', ');
  const perBrand = await Promise.all(
    BRANDS.map(async (brand) => {
      const completion = await meta().chat.completions.create({
        model: SPARK_MODEL,
        response_format: { type: 'json_schema', json_schema: { name: 'products', strict: true, schema: productSchema } },
        messages: [
          {
            role: 'system',
            content:
              'You are the merchandiser for a fashion brand. Design a realistic, coherent product line whose pieces can be combined into full outfits.',
          },
          {
            role: 'user',
            content: [
              `Brand: ${brand.name} — ${brand.brief}`,
              `Create exactly 20 products: ${counts}.`,
              'Gender mix: about half women, a third men, the rest unisex. Shoes and accessories may be unisex.',
              'Mostly autumn/winter pieces (warmth 3-5) plus a few lighter layers (warmth 1-2).',
              'Every product name must be distinct and specific. Prices in USD typical for an independent label.',
              'Sizes: tops, bottoms and outerwear list the sizes in stock from XS-XL. Vary them: most carry S-L or XS-XL, but a few run only small (XS-S) or only large (L-XL). Shoes and accessories use ["M"] as one size.',
            ].join('\n'),
          },
        ],
      });
      const content = completion.choices[0]?.message.content;
      if (!content) throw new Error(`No specs for ${brand.id}`);
      const { products } = JSON.parse(content) as { products: Omit<Product, 'id' | 'brandId'>[] };
      return products.map((p, i) => ({ id: `${brand.id}-${String(i + 1).padStart(2, '0')}`, brandId: brand.id, ...p }));
    }),
  );
  const catalog: Catalog = {
    brands: BRANDS.map(({ id, name, tagline }) => ({ id, name, tagline })),
    products: perBrand.flat(),
  };
  writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`wrote ${catalog.products.length} products to ${CATALOG_PATH}`);
}

const STUDIO =
  'Seamless warm off-white studio background (#F4F1EC), soft even lighting, subtle natural shadow beneath, sharp fabric texture, square 1:1 framing, e-commerce product photo.';

function productImagePrompt(product: Product): string {
  const subject = `${product.imagePrompt} Colors: ${product.colors.join(', ')}. Material: ${product.material}.`;
  switch (product.category) {
    case 'shoes':
      return `${subject} A single pair of shoes, side three-quarter view, no feet, no person, no props. ${STUDIO}`;
    case 'accessory':
      return `${subject} The accessory alone, front view, centered, no person, no mannequin, no props. ${STUDIO}`;
    case 'bottom':
      return `${subject} The garment alone on an invisible ghost mannequin, front view, full length, centered, no person, no model, no body parts, no hanger, no props. ${STUDIO}`;
    default:
      return `${subject} The garment alone on an invisible ghost mannequin, front view, centered, no person, no model, no body parts, no hanger, no props. ${STUDIO}`;
  }
}

async function saveWebp(base64: string, path: string, width: number, height: number): Promise<void> {
  await sharp(Buffer.from(base64, 'base64')).resize(width, height, { fit: 'cover' }).webp({ quality: 86 }).toFile(path);
}

async function pool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await worker(item);
      }
    }),
  );
}

async function generateImages(): Promise<void> {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as Catalog;
  mkdirSync(IMAGE_DIR, { recursive: true });
  const missing = catalog.products.filter((p) => !existsSync(`${IMAGE_DIR}/${p.id}.webp`));
  console.log(`${missing.length} images to generate`);
  const failures: string[] = [];
  await pool(missing, async (product) => {
    const started = Date.now();
    try {
      const { base64 } = await generateImage(productImagePrompt(product));
      await saveWebp(base64, `${IMAGE_DIR}/${product.id}.webp`, IMAGE_SIZE, IMAGE_SIZE);
      console.log(`${product.id} ${((Date.now() - started) / 1000).toFixed(1)}s ${product.name}`);
    } catch (error) {
      failures.push(product.id);
      console.error(`${product.id} failed: ${String(error)}`);
    }
  });
  if (failures.length) {
    console.error(`failed: ${failures.join(', ')} — rerun to retry`);
    process.exitCode = 1;
  }
}

const DEMO_SHOPPERS: Record<string, string> = {
  'shopper-mina':
    'Realistic full-body smartphone photo of a young East Asian woman in her mid-twenties standing straight facing the camera, arms relaxed at her sides, wearing a plain fitted white t-shirt, grey leggings and white sneakers, shoulder-length black hair, plain light grey wall behind her, natural indoor daylight, head to toe in frame, portrait 3:4.',
  'shopper-leo':
    'Realistic full-body smartphone photo of a man around thirty standing straight facing the camera, arms relaxed at his sides, wearing a plain fitted grey t-shirt, black slim joggers and white sneakers, short dark hair, plain light grey wall behind him, natural indoor daylight, head to toe in frame, portrait 3:4.',
};

const DEMO_INSPIRATION: Record<string, string> = {
  'inspo-seoul':
    'Candid street-style photo in Seongsu-dong, Seoul on a cold winter day: a young woman walking toward the camera wearing a cropped dark puffer jacket over a chunky cream knit, wide-leg charcoal cargo pants, chunky sneakers and a knit beanie, holding a coffee. Overcast light, shallow depth of field, editorial fashion photography, portrait 3:4.',
};

async function generateDemo(): Promise<void> {
  mkdirSync(DEMO_DIR, { recursive: true });
  const entries = Object.entries({ ...DEMO_SHOPPERS, ...DEMO_INSPIRATION }).filter(
    ([name]) => !existsSync(`${DEMO_DIR}/${name}.webp`),
  );
  await Promise.all(
    entries.map(async ([name, prompt]) => {
      const { base64 } = await generateImage(prompt);
      await saveWebp(base64, `${DEMO_DIR}/${name}.webp`, 768, 1024);
      console.log(`${name} done`);
    }),
  );
}

const step = process.argv[2];
if (step === 'specs') await generateSpecs();
else if (step === 'images') await generateImages();
else if (step === 'demo') await generateDemo();
else throw new Error('usage: generate-catalog.ts specs|images|demo');
