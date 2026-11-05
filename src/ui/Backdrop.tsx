import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors } from './theme';

/** М’які кольорові плями фону з дизайну. */
export function Backdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="b1" cx="0%" cy="0%" rx="110%" ry="55%">
            <Stop offset="0" stopColor={colors.accent100} stopOpacity="1" />
            <Stop offset="0.62" stopColor={colors.accent100} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="b2" cx="100%" cy="38%" rx="80%" ry="45%">
            <Stop offset="0" stopColor="#f1effb" stopOpacity="1" />
            <Stop offset="0.65" stopColor="#f1effb" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="b3" cx="30%" cy="100%" rx="90%" ry="50%">
            <Stop offset="0" stopColor="#eef7f8" stopOpacity="1" />
            <Stop offset="0.6" stopColor="#eef7f8" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={colors.bg} />
        <Rect width="100%" height="100%" fill="url(#b1)" />
        <Rect width="100%" height="100%" fill="url(#b2)" />
        <Rect width="100%" height="100%" fill="url(#b3)" />
      </Svg>
    </View>
  );
}
