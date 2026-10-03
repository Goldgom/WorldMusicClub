use super::*;
use crate::vsq::{VsqController, VsqControllerEvent};
use std::collections::VecDeque;
struct Field {
    parameter: u8,
    msb: u8,
    lsb: Option<u8>,
}
struct Fields {
    fields: VecDeque<Field>,
}
impl Fields {
    fn has(&self, k: u8) -> bool {
        self.fields.front().is_some_and(|f| f.parameter == k)
    }
    fn field(&mut self, k: u8) -> Result<Field, String> {
        let f = self
            .fields
            .pop_front()
            .ok_or("VSQ engine missing required field")?;
        if f.parameter != k {
            return Err(format!(
                "VSQ unsupported field order: expected {k:02x}, found {:02x}",
                f.parameter
            ));
        }
        Ok(f)
    }
    fn one(&mut self, k: u8) -> Result<u8, String> {
        let f = self.field(k)?;
        if f.lsb.is_some() {
            return Err("VSQ unexpected second component".into());
        }
        Ok(f.msb)
    }
    fn pair(&mut self, k: u8) -> Result<(u8, u8), String> {
        let f = self.field(k)?;
        Ok((f.msb, f.lsb.ok_or("VSQ missing paired component")?))
    }
    fn number(&mut self, k: u8) -> Result<u16, String> {
        let (a, b) = self.pair(k)?;
        if a > 127 || b > 127 {
            return Err("VSQ numeric pair exceeds 14bits".into());
        }
        Ok(u16::from(a) * 128 + u16::from(b))
    }
    fn done(self) -> Result<(), String> {
        if self.fields.is_empty() {
            Ok(())
        } else {
            Err("VSQ engine unconsumed or unknown fields".into())
        }
    }
}
fn fields(group: &[VsqControllerEvent]) -> Result<Fields, String> {
    let mut fields = VecDeque::new();
    let mut at = 1;
    while at < group.len() {
        let select = &group[at];
        if select.controller != VsqController::NrpnLsb {
            return Err("VSQ engine requires parameter selector".into());
        }
        at += 1;
        let first = group.get(at).ok_or("VSQ group ends with selector")?;
        if first.controller != VsqController::DataEntryMsb {
            return Err("VSQ parameter needs main value".into());
        }
        at += 1;
        let lsb = if group
            .get(at)
            .is_some_and(|e| e.controller == VsqController::DataEntryLsb)
        {
            let v = group[at].value;
            at += 1;
            Some(v)
        } else {
            None
        };
        fields.push_back(Field {
            parameter: select.value,
            msb: first.value,
            lsb,
        });
    }
    Ok(Fields { fields })
}
fn voice(v: u8) -> Result<EngineVoiceParameter, String> {
    use EngineVoiceParameter::*;
    Ok(match v {
        0x31 => Breathiness,
        0x32 => Brightness,
        0x33 => Clearness,
        0x34 => PortamentoTiming,
        0x35 => Opening,
        0x70 => GenderFactor,
        0x40 => Resonance1Frequency,
        0x41 => Resonance2Frequency,
        0x42 => Resonance3Frequency,
        0x43 => Resonance4Frequency,
        0x50 => Resonance1Bandwidth,
        0x51 => Resonance2Bandwidth,
        0x52 => Resonance3Bandwidth,
        0x53 => Resonance4Bandwidth,
        0x60 => Resonance1Amplitude,
        0x61 => Resonance2Amplitude,
        0x62 => Resonance3Amplitude,
        0x63 => Resonance4Amplitude,
        _ => return Err(format!("Unknown VOCALOID2 voice parameter {v:02x}")),
    })
}
fn note(f: &mut Fields, id: String) -> Result<EngineNote, String> {
    let note_number = f.one(2)?;
    let velocity = f.one(3)?;
    let duration_ms = f.number(4)?;
    let location = match f.one(5)? {
        0 => EngineNoteLocation::ConnectedBeforeAndAfter,
        1 => EngineNoteLocation::ConnectedAfter,
        2 => EngineNoteLocation::ConnectedBefore,
        3 => EngineNoteLocation::Isolated,
        _ => return Err("Unsupported engine note location".into()),
    };
    let vibrato = if f.has(0x0c) {
        let database_index = f.number(0x0c)?;
        let (type_index, duration_parameter) = f.pair(0x0d)?;
        let delay_parameter = f.one(0x0e)?;
        Some(EngineVibrato {
            database_index,
            type_index,
            duration_parameter,
            delay_parameter,
        })
    } else {
        None
    };
    let count = f.one(0x12)?;
    if count == 0 || count > 60 {
        return Err("Unsupported engine phonetic count".into());
    }
    let mut phonetic_symbols = Vec::new();
    for i in 0..count {
        let field = f.field(0x13 + i)?;
        if !field.msb.is_ascii_graphic() {
            return Err("Engine phonetic symbol must be printable ASCII".into());
        }
        phonetic_symbols.push(EnginePhoneticSymbol {
            symbol: char::from(field.msb).to_string(),
            consonant_adjustment: field.lsb,
        });
    }
    if f.one(0x4f)? != 127 {
        return Err("Continued phonetic packets not implemented".into());
    }
    let intonation = EngineIntonation {
        v1_mean_parameter: f.one(0x50)?,
        d1_mean_parameter: f.one(0x51)?,
        d1_mean_first_note_parameter: f.one(0x52)?,
        d2_mean_parameter: f.one(0x53)?,
        d4_mean_parameter: f.one(0x54)?,
        p_mean_onset_first_note_parameter: f.one(0x55)?,
        v_mean_note_transition_parameter: f.one(0x56)?,
        p_mean_ending_note_parameter: f.one(0x57)?,
    };
    let portamento_flags = f.one(0x58)?;
    let decay = f.one(0x59)?;
    let accent = f.one(0x5a)?;
    if f.one(0x7f)? != 127 {
        return Err("Continued note packets not implemented".into());
    }
    Ok(EngineNote {
        authored_note_id: id,
        note_number,
        velocity,
        duration_ms,
        location,
        vibrato,
        phonetic_symbols,
        intonation,
        portamento_flags,
        decay,
        accent,
    })
}
pub fn normalize_engine_dispatch(project: &VsqProject) -> Result<EngineDispatch, String> {
    let dispatch = parse_dispatch(project)?;
    dispatch.validate(project)?;
    Ok(dispatch)
}

