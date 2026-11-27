import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { followTips } from './followTips';
import './theme.css';

followTips();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
