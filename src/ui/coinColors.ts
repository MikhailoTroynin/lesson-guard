import type { CoinTone } from '../core/overview';
import { colors } from './theme';

export const COIN: Record<CoinTone, { color: string; edge: string }> = {
  bad: { color: colors.red, edge: colors.redEdge },
  good: { color: colors.green, edge: colors.greenEdge },
  ok: { color: colors.green, edge: colors.greenEdge },
  empty: { color: colors.amber, edge: colors.amberEdge },
  pending: { color: colors.accent400, edge: colors.accent600 },
};