pub(super) fn parse_dispatch(project: &VsqProject) -> Result<EngineDispatch, String> {
    project.validate()?;
    let mut tracks = Vec::new();
    let mut source_controller_events = 0;
    for t in &project.tracks {
        let mut commands = Vec::new();
        let mut start = 0;
        let mut ni = 0;
        while start < t.controller_events.len() {
            let first = &t.controller_events[start];
            if first.controller != VsqController::NrpnMsb {
                return Err("Engine command must start with group selector".into());
            }
            let end = t.controller_events[start + 1..]
                .iter()
                .position(|e| e.controller == VsqController::NrpnMsb)
                .map_or(t.controller_events.len(), |i| start + 1 + i);
            let group = &t.controller_events[start..end];
            if group.iter().any(|e| e.tick != first.tick)
                || group
                    .windows(2)
                    .any(|w| w[1].event_order != w[0].event_order + 1)
            {
                return Err("Engine group interrupted or spans ticks".into());
            }
            let mut f = fields(group)?;
            let identity = if f.has(0) {
                let (version, device) = f.pair(0)?;
                Some(EngineIdentity { version, device })
            } else {
                None
            };
            let delay_ms = if f.has(1) { Some(f.number(1)?) } else { None };
            let explicit_transport = if identity.is_some() || delay_ms.is_some() {
                Some(EngineTransport { identity, delay_ms })
            } else {
                None
            };
            let command = match first.value {
                0x50 => {
                    let n = t.notes.get(ni).ok_or("Extra engine note command")?;
                    ni += 1;
                    EngineCommandKind::Note {
                        note: note(&mut f, n.id.clone())?,
                    }
                }
                0x53 => EngineCommandKind::VoiceProgram { program: f.one(2)? },
                0x54 => EngineCommandKind::PitchBend {
                    value: (i32::from(f.number(2)?) - 8192) as i16,
                },
                0x55 => {
                    let parameter = voice(f.one(2)?)?;
                    let value = f.one(3)?;
                    EngineCommandKind::VoiceParameter { parameter, value }
                }
                0x60 => EngineCommandKind::VoiceBank { bank: f.one(2)? },
                0x63 => EngineCommandKind::Dynamics { value: f.one(2)? },
                0x64 => EngineCommandKind::VibratoRate { value: f.one(2)? },
                0x65 => EngineCommandKind::VibratoDepth { value: f.one(2)? },
                0x67 => {
                    let (semitones, fixed) = f.pair(2)?;
                    if fixed != 0 {
                        return Err("PBS second component must be zero".into());
                    }
                    EngineCommandKind::PitchBendSensitivity { semitones }
                }
                _ => return Err(format!("Unknown engine group {:02x}", first.value)),
            };
            f.done()?;
            commands.push(EngineCommand {
                tick: first.tick,
                source_order_first: first.event_order,
                source_order_last: group.last().unwrap().event_order,
                explicit_transport,
                command,
            });
            start = end;
        }
        if ni != t.notes.len() {
            return Err("Missing engine note commands".into());
        }
        source_controller_events += t.controller_events.len();
        tracks.push(EngineTrack {
            source_track_index: t.source_track_index,
            commands,
        });
    }
    let dispatch = EngineDispatch {
        profile: ENGINE_PROFILE.into(),
        source_sha256: project.source_sha256.clone(),
        source_controller_events,
        tracks,
        interpretation_limits: ENGINE_LIMITS.to_vec(),
    };
    Ok(dispatch)
}
