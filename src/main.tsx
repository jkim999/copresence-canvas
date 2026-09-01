import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useSceneStore } from './state/sceneStore';
import { sceneFromHash } from './data/shareLink';
import './index.css';

// A shared board is hydrated before the first render, so the seed board never
// flashes up behind it. An unreadable hash is not an error — the page simply
// opens on the demo board, which is what someone following a mangled link wants.
const shared = sceneFromHash(window.location.hash);
if (shared) {
  useSceneStore.getState().loadScene(shared);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
