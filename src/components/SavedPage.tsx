// A shared analysis (/a/<id>). Guild members get the Analyze form pre-filled from it, so they can
// change the fight, player or comparison (which makes a new analysis; the shared one stays as it is).
// Anyone else with the link sees it read-only, with a prompt to sign in.
import { useEffect, useState } from 'react';
import type { AnalysisResult } from '../../server/types';
import { loadMe, loadSaved, setPublicView } from '../api';
import { useNav } from '../nav';
import AnalyzePage from './AnalyzePage';
import ResultView from './ResultView';

export default function SavedPage({ id }: { id: string }) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    loadMe().then((me) => {
      setPublicView(!me.signedIn);
      setSignedIn(me.signedIn);
      return loadSaved(id).then(setResult);
    }).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <section className="panel"><p className="error">{error === 'Not found' ? 'This shared analysis doesn\u2019t exist any more.' : error}</p></section>;
  if (!result || signedIn === null) return <section className="panel"><p className="muted">Loading…</p></section>;
  if (!signedIn) return <ReadOnly id={id} result={result} />;
  return <AnalyzePage key={id} initial={result} />;
}

function ReadOnly({ id, result }: { id: string; result: AnalysisResult }) {
  const nav = useNav();
  // The menu lists this analysis' sections
  useEffect(() => {
    nav.setResult(result);
    return () => nav.setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  return (
    <>
      <section className="panel shared-note">
        <div>
          <strong>Shared analysis</strong>
          <p className="muted small">
            You&rsquo;re viewing this as a guest, so it can&rsquo;t be changed. Guild members can sign in to compare with someone else or analyze their own fights.
          </p>
        </div>
        <a className="button" href={`/api/login?discord=1&next=${encodeURIComponent(`/a/${id}`)}`}>Sign in with Discord</a>
      </section>
      <ResultView result={result} />
    </>
  );
}
