use super::*;
use std::collections::BTreeSet;
fn text(s: &str, max: usize) -> Result<(), String> {
    if s.len() > max || s.contains('\0') {
        Err("VSQ semantic string exceeds bounds or contains NUL".into())
    } else {
        Ok(())
    }
}
fn sha(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn id(s: &str, p: &str) -> bool {
    s.strip_prefix(p).is_some_and(|v| {
        v.len() <= 8 && !v.is_empty() && v.len() % 4 == 0 && v.bytes().all(|b| b.is_ascii_digit())
    })
}
fn icon(s: &str) -> bool {
    s.strip_prefix('$')
        .is_some_and(|v| v.len() == 8 && v.bytes().all(|b| b.is_ascii_hexdigit()))
}
fn decimal(v: &VsqDecimal) -> bool {
    v.scale <= 12 && v.coefficient.unsigned_abs() < 1_000_000_000_000_000_000
}
fn envelope(e: &VsqEnvelope) -> Result<(), String> {
    if e.points.len() > 100_000 {
        return Err("VSQ envelope count exceeds bounds".into());
    }
    let mut prev = (0_i128, 1_i128);
    for p in &e.points {
        if !decimal(&p.position) {
            return Err("Invalid VSQ exact decimal".into());
        }
        let n = i128::from(p.position.coefficient);
        let d = 10_i128.pow(u32::from(p.position.scale));
        if n < 0 || n > d || n * prev.1 < prev.0 * d {
            return Err("Envelope positions must be ordered within zero and one".into());
        }
        prev = (n, d);
    }
    Ok(())
}
pub(super) fn validate(p: &VsqProject) -> Result<(), String> {
    if p.profile != VSQ_PROFILE
        || !sha(&p.source_sha256)
        || p.ppq == 0
        || p.ppq > 32767
        || p.master_end_tick > MAX_TICK
        || p.tracks.is_empty()
        || p.tracks.len() > 127
        || p.mixer.tracks.len() != p.tracks.len()
    {
        return Err("VSQ profile, source identity, timing or track bounds invalid".into());
    }
    text(&p.master_track_name, 16_384)?;
    if p.tempo.is_empty()
        || p.tempo.len() > MAX_EVENTS
        || p.tempo[0].tick != 0
        || p.meters.is_empty()
        || p.meters.len() > MAX_EVENTS
        || p.meters[0].tick != 0
    {
        return Err("VSQ bounded tempo and meter maps must start at zero".into());
    }
    if p.tempo.iter().any(|t| {
        t.tick > MAX_TICK
            || t.microseconds_per_quarter == 0
            || t.microseconds_per_quarter > 0xff_ffff
    }) || p
        .tempo
        .windows(2)
        .any(|w| w[0].tick >= w[1].tick || w[0].event_order >= w[1].event_order)
    {
        return Err("VSQ tempo values or order invalid".into());
    }
    if p.meters
        .iter()
        .any(|m| m.tick > MAX_TICK || m.numerator == 0 || m.denominator_power > 10)
        || p.meters
            .windows(2)
            .any(|w| w[0].tick >= w[1].tick || w[0].event_order >= w[1].event_order)
    {
        return Err("VSQ meter values or order invalid".into());
    }
    if p.premeasure_ticks != premeasure_ticks(p.premeasure_bars, p.ppq, &p.meters)? {
        return Err("VSQ PreMeasure disagrees with meter map".into());
    }
    if p.interpretation_limits != required_limits() {
        return Err("VSQ interpretation limits cannot be omitted or replaced".into());
    }
    let (mut note_count, mut controller_count) = (0, 0);
    for (i, t) in p.tracks.iter().enumerate() {
        if usize::from(t.source_track_index) != i + 1
            || t.common.version != "DSB301"
            || !sha(&t.project_text_sha256)
            || t.end_tick > MAX_TICK
            || t.eos_tick > MAX_TICK
            || t.singers
                .first()
                .is_none_or(|s| s.tick != 0 || s.event_order != 0)
        {
            return Err("Invalid VSQ track identity, origin or initial singer".into());
        }
        text(&t.smf_track_name, 16_384)?;
        text(&t.common.name, 256)?;
        note_count += t.notes.len();
        controller_count += t.controller_events.len();
        if note_count > 100_000
            || controller_count > MAX_EVENTS
            || t.singers.len() > 100_000
            || t.curves.len() > 21
        {
            return Err("VSQ semantic count exceeds bounds".into());
        }
        let mut ids = BTreeSet::new();
        let mut handles = BTreeSet::new();
        let mut order = Vec::new();
        for s in &t.singers {
            if !id(&s.id, "ID#")
                || !id(&s.handle_id, "h#")
                || !ids.insert(&s.id)
                || !handles.insert(&s.handle_id)
                || !icon(&s.voice.icon_id)
                || s.tick > t.eos_tick
                || s.voice.length > MAX_TICK
            {
                return Err("Invalid VSQ singer identity, reference or clock".into());
            }
            text(&s.voice.ids, 16_384)?;
            text(&s.voice.caption, 16_384)?;
            order.push((s.event_order, s.tick));
        }
        if t.singers
            .windows(2)
            .any(|w| w[0].tick >= w[1].tick || w[0].event_order >= w[1].event_order)
        {
            return Err("Ambiguous or unordered VSQ singers".into());
        }
        for n in &t.notes {
            if !id(&n.id, "ID#")
                || !id(&n.lyric_handle_id, "h#")
                || !ids.insert(&n.id)
                || !handles.insert(&n.lyric_handle_id)
                || n.tick < p.premeasure_ticks
                || n.tick > MAX_TICK
                || n.length_ticks == 0
                || n.length_ticks > MAX_TICK
                || n.tick + n.length_ticks > t.eos_tick
                || n.note_number > 127
                || n.dynamics > 127
            {
                return Err("Invalid VSQ note identity, reference, time or pitch".into());
            }
            let si = t.singers.partition_point(|s| s.tick <= n.tick) - 1;
            if t.singers[si].id != n.singer_event_id
                || (si > 0 && t.singers[si].tick == n.tick)
                || t.singers
                    .get(si + 1)
                    .is_some_and(|s| s.tick < n.tick + n.length_ticks)
            {
                return Err("Incorrect or ambiguous VSQ singer assignment".into());
            }
            if n.lyrics.is_empty() || n.lyrics.len() > 1000 {
                return Err("Invalid VSQ lyric count".into());
            }
            for (li, l) in n.lyrics.iter().enumerate() {
                if l.index != li as u32
                    || !(3..=4).contains(&l.numeric_fields.len())
                    || l.numeric_fields.iter().any(|v| !decimal(v))
                {
                    return Err("Invalid VSQ lyric numeric structure".into());
                }
                text(&l.lyric, 16_384)?;
                text(&l.phonetic, 16_384)?;
            }
            if let Some(v) = &n.vibrato {
                if !id(&v.handle_id, "h#")
                    || !handles.insert(&v.handle_id)
                    || !icon(&v.icon_id)
                    || v.delay_ticks > n.length_ticks
                    || v.length_ticks > MAX_TICK
                {
                    return Err("Invalid VSQ vibrato reference or length".into());
                }
                text(&v.ids, 16_384)?;
                text(&v.caption, 16_384)?;
                envelope(&v.depth)?;
                envelope(&v.rate)?;
            }
            order.push((n.event_order, n.tick));
        }
        if t.notes
            .windows(2)
            .any(|w| w[0].tick > w[1].tick || w[0].event_order >= w[1].event_order)
        {
            return Err("Invalid VSQ note ordering".into());
        }
        order.sort_unstable();
        if order.iter().enumerate().any(|(i, e)| e.0 as usize != i)
            || order.windows(2).any(|w| w[0].1 > w[1].1)
        {
            return Err("Invalid authored VSQ event order".into());
        }
        let mut parameters = Vec::new();
        let mut point_count = 0;
        for c in &t.curves {
            if parameters.contains(&c.parameter) {
                return Err("Duplicate VSQ curve parameter".into());
            }
            parameters.push(c.parameter);
            point_count += c.points.len();
            if point_count > MAX_EVENTS
                || c.points.iter().any(|p| p.tick > MAX_TICK)
                || c.points.windows(2).any(|w| w[0].tick >= w[1].tick)
            {
                return Err("Invalid VSQ curve clock or count".into());
            }
        }
        let mut nrpn = (None, None);
        for e in &t.controller_events {
            if e.tick > t.end_tick {
                return Err("VSQ controller after track end".into());
            }
            let high = e.controller == VsqController::DataEntryMsb
                && e.value == 255
                && nrpn == (Some(85), Some(3));
            if e.value > 127 && !high {
                return Err("Invalid high-bit VSQ controller value".into());
            }
            match e.controller {
                VsqController::NrpnMsb => nrpn.0 = Some(e.value),
                VsqController::NrpnLsb => nrpn.1 = Some(e.value),
                _ if nrpn.0.is_none() || nrpn.1.is_none() => {
                    return Err("Data entry before NRPN selection".into())
                }
                _ => {}
            }
        }
        if t.controller_events
            .windows(2)
            .any(|w| w[0].tick > w[1].tick || w[0].event_order >= w[1].event_order)
        {
            return Err("Invalid VSQ controller order".into());
        }
    }
    Ok(())
}
