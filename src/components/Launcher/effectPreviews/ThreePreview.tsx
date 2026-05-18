import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import type { EffectPreviewProps } from './types';

type ThreeVariant =
  | 'faceted-object'
  | 'wire-terrain'
  | 'isometric-blocks'
  | 'organic-sphere'
  | 'network-globe'
  | 'shader-plane';

function parseHexColor(value: string | undefined, fallback: number): number {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return fallback;
  const hex = match[1].length === 3 ? match[1].split('').map(char => char + char).join('') : match[1];
  return Number.parseInt(hex, 16);
}

function rgba(hex: string | undefined, alpha: number, fallback: string): string {
  const raw = String(hex ?? '').trim();
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return fallback;
  const normalized = match[1].length === 3
    ? match[1].split('').map(char => char + char).join('')
    : match[1];
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function ThreeThumbnailPreview({ variant, theme }: Pick<EffectPreviewProps, 'theme'> & { variant: ThreeVariant }) {
  const accent = theme.accent;
  const secondary = theme.secondary;
  const bg = theme.isLight ? '#f8fafc' : theme.background;

  if (variant === 'wire-terrain') {
    return (
      <div className="absolute inset-0 overflow-hidden" style={{ background: `radial-gradient(circle at 52% 72%, ${rgba(accent, .24, 'rgba(34,197,94,.24)')}, transparent 30%), ${bg}`, perspective: '520px' }}>
        <div
          className="absolute left-[-12%] top-[42%] h-[72%] w-[124%] border-t"
          style={{
            borderColor: rgba(accent, .26, 'rgba(34,197,94,.26)'),
            backgroundImage: `linear-gradient(${rgba(accent, .18, 'rgba(34,197,94,.18)')} 1px, transparent 1px), linear-gradient(90deg, ${rgba(accent, .20, 'rgba(34,197,94,.20)')} 1px, transparent 1px)`,
            backgroundSize: '22px 18px',
            transform: 'rotateX(62deg)',
            transformOrigin: 'center top',
          }}
        />
      </div>
    );
  }

  if (variant === 'shader-plane') {
    return (
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          background:
            `radial-gradient(circle at 35% 28%, ${rgba(accent, .28, 'rgba(34,197,94,.28)')}, transparent 28%), radial-gradient(circle at 70% 70%, ${rgba(secondary, .20, 'rgba(148,163,184,.20)')}, transparent 32%), linear-gradient(135deg, ${bg}, #050711)`,
        }}
      >
        <div className="absolute inset-0 opacity-25" style={{ backgroundImage: `linear-gradient(${rgba(accent, .20, 'rgba(34,197,94,.20)')} 1px, transparent 1px), linear-gradient(90deg, ${rgba(accent, .18, 'rgba(34,197,94,.18)')} 1px, transparent 1px)`, backgroundSize: '18px 18px' }} />
      </div>
    );
  }

  if (variant === 'organic-sphere') {
    return (
      <div className="absolute inset-0 overflow-hidden" style={{ background: `radial-gradient(circle at 28% 30%, ${rgba(accent, .26, 'rgba(34,197,94,.26)')}, transparent 28%), ${bg}` }}>
        <div className="absolute left-[42%] top-[18%] h-[52%] w-[42%] rounded-full blur-[1px]" style={{ background: `radial-gradient(circle at 52% 42%, ${rgba(secondary, .22, 'rgba(148,163,184,.22)')}, rgba(7,19,13,.72) 56%, transparent 72%)`, boxShadow: `0 0 46px ${rgba(accent, .20, 'rgba(34,197,94,.20)')}` }} />
      </div>
    );
  }

  if (variant === 'network-globe') {
    return (
      <div className="absolute inset-0 overflow-hidden" style={{ background: '#020504' }}>
        <div className="absolute left-1/2 top-1/2 h-[70%] w-[54%] -translate-x-1/2 -translate-y-1/2 rounded-full border" style={{ borderColor: rgba(accent, .26, 'rgba(34,197,94,.26)'), boxShadow: `inset 0 0 28px ${rgba(accent, .16, 'rgba(34,197,94,.16)')}, 0 0 34px ${rgba(accent, .12, 'rgba(34,197,94,.12)')}` }} />
        <div className="absolute inset-[18%] opacity-45" style={{ backgroundImage: `radial-gradient(circle, ${rgba(accent, .75, 'rgba(34,197,94,.75)')} 1px, transparent 1.5px)`, backgroundSize: '10px 10px', borderRadius: '50%' }} />
      </div>
    );
  }

  if (variant === 'isometric-blocks') {
    return (
      <div className="absolute inset-0 overflow-hidden" style={{ background: `linear-gradient(135deg, ${bg}, #06100b)` }}>
        <div className="absolute left-[38%] top-[24%] grid grid-cols-3 gap-1.5" style={{ transform: 'rotateX(58deg) rotateZ(-36deg)' }}>
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="h-7 w-7" style={{ background: index % 2 ? rgba(accent, .62, 'rgba(34,197,94,.62)') : rgba(secondary, .36, 'rgba(148,163,184,.36)'), boxShadow: `0 ${4 + (index % 3) * 3}px 0 ${rgba(accent, .18, 'rgba(34,197,94,.18)')}` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: `radial-gradient(circle at 50% 46%, ${rgba(accent, .36, 'rgba(34,197,94,.36)')}, transparent 30%), ${bg}` }}>
      <div className="absolute left-1/2 top-1/2 h-[34%] w-[34%] -translate-x-1/2 -translate-y-1/2 rotate-12 border" style={{ borderColor: rgba(accent, .72, 'rgba(34,197,94,.72)'), background: rgba(accent, .18, 'rgba(34,197,94,.18)') }} />
    </div>
  );
}

