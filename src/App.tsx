import { useEffect, useState } from 'react';

export function App() {
  const [health, setHealth] = useState<string>('checking…');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((body) => setHealth(JSON.stringify(body)))
      .catch((error: unknown) => setHealth(String(error)));
  }, []);

  return (
    <main>
      <h1>Tryzeon Fashion Agent</h1>
      <pre>{health}</pre>
    </main>
  );
}
