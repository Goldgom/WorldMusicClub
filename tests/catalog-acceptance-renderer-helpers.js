// Load only pure shared renderer helpers. Never run its DOM/browser acceptance.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
export async function catalogAcceptanceRendererHelpers() {
  const source = await readFile(new URL('../crates/desktop-shell/library-catalog-acceptance.js', import.meta.url), 'utf8'), marker = '\n(() => {';
  assert.equal(source.split(marker).length, 2, 'One explicit catalog renderer entry point is required');
  return runInNewContext(source.slice(0, source.indexOf(marker)) + '\n({createCatalogAcceptanceTransport,settleCatalogAcceptanceTransport,catalogManagementPaneReady,catalogPracticeBaselineReady,catalogSeedImportFilenames,catalogAcceptanceEqual,catalogTrustedActionComplete,runCatalogUserPackAcceptance})', {URL, Response, Headers, TextEncoder, TextDecoder, Uint8Array, btoa, structuredClone});
}
