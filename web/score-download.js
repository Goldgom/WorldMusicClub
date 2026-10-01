/** Preserve the complete canonical object; keep its JSON reimportable when it fits. */
export const SCORE_DOWNLOAD_LIMIT = 8 * 1024 * 1024;
const encoder = new TextEncoder();

export function prepareScoreDownload(score) {
  const compact = JSON.stringify(score);
  if (typeof compact !== 'string') throw new Error('No canonical score is available to export.');
  const compactBytes = encoder.encode(compact).byteLength;
  if (compactBytes > SCORE_DOWNLOAD_LIMIT) {
    // A legacy/expanded in-memory score may no longer fit the current reader.
    // Preserve a full copy for the user and let the UI disclose that limitation.
    return {text: compact, bytes: compactBytes, formatting: 'compact', reimportable: false};
  }
  const indented = JSON.stringify(score, null, 2);
  const indentedBytes = encoder.encode(indented).byteLength;
  return indentedBytes <= SCORE_DOWNLOAD_LIMIT
    ? {text: indented, bytes: indentedBytes, formatting: 'indented', reimportable: true}
    : {text: compact, bytes: compactBytes, formatting: 'compact', reimportable: true};
}
