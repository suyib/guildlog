import { useEffect, useState } from 'react';
import type { AnalysisResult } from '../../server/types';
import { loadSaved } from '../api';
import ResultView from './ResultView';

export default function SavedPage({ id }: { id: string }) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    loadSaved(id).then(setResult).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <section className="card"><p className="error">{error}</p></section>;
  if (!result) return <section className="card"><p className="muted">Loading…</p></section>;
  return <ResultView result={result} />;
}
