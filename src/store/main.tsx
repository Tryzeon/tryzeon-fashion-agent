import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Store } from './Store';
import './store.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Store />
  </StrictMode>,
);
