//! Small metadata index and exact-ID access to immutable bundled editions.
use crate::{catalog_scores, Provenance, Score};
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Clone, Debug, Serialize)]
pub struct CatalogItem {
    pub id: String,
    pub title: String,
    pub composer: String,
    pub provenance: Provenance,
    pub written_event_count: usize,
    pub pitched_note_count: usize,
    pub rest_count: usize,
    pub opening_bpm: f64,
    pub part_count: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct CatalogIndex {
    pub version: u32,
    pub items: Vec<CatalogItem>,
}

/// Metadata excludes canonical note arrays and retained source archives.
pub fn catalog_index() -> &'static CatalogIndex {
    static INDEX: OnceLock<CatalogIndex> = OnceLock::new();
    INDEX.get_or_init(|| CatalogIndex {
        version: 1,
        items: catalog_scores()
            .iter()
            .map(|score| {
                let written_event_count = score.parts.iter().map(|p| p.notes.len()).sum();
                let pitched_note_count = score
                    .parts
                    .iter()
                    .flat_map(|p| &p.notes)
                    .filter(|n| n.pitch.is_some())
                    .count();
                CatalogItem {
                    id: score.id.clone(),
                    title: score.title.clone(),
                    composer: score.composer.clone(),
                    provenance: score.provenance.clone(),
                    written_event_count,
                    pitched_note_count,
                    rest_count: written_event_count - pitched_note_count,
                    opening_bpm: score.tempo.first().map_or(120.0, |t| t.bpm),
                    part_count: score.parts.len(),
                }
            })
            .collect(),
    })
}

/// Only fixed catalog identifiers are looked up; no paths, files or URLs are read.
pub fn catalog_score(id: &str) -> Option<Score> {
    catalog_scores()
        .iter()
        .find(|score| score.id == id)
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata_counts_written_events_without_transferring_sources() {
        let index = catalog_index();
        let item = index
            .items
            .iter()
            .find(|item| item.id == "cc0-schubert-wandrers-nachtlied-d768")
            .unwrap();
        assert_eq!(
            (
                item.written_event_count,
                item.pitched_note_count,
                item.rest_count,
                item.part_count
            ),
            (334, 324, 10, 2)
        );
        assert_eq!(item.opening_bpm, 38.5);
        assert_eq!(item.provenance.license.as_deref(), Some("CC0-1.0"));
        let bytes = serde_json::to_vec(index).unwrap();
        assert!(bytes.len() < 20 * 1024);
        let text = String::from_utf8(bytes).unwrap();
        for key in ["\"notes\":", "\"source\":", "\"content\":"] {
            assert!(!text.contains(key));
        }
    }
    #[test]
    fn exact_lookup_preserves_every_score_byte_and_does_not_mutate_cached_originals() {
        for expected in crate::catalog() {
            let mut selected = catalog_score(&expected.id).unwrap();
            assert_eq!(
                serde_json::to_value(&selected).unwrap(),
                serde_json::to_value(&expected).unwrap()
            );
            selected.title = "User's private copy".into();
            assert_eq!(catalog_score(&expected.id).unwrap().title, expected.title);
        }
        assert!(catalog_score("missing-edition").is_none());
        assert!(catalog_score("FIRST-STEPS").is_none());
    }
}
