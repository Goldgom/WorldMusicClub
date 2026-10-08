//! Optional, read-only GM source identity. This module grants no practice,
//! adaptation, playback, ownership or scoring capability. Unresolved evidence
//! leaves existing raw MIDI-key practice unchanged. Product policy is separate
//! from the reviewed standard identity table, and is deliberately provisional.
use crate::{basic_keys, clean_song::Coordinate, practice_source, source_instrument, Beat};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub const ANALYSIS_POLICY_ID: &str = "wmc-basic-explicit-gm-identity-v1";
pub const IDENTITY_TABLE_REVISION: &str = "wmc-reviewed-gm-subset-v1";
pub const PRODUCT_POLICY_ID: &str = "wmc-provisional-piano-guitar-v1";
pub const MAX_DISCLOSURE_BYTES: usize = 32 * 1024 * 1024;

/// Informational, source-bound output; never an accepted input or capability.
///
/// The exported disclosure type supports serialization. This positive example
/// also binds both public types used by the negative examples below, so an
/// unresolved type path cannot masquerade as a protected API boundary.
/// ```
/// use score_core::{source_identity::SourceIdentityDisclosure, Score};
///
/// fn serialize(disclosure: &SourceIdentityDisclosure) -> serde_json::Result<String> {
///     serde_json::to_string(disclosure)
/// }
/// let _: fn(&SourceIdentityDisclosure) -> serde_json::Result<String> = serialize;
/// let _: Option<Score> = None;
/// ```
///
/// A serialized disclosure cannot be reintroduced as trusted input:
/// ```compile_fail
/// let _: score_core::source_identity::SourceIdentityDisclosure =
///     serde_json::from_str("{}").unwrap();
/// ```
///
/// A disclosure is not a canonical score:
/// ```compile_fail
/// fn as_score(identity: score_core::source_identity::SourceIdentityDisclosure) {
///     let _: score_core::Score = identity;
/// }
/// ```
///
/// Its source-bound fields cannot be rewritten by callers:
/// ```compile_fail
/// fn rewrite(identity: &mut score_core::source_identity::SourceIdentityDisclosure) {
///     identity.original_midi_sha256 = String::new();
/// }
/// ```
#[derive(Debug, Serialize)]
pub struct SourceIdentityDisclosure {
    revision: u32,
    analysis_policy_id: &'static str,
    identity_table_revision: &'static str,
    product_policy_id: &'static str,
    source_profile: &'static str,
    source_binding: practice_source::PracticeSourceBinding,
    original_bytes_verification: source_instrument::OriginalBytesVerification,
    original_midi_sha256: String,
    routes: Vec<RouteEvidence>,
    epochs: Vec<Epoch>,
    attacks: Vec<AttackIdentity>,
    parts: Vec<PartIdentitySummary>,
    diagnostics: Vec<Diagnostic>,
}
#[derive(Debug, Serialize)]
pub struct IdentityError {
    code: &'static str,
    message: String,
}
impl std::fmt::Display for IdentityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for IdentityError {}
fn error(code: &'static str, message: impl Into<String>) -> IdentityError {
    IdentityError {
        code,
        message: message.into(),
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Classification {
    Supported,
    KnownUnsupported,
    Unresolved,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Namespace {
    Gm1,
    Gm2,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
enum Reason {
    MissingGmDeclaration,
    GmOff,
    MissingProgram,
    MissingExplicitBank,
    UnknownTuple,
    ExplicitRoutingOutOfScope,
    TargetedSysex,
    FragmentOrEscape,
    OpaqueSoundBoundary,
    CrossTrackOrderUncertain,
    InvalidProgram,
    OptionalDrumChannelBehavior,
}
#[derive(Debug, Serialize)]
struct Diagnostic {
    code: Reason,
    coordinate: Option<Coordinate>,
}
#[derive(Debug, Serialize)]
struct RouteEvidence {
    source_route_index: Option<usize>,
    port: Option<u8>,
    device_name_bytes: Option<Vec<u8>>,
    declaration_coordinates: Vec<Coordinate>,
    admission: &'static str,
}
#[derive(Debug, Serialize)]
struct Epoch {
    id: usize,
    namespace: Namespace,
    boundary_coordinate: Option<Coordinate>,
    tick: u64,
    boundary_kind: &'static str,
    taint_reason_indices: Vec<usize>,
}
#[derive(Clone, Debug, Serialize)]
struct CommittedSelection {
    program: u8,
    program_coordinate: Coordinate,
    bank_msb: Option<u8>,
    bank_lsb: Option<u8>,
    bank_msb_coordinate: Option<Coordinate>,
    bank_lsb_coordinate: Option<Coordinate>,
    namespace_coordinate: Option<Coordinate>,
}
#[derive(Debug, Serialize)]
struct AttackIdentity {
    note_id: String,
    part_id: String,
    attack_coordinate: Coordinate,
    tick: u64,
    beat: Beat,
    route_index: usize,
    channel: u8,
    epoch_index: usize,
    classification: Classification,
    identity_key: Option<&'static str>,
    label: Option<&'static str>,
    committed_selection: Option<CommittedSelection>,
    reason_indices: Vec<usize>,
}
#[derive(Debug, Serialize)]
struct IdentityCount {
    identity_key: &'static str,
    count: usize,
}
#[derive(Debug, Serialize)]
struct PartIdentitySummary {
    part_id: String,
    attack_count: usize,
    supported_count: usize,
    known_unsupported_count: usize,
    unresolved_count: usize,
    mixed: bool,
    classification: Classification,
    identity_counts: Vec<IdentityCount>,
}
#[derive(Clone, Default)]
struct Channel {
    msb: Option<(u8, Coordinate)>,
    lsb: Option<(u8, Coordinate)>,
    committed: Option<CommittedSelection>,
    // Sticky across every later declaration, including GM On.
    tie: Option<usize>,
}
#[derive(Clone, Copy)]
enum Action {
    Mode(u8),
    Opaque(Reason),
    Bank(u8, u8, u8),
    Program(u8, u8),
    Attack(usize, u8),
}
struct Event {
    tick: u64,
    at: Coordinate,
    action: Action,
}
impl Action {
    fn channel(self) -> Option<u8> {
        match self {
            Self::Bank(c, _, _) | Self::Program(c, _) | Self::Attack(_, c) => Some(c),
            _ => None,
        }
    }
    fn global(self) -> bool {
        matches!(self, Self::Mode(_) | Self::Opaque(_))
    }
    fn changes(self) -> bool {
        !matches!(self, Self::Attack(_, _))
    }
}
struct Diagnostics {
    values: Vec<Diagnostic>,
    index: BTreeMap<(Reason, Option<Coordinate>), usize>,
}
impl Diagnostics {
    fn add(&mut self, code: Reason, coordinate: Option<Coordinate>) -> usize {
        let key = (code, coordinate);
        if let Some(index) = self.index.get(&key) {
            return *index;
        }
        let index = self.values.len();
        self.values.push(Diagnostic { code, coordinate });
        self.index.insert(key, index);
        index
    }
}

/// Revalidate complete Basic source before inspecting it. No renderer-supplied
/// identity is accepted. The digest uses the existing Basic compact-wire domain
/// and revision, never the saved-package domain or declared original MIDI hash.
pub fn describe_basic(
    source: &basic_keys::CompleteBasicKeys,
) -> Result<SourceIdentityDisclosure, IdentityError> {
    if source.performance.profile != basic_keys::PROFILE {
        return Err(error(
            "non_basic_profile",
            "Identity analysis accepts complete Basic MIDI only",
        ));
    }
    let wire = basic_keys::encode_json(source).map_err(|e| error("invalid_basic_source", e))?;
    let binding = practice_source::PracticeSourceBinding {
        domain: "wmc-basic-complete-wire-json".into(),
        serialization_revision: 1,
        digest: format!("{:x}", Sha256::digest(&wire)),
    };
    bounded(build(source, binding)?, MAX_DISCLOSURE_BYTES)
}
fn bounded(
    value: SourceIdentityDisclosure,
    limit: usize,
) -> Result<SourceIdentityDisclosure, IdentityError> {
    struct Budget(usize);
    impl std::io::Write for Budget {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_sub(bytes.len())
                .ok_or_else(|| std::io::Error::other("identity disclosure limit"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(Budget(limit), &value).map_err(|_| error("analysis_limit", "Complete informational output exceeds its byte budget; source and practice are unchanged, and no partial output is returned"))?;
    Ok(value)
}

fn build(
    source: &basic_keys::CompleteBasicKeys,
    source_binding: practice_source::PracticeSourceBinding,
) -> Result<SourceIdentityDisclosure, IdentityError> {
    let perf = &source.performance;
    let mut diagnostics = Diagnostics {
        values: vec![],
        index: BTreeMap::new(),
    };
    let part_index: BTreeMap<_, _> = perf
        .parts
        .iter()
        .enumerate()
        .map(|(i, p)| (p.id.as_str(), i))
        .collect();
    let note_index: BTreeMap<_, _> = perf
        .notes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.attack, i))
        .collect();
    if note_index.len() != perf.notes.len() || perf.notes.len() > source.coverage.source_events {
        return Err(error(
            "analysis_limit",
            "Attack/event cardinality invariant failed",
        ));
    }
    let mut routes: Vec<_> = perf
        .routes
        .iter()
        .enumerate()
        .map(|(i, r)| RouteEvidence {
            source_route_index: Some(i),
            port: r.port,
            device_name_bytes: r.device_name_bytes.clone(),
            declaration_coordinates: vec![],
            admission: "sole_implicit_route",
        })
        .collect();
    // Intern names only on actual name declarations. Port changes compare
    // compact IDs, never a potentially megabyte-long current device name.
    let mut names = Vec::<Vec<u8>>::new();
    let mut name_index = BTreeMap::<Vec<u8>, usize>::new();
    let mut route_index = BTreeMap::new();
    for (i, route) in perf.routes.iter().enumerate() {
        let name = route
            .device_name_bytes
            .as_deref()
            .map(|bytes| intern_name(bytes, &mut names, &mut name_index));
        route_index.insert((route.port, name), i);
    }
    // Bound copied route text before building extra metadata-only route states.
    // A large device name followed by many port changes must not amplify memory
    // without limit before the final serialized-output budget is checked.
    let mut route_bytes = routes
        .iter()
        .map(|r| r.device_name_bytes.as_ref().map_or(0, Vec::len))
        .sum::<usize>();
    let mut first_route = None;
    let mut events = vec![];
    for track in &perf.tracks {
        let mut tick = 0u64;
        let mut route: (Option<u8>, Option<usize>) = (None, None);
        for (index, record) in track.events.iter().enumerate() {
            tick += u64::from(record.0);
            let at = Coordinate {
                track: track.source_index,
                event: index as u32,
            };
            let bytes = record.1.as_slice();
            // Retain even metadata-only routes; explicit port zero is not implicit.
            let routing = match bytes {
                [255, 0x21, port] => {
                    route.0 = Some(*port);
                    true
                }
                [255, 0x09, name @ ..] => {
                    route.1 = Some(intern_name(name, &mut names, &mut name_index));
                    true
                }
                _ => false,
            };
            if routing {
                first_route.get_or_insert(at);
                let ri = if let Some(ri) = route_index.get(&route) {
                    *ri
                } else {
                    let added_bytes = route.1.map_or(0, |id| names[id].len());
                    route_bytes = route_bytes
                        .checked_add(added_bytes)
                        .filter(|n| *n <= MAX_DISCLOSURE_BYTES)
                        .ok_or_else(|| {
                            error(
                                "analysis_limit",
                                "Route evidence exceeds its complete-output budget",
                            )
                        })?;
                    let ri = routes.len();
                    routes.push(RouteEvidence {
                        source_route_index: None,
                        port: route.0,
                        device_name_bytes: route.1.map(|id| names[id].clone()),
                        declaration_coordinates: vec![],
                        admission: "explicit_routing_out_of_scope",
                    });
                    route_index.insert(route, ri);
                    ri
                };
                routes[ri].declaration_coordinates.push(at);
            }
            let action = match bytes {
                [0xf0, 0x7e, 0x7f, 9, mode @ 1..=3, 0xf7] => Some(Action::Mode(*mode)),
                [0xf0, 0x7e, device, 9, 1..=3, 0xf7] if *device != 0x7f => {
                    Some(Action::Opaque(Reason::TargetedSysex))
                }
                [0xf7, ..] => Some(Action::Opaque(Reason::FragmentOrEscape)),
                [0xf0, rest @ ..] => Some(Action::Opaque(if rest.last() != Some(&0xf7) {
                    Reason::FragmentOrEscape
                } else {
                    Reason::OpaqueSoundBoundary
                })),
                [255, 0x7f, ..] => Some(Action::Opaque(Reason::OpaqueSoundBoundary)),
                [status, controller @ (0 | 32), value] if status & 0xf0 == 0xb0 => {
                    Some(Action::Bank(status & 15, *controller, *value))
                }
                [status, value] if status & 0xf0 == 0xc0 => {
                    Some(Action::Program(status & 15, *value))
                }
                [status, _, velocity] if status & 0xf0 == 0x90 && *velocity > 0 => {
                    let ni = *note_index.get(&at).ok_or_else(|| {
                        error(
                            "invalid_basic_source",
                            "Attack has no validated source note",
                        )
                    })?;
                    Some(Action::Attack(ni, status & 15))
                }
                _ => None,
            };
            if let Some(action) = action {
                events.push(Event { tick, at, action });
            }
        }
    }
    let route_reason =
        first_route.map(|at| diagnostics.add(Reason::ExplicitRoutingOutOfScope, Some(at)));
    if route_reason.is_some() {
        for route in &mut routes {
            route.admission = "explicit_routing_out_of_scope";
        }
    }
    events.sort_by_key(|e| (e.tick, e.at));
    let mut channels: [Channel; 16] = std::array::from_fn(|_| Channel::default());
    let mut namespace = Namespace::Unknown;
    let mut boundary = None;
    let mut off = false;
    // At most one sticky diagnostic per reason, not one per opaque event per attack.
    let mut global_taints = BTreeMap::<Reason, usize>::new();
    let mut epochs = vec![Epoch {
        id: 0,
        namespace,
        boundary_coordinate: None,
        tick: 0,
        boundary_kind: "source_start",
        taint_reason_indices: vec![],
    }];
    let mut attacks = Vec::with_capacity(perf.notes.len());
    let mut start = 0;
    while start < events.len() {
        let mut end = start + 1;
        while end < events.len() && events[end].tick == events[start].tick {
            end += 1;
        }
        let group = &events[start..end];
        mark_ties(group, &mut channels, &mut global_taints, &mut diagnostics);
        for event in group {
            match event.action {
                Action::Mode(mode) => {
                    namespace = match mode {
                        1 => Namespace::Gm1,
                        3 => Namespace::Gm2,
                        _ => Namespace::Unknown,
                    };
                    off = mode == 2;
                    boundary = Some(event.at);
                    for ch in &mut channels {
                        ch.msb = None;
                        ch.lsb = None;
                        ch.committed = None;
                    }
                    epochs.push(Epoch {
                        id: epochs.len(),
                        namespace,
                        boundary_coordinate: boundary,
                        tick: event.tick,
                        boundary_kind: if off { "gm_off" } else { "gm_on" },
                        taint_reason_indices: global_taints.values().copied().collect(),
                    });
                }
                Action::Opaque(reason) => {
                    global_taints
                        .entry(reason)
                        .or_insert_with(|| diagnostics.add(reason, Some(event.at)));
                }
                Action::Bank(channel, controller, value) => {
                    let ch = &mut channels[usize::from(channel)];
                    if controller == 0 {
                        ch.msb = Some((value, event.at));
                    } else {
                        ch.lsb = Some((value, event.at));
                    }
                }
                Action::Program(channel, program) => {
                    let ch = &mut channels[usize::from(channel)];
                    ch.committed = Some(CommittedSelection {
                        program,
                        program_coordinate: event.at,
                        bank_msb: ch.msb.map(|v| v.0),
                        bank_lsb: ch.lsb.map(|v| v.0),
                        bank_msb_coordinate: ch.msb.map(|v| v.1),
                        bank_lsb_coordinate: ch.lsb.map(|v| v.1),
                        namespace_coordinate: boundary,
                    });
                }
                Action::Attack(ni, channel) => {
                    let note = &perf.notes[ni];
                    let part =
                        &perf.parts[*part_index.get(note.part_id.as_str()).ok_or_else(|| {
                            error("invalid_basic_source", "Attack has no validated part")
                        })?];
                    let ch = &channels[usize::from(channel)];
                    let mut reasons: Vec<_> = global_taints.values().copied().collect();
                    reasons.extend(route_reason);
                    reasons.extend(ch.tie);
                    let identity = if reasons.is_empty() {
                        match identify(namespace, off, channel, ch.committed.as_ref()) {
                            Ok(identity) => Some(identity),
                            Err(reason) => {
                                reasons.push(
                                    diagnostics.add(
                                        reason,
                                        ch.committed
                                            .as_ref()
                                            .map(|s| s.program_coordinate)
                                            .or(boundary),
                                    ),
                                );
                                None
                            }
                        }
                    } else {
                        None
                    };
                    // Track sorting is presentation order, never evidence of a
                    // winning selection at a cross-track tie. Do not expose an
                    // arbitrary sorted candidate as the committed snapshot.
                    let ordering_uncertain = ch.tie.is_some()
                        || global_taints.contains_key(&Reason::CrossTrackOrderUncertain);
                    let committed_selection = if ordering_uncertain {
                        None
                    } else {
                        ch.committed.clone()
                    };
                    attacks.push(AttackIdentity {
                        note_id: note.note_id.clone(),
                        part_id: note.part_id.clone(),
                        attack_coordinate: note.attack,
                        tick: note.start.tick,
                        beat: note.start.beat,
                        route_index: part.route,
                        channel,
                        epoch_index: epochs.len() - 1,
                        classification: identity.map_or(Classification::Unresolved, |i| {
                            product_classification(i.key)
                        }),
                        identity_key: identity.map(|i| i.key),
                        label: identity.map(|i| i.label),
                        committed_selection,
                        reason_indices: reasons,
                    });
                }
            }
        }
        start = end;
    }
    if attacks.len() != perf.notes.len() {
        return Err(error(
            "invalid_basic_source",
            "Disclosure must snapshot every source attack exactly once",
        ));
    }
    let parts = summarize(&perf.parts, &attacks);
    Ok(SourceIdentityDisclosure {
        revision: 1,
        analysis_policy_id: ANALYSIS_POLICY_ID,
        identity_table_revision: IDENTITY_TABLE_REVISION,
        product_policy_id: PRODUCT_POLICY_ID,
        source_profile: basic_keys::PROFILE,
        source_binding,
        original_bytes_verification:
            source_instrument::OriginalBytesVerification::DeclaredProvenanceOnly,
        original_midi_sha256: source.source.sha256.clone(),
        routes,
        epochs,
        attacks,
        parts,
        diagnostics: diagnostics.values,
    })
}

fn intern_name(
    bytes: &[u8],
    names: &mut Vec<Vec<u8>>,
    index: &mut BTreeMap<Vec<u8>, usize>,
) -> usize {
    if let Some(id) = index.get(bytes) {
        return *id;
    }
    let id = names.len();
    names.push(bytes.to_vec());
    index.insert(bytes.to_vec(), id);
    id
}

// O(events * 16), independent of the number of permissible interleavings.
fn mark_ties(
    group: &[Event],
    channels: &mut [Channel; 16],
    global: &mut BTreeMap<Reason, usize>,
    diagnostics: &mut Diagnostics,
) {
    let tracks: BTreeSet<_> = group.iter().map(|e| e.at.track).collect();
    if tracks.len() < 2 {
        return;
    }
    if let Some(event) = group.iter().find(|e| e.action.global()) {
        global
            .entry(Reason::CrossTrackOrderUncertain)
            .or_insert_with(|| diagnostics.add(Reason::CrossTrackOrderUncertain, Some(event.at)));
    }
    for (channel, state) in channels.iter_mut().enumerate() {
        if state.tie.is_some() {
            continue;
        }
        let mut first = None;
        let mut foreign = false;
        let mut change = None;
        for event in group
            .iter()
            .filter(|e| e.action.channel() == Some(channel as u8))
        {
            if let Some(track) = first {
                foreign |= track != event.at.track;
            } else {
                first = Some(event.at.track);
            }
            if event.action.changes() {
                change = Some(event.at);
            }
        }
        if foreign {
            if let Some(at) = change {
                state.tie = Some(diagnostics.add(Reason::CrossTrackOrderUncertain, Some(at)));
            }
        }
    }
}

#[derive(Clone, Copy)]
struct Identity {
    key: &'static str,
    label: &'static str,
}
// Finite reviewed subset, deliberately not a claim to cover all GM sounds.
// Source facts: MIDI Association GM1; AMEI RP-024 Appendix A (GM2),
// https://midi.org/general-midi-level-1
// https://amei.or.jp/midistandardcommittee/Recommended_Practice/GM2_japanese.pdf
fn base_identity(program: u8) -> Option<Identity> {
    let (key, label) = match program {
        0 => ("gm:acoustic_grand_piano", "Acoustic Grand Piano"),
        6 => ("gm:harpsichord", "Harpsichord"),
        7 => ("gm:clav", "Clav"),
        24 => ("gm:acoustic_guitar_nylon", "Acoustic Guitar (nylon)"),
        25 => ("gm:acoustic_guitar_steel", "Acoustic Guitar (steel)"),
        40 => ("gm:violin", "Violin"),
        _ => return None,
    };
    Some(Identity { key, label })
}
fn product_classification(key: &str) -> Classification {
    match key {
        "gm:acoustic_grand_piano" | "gm:acoustic_guitar_nylon" | "gm:acoustic_guitar_steel" => {
            Classification::Supported
        }
        _ => Classification::KnownUnsupported,
    }
}
fn identify(
    namespace: Namespace,
    off: bool,
    channel: u8,
    selection: Option<&CommittedSelection>,
) -> Result<Identity, Reason> {
    if namespace == Namespace::Unknown {
        return Err(if off {
            Reason::GmOff
        } else {
            Reason::MissingGmDeclaration
        });
    }
    if selection.is_some_and(|s| s.program > 127) {
        return Err(Reason::InvalidProgram);
    }
    // GM1 percussion identity needs no inferred kit or program default.
    if namespace == Namespace::Gm1 && channel == 9 {
        return Ok(Identity {
            key: "gm:percussion",
            label: "GM percussion (kit unspecified)",
        });
    }
    let selection = selection.ok_or(Reason::MissingProgram)?;
    if selection.program > 127 {
        return Err(Reason::InvalidProgram);
    }
    if namespace == Namespace::Gm1 {
        return base_identity(selection.program).ok_or(Reason::UnknownTuple);
    }
    let (msb, lsb) = match (selection.bank_msb, selection.bank_lsb) {
        (Some(m), Some(l)) => (m, l),
        _ => return Err(Reason::MissingExplicitBank),
    };
    match (msb, lsb, selection.program) {
        (121, 0, program) => base_identity(program).ok_or(Reason::UnknownTuple),
        (121, 1, 24) => Ok(Identity {
            key: "gm2:ukulele",
            label: "Ukulele",
        }),
        (121, 2, 25) => Ok(Identity {
            key: "gm2:mandolin",
            label: "Mandolin",
        }),
        (120, 0, 0) if channel == 9 || channel == 10 => Ok(Identity {
            key: "gm2:standard_drum_kit",
            label: "Standard Drum Kit",
        }),
        (120, 0, 0) => Err(Reason::OptionalDrumChannelBehavior),
        _ => Err(Reason::UnknownTuple),
    }
}
fn summarize(parts: &[basic_keys::Part], attacks: &[AttackIdentity]) -> Vec<PartIdentitySummary> {
    let mut summaries: BTreeMap<_, _> = parts
        .iter()
        .map(|p| {
            (
                p.id.as_str(),
                (
                    0usize,
                    0usize,
                    0usize,
                    BTreeMap::<&'static str, usize>::new(),
                ),
            )
        })
        .collect();
    for attack in attacks {
        if let Some((supported, unsupported, unresolved, identities)) =
            summaries.get_mut(attack.part_id.as_str())
        {
            match attack.classification {
                Classification::Supported => *supported += 1,
                Classification::KnownUnsupported => *unsupported += 1,
                Classification::Unresolved => *unresolved += 1,
            }
            if let Some(key) = attack.identity_key {
                *identities.entry(key).or_default() += 1;
            }
        }
    }
    parts
        .iter()
        .map(|p| {
            let (supported, unsupported, unresolved, identities) = summaries
                .remove(p.id.as_str())
                .expect("validated part summary");
            let count = supported + unsupported + unresolved;
            let states = usize::from(supported > 0)
                + usize::from(unsupported > 0)
                + usize::from(unresolved > 0);
            PartIdentitySummary {
                part_id: p.id.clone(),
                attack_count: count,
                supported_count: supported,
                known_unsupported_count: unsupported,
                unresolved_count: unresolved,
                mixed: states > 1 || identities.len() > 1,
                classification: if count > 0 && supported == count {
                    Classification::Supported
                } else if count > 0 && unsupported == count {
                    Classification::KnownUnsupported
                } else {
                    Classification::Unresolved
                },
                identity_counts: identities
                    .into_iter()
                    .map(|(identity_key, count)| IdentityCount {
                        identity_key,
                        count,
                    })
                    .collect(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests;
