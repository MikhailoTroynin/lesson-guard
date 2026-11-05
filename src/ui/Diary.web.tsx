import type { CSSProperties } from 'react';

import type { CoinFace } from '../core/overview';
import { COIN } from './coinColors';
import { colors } from './theme';

/**
 * Веб-версія 3D-щоденника з дизайну: CSS preserve-3d, гортання сторінок,
 * монета з оцінкою. Рендеримо звичайні DOM-елементи (react-native-web
 * працює поверх react-dom), бо RN-стилі не підтримують preserve-3d.
 */

const KEYFRAMES = `
@keyframes lgSway{0%,100%{transform:rotateX(52deg) rotateZ(-14deg)}50%{transform:rotateX(44deg) rotateZ(-4deg)}}
@keyframes lgFlip{0%{transform:translateZ(4px) rotateY(-8deg);opacity:0}8%{opacity:1}70%{transform:translateZ(4px) rotateY(-172deg);opacity:1}85%,100%{transform:translateZ(4px) rotateY(-172deg);opacity:0}}
@keyframes lgCoin{0%{transform:rotateY(0deg)}100%{transform:rotateY(360deg)}}
@keyframes lgBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes lgSpinIcon{to{transform:rotate(360deg)}}
`;

function ensureKeyframes() {
  if (typeof document === 'undefined' || document.getElementById('lg-keyframes')) return;
  const el = document.createElement('style');
  el.id = 'lg-keyframes';
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
}

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Coin({ face, size, spin = 6 }: { face: CoinFace; size: number; spin?: number }) {
  ensureKeyframes();
  const d = size;
  const g = COIN[face.tone];
  const motion = !reduceMotion();
  const layers = [];
  for (let i = -3; i <= 3; i++) {
    layers.push(
      <div
        key={i}
        style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: g.edge, transform: `translateZ(${(i * d) / 60}px)` }}
      />,
    );
  }
  const faceStyle = (back: boolean): CSSProperties => ({
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,.55), transparent 45%), ${g.color}`,
    boxShadow: `inset 0 0 0 ${Math.max(1.5, d / 22)}px rgba(255,255,255,.45)`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    font: `600 ${d * 0.46}px/1 "Barlow Condensed", "Roboto Condensed", system-ui, sans-serif`,
    transform: `${back ? 'rotateY(180deg) ' : ''}translateZ(${(3.5 * d) / 60}px)`,
    backfaceVisibility: 'hidden',
  });
  return (
    <div style={{ width: d, height: d, perspective: 600 }} aria-label={`Оцінка ${face.text}`}>
      <div
        style={{
          position: 'relative',
          width: d,
          height: d,
          transformStyle: 'preserve-3d',
          animation: motion ? `lgCoin ${spin}s cubic-bezier(.45,.05,.55,.95) infinite` : 'none',
        }}>
        {layers}
        <div style={faceStyle(false)}>{face.text}</div>
        <div style={faceStyle(true)}>{face.text}</div>
      </div>
    </div>
  );
}

export function Diary({ scale: s, face, scanning }: { scale: number; face: CoinFace | null; scanning: boolean }) {
  ensureKeyframes();
  const motion = !reduceMotion();
  const an = (x: string) => (motion ? x : 'none');
  const W = 64 * s;
  const H = 84 * s;
  const lines =
    `linear-gradient(90deg, transparent ${9 * s}px, rgba(232,140,130,.7) ${9 * s}px, rgba(232,140,130,.7) ${9 * s + 1}px, transparent ${9 * s + 1}px), ` +
    `repeating-linear-gradient(transparent 0 ${7 * s}px, ${colors.accent200} ${7 * s}px ${7 * s + 1}px)`;

  const page = (side: 'L' | 'R', key: string, extra?: CSSProperties) => (
    <div
      key={key}
      style={{
        position: 'absolute',
        top: 0,
        width: W,
        height: H,
        left: side === 'L' ? 0 : W,
        transformOrigin: side === 'L' ? '100% 50%' : '0% 50%',
        background: '#fcfcfe',
        backgroundImage: lines,
        borderRadius: side === 'L' ? '3px 0 0 3px' : '0 3px 3px 0',
        boxShadow: `inset ${side === 'L' ? '-' : ''}${6 * s}px 0 ${8 * s}px -6px rgba(41,61,90,.25)`,
        transform: `rotateY(${side === 'L' ? 9 : -9}deg) translateZ(${3 * s}px)`,
        ...extra,
      }}
    />
  );
  const flips = (scanning ? [0, 0.28, 0.56] : [0]).map((d, i) =>
    page('R', 'f' + i, {
      animation: an(scanning ? `lgFlip 1.3s ${d}s ease-in-out infinite` : 'lgFlip 7s 1s ease-in-out infinite'),
      opacity: 0,
      transform: `translateZ(${4 * s}px)`,
    }),
  );
  const cover = (side: 'L' | 'R') => (
    <div
      key={'c' + side}
      style={{
        position: 'absolute',
        top: -3 * s,
        left: side === 'L' ? -3 * s : W,
        width: W + 3 * s,
        height: H + 6 * s,
        transformOrigin: side === 'L' ? '100% 50%' : '0% 50%',
        background: `linear-gradient(135deg, ${colors.accent500}, ${colors.accent700})`,
        borderRadius: side === 'L' ? '5px 0 0 5px' : '0 5px 5px 0',
        transform: `rotateY(${side === 'L' ? 9 : -9}deg)`,
      }}
    />
  );

  return (
    <div
      style={{
        position: 'relative',
        width: 190 * s,
        height: 168 * s,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        perspective: 900 * s,
      }}>
      <div
        style={{
          position: 'absolute',
          bottom: -40 * s,
          width: 230 * s,
          height: 230 * s,
          transform: 'rotateX(76deg)',
          backgroundImage: `linear-gradient(${colors.accent300} 1px, transparent 1px), linear-gradient(90deg, ${colors.accent300} 1px, transparent 1px)`,
          backgroundSize: `${20 * s}px ${20 * s}px`,
          WebkitMaskImage: 'radial-gradient(circle, #000 15%, transparent 65%)',
          maskImage: 'radial-gradient(circle, #000 15%, transparent 65%)',
          opacity: 0.7,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 6 * s,
          width: 120 * s,
          height: 22 * s,
          borderRadius: '50%',
          background: 'radial-gradient(closest-side, rgba(41,61,90,.28), transparent)',
        }}
      />
      <div
        style={{
          position: 'relative',
          width: 2 * W,
          height: H,
          marginBottom: 14 * s,
          transformStyle: 'preserve-3d',
          animation: an('lgSway 9s ease-in-out infinite'),
          transform: 'rotateX(50deg) rotateZ(-10deg)',
        }}>
        {cover('L')}
        {cover('R')}
        {page('L', 'pl')}
        {page('R', 'pr')}
        {flips}
      </div>
      {face ? (
        <div style={{ position: 'absolute', top: 0, left: '50%', marginLeft: -26 * s, animation: an('lgBob 4s ease-in-out infinite') }}>
          <Coin face={face} size={52 * s} spin={scanning ? 1.2 : 6} />
        </div>
      ) : null}
    </div>
  );
}

export function Spinning({ active, children }: { active: boolean; children: React.ReactNode }) {
  ensureKeyframes();
  return <div style={{ display: 'flex', animation: active ? 'lgSpinIcon 1s linear infinite' : 'none' }}>{children}</div>;
}
