export interface NeuformEffectMetadata {
  id: string;
  title: string;
  path: string;
  group: string;
  intensity: string;
  technicalComplexity: string;
  originId: string;
  resourceUri: string;
  tags: string[];
}

const HIGH_COMPLEXITY_TERMS = ['webgl', 'shader', '3d', 'globe', 'particle', 'laser', 'field', 'nebula', 'procedural'];

function titleFromSlug(slug: string): string {
  return slug
    .replace(/-[a-z0-9]{6}$/, '')
    .replace(/\b3d\b/g, '3D')
    .replace(/\bd3\b/g, 'D3')
    .replace(/\bwebgl\b/g, 'WebGL')
    .replace(/\bui\b/g, 'UI')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function normalizedSlug(effectId: string): string {
  return effectId
    .replace(/^neuform[_-]/, '')
    .replace(/_/g, '-')
    .replace(/^css-border-gradient$/, 'border-gradients')
    .replace(/^gsap$/, 'gsap-motion')
    .replace(/^marquee-loop$/, 'marquee')
    .replace(/-[a-z0-9]{6}$/, '');
}

function groupFromSlug(slug: string): string {
  if (/(border|shadow|blur|skeuomorphic|duotone|number)/.test(slug)) return 'Surface and Material Effects';
  if (/(grid-layout|container|asset-images|frames)/.test(slug)) return 'Layout Systems';
  if (/(logo|logos|typography|serif)/.test(slug)) return 'Typography Effects';
  if (/(motion|reveal|marquee|cursor|kinetic|gooey|paper|agency|diagonal|clock)/.test(slug)) return 'Motion Effects';
  return 'Background Effects';
}

function tagsFromSlug(slug: string): string[] {
  return slug.split('-').filter(Boolean);
}

export function resolveNeuformEffect(effectId: string): NeuformEffectMetadata | null {
  if (!effectId || effectId === 'none' || effectId === 'agent_decides') return null;
  const slug = normalizedSlug(effectId);
  const highComplexity = HIGH_COMPLEXITY_TERMS.some(term => slug.includes(term));
  return {
    id: `neuform_${slug}`,
    title: titleFromSlug(slug),
    path: `effects/${slug}.md`,
    group: groupFromSlug(slug),
    intensity: highComplexity ? 'expressive' : 'balanced',
    technicalComplexity: highComplexity ? 'high' : 'medium',
    originId: slug,
    resourceUri: `frontend-patterns://neuform/${slug}`,
    tags: tagsFromSlug(slug),
  };
}

export function selectedNeuformEffects(effectIds: string[]): NeuformEffectMetadata[] {
  const selected: NeuformEffectMetadata[] = [];
  const seen = new Set<string>();
  for (const effectId of effectIds) {
    const effect = resolveNeuformEffect(effectId);
    if (!effect || seen.has(effect.id)) continue;
    selected.push(effect);
    seen.add(effect.id);
  }
  return selected;
}
