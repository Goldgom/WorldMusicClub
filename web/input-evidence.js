/** Bounded observations only: no release pairing, durations, or performance judgement. */
export const INPUT_EVIDENCE_LIMIT = 100_000;

export class InputEvidence {
  constructor({limit = INPUT_EVIDENCE_LIMIT, onLimit = () => {}} = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > INPUT_EVIDENCE_LIMIT) throw new Error('Invalid input evidence limit');
    this.limit = limit; this.onLimit = onLimit; this.enabled = false;
    this.events = []; this.sources = new Map(); this.generations = new Map(); this.active = new Map(); this.awaitingRelease = new Set();
    this.omitted = 0; this.firstOmitted = null;
  }
  start() { this.enabled = true; }
  generation(token) {
    if (token == null) return null;
    if (!this.generations.has(token)) this.generations.set(token, `generation-${this.generations.size + 1}`);
    return this.generations.get(token);
  }
  sourceKey(source, token) { return `${this.generation(token) ?? 'local'}:${source}`; }
  append({kind, source = null, generationToken = null, inputKind = null, channel = null, midi = null,
    velocity = null, encoding = null, reason = null, eventWall, receivedWall = eventWall,
    timestampBasis = 'application_clock', rawTimestamp = null, boundaryWall = null, capture = null}) {
    if (!this.enabled || !Number.isFinite(eventWall) || !Number.isFinite(receivedWall)) return null;
    if (this.events.length >= this.limit) {
      this.omitted++;
      if (this.firstOmitted === null) { this.firstOmitted = receivedWall; this.onLimit(); }
      return null;
    }
    const generation = this.generation(generationToken);
    let identity = null;
    if (source !== null) {
      const key = this.sourceKey(source, generationToken);
      identity = this.sources.get(key);
      if (!identity) {
        identity = {id:`source-${this.sources.size + 1}`, source, generationToken, inputKind, channel, midi};
        this.sources.set(key, identity);
      }
      if (kind === 'note_on') { identity.midi = midi; this.active.set(key, {...identity, midi}); this.awaitingRelease.add(key); }
      else if (kind === 'note_off' || kind === 'synthetic_release') {
        this.active.delete(key);
        if (kind === 'note_off') this.awaitingRelease.delete(key);
      }
    }
    const event = Object.freeze({event_id:this.events.length + 1, kind, source_id:identity?.id ?? null,
      source_generation:generation, input_kind:inputKind ?? identity?.inputKind ?? null,
      channel:channel ?? identity?.channel ?? null, midi, velocity, encoding, reason,
      event_wall_ms:eventWall, received_wall_ms:receivedWall, timestamp_basis:timestampBasis,
      raw_timestamp_ms:Number.isFinite(rawTimestamp) ? rawTimestamp : null, boundary_wall_ms:boundaryWall,
      onset_capture:capture ? Object.freeze({...capture}) : null});
    this.events.push(event);
    return event;
  }
  release({source, generationToken = null, midi = null, ...event}) {
    // MIDI carries its pitch even when its onset was absent or delivered later.
    // Unrelated typing keyups and duplicate UI cleanup are not musical observations.
    if (!this.enabled) return null;
    const generation = generationToken == null ? null : this.generations.get(generationToken);
    const expected = this.awaitingRelease.has(`${generation ?? 'local'}:${source}`);
    if (!expected && midi === null && !event.inputKind) return null;
    return this.append({...event, source, generationToken, midi, kind:'note_off'});
  }
  cancel({source = null, prefix = null, generationToken = null, channel = null, ...event}) {
    if (!this.enabled) return;
    const generation = generationToken == null ? null : this.generations.get(generationToken);
    if (source !== null && !this.active.has(`${generation ?? 'local'}:${source}`)) return;
    // Session/port boundaries survive delayed onsets. Per-contact cleanup after
    // an explicit release is a duplicate browser notification, not a cancellation.
    this.append({...event, kind:'boundary', source, generationToken, channel});
    for (const [key, identity] of [...this.active]) {
      if (source !== null && identity.source !== source) continue;
      if (prefix !== null && !identity.source.startsWith(prefix)) continue;
      if (generationToken !== null && identity.generationToken !== generationToken) continue;
      this.append({...event, kind:'synthetic_release', source:identity.source,
        generationToken:identity.generationToken, inputKind:identity.inputKind, channel:identity.channel, midi:identity.midi});
      this.active.delete(key);
    }
  }
  exportData() {
    return {version:1, scope:'observed musical input from first practice pass until session reset',
      event_order:'receipt_order', pairing:'not_implemented', release_assessment:'not_implemented',
      duration_eligibility:'unknown', controllers:'only CC120/123 cleanup is observed; pedals and other controllers are not captured',
      limit:this.limit, truncated:this.omitted > 0, omitted_observations:this.omitted,
      first_omitted_received_wall_ms:this.firstOmitted, events:[...this.events]};
  }
}
