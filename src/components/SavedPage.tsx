import { useEffect, useState } from 'react';
import type { AnalysisResult } from '../../server/types';
import { loadSaved } from '../api';
import AnalyzePage from './AnalyzePage';

export default function SavedPage({ id }: { id: string }) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    loadSaved(id).then(setResult).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <section className="panel"><p className="error">{error}</p></section>;
  if (!result) return <section className="panel"><p className="muted">Loading…</p></section>;
  // Same form as the Analyze page, pre-filled from the shared analysis.
  return <AnalyzePage key={id} initial={result} />;
}
