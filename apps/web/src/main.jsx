import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/prototype.css';
import './styles/app.css';
import './styles/manual-v4.css';
import './styles/harmony.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
