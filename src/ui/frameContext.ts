import { createContext, useContext } from 'react';

/** true, коли застосунок намальовано всередині макета смартфона (веб на широкому екрані). */
export const PhoneFrameContext = createContext(false);
export const useInPhoneFrame = () => useContext(PhoneFrameContext);
