import Svg, { Line, Path, Polyline, Rect } from 'react-native-svg';

/** Лінійні іконки (lucide-стиль), як у дизайні. */
export type IconName =
  | 'refresh'
  | 'fileNew'
  | 'warning'
  | 'trendDown'
  | 'chevron'
  | 'reset'
  | 'check'
  | 'shield'
  | 'bell'
  | 'sliders'
  | 'arrow'
  | 'close'
  | 'external'
  | 'wifi'
  | 'battery';

export function Icon({ name, size = 16, color = 'currentColor' }: { name: IconName; size?: number; color?: string }) {
  const p = { stroke: color, strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === 'refresh' && (
        <>
          <Path {...p} d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <Path {...p} d="M21 3v5h-5" />
          <Path {...p} d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <Path {...p} d="M8 16H3v5" />
        </>
      )}
      {name === 'fileNew' && (
        <>
          <Path {...p} d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <Path {...p} d="M14 2v4a2 2 0 0 0 2 2h4" />
          <Path {...p} d="M9 15h6" />
          <Path {...p} d="M12 18v-6" />
        </>
      )}
      {name === 'warning' && (
        <>
          <Path {...p} d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
          <Path {...p} d="M12 9v4" />
          <Path {...p} d="M12 17h.01" />
        </>
      )}
      {name === 'trendDown' && (
        <>
          <Polyline {...p} points="22 17 13.5 8.5 8.5 13.5 2 7" />
          <Polyline {...p} points="16 17 22 17 22 11" />
        </>
      )}
      {name === 'chevron' && <Path {...p} d="m9 18 6-6-6-6" />}
      {name === 'reset' && (
        <>
          <Path {...p} d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <Path {...p} d="M3 3v5h5" />
        </>
      )}
      {name === 'check' && <Path {...p} d="M20 6 9 17l-5-5" />}
      {name === 'shield' && <Path {...p} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />}
      {name === 'bell' && (
        <>
          <Path {...p} d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <Path {...p} d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </>
      )}
      {name === 'sliders' && (
        <>
          <Line {...p} x1="21" x2="14" y1="4" y2="4" />
          <Line {...p} x1="10" x2="3" y1="4" y2="4" />
          <Line {...p} x1="21" x2="12" y1="12" y2="12" />
          <Line {...p} x1="8" x2="3" y1="12" y2="12" />
          <Line {...p} x1="21" x2="16" y1="20" y2="20" />
          <Line {...p} x1="12" x2="3" y1="20" y2="20" />
          <Line {...p} x1="14" x2="14" y1="2" y2="6" />
          <Line {...p} x1="8" x2="8" y1="10" y2="14" />
          <Line {...p} x1="16" x2="16" y1="18" y2="22" />
        </>
      )}
      {name === 'arrow' && (
        <>
          <Path {...p} d="M5 12h14" />
          <Path {...p} d="m12 5 7 7-7 7" />
        </>
      )}
      {name === 'close' && (
        <>
          <Path {...p} d="M18 6 6 18" />
          <Path {...p} d="m6 6 12 12" />
        </>
      )}
      {name === 'external' && (
        <>
          <Path {...p} d="M15 3h6v6" />
          <Path {...p} d="M10 14 21 3" />
          <Path {...p} d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </>
      )}
      {name === 'wifi' && (
        <>
          <Path {...p} d="M12 20h.01" />
          <Path {...p} d="M2 8.82a15 15 0 0 1 20 0" />
          <Path {...p} d="M5 12.86a10 10 0 0 1 14 0" />
          <Path {...p} d="M8.5 16.43a5 5 0 0 1 7 0" />
        </>
      )}
      {name === 'battery' && (
        <>
          <Rect {...p} width="16" height="10" x="2" y="7" rx="2" />
          <Line {...p} x1="22" x2="22" y1="11" y2="13" />
          <Line {...p} x1="6" x2="6" y1="11" y2="13" />
          <Line {...p} x1="10" x2="10" y1="11" y2="13" />
        </>
      )}
    </Svg>
  );
}
