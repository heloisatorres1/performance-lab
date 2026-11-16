import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createStore, loadPersisted, persist, seed, setActiveStore } from './data/state';
import { recoverAfterReload } from './data/actions';
import './styles/app.css';

setActiveStore(createStore(loadPersisted() ?? seed(), persist));
// A recording cannot survive a reload: mark it interrupted instead of resuming.
recoverAfterReload();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
