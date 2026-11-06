import { useEffect, type ReactNode } from 'react';

import { PhoneFrameContext } from './frameContext';
import { colors } from './theme';

export { useInPhoneFrame } from './frameContext';

function useWebFonts() {
  useEffect(() => {
    if (document.getElementById('lg-fonts')) return;
    const link = document.createElement('link');
    link.id = 'lg-fonts';
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@400;600&family=Roboto+Condensed:wght@400;600&display=swap';
    document.head.appendChild(link);
    document.body.style.background = colors.bg;
  }, []);
}

/**
 * Веб-версія — звичайний сайт на всю ширину вікна (без макета смартфона).
 * Компонент лишився, щоб нативна і веб-збірка мали однаковий каркас.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  useWebFonts();
  return <PhoneFrameContext.Provider value={false}>{children}</PhoneFrameContext.Provider>;
}
