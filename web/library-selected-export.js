/** Both library views export the same exact storage-qualified selection transport. */
export function exportSelectedLibraryEditions(transport, rows, kind, {signal} = {}) {
  if (!['legacy', 'clean'].includes(kind)) throw new Error('Choose a supported song edition format.');
  const selected = rows.filter(row => row.storage_kind === kind);
  if (!selected.length || new Set(selected.map(row => row.edition_id)).size !== selected.length) throw new Error('Choose an exact, nonempty song edition selection.');
  const entries = selected.map(row => ({storageKind: 'native', storageKey: row.key, ...(kind === 'clean' ? {clean_package: {}} : {})}));
  return transport.exportPack(entries, {signal});
}
export const selectedExportFilename = kind => kind === 'clean' ? 'worldmusicclub-complete-songs.zip' : 'worldmusicclub-legacy-scores.zip';
