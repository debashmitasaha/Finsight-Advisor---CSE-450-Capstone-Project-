
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Imported here rather than linked from index.html so the bundler emits it with a
// hashed name. A bare <link href="/index.css"> is not copied into dist and 404s in
// production, which silently drops the whole design layer.
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
