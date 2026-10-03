use super::*;
use crate::vsq::{VsqNote, VsqTrack};
fn bound(v: u8) -> Result<(), String> {
    if v <= 127 {
        Ok(())
    } else {
        Err("Engine field exceeds 7bits".into())
    }
}
fn resonance(p: EngineVoiceParameter) -> bool {
    !matches!(
        p,
        EngineVoiceParameter::Breathiness
            | EngineVoiceParameter::Brightness
            | EngineVoiceParameter::Clearness
            | EngineVoiceParameter::PortamentoTiming
            | EngineVoiceParameter::Opening
            | EngineVoiceParameter::GenderFactor
    )
}
fn location(t: &VsqTrack, i: usize) -> EngineNoteLocation {
    let n = &t.notes[i];
    let before = i > 0 && t.notes[i - 1].tick + t.notes[i - 1].length_ticks == n.tick;
    let after = t
        .notes
        .get(i + 1)
        .is_some_and(|next| n.tick + n.length_ticks == next.tick);
    match (before, after) {
        (true, true) => EngineNoteLocation::ConnectedBeforeAndAfter,
        (false, true) => EngineNoteLocation::ConnectedAfter,
        (true, false) => EngineNoteLocation::ConnectedBefore,
        (false, false) => EngineNoteLocation::Isolated,
    }
}
fn validate_note(n: &EngineNote, a: &VsqNote, loc: EngineNoteLocation) -> Result<usize, String> {
    if n.authored_note_id != a.id
        || n.note_number != a.note_number
        || n.velocity != a.dynamics
        || n.duration_ms > 16383
        || n.location != loc
        || i32::from(n.portamento_flags) != a.expression.portamento_use
        || i32::from(n.decay) != a.expression.decay_gain_rate
        || i32::from(n.accent) != a.expression.accent
        || n.vibrato.is_some() != a.vibrato.is_some()
    {
        return Err("Engine note disagrees with authored note".into());
    }
    if n.portamento_flags > 3 || n.decay > 100 || n.accent > 100 {
        return Err("Engine note expression outside range".into());
    }
    let i = &n.intonation;
    for v in [
        i.v1_mean_parameter,
        i.d1_mean_parameter,
        i.d1_mean_first_note_parameter,
        i.d2_mean_parameter,
        i.d4_mean_parameter,
        i.p_mean_onset_first_note_parameter,
        i.v_mean_note_transition_parameter,
        i.p_mean_ending_note_parameter,
    ] {
        bound(v)?;
    }
    if let Some(v) = &n.vibrato {
        if v.database_index > 16383 {
            return Err("Vibrato database index exceeds14bits".into());
        }
        bound(v.type_index)?;
        bound(v.duration_parameter)?;
        bound(v.delay_parameter)?;
    }
    if a.lyrics.len() != 1 {
        return Err("VOCALOID2 requires one lyric record".into());
    }
    let l = &a.lyrics[0];
    let tokens: Vec<_> = l.phonetic.split(' ').collect();
    if tokens.iter().any(|t| t.is_empty()) || tokens.len() + 2 != l.numeric_fields.len() {
        return Err("Unsupported phonetic token/adjustment structure".into());
    }
    let mut expected = Vec::new();
    for (token, adj) in tokens
        .into_iter()
        .zip(&l.numeric_fields[1..l.numeric_fields.len() - 1])
    {
        if adj.scale != 0 || !(0..=127).contains(&adj.coefficient) {
            return Err("Consonant adjustment outside0..127 integer".into());
        }
        for (index, b) in token.bytes().enumerate() {
            if !b.is_ascii_graphic() {
                return Err("Phonetic token must be printable ASCII".into());
            }
            expected.push(EnginePhoneticSymbol {
                symbol: char::from(b).to_string(),
                consonant_adjustment: if index == 0 {
                    Some(adj.coefficient as u8)
                } else {
                    None
                },
            });
        }
    }
    if n.phonetic_symbols != expected
        || n.phonetic_symbols.is_empty()
        || n.phonetic_symbols.len() > 60
    {
        return Err("Engine phonetics disagree with authored record".into());
    }
    Ok(38
        + usize::from(n.vibrato.is_some()) * 8
        + n.phonetic_symbols
            .iter()
            .map(|p| 2 + usize::from(p.consonant_adjustment.is_some()))
            .sum::<usize>())
}
pub(super) fn validate(d: &EngineDispatch, a: &VsqProject) -> Result<(), String> {
    a.validate()?;
    if d.profile != ENGINE_PROFILE
        || d.source_sha256 != a.source_sha256
        || d.interpretation_limits != ENGINE_LIMITS
        || d.tracks.len() != a.tracks.len()
        || d.source_controller_events > 1_000_000
        || d.command_count() > 250_000
    {
        return Err("Engine profile/identity/coverage bounds invalid".into());
    }
    let mut count = 0;
    for (t, at) in d.tracks.iter().zip(&a.tracks) {
        if t.source_track_index != at.source_track_index {
            return Err("Engine track association invalid".into());
        }
        let (mut ni, mut bi, mut pi) = (0, 0, 0);
        for c in &t.commands {
            if c.tick > at.end_tick
                || c.source_order_first > c.source_order_last
                || c.source_order_last > 1_000_000
            {
                return Err("Engine source coordinates invalid".into());
            }
            let transport = if let Some(s) = &c.explicit_transport {
                if s.identity.is_none() && s.delay_ms.is_none() {
                    return Err("Empty explicit transport must be absent".into());
                }
                if let Some(id) = &s.identity {
                    bound(id.version)?;
                    bound(id.device)?;
                }
                if s.delay_ms.is_some_and(|v| v > 16383) {
                    return Err("Engine delay exceeds14bits".into());
                }
                usize::from(s.identity.is_some()) * 3 + usize::from(s.delay_ms.is_some()) * 3
            } else {
                0
            };
            let needed = match &c.command {
                EngineCommandKind::Note { note } => {
                    let n = at.notes.get(ni).ok_or("Extra engine note")?;
                    let count = validate_note(note, n, location(at, ni))?;
                    ni += 1;
                    count
                }
                EngineCommandKind::VoiceBank { bank } => {
                    bound(*bank)?;
                    let s = at.singers.get(bi).ok_or("Extra voice bank")?;
                    bi += 1;
                    if i32::from(*bank) != s.voice.language {
                        return Err("Voice bank disagrees with language descriptor".into());
                    }
                    3
                }
                EngineCommandKind::VoiceProgram { program } => {
                    bound(*program)?;
                    let s = at.singers.get(pi).ok_or("Extra voice program")?;
                    pi += 1;
                    if i32::from(*program) != s.voice.program {
                        return Err("Voice program disagrees with descriptor".into());
                    }
                    3
                }
                EngineCommandKind::PitchBend { value } => {
                    if !(-8192..=8191).contains(value) {
                        return Err("Pitch bend outside range".into());
                    }
                    4
                }
                EngineCommandKind::Dynamics { value }
                | EngineCommandKind::VibratoRate { value }
                | EngineCommandKind::VibratoDepth { value } => {
                    bound(*value)?;
                    3
                }
                EngineCommandKind::VoiceParameter { parameter, value } => {
                    if *value != 255 || !resonance(*parameter) {
                        bound(*value)?;
                    }
                    5
                }
                EngineCommandKind::PitchBendSensitivity { semitones } => {
                    bound(*semitones)?;
                    4
                }
            } + transport;
            if c.source_order_last - c.source_order_first + 1 != needed as u32 {
                return Err(
                    "Engine command source span does not account for all controller records".into(),
                );
            }
            count += needed;
        }
        if ni != at.notes.len() || bi != at.singers.len() || pi != at.singers.len() {
            return Err("Engine commands do not cover every note/singer".into());
        }
        if t.commands
            .windows(2)
            .any(|w| w[0].tick > w[1].tick || w[0].source_order_last + 1 != w[1].source_order_first)
        {
            return Err("Engine command ordering not contiguous".into());
        }
    }
    if count != d.source_controller_events {
        return Err("Engine controller accounting incomplete".into());
    }
    let originals: usize = a.tracks.iter().map(|t| t.controller_events.len()).sum();
    if originals != 0 && originals != count {
        return Err("Engine source count differs from source".into());
    }
    if originals != 0 && super::normalize::parse_dispatch(a)? != *d {
        return Err("Named engine values or source coordinates disagree with the available controller source".into());
    }
    Ok(())
}
