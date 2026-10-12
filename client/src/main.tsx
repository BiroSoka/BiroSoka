import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { sfx } from './lib/audio';
import { installVatar } from './lib/vatar';

sfx.installGestureUnlock();
installVatar();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
