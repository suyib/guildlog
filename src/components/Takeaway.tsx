// "What this means" under a chart or table: a few lines worked out from the numbers.
export default function Takeaway({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <div className="takeaway">
      <span className="takeaway-label">What this means</span>
      {lines.map((l, i) => <p key={i}>{l}</p>)}
    </div>
  );
}
