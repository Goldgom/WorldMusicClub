use super::*;
// Wholly authored fixture: no user score content or voicebank assets.
fn text() -> String {
    concat!(
"[Common]\nVersion=DSB301\nName=Original test voice\nColor=12,34,56\nDynamicsMode=1\nPlayMode=1\n",
"[Master]\nPreMeasure=1\n[Mixer]\nMasterFeder=-10\nMasterPanpot=0\nMasterMute=0\nOutputMode=0\nTracks=1\nFeder0=5\nPanpot0=-8\nMute0=0\nSolo0=1\n",
"[EventList]\n0=ID#0000\n1920=ID#0001\n3000=ID#0002\n3360=ID#0003\n4000=EOS\n",
"[ID#0000]\nType=Singer\nIconHandle=h#0000\n",
"[ID#0001]\nType=Anote\nLength=801\nNote#=60\nDynamics=73\nPMBendDepth=8\nPMBendLength=10\nPMbPortamentoUse=3\nDEMdecGainRate=24\nDEMaccent=88\nLyricHandle=h#0001\nVibratoHandle=h#0002\nVibratoDelay=266\n",
"[ID#0002]\nType=Singer\nIconHandle=h#0003\n",
"[ID#0003]\nType=Anote\nLength=240\nNote#=64\nDynamics=66\nPMBendDepth=2\nPMBendLength=0\nPMbPortamentoUse=0\nDEMdecGainRate=20\nDEMaccent=50\nLyricHandle=h#0004\n",
"[h#0000]\nIconID=$07010000\nIDS=Original A\nOriginal=0\nCaption=Test descriptor\nLength=1\nLanguage=0\nProgram=0\n",
"[h#0001]\nL0=\"あ\",\"a\",0.000000,64,0,0\n",
"[h#0002]\nIconID=$04040001\nIDS=original\nOriginal=1\nCaption=Authored test envelope\nLength=534\nStartDepth=40\nDepthBPNum=3\nDepthBPX=0.250000,0.250000,1.000000\nDepthBPY=10,20,0\nStartRate=60\nRateBPNum=0\n",
"[h#0003]\nIconID=$07010001\nIDS=Original B\nOriginal=1\nCaption=Second descriptor\nLength=1\nLanguage=0\nProgram=1\n",
"[h#0004]\nL0=\"la,\"\"test\"\"\",\"l a\",1.000000,0,0\n",
"[PitchBendBPList]\n1920=0\n2040=-1234\n2200=8120\n[PitchBendSensBPList]\n0=2\n2100=12\n[DynamicsBPList]\n0=70\n2100=99\n[Reso1FreqBPList]\n1920=255\n").into()
}
fn vlq(mut n: u32) -> Vec<u8> {
    let mut b = vec![(n & 127) as u8];
    n >>= 7;
    while n != 0 {
        b.push((n & 127) as u8 | 128);
        n >>= 7;
    }
    b.reverse();
    b
}
fn meta(delta: u32, kind: u8, data: &[u8]) -> Vec<u8> {
    let mut b = vlq(delta);
    b.extend_from_slice(&[255, kind]);
    b.extend(vlq(data.len() as u32));
    b.extend_from_slice(data);
    b
}
fn fixture_with(text: &str, controls: &[u8], first_chunk: u32) -> Vec<u8> {
    let mut master = meta(0, 3, b"Original master");
    master.extend(meta(0, 0x51, &[7, 0xa1, 0x20]));
    master.extend(meta(0, 0x58, &[4, 2, 24, 8]));
    master.extend(meta(2160, 0x51, &[15, 0x42, 0x40]));
    master.extend(meta(1840, 0x2f, &[]));
    let (encoded, _, errors) = encoding_rs::SHIFT_JIS.encode(text);
    assert!(!errors);
    let split = encoded
        .windows(2)
        .position(|p| p == [0x82, 0xa0])
        .map(|p| p + 1)
        .unwrap_or(encoded.len() / 2);
    let mut track = meta(0, 3, b"Original voice");
    for (i, bytes) in [&encoded[..split], &encoded[split..]]
        .into_iter()
        .enumerate()
    {
        let mut dm = format!("DM:{:04}:", i as u32 + first_chunk).into_bytes();
        dm.extend_from_slice(bytes);
        track.extend(meta(0, 1, &dm));
    }
    track.extend_from_slice(controls);
    track.extend(meta(4000, 0x2f, &[]));
    let mut b = b"MThd\0\0\0\x06\0\x01\0\x02\x01\xe0".to_vec();
    for t in [master, track] {
        b.extend_from_slice(b"MTrk");
        b.extend_from_slice(&(t.len() as u32).to_be_bytes());
        b.extend(t);
    }
    b
}
fn fixture(text: &str) -> Vec<u8> {
    fixture_with(text, &[0, 0xb0, 99, 85, 0, 98, 3, 0, 6, 255, 0, 38, 1], 0)
}
#[test]
fn decoded_fields_cp932_split_and_independent_tick_lengths() {
    let b = fixture(&text());
    let p = decode_vsq(&b).unwrap();
    let t = &p.tracks[0];
    assert_eq!(p.premeasure_ticks, 1920);
    assert_eq!(t.notes.len(), 2);
    assert_eq!(t.notes[0].lyrics[0].lyric, "あ");
    assert_eq!(t.notes[1].lyrics[0].lyric, "la,\"test\"");
    assert_eq!(t.notes[0].dynamics, 73);
    assert_eq!(t.notes[0].expression.portamento_use, 3);
    assert_eq!(t.notes[1].singer_event_id, "ID#0002");
    let v = t.notes[0].vibrato.as_ref().unwrap();
    assert_eq!(v.length_ticks, 534);
    assert_eq!(801 - v.delay_ticks, 535);
    assert_eq!(v.depth.points[0].position, v.depth.points[1].position);
    assert_eq!(t.curves[0].points[1].value, -1234);
    assert_eq!(t.controller_events[2].value, 255);
    let s = p.canonical_score("Original fixture").unwrap();
    crate::validate(&s).unwrap();
    assert!(s.source.is_none());
    assert!(s.keys.is_empty());
    assert!(crate::import_midi(&b).is_err());
    let json = serde_json::to_string(&p).unwrap();
    assert!(!json.contains("[Common]"));
    assert_eq!(serde_json::from_str::<VsqProject>(&json).unwrap(), p);
}
#[test]
fn exact_tempo_integrates_inside_note() {
    let p = decode_vsq(&fixture(&text())).unwrap();
    assert_eq!(p.microseconds_at(1920).unwrap(), (2000000, 1));
    assert_eq!(p.microseconds_at(2400).unwrap(), (2750000, 1));
    assert_eq!(p.microseconds_at(2721).unwrap(), (3418750, 1));
}
#[test]
fn high_byte_permission_requires_proven_profile_pair_and_controller() {
    for controls in [
        &[0, 0xb0, 99, 85, 0, 98, 2, 0, 6, 255][..],
        &[0, 0xb0, 99, 85, 0, 98, 3, 0, 38, 255],
        &[0, 0xb0, 99, 85, 0, 98, 3, 0, 6, 254],
        &[0, 0xb0, 6, 255],
    ] {
        assert!(decode_vsq(&fixture_with(&text(), controls, 0)).is_err());
    }
    assert!(decode_vsq(&fixture(&text().replace("DSB301", "unknown"))).is_err());
}
#[test]
fn unknown_fields_missing_references_and_duplicate_structure_hold() {
    let s = text();
    for bad in [
        s.replace("DEMaccent=88", "DEMaccent=88\nUnknownExpression=1"),
        s.replace("Length=801", "Length=0"),
        s.replace("LyricHandle=h#0001", "LyricHandle=h#9999"),
        s.replace("[PitchBendBPList]", "[NewPitchBPList]"),
        s.replace("Name=Original test voice", "Name=A\nName=B"),
        s.replace("3360=ID#0003", "3360=ID#0001"),
        s.replace("RateBPNum=0", "RateBPNum=1"),
        s.replace("DepthBPNum=3", "DepthBPNum=2"),
    ] {
        assert!(decode_vsq(&fixture(&bad)).is_err());
    }
    assert!(decode_vsq(&fixture_with(&s, &[], 1)).is_err());
    let mut b = fixture(&s);
    b.pop();
    assert!(decode_vsq(&b).is_err());
}
#[test]
fn empty_curve_is_distinct_from_absent() {
    let s = text();
    let p = decode_vsq(&fixture(&format!("{s}[OpeningBPList]\n"))).unwrap();
    assert_eq!(
        p.tracks[0].curves.last().unwrap().parameter,
        VsqCurveParameter::Opening
    );
    assert!(p.tracks[0].curves.last().unwrap().points.is_empty());
    assert_eq!(decode_vsq(&fixture(&s)).unwrap().tracks[0].curves.len(), 4);
}
#[test]
fn complete_cp932_single_and_double_byte_digest() {
    let mut h = Sha256::new();
    let mut valid = 0;
    let mut observe = |b: &[u8]| match container::decode_cp932(b) {
        Ok(s) => {
            valid += 1;
            h.update([s.len() as u8]);
            h.update(s.as_bytes());
        }
        Err(_) => h.update([255]),
    };
    for a in 0..=255 {
        observe(&[a]);
    }
    for a in 0..=255 {
        for b in 0..=255 {
            observe(&[a, b]);
        }
    }
    assert_eq!(valid, 48216);
    assert_eq!(
        format!("{:x}", h.finalize()),
        "734e7acb37fed929401b56c7d95b951f0c706ce10be2e12e7c556f82b9e11b0b"
    );
}
#[test]
fn strict_cp932_specials_and_invalid_pairs() {
    assert_eq!(
        container::decode_cp932(&[0x80, 0xa0, 0xfd, 0xfe, 0xff]).unwrap(),
        "\u{80}\u{f8f0}\u{f8f1}\u{f8f2}\u{f8f3}"
    );
    assert_eq!(
        container::decode_cp932(&[0x82, 0xa0, 0x81, 0x60]).unwrap(),
        "あ～"
    );
    for b in [&[0x82][..], &[0x82, 0x20], &[0x81, 0x7f], &[0x81, 0xad]] {
        assert!(container::decode_cp932(b).is_err());
    }
}
#[test]
fn premeasure_uses_actual_meter_and_holds_inside_bar_changes() {
    let m = |tick, numerator| VsqMeter {
        tick,
        event_order: 0,
        numerator,
        denominator_power: 2,
        clocks_per_click: 24,
        thirty_seconds_per_quarter: 8,
    };
    assert_eq!(
        premeasure_ticks(2, 120, &[m(0, 3), m(360, 5)]).unwrap(),
        960
    );
    assert!(premeasure_ticks(2, 120, &[m(0, 3), m(100, 5)]).is_err());
}
#[test]
fn revalidation_holds_forged_time_voice_limits_and_singer_boundaries() {
    let original = decode_vsq(&fixture(&text())).unwrap();
    let mut p = original.clone();
    p.meters[0].denominator_power = 63;
    assert!(p.canonical_score("invalid").is_err());
    assert!(p.microseconds_at(10).is_err());
    let mut p = original.clone();
    p.tracks[0].notes[0].singer_event_id = "ID#0002".into();
    assert!(p.validate().is_err());
    let mut p = original;
    p.interpretation_limits.clear();
    assert!(p.validate().is_err());
    let s = text();
    for bad in [
        s.replace("3000=ID#0002", "2720=ID#0002"),
        s.replace("3360=ID#0003", "3000=ID#0003"),
        s.replace("4000=EOS", "3500=EOS"),
    ] {
        assert!(decode_vsq(&fixture(&bad)).is_err());
    }
}
