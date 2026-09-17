import { useEffect, useState } from 'react';
import type { Num, PeerCompany } from '@fca/core';
import { useWorkspace } from '../state/WorkspaceContext';
import { Badge, Banner, Card, EmptyState, PageHeader } from '../components/ui/primitives';
import { fmtCtx, formatMetric } from '../lib/display';

/** Parse a peer metric cell. Blank means "not available" and is stored as null, never zero. */
function parseMetric(text: string): Num {
  const cleaned = text.replace(/[%x,\s]/gi, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export default function Peers() {
  const { analysis, current, savePeers } = useWorkspace();
  const [draft, setDraft] = useState<PeerCompany[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(current?.peers?.map((p) => ({ ...p, metrics: { ...p.metrics } })) ?? []);
    setDirty(false);
  }, [current?.id, current?.peers]);

  if (!analysis || !current) return null;
  const ctx = fmtCtx(current.company);
  const rows = analysis.peerComparison;

  const addPeer = () => {
    setDraft((prev) => [...prev, { name: `Peer ${prev.length + 1}`, metrics: {} }]);
    setDirty(true);
  };

  const updatePeer = (index: number, patch: Partial<PeerCompany>) => {
    setDraft((prev) => prev.map((peer, i) => (i === index ? { ...peer, ...patch } : peer)));
    setDirty(true);
  };

  const updateMetric = (index: number, key: string, text: string) => {
    setDraft((prev) =>
      prev.map((peer, i) => {
        if (i !== index) return peer;
        const metrics = { ...peer.metrics };
        const value = parseMetric(text);
        if (value === null) delete metrics[key];
        else metrics[key] = value;
        return { ...peer, metrics };
      }),
    );
    setDirty(true);
  };

  const removePeer = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await savePeers(draft.filter((p) => p.name.trim().length > 0));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const hasPeerData = rows.some((r) => r.peerValues.some((p) => p.value !== null));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Peer Comparison"
        description="Benchmark the company against peers you supply. Peer figures are entered by you and are echoed as given — they are not calculated by the engine and are labelled accordingly, so the two are never confused."
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={addPeer}>Add peer</button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? 'Saving…' : dirty ? 'Save peers' : 'Saved'}
            </button>
          </>
        }
      />

      <Banner tone="accent">
        Peer metrics are supplied by you, not derived from peer financial statements. Enter percentages as plain numbers
        (18.4 for 18.4%) and multiples as plain numbers (2.1 for 2.1x). Leave a cell blank when a figure is unavailable — blanks
        are excluded from the peer average rather than counted as zero.
      </Banner>

      {!hasPeerData ? (
        <EmptyState
          title="No peer data has been entered yet"
          message="Add a peer and fill in the metrics you have for it. The comparison table fills in automatically, showing your company against the peer average, the best peer and the worst peer for each measure."
          action={<button type="button" className="btn-primary" onClick={addPeer}>Add a peer</button>}
        />
      ) : (
        <Card title="Comparison" description={`${current.company.name} against ${draft.length} ${draft.length === 1 ? 'peer' : 'peers'}.`} padded={false}>
          <div className="table-scroll">
            <table className="fin-table sticky-labels">
              <thead>
                <tr>
                  <th className="text-left">Metric</th>
                  <th>{current.company.name}</th>
                  <th>Peer average</th>
                  <th className="text-left">Best peer</th>
                  <th className="text-left">Worst peer</th>
                  <th className="text-left">Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const ahead =
                    row.company !== null && row.peerAverage !== null
                      ? row.company > row.peerAverage
                      : null;
                  return (
                    <tr key={row.metricKey}>
                      <th>{row.label}</th>
                      <td className={`tnum font-semibold ${row.company === null ? 'text-ink-400' : ''}`}>
                        {row.company !== null ? formatMetric(row.company, row.unit, ctx) : 'n/a'}
                        {ahead !== null && (
                          <span className={`ml-1.5 text-2xs ${ahead ? 'text-positive-600' : 'text-negative-600'}`} title="Versus peer average">
                            {ahead ? '▲' : '▼'}
                          </span>
                        )}
                      </td>
                      <td className="tnum">{row.peerAverage !== null ? formatMetric(row.peerAverage, row.unit, ctx) : <span className="text-ink-400">n/a</span>}</td>
                      <td className="text-left">
                        {row.bestPeer ? (
                          <span className="text-ink-700 dark:text-ink-300">
                            {row.bestPeer.name} <span className="tnum font-medium">{formatMetric(row.bestPeer.value, row.unit, ctx)}</span>
                          </span>
                        ) : <span className="text-ink-400">n/a</span>}
                      </td>
                      <td className="text-left">
                        {row.worstPeer ? (
                          <span className="text-ink-700 dark:text-ink-300">
                            {row.worstPeer.name} <span className="tnum font-medium">{formatMetric(row.worstPeer.value, row.unit, ctx)}</span>
                          </span>
                        ) : <span className="text-ink-400">n/a</span>}
                      </td>
                      <td className="max-w-xs whitespace-normal text-left text-2xs text-ink-500 dark:text-ink-400">{row.note ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-2xs text-ink-500 dark:text-ink-400">
            The company column is calculated by the engine from the financial data you entered. The peer columns are the values
            you supplied, unmodified.
          </p>
        </Card>
      )}

      <Card title="Peer data" description="Enter the metrics you have for each peer. Blank cells stay unavailable." padded={false}>
        {draft.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No peers" message="Add a peer to start entering benchmark data." action={<button type="button" className="btn-primary" onClick={addPeer}>Add peer</button>} />
          </div>
        ) : (
          <div className="table-scroll">
            <table className="fin-table sticky-labels">
              <thead>
                <tr>
                  <th className="text-left" style={{ minWidth: 180 }}>Peer</th>
                  {rows.map((row) => (
                    <th key={row.metricKey} style={{ minWidth: 100 }} title={row.label}>
                      <span className="block truncate">{row.label}</span>
                      <span className="block font-normal normal-case tracking-normal text-ink-400">
                        {row.unit === 'percent' ? '%' : row.unit === 'times' ? 'x' : row.unit}
                      </span>
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.map((peer, index) => (
                  <tr key={index}>
                    <th>
                      <input
                        className="input py-1"
                        value={peer.name}
                        onChange={(e) => updatePeer(index, { name: e.target.value })}
                        aria-label={`Peer ${index + 1} name`}
                      />
                    </th>
                    {rows.map((row) => (
                      <td key={row.metricKey} className="p-0">
                        <input
                          className="cell-input"
                          defaultValue={typeof peer.metrics[row.metricKey] === 'number' ? String(peer.metrics[row.metricKey]) : ''}
                          onBlur={(e) => updateMetric(index, row.metricKey, e.target.value)}
                          inputMode="decimal"
                          aria-label={`${peer.name} ${row.label}`}
                        />
                      </td>
                    ))}
                    <td>
                      <button type="button" className="btn-danger" onClick={() => removePeer(index)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {current.company.isSample && (
        <Card>
          <p className="text-[12.5px] leading-relaxed text-ink-600 dark:text-ink-400">
            <Badge tone="caution">Note</Badge>{' '}
            The peers shipped with the sample dataset are fictional and their figures were invented for demonstration. They do
            not describe real companies.
          </p>
        </Card>
      )}
    </div>
  );
}
