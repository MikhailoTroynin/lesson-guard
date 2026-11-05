import type { ReactNode } from 'react';

export { useInPhoneFrame } from './frameContext';

/** На телефоні застосунок займає весь екран — рамка не потрібна. */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
