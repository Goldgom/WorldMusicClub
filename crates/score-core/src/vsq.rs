//! Bounded DSB301 VSQ decoding, independent from the generic MIDI validator.
//! This source was reconstructed after workspace replacement and requires all
//! public tests and private-source comparisons to run again before acceptance.
mod container;
mod project_text;
#[cfg(test)]
mod tests;
mod validation;
use crate::{Beat, Measure, Meter, Note, Part, Pitch, Provenance, Score, Tempo};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
pub const VSQ_PROFILE: &str = "wmh-vsq-dsb301-v1";
pub(super) const MAX_SOURCE_BYTES: usize = 5 * 1024 * 1024;
pub(super) const MAX_EVENTS: usize = 1_000_000;
pub(super) const MAX_TICK: u64 = 1_000_000_000;
macro_rules! record {($name:ident{$($field:ident:$ty:ty),*$(,)?})=>{#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]#[serde(deny_unknown_fields)]pub struct $name{$(pub $field:$ty),*}};}
record!(VsqProject{profile:String,source_sha256:String,ppq:u16,master_track_name:String,master_end_tick:u64,tempo:Vec<VsqTempo>,meters:Vec<VsqMeter>,premeasure_bars:u32,premeasure_ticks:u64,mixer:VsqMixer,tracks:Vec<VsqTrack>,interpretation_limits:Vec<VsqInterpretationLimit>});
record!(VsqTempo {
    tick: u64,
    event_order: u32,
    microseconds_per_quarter: u32
});
record!(VsqMeter {
    tick: u64,
    event_order: u32,
    numerator: u8,
    denominator_power: u8,
    clocks_per_click: u8,
    thirty_seconds_per_quarter: u8
});
record!(VsqMixer{master_fader:i32,master_panpot:i32,master_mute:bool,output_mode:i32,tracks:Vec<VsqMixerTrack>});
record!(VsqMixerTrack {
    fader: i32,
    panpot: i32,
    mute: bool,
    solo: bool
});
record!(VsqCommon {
    version: String,
    name: String,
    color_components: [u8; 3],
    dynamics_mode: i32,
    play_mode: i32
});
record!(VsqTrack{source_track_index:u16,smf_track_name:String,project_text_sha256:String,common:VsqCommon,end_tick:u64,eos_tick:u64,singers:Vec<VsqSinger>,notes:Vec<VsqNote>,curves:Vec<VsqCurve>,controller_events:Vec<VsqControllerEvent>});
record!(VsqSinger {
    id: String,
    event_order: u32,
    tick: u64,
    handle_id: String,
    voice: VsqVoice
});
record!(VsqVoice {
    icon_id: String,
    ids: String,
    original: i32,
    caption: String,
    length: u64,
    language: i32,
    program: i32
});
record!(VsqNote{id:String,event_order:u32,tick:u64,length_ticks:u64,note_number:u8,dynamics:u8,singer_event_id:String,expression:VsqNoteExpression,lyric_handle_id:String,lyrics:Vec<VsqLyric>,vibrato:Option<VsqVibrato>});
record!(VsqNoteExpression {
    bend_depth: i32,
    bend_length: i32,
    portamento_use: i32,
    decay_gain_rate: i32,
    accent: i32
});
record!(VsqLyric{index:u32,lyric:String,phonetic:String,numeric_fields:Vec<VsqDecimal>});
record!(VsqDecimal {
    coefficient: i64,
    scale: u8
});
record!(VsqVibrato {
    handle_id: String,
    delay_ticks: u64,
    icon_id: String,
    ids: String,
    original: i32,
    caption: String,
    length_ticks: u64,
    depth: VsqEnvelope,
    rate: VsqEnvelope
});
record!(VsqEnvelope{start:i32,points:Vec<VsqEnvelopePoint>});
record!(VsqEnvelopePoint {
    position: VsqDecimal,
    value: i32
});
record!(VsqCurve{parameter:VsqCurveParameter,points:Vec<VsqCurvePoint>});
record!(VsqCurvePoint {
    tick: u64,
    value: i32
});
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum VsqCurveParameter {
    PitchBend,
    PitchBendSensitivity,
    Dynamics,
    Breathiness,
    Brightness,
    Clearness,
    Resonance1Frequency,
    Resonance2Frequency,
    Resonance3Frequency,
    Resonance4Frequency,
    Resonance1Bandwidth,
    Resonance2Bandwidth,
    Resonance3Bandwidth,
    Resonance4Bandwidth,
    Resonance1Amplitude,
    Resonance2Amplitude,
    Resonance3Amplitude,
    Resonance4Amplitude,
    GenderFactor,
    PortamentoTiming,
    Opening,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum VsqController {
    NrpnMsb,
    NrpnLsb,
    DataEntryMsb,
    DataEntryLsb,
}
record!(VsqControllerEvent {
    tick: u64,
    event_order: u32,
    controller: VsqController,
    value: u8
});
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum VsqInterpretationLimit {
    VoicebankIdentityAndAvailabilityUnverified,
    PhoneticNumericFieldMeaningsUnverified,
    VocalExpressionAndPitchInterpolationNotRendered,
    NrpnDispatchAndPresendNotEvaluated,
    Resonance255MeaningUnverified,
    CommonModeAndMixerOutputModeNotInterpreted,
    SingerHandleMetadataNotAcousticIdentity,
    EosDoesNotEstablishAcousticTailOrAccompaniment,
}
pub(super) fn required_limits() -> Vec<VsqInterpretationLimit> {
    use VsqInterpretationLimit::*;
    vec![
        VoicebankIdentityAndAvailabilityUnverified,
        PhoneticNumericFieldMeaningsUnverified,
        VocalExpressionAndPitchInterpolationNotRendered,
        NrpnDispatchAndPresendNotEvaluated,
        Resonance255MeaningUnverified,
        CommonModeAndMixerOutputModeNotInterpreted,
        SingerHandleMetadataNotAcousticIdentity,
        EosDoesNotEstablishAcousticTailOrAccompaniment,
    ]
}
pub fn decode_vsq(bytes: &[u8]) -> Result<VsqProject, String> {
    let file = container::decode(bytes)?;
    let mut tracks = Vec::new();
    let mut master = None;
    let mut mixer = None;
    for track in file.tracks {
        let d = project_text::decode(track)?;
        if let Some(p) = d.premeasure {
            if master.replace(p).is_some() {
                return Err("Multiple VSQ Master sections".into());
            }
        }
        if let Some(m) = d.mixer {
            if mixer.replace(m).is_some() {
                return Err("Multiple VSQ Mixer sections".into());
            }
        }
        tracks.push(d.track);
    }
    let premeasure_bars = master.ok_or("Missing VSQ PreMeasure")?;
    let mixer = mixer.ok_or("Missing VSQ Mixer")?;
    if mixer.tracks.len() != tracks.len() {
        return Err("VSQ mixer track count disagrees".into());
    }
    let premeasure_ticks = premeasure_ticks(premeasure_bars, file.ppq, &file.meters)?;
    let p = VsqProject {
        profile: VSQ_PROFILE.into(),
        source_sha256: format!("{:x}", Sha256::digest(bytes)),
        ppq: file.ppq,
        master_track_name: file.master_name,
        master_end_tick: file.master_end,
        tempo: file.tempo,
        meters: file.meters,
        premeasure_bars,
        premeasure_ticks,
        mixer,
        tracks,
        interpretation_limits: required_limits(),
    };
    p.validate()?;
    Ok(p)
}
fn premeasure_ticks(bars: u32, ppq: u16, meters: &[VsqMeter]) -> Result<u64, String> {
    if bars > 1024 || ppq == 0 || meters.first().is_none_or(|m| m.tick != 0) {
        return Err("Invalid premeasure origin".into());
    }
    let mut tick = 0_u64;
    let mut index = 0;
    for _ in 0..bars {
        while index + 1 < meters.len() && meters[index + 1].tick <= tick {
            index += 1;
        }
        let m = &meters[index];
        if m.denominator_power > 10 || m.numerator == 0 {
            return Err("Invalid premeasure meter".into());
        }
        let num = u64::from(ppq) * 4 * u64::from(m.numerator);
        let den = 1_u64 << m.denominator_power;
        if num % den != 0 {
            return Err("Fractional premeasure tick length unsupported".into());
        }
        let end = tick.checked_add(num / den).ok_or("PreMeasure overflow")?;
        if meters.get(index + 1).is_some_and(|n| n.tick < end) {
            return Err("Meter change inside premeasure bar is unverified".into());
        }
        tick = end;
    }
    if tick > MAX_TICK {
        return Err("PreMeasure exceeds time bounds".into());
    }
    Ok(tick)
}
pub(super) fn beat(tick: u64, ppq: u16) -> Result<Beat, String> {
    if ppq == 0 {
        return Err("VSQ PPQ zero".into());
    }
    let g = crate::gcd(u128::from(tick), u128::from(ppq)) as u64;
    let b = Beat::new(
        i64::try_from(tick / g).map_err(|_| "VSQ tick overflow")?,
        i64::from(ppq) / g as i64,
    );
    b.valid()
        .then_some(b)
        .ok_or_else(|| "VSQ time outside canonical rational bounds".into())
}
impl VsqProject {
    pub fn validate(&self) -> Result<(), String> {
        validation::validate(self)
    }
    pub fn microseconds_at(&self, tick: u64) -> Result<(u128, u64), String> {
        self.validate()?;
        let mut n = 0_u128;
        for (i, t) in self.tempo.iter().enumerate() {
            if t.tick >= tick {
                break;
            }
            let end = self.tempo.get(i + 1).map_or(tick, |x| x.tick.min(tick));
            n += u128::from(end - t.tick) * u128::from(t.microseconds_per_quarter);
        }
        let g = crate::gcd(n, u128::from(self.ppq));
        Ok((n / g, u64::from(self.ppq) / g as u64))
    }
    pub fn canonical_score(&self, title: &str) -> Result<Score, String> {
        self.validate()?;
        let mut parts = Vec::new();
        for t in &self.tracks {
            let mut notes = Vec::new();
            for n in &t.notes {
                let (step, alter) = match n.note_number % 12 {
                    0 => ("C", 0),
                    1 => ("C", 1),
                    2 => ("D", 0),
                    3 => ("D", 1),
                    4 => ("E", 0),
                    5 => ("F", 0),
                    6 => ("F", 1),
                    7 => ("G", 0),
                    8 => ("G", 1),
                    9 => ("A", 0),
                    10 => ("A", 1),
                    _ => ("B", 0),
                };
                notes.push(Note {
                    id: format!("vsq-t{}-{}", t.source_track_index, n.id),
                    at: beat(n.tick, self.ppq)?,
                    duration: beat(n.length_ticks, self.ppq)?,
                    pitch: Some(Pitch {
                        step: step.into(),
                        alter,
                        octave: (n.note_number / 12) as i8 - 1,
                    }),
                    voice: n.singer_event_id.clone(),
                    staff: 1,
                    velocity: n.dynamics,
                    tie_start: false,
                    tie_stop: false,
                });
            }
            parts.push(Part {
                id: format!("vsq-track-{}", t.source_track_index),
                name: t.common.name.clone(),
                instrument: "voice".into(),
                notes,
            });
        }
        let max = self
            .tracks
            .iter()
            .flat_map(|t| &t.notes)
            .map(|n| n.tick + n.length_ticks)
            .max()
            .unwrap_or(0);
        let mut measures = Vec::new();
        let mut at = 0;
        let mut mi = 0;
        while at < max {
            if measures.len() >= 100_000 {
                return Err("VSQ measure limit exceeded".into());
            }
            while mi + 1 < self.meters.len() && self.meters[mi + 1].tick <= at {
                mi += 1;
            }
            let m = &self.meters[mi];
            let num = u64::from(self.ppq) * 4 * u64::from(m.numerator);
            let den = 1_u64 << m.denominator_power;
            if num % den != 0 {
                return Err("Fractional VSQ measure ticks unsupported".into());
            }
            let mut length = num / den;
            if let Some(next) = self.meters.get(mi + 1) {
                length = length.min(next.tick - at);
            }
            if length == 0 {
                return Err("Invalid VSQ measure length".into());
            }
            measures.push(Measure {
                number: measures.len() as u32 + 1,
                at: beat(at, self.ppq)?,
                length: beat(length, self.ppq)?,
            });
            at += length;
        }
        Ok(Score{format_metadata:Some(crate::FormatMetadata::current()),version:1,id:format!("vsq-{}",self.source_sha256),title:title.into(),composer:String::new(),provenance:Provenance{kind:"user-import".into(),attribution:"VSQ authored notes; derived base-pitch audition only; vocal synthesis and voicebank equivalence are unverified".into(),source_url:None,license:None},parts,tempo:self.tempo.iter().map(|t|Ok(Tempo{at:beat(t.tick,self.ppq)?,bpm:60_000_000.0/f64::from(t.microseconds_per_quarter)})).collect::<Result<_,String>>()?,meters:self.meters.iter().map(|m|Ok(Meter{at:beat(m.tick,self.ppq)?,numerator:u16::from(m.numerator),denominator:1_u16<<m.denominator_power})).collect::<Result<_,String>>()?,keys:vec![],measures,repeats:vec![],source:None})
    }
}