function createShaderMaterial(THREE: typeof import('three'), accent: number, secondary: number, isLight: boolean) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uAccent: { value: new THREE.Color(accent) },
      uSecondary: { value: new THREE.Color(secondary) },
      uIsLight: { value: isLight ? 1 : 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform vec3 uAccent;
      uniform vec3 uSecondary;
      uniform float uIsLight;
      varying vec2 vUv;
      float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
      float noise(vec2 p){
        vec2 i=floor(p); vec2 f=fract(p);
        float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
        vec2 u=f*f*(3.-2.*f);
        return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;
      }
      float fbm(vec2 p){ float v=0.; float a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.05+13.2; a*=.5; } return v; }
      void main() {
        vec2 uv = vUv * 2.0 - 1.0;
        float n = fbm(uv * 2.3 + vec2(uTime * .08, -uTime * .05));
        float ring = 1.0 - smoothstep(.02, .035, abs(fract(length(uv) * 8.0 - uTime * .12) - .5));
        float fold = sin((uv.x + n * .2) * 12.0) * sin((uv.y - n * .16) * 9.0);
        vec3 base = mix(vec3(.008,.012,.032), vec3(.94,.97,1.), uIsLight * .72);
        vec3 color = base + uAccent * n * .42 + uSecondary * max(fold, 0.0) * .18 + vec3(1.0) * ring * .08;
        float vignette = smoothstep(1.25, .18, length(uv));
        gl_FragColor = vec4(color, vignette * .96);
      }
    `,
  });
}

function ThreeLivePreview({ variant, theme, mode, quality, reducedMotion }: EffectPreviewProps & { variant: ThreeVariant }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const live = mode === 'live' && !reducedMotion;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let frame = 0;
    let cleanup = () => {};

    const setup = async () => {
      const THREE = await import('three');
      if (disposed || !container) return;

      const accent = parseHexColor(theme.accent, 0x22c55e);
      const secondary = parseHexColor(theme.secondary, 0x94a3b8);
      const background = parseHexColor(theme.background, theme.isLight ? 0xf8fafc : 0x050505);
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: quality !== 'thumbnail', powerPreference: 'low-power' });
      renderer.setClearColor(background, theme.isLight ? 0.42 : 0.22);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'thumbnail' ? 1 : 1.6));
      container.appendChild(renderer.domElement);
      renderer.domElement.className = 'absolute inset-0 h-full w-full';

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
      camera.position.set(0, 0, variant === 'wire-terrain' ? 5.8 : 4.8);

      const ambient = new THREE.AmbientLight(0xffffff, theme.isLight ? 0.65 : 0.38);
      const key = new THREE.DirectionalLight(0xffffff, 1.4);
      key.position.set(3, 4, 5);
      const rim = new THREE.PointLight(accent, 2.2, 8);
      rim.position.set(-2.5, 1.8, 2.5);
      scene.add(ambient, key, rim);

      const group = new THREE.Group();
      scene.add(group);
      let shaderMaterial: import('three').ShaderMaterial | null = null;

      if (variant === 'shader-plane') {
        shaderMaterial = createShaderMaterial(THREE, accent, secondary, theme.isLight);
        group.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shaderMaterial));
        camera.position.z = 1;
      } else if (variant === 'wire-terrain') {
        const material = new THREE.MeshBasicMaterial({ color: accent, wireframe: true, transparent: true, opacity: theme.isLight ? 0.22 : 0.34 });
        const geometry = new THREE.PlaneGeometry(8, 5, 44, 28);
        const position = geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i);
          const y = position.getY(i);
          position.setZ(i, Math.sin(x * 1.4) * Math.cos(y * 2.1) * 0.22);
        }
        geometry.computeVertexNormals();
        const terrain = new THREE.Mesh(geometry, material);
        terrain.rotation.x = -1.12;
        terrain.position.y = -1.25;
        group.add(terrain);
      } else if (variant === 'isometric-blocks') {
        const material = new THREE.MeshStandardMaterial({ color: accent, metalness: 0.35, roughness: 0.46, emissive: accent, emissiveIntensity: 0.18 });
        for (let i = 0; i < 9; i++) {
          const box = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18 + (i % 3) * 0.18, 0.38), material);
          box.position.set((i % 3 - 1) * 0.55, -0.45 + Math.floor(i / 3) * 0.28, (Math.floor(i / 3) - 1) * 0.45);
          group.add(box);
        }
        group.rotation.set(-0.52, 0.72, 0.1);
        group.position.x = 0.72;
        group.scale.setScalar(1.18);
      } else if (variant === 'network-globe') {
        const points = [];
        for (let i = 0; i < 180; i++) {
          const y = 1 - (i / 179) * 2;
          const radius = Math.sqrt(1 - y * y);
          const theta = i * 2.39996323;
          points.push(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        group.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: accent, size: 0.024, transparent: true, opacity: 0.86 })));
        group.add(new THREE.Mesh(new THREE.SphereGeometry(1.02, 32, 16), new THREE.MeshBasicMaterial({ color: secondary, wireframe: true, transparent: true, opacity: 0.12 })));
        group.scale.setScalar(1.42);
        group.position.y = -0.08;
      } else if (variant === 'organic-sphere') {
        const material = new THREE.MeshStandardMaterial({ color: 0x07130d, metalness: 0.18, roughness: 0.34, emissive: accent, emissiveIntensity: 0.28 });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.05, 96, 64), material);
        mesh.scale.set(1.25, 0.92, 1);
        group.add(mesh);
      } else {
        const material = new THREE.MeshStandardMaterial({ color: accent, metalness: 0.62, roughness: 0.3, emissive: accent, emissiveIntensity: 0.16, flatShading: true });
        const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), material);
        group.add(mesh);
        const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.04, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.18 }));
        group.add(wire);
      }

      const resize = () => {
        const rect = container.getBoundingClientRect();
        renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
        camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
        camera.updateProjectionMatrix();
      };

      const draw = (now: number) => {
        resize();
        const t = live ? now * 0.001 : 4.2;
        if (shaderMaterial) shaderMaterial.uniforms.uTime.value = t;
        group.rotation.y = t * (variant === 'wire-terrain' ? 0.07 : 0.22);
        group.rotation.x += Math.sin(t * 0.4) * 0.0008;
        group.position.y = Math.sin(t * 0.7) * 0.08;
        renderer.render(scene, camera);
      };

      const tick = (now: number) => {
        draw(now);
        frame = requestAnimationFrame(tick);
      };

      const resizeObserver = new ResizeObserver(() => {
        if (!live) draw(performance.now());
      });
      resizeObserver.observe(container);
      if (live) frame = requestAnimationFrame(tick);
      else draw(performance.now());

      cleanup = () => {
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        renderer.dispose();
        scene.traverse(object => {
          const renderable = object as import('three').Mesh | import('three').Points;
          if ('geometry' in renderable && renderable.geometry) renderable.geometry.dispose();
          if ('material' in renderable && renderable.material) {
            const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
            for (const material of materials) material.dispose();
          }
        });
        renderer.domElement.remove();
      };
    };

    setup();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [live, quality, theme.accent, theme.background, theme.isLight, theme.secondary, variant]);

  return <div ref={containerRef} className="absolute inset-0 overflow-hidden" aria-hidden="true" />;
}

function ThreePreview(props: EffectPreviewProps & { variant: ThreeVariant }) {
  if (props.quality === 'thumbnail') {
    return <ThreeThumbnailPreview variant={props.variant} theme={props.theme} />;
  }
  return <ThreeLivePreview {...props} />;
}

export function createThreePreview(variant: ThreeVariant) {
  function ThreePreviewComponent(props: EffectPreviewProps) {
    return <ThreePreview {...props} variant={variant} />;
  }
  return ThreePreviewComponent;
}

export function createLayeredPreview(...components: Array<ComponentType<EffectPreviewProps>>) {
  function LayeredPreviewComponent(props: EffectPreviewProps) {
    return (
      <>
        {components.map((Component, index) => (
          <div key={index} className="absolute inset-0 overflow-hidden" style={{ zIndex: index }}>
            <Component {...props} />
          </div>
        ))}
      </>
    );
  }
  return LayeredPreviewComponent;
}
