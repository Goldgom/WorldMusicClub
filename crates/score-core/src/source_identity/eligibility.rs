//! Compact, immutable policy result from the shared original-source analysis.
use super::{
    basic_keys, error, practice_source, Classification, IdentityError, ANALYSIS_POLICY_ID,
    IDENTITY_TABLE_REVISION, PRACTICE_ELIGIBILITY_POLICY_ID, PRODUCT_POLICY_ID,
};

/// Complete original-source Human-practice exclusions, created only by
/// [`super::analyze_basic_practice`]. An empty exclusion list on a successful
/// result means this policy excluded nothing. It does not prove that a source
/// is playable on a chosen instrument or authorize automatic adaptation.
///
/// Keep this result and its original binding across later note projections;
/// projected notes or informational JSON must never become source authority.
/// Storage is O(source attacks + source parts): at most one generated note ID
/// per excluded attack, one small count record per part, and a fixed binding.
/// There are no copied labels, route names, epochs or diagnostic histories.
///
/// A positive example binds the public API used by the boundary examples:
/// ```
/// use score_core::{basic_keys::CompleteBasicKeys, source_identity::{
///     analyze_basic_practice, IdentityError, SourcePracticeEligibility,
/// }};
/// let _: fn(&CompleteBasicKeys) -> Result<SourcePracticeEligibility, IdentityError> =
///     analyze_basic_practice;
/// fn read(result: &SourcePracticeEligibility) -> usize {
///     result.complete_attack_count()
/// }
/// let _: fn(&SourcePracticeEligibility) -> usize = read;
/// ```
///
/// Caller-authored JSON cannot mint trusted eligibility:
/// ```compile_fail
/// let _: score_core::source_identity::SourcePracticeEligibility =
///     serde_json::from_str("{}").unwrap();
/// ```
///
/// Callers cannot construct eligibility, even with fields from an existing result:
/// ```compile_fail
/// use score_core::source_identity::SourcePracticeEligibility;
/// fn forge(original: SourcePracticeEligibility) -> SourcePracticeEligibility {
///     SourcePracticeEligibility { complete_attack_count: 0, ..original }
/// }
/// ```
///
/// Callers cannot erase exclusions on a valid result:
/// ```compile_fail
/// fn erase(result: &mut score_core::source_identity::SourcePracticeEligibility) {
///     result.known_unsupported_source_attack_ids.clear();
/// }
/// ```
#[derive(Debug)]
pub struct SourcePracticeEligibility {
    revision: u32,
    analysis_policy_id: &'static str,
    identity_table_revision: &'static str,
    product_policy_id: &'static str,
    eligibility_policy_id: &'static str,
    source_profile: &'static str,
    source_binding: practice_source::PracticeSourceBinding,
    complete_attack_count: usize,
    known_unsupported_source_attack_ids: Vec<String>,
    parts: Vec<PartPracticeEligibility>,
}
impl SourcePracticeEligibility {
    pub fn revision(&self) -> u32 {
        self.revision
    }
    pub fn analysis_policy_id(&self) -> &'static str {
        self.analysis_policy_id
    }
    pub fn identity_table_revision(&self) -> &'static str {
        self.identity_table_revision
    }
    pub fn product_policy_id(&self) -> &'static str {
        self.product_policy_id
    }
    pub fn eligibility_policy_id(&self) -> &'static str {
        self.eligibility_policy_id
    }
    pub fn source_profile(&self) -> &'static str {
        self.source_profile
    }
    /// Binding of the validated original complete wire, not a note projection
    /// or a verification of the declared original MIDI bytes.
    pub fn source_binding(&self) -> &practice_source::PracticeSourceBinding {
        &self.source_binding
    }
    pub fn complete_attack_count(&self) -> usize {
        self.complete_attack_count
    }
    /// Original generated note IDs in the shared analysis's source-time order.
    /// These IDs have meaning only together with this result's source binding.
    pub fn known_unsupported_source_attack_ids(&self) -> &[String] {
        &self.known_unsupported_source_attack_ids
    }
    pub fn parts(&self) -> &[PartPracticeEligibility] {
        &self.parts
    }
}

/// Complete per-part counts. Only `known_unsupported_count` excludes attacks;
/// a mixed part's aggregate informational classification is never consulted.
#[derive(Debug)]
pub struct PartPracticeEligibility {
    part_id: String,
    attack_count: usize,
    supported_count: usize,
    known_unsupported_count: usize,
    unresolved_count: usize,
}
impl PartPracticeEligibility {
    pub fn part_id(&self) -> &str {
        &self.part_id
    }
    pub fn attack_count(&self) -> usize {
        self.attack_count
    }
    pub fn supported_count(&self) -> usize {
        self.supported_count
    }
    pub fn known_unsupported_count(&self) -> usize {
        self.known_unsupported_count
    }
    pub fn unresolved_count(&self) -> usize {
        self.unresolved_count
    }
}

pub(super) struct Builder(SourcePracticeEligibility);
impl Builder {
    pub(super) fn new(
        source_binding: practice_source::PracticeSourceBinding,
        parts: &[basic_keys::Part],
    ) -> Self {
        Self(SourcePracticeEligibility {
            revision: 1,
            analysis_policy_id: ANALYSIS_POLICY_ID,
            identity_table_revision: IDENTITY_TABLE_REVISION,
            product_policy_id: PRODUCT_POLICY_ID,
            eligibility_policy_id: PRACTICE_ELIGIBILITY_POLICY_ID,
            source_profile: basic_keys::PROFILE,
            source_binding,
            complete_attack_count: 0,
            known_unsupported_source_attack_ids: vec![],
            parts: parts
                .iter()
                .map(|part| PartPracticeEligibility {
                    part_id: part.id.clone(),
                    attack_count: 0,
                    supported_count: 0,
                    known_unsupported_count: 0,
                    unresolved_count: 0,
                })
                .collect(),
        })
    }
    pub(super) fn record(
        &mut self,
        note: &basic_keys::KeyNote,
        part_index: usize,
        classification: Classification,
    ) {
        let part = &mut self.0.parts[part_index];
        self.0.complete_attack_count += 1;
        part.attack_count += 1;
        match classification {
            Classification::Supported => part.supported_count += 1,
            Classification::KnownUnsupported => {
                part.known_unsupported_count += 1;
                self.0
                    .known_unsupported_source_attack_ids
                    .push(note.note_id.clone());
            }
            Classification::Unresolved => part.unresolved_count += 1,
        }
    }
    pub(super) fn finish(
        self,
        expected_attacks: usize,
    ) -> Result<SourcePracticeEligibility, IdentityError> {
        if self.0.complete_attack_count != expected_attacks {
            return Err(error(
                "invalid_basic_source",
                "Eligibility must classify every source attack exactly once",
            ));
        }
        Ok(self.0)
    }
}
