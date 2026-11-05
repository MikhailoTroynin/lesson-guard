import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Line, Path, RadialGradient, Stop } from 'react-native-svg';

import type { CoinFace } from '../core/overview';
import { COIN } from './coinColors';
import { colors, fonts } from './theme';

/**
 * Android-версія щоденника: RN не підтримує preserve-3d, тож книга —
 * SVG у перспективі, а монета обертається через rotateY.
 */

function useLoop(duration: number, active = true) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!active) {
      v.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [v, duration, active]);
  return v;
}

export function Coin({ face, size, spin = 6 }: { face: CoinFace; size: number; spin?: number }) {
  const g = COIN[face.tone];
  const t = useLoop(spin * 1000);
  // Половина оберту — дзеркальна сторона: показуємо «ребро» між ними.
  const rotateY = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View
      accessibilityLabel={`Оцінка ${face.text}`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: g.color,
        borderWidth: Math.max(1.5, size / 22),
        borderColor: 'rgba(255,255,255,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 ${size / 14}px 0 ${g.edge}`,
        transform: [{ perspective: 600 }, { rotateY }],
      }}>
      <Text style={{ color: '#fff', fontSize: size * 0.46, fontWeight: '600', fontFamily: fonts.heading }}>{face.text}</Text>
    </Animated.View>
  );
}

export function Diary({ scale: s, face, scanning }: { scale: number; face: CoinFace | null; scanning: boolean }) {
  const bob = useLoop(4000);
  const flip = useLoop(scanning ? 900 : 7000);
  const translateY = bob.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -8, 0] });
  const pageScale = flip.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, -1, -1] });
  const pageOpacity = flip.interpolate({ inputRange: [0, 0.08, 0.7, 0.85, 1], outputRange: [0, 1, 1, 0, 0] });
  const W = 190 * s;
  const H = 168 * s;
  return (
    <View style={{ width: W, height: H, alignItems: 'center', justifyContent: 'flex-end' }}>
      <Svg width={W} height={H * 0.72} viewBox="0 0 190 120" style={{ position: 'absolute', bottom: 0 }}>
        <Defs>
          <RadialGradient id="shadow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="rgb(41,61,90)" stopOpacity="0.28" />
            <Stop offset="1" stopColor="rgb(41,61,90)" stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="cover" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.accent500} />
            <Stop offset="1" stopColor={colors.accent700} />
          </LinearGradient>
        </Defs>
        <Ellipse cx="95" cy="108" rx="62" ry="10" fill="url(#shadow)" />
        {/* обкладинка */}
        <Path d="M14 70 L92 40 L176 62 L98 100 Z" fill="url(#cover)" />
        {/* сторінки */}
        <Path d="M20 66 L94 38 L94 86 L22 74 Z" fill="#fcfcfe" />
        <Path d="M94 38 L170 60 L168 70 L96 92 Z" fill="#f4f6fb" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Line key={i} x1={28} y1={66 - i * 5} x2={90} y2={44 - i * 3 + 8} stroke={colors.accent200} strokeWidth={0.8} />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <Line key={'r' + i} x1={100} y1={46 + i * 6} x2={164} y2={64 + i * 1.5} stroke={colors.accent200} strokeWidth={0.8} />
        ))}
      </Svg>
      <Animated.View
        style={{
          position: 'absolute',
          bottom: H * 0.18,
          left: W / 2,
          width: W * 0.36,
          height: H * 0.3,
          backgroundColor: '#fcfcfe',
          borderRadius: 3,
          opacity: pageOpacity,
          transformOrigin: 'left',
          transform: [{ skewY: '-16deg' }, { scaleX: pageScale }],
        }}
      />
      {face ? (
        <Animated.View style={{ position: 'absolute', top: 0, transform: [{ translateY }] }}>
          <Coin face={face} size={52 * s} spin={scanning ? 1.2 : 6} />
        </Animated.View>
      ) : null}
    </View>
  );
}

export function Spinning({ active, children }: { active: boolean; children: ReactNode }) {
  const t = useLoop(1000, active);
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View style={{ transform: [{ rotate }] }}>{children}</Animated.View>;
}
