import type { BodyProfile } from '../../shared/types';

export interface Shopper {
  id: string;
  name: string;
  photo: string;
  profile: BodyProfile;
}

export const SAMPLE_SHOPPERS: Shopper[] = [
  {
    id: 'mina',
    name: 'Mina',
    photo: '/demo/shopper-mina.webp',
    profile: { gender: 'women', heightCm: 163, chestCm: 84, waistCm: 66, hipCm: 91 },
  },
  {
    id: 'leo',
    name: 'Leo',
    photo: '/demo/shopper-leo.webp',
    profile: { gender: 'men', heightCm: 178, chestCm: 96, waistCm: 81, hipCm: 97 },
  },
];

export interface Starter {
  text: string;
  image?: string;
}

export const STARTERS: Starter[] = [
  { text: "I'm in Seoul next week and it'll be around 0°C. Dress me like this photo.", image: '/demo/inspo-seoul.webp' },
  { text: 'Client dinner in Taipei on Friday. Smart, but warm enough for a rainy 14°C.' },
  { text: 'Weekend hike in the morning, coffee in town after. One outfit for both.' },
];
