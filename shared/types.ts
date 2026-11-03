export const CATEGORIES = ['top', 'bottom', 'outerwear', 'shoes', 'accessory'] as const;
export type Category = (typeof CATEGORIES)[number];

export const SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type Size = (typeof SIZES)[number];

export type Gender = 'women' | 'men' | 'unisex';
export type FitStyle = 'slim' | 'regular' | 'relaxed' | 'oversized';

export interface Brand {
  id: string;
  name: string;
  tagline: string;
}

export interface Product {
  id: string;
  brandId: string;
  name: string;
  category: Category;
  garment: string;
  gender: Gender;
  price: number;
  colors: string[];
  material: string;
  fit: FitStyle;
  warmth: number;
  styleTags: string[];
  occasions: string[];
  description: string;
  look: string;
  imagePrompt: string;
  sizes: Size[];
}

export interface Catalog {
  brands: Brand[];
  products: Product[];
}

export interface BodyProfile {
  gender: 'women' | 'men';
  heightCm: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
}
