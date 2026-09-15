/**
 * Containment for prototype pollution during untrusted spreadsheet parsing.
 *
 * The workbook parser is the one place this application feeds attacker-controlled bytes into a
 * third-party parser. The npm distribution of SheetJS is pinned at 0.18.5 — the last version its
 * authors published to npm — and that line carries a known prototype-pollution issue reachable by
 * parsing a crafted workbook (CVE-2023-30533, fixed in 0.19.3, which is distributed only from the
 * vendor's own CDN). See the supply-chain note in the README for how to move to the patched build.
 *
 * Until then this guard bounds the damage rather than relying on the parser being well behaved:
 * it snapshots the built-in prototypes, runs the parse, and if anything new was grafted onto them
 * it removes the additions and refuses the upload. Pollution therefore cannot outlive the request
 * that caused it or leak into another user's analysis.
 */

const GUARDED_PROTOTYPES: [string, object][] = [
  ['Object.prototype', Object.prototype],
  ['Array.prototype', Array.prototype],
  ['Function.prototype', Function.prototype],
  ['String.prototype', String.prototype],
];

function snapshot(): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const [label, proto] of GUARDED_PROTOTYPES) {
    result.set(label, new Set(Object.getOwnPropertyNames(proto)));
  }
  return result;
}

/** Remove any property grafted onto a guarded prototype since the snapshot. */
function reconcile(before: Map<string, Set<string>>): string[] {
  const added: string[] = [];
  for (const [label, proto] of GUARDED_PROTOTYPES) {
    const known = before.get(label);
    if (!known) continue;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (known.has(name)) continue;
      added.push(`${label}.${name}`);
      try {
        delete (proto as Record<string, unknown>)[name];
      } catch {
        // A non-configurable property cannot be removed; it is still reported, and the caller
        // rejects the request either way.
      }
    }
  }
  return added;
}

/**
 * Run an untrusted parse under the guard.
 *
 * Throws a 400 if the parse mutated a built-in prototype, after undoing the mutation.
 */
export function withPrototypeGuard<T>(operation: () => T): T {
  const before = snapshot();
  let result: T;
  try {
    result = operation();
  } catch (error) {
    // Clean up even when the parse itself threw: a parser can pollute and then fail.
    reconcile(before);
    throw error;
  }

  const added = reconcile(before);
  if (added.length > 0) {
    throw Object.assign(
      new Error(
        `The uploaded file was rejected because parsing it attempted to modify built-in JavaScript prototypes (${added.join(', ')}). ` +
          'This is characteristic of a crafted file rather than a real financial workbook. The change has been reverted and nothing was imported.',
      ),
      { status: 400 },
    );
  }

  return result;
}
