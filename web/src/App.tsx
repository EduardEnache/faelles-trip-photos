/** SCAFFOLD-OWNED. Global providers only; the app lives in app/Root.tsx (package B). */
import { IconContext } from '@phosphor-icons/react';
import Root from '@/app/Root';

const iconDefaults = { weight: 'light' as const, size: 22, mirrored: false, color: 'currentColor' };

export default function App() {
  return (
    <IconContext.Provider value={iconDefaults}>
      <Root />
    </IconContext.Provider>
  );
}
