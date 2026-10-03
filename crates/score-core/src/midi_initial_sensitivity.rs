//! Closed initialization grammars, shared by source and clean-JSON validation.
use crate::Beat;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InitialPitchBendSensitivity12Step {
    SelectMostSignificantZero,
    SelectLeastSignificantZero,
    SetSemitones12,
    SetCentsZero,
}
impl InitialPitchBendSensitivity12Step {
    pub(crate) fn from_controller(controller: u8, value: u8) -> Result<Self, String> {
        match (controller, value) {
            (101, 0) => Ok(Self::SelectMostSignificantZero),
            (100, 0) => Ok(Self::SelectLeastSignificantZero),
            (6, 12) => Ok(Self::SetSemitones12),
            (38, 0) => Ok(Self::SetCentsZero),
            _ => Err("Unreviewed initial RPN 0 sensitivity12 selector or value".into()),
        }
    }
    pub(crate) fn controller(self) -> (u8, u8) {
        match self {
            Self::SelectMostSignificantZero => (101, 0),
            Self::SelectLeastSignificantZero => (100, 0),
            Self::SetSemitones12 => (6, 12),
            Self::SetCentsZero => (38, 0),
        }
    }
}
const ORDERS: [&[(u8, u8)]; 4] = [
    &[(101, 0), (100, 0), (6, 24), (38, 0), (101, 127), (100, 127)],
    &[(100, 0), (101, 0), (6, 12), (38, 0)],
    &[
        (100, 0),
        (101, 0),
        (100, 0),
        (101, 0),
        (6, 12),
        (6, 12),
        (38, 0),
        (38, 0),
    ],
    &[
        (101, 0),
        (100, 0),
        (101, 0),
        (100, 0),
        (6, 12),
        (6, 12),
        (38, 0),
        (38, 0),
    ],
];
#[derive(Clone, Copy)]
pub(crate) enum Prefix {
    Program,
    Control,
    Reset,
    Other,
}
#[derive(Clone, Copy)]
pub(crate) struct State {
    tracks: u128,
    start: u32,
    steps: usize,
    candidates: u8,
    previous: Option<Beat>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            tracks: 0,
            start: 0,
            steps: 0,
            candidates: 15,
            previous: None,
        }
    }
}
impl State {
    pub(crate) fn twelve() -> Self {
        Self {
            candidates: 14,
            ..Self::default()
        }
    }
    pub(crate) fn used(&self) -> bool {
        self.steps > 0
    }
    pub(crate) fn semitones(&self) -> Option<u8> {
        ORDERS.iter().enumerate().find_map(|(index, sequence)| {
            (self.candidates & (1 << index) != 0 && self.steps == sequence.len())
                .then_some(if index == 0 { 24 } else { 12 })
        })
    }
    pub(crate) fn finish(&self) -> Result<(), String> {
        if self.used() && self.semitones().is_none() {
            Err("MIDI controller 101 initial pitch-bend sensitivity requires one complete reviewed selector/value group".into())
        } else {
            Ok(())
        }
    }
    pub(crate) fn observe(
        &mut self,
        track: u16,
        index: u32,
        at: Beat,
        step: Option<(u8, u8)>,
        prefix: Prefix,
    ) -> Result<bool, String> {
        if track >= 128 || !at.valid() || at.numerator < 0 {
            return Err("Invalid initial sensitivity coordinate or time".into());
        }
        self.tracks |= 1_u128 << track;
        if self.used() && self.tracks.count_ones() != 1 {
            return Err(
                "MIDI initial pitch-bend sensitivity requires one owning source track".into(),
            );
        }
        if self.used() && matches!(prefix, Prefix::Reset) {
            return Err("Initial pitch-bend sensitivity cannot be mixed with controller reset on the same channel".into());
        }
        if let Some(step) = step {
            if self.tracks.count_ones() != 1
                || self
                    .previous
                    .is_some_and(|previous| previous.compare(at).is_gt())
                || (self.used() && self.start.checked_add(self.steps as u32) != Some(index))
            {
                return Err("Initial sensitivity requires contiguous source coordinates and monotone source time".into());
            }
            for (candidate, sequence) in ORDERS.iter().enumerate() {
                if sequence.get(self.steps) != Some(&step)
                    || (candidate == 0 && !at.equivalent(Beat::ZERO))
                {
                    self.candidates &= !(1 << candidate);
                }
            }
            if self.candidates == 0 {
                return Err(format!("MIDI controller {} requires a reviewed contiguous initial RPN 0 sensitivity sequence before key activity", step.0));
            }
            if !self.used() {
                self.start = index;
            }
            self.steps += 1;
        } else {
            self.finish()?;
            if !self.used() {
                match prefix {
                    Prefix::Program => (),
                    Prefix::Control => self.candidates &= !1,
                    Prefix::Reset | Prefix::Other => self.candidates = 0,
                }
            }
        }
        self.previous = Some(at);
        Ok(step.is_some())
    }
}
