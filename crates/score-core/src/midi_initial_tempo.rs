//! Narrow initial-tempo projection shared by import and authoritative JSON load.
//! See docs/MIDI_INITIAL_TEMPO.md. This never removes performance commands.
use crate::clean_song::Coordinate;

#[derive(Default)]
pub(crate) struct InitialTempo {
    first: Option<(Coordinate, u32)>,
    last: Option<Coordinate>,
    varied: bool,
    cross_track: bool,
}

impl InitialTempo {
    /// Call only for tick-zero declarations, in original track/event order.
    /// Unequal values need a single owning track, including every earlier value.
    pub(crate) fn observe(&mut self, origin: Coordinate, value: u32) -> Result<(), String> {
        if self.last.is_some_and(|last| last >= origin) {
            return Err("Initial MIDI tempos must retain original source order".into());
        }
        if let Some((first, first_value)) = self.first {
            self.cross_track |= first.track != origin.track;
            self.varied |= first_value != value;
            if self.cross_track && self.varied {
                return Err("Differing initial MIDI tempos across source tracks are unsupported by this profile; cross-track tempo order is not inferred".into());
            }
        } else {
            self.first = Some((origin, value));
        }
        self.last = Some(origin);
        Ok(())
    }

    pub(crate) fn projects_changes(&self) -> bool {
        self.varied
    }
}
