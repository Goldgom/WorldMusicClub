//! Original synthetic VSQ fixture: C/E, three vocal parts (one muted, one
//! note-free), descriptor-only singers, exact decimals; no private source data.
#![allow(dead_code)]
pub fn vlq(mut value: u32) -> Vec<u8> {
    let mut bytes = vec![(value & 127) as u8];
    value >>= 7;
    while value != 0 {
        bytes.push((value & 127) as u8 | 128);
        value >>= 7;
    }
    bytes.reverse();
    bytes
}
pub fn meta(delta: u32, kind: u8, data: &[u8]) -> Vec<u8> {
    let mut bytes = vlq(delta);
    bytes.extend([255, kind]);
    bytes.extend(vlq(data.len() as u32));
    bytes.extend(data);
    bytes
}
pub fn smf(tracks: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = b"MThd\0\0\0\x06\0\x01".to_vec();
    bytes.extend((tracks.len() as u16).to_be_bytes());
    bytes.extend([1, 224]);
    for track in tracks {
        bytes.extend(b"MTrk");
        bytes.extend((track.len() as u32).to_be_bytes());
        bytes.extend(track);
    }
    bytes
}
fn command(track: &mut Vec<u8>, group: u8, fields: &[(u8, u8, Option<u8>)]) {
    track.extend([0, 0xb0, 99, group]);
    for &(field, value, tail) in fields {
        track.extend([0, 98, field, 0, 6, value]);
        if let Some(value) = tail {
            track.extend([0, 38, value]);
        }
    }
}
pub fn source() -> Vec<u8> {
    smf(&tracks("DSB301", 0))
}
pub fn tracks(version: &str, extra_commands: usize) -> Vec<Vec<u8>> {
    let mut conductor = meta(0, 3, b"Original conductor");
    conductor.extend(meta(0, 81, &[7, 161, 33]));
    conductor.extend(meta(0, 88, &[4, 2, 24, 8]));
    conductor.extend(meta(4000, 47, &[]));
    let mut tracks = vec![conductor];
    for (index, key) in [Some(60), Some(64), None].into_iter().enumerate() {
        let mut text = format!("[Common]\nVersion={version}\nName=Original vocal {}\nColor=1,2,3\nDynamicsMode=1\nPlayMode=1\n", index + 1);
        if index == 0 {
            text.push_str("[Master]\nPreMeasure=1\n[Mixer]\nMasterFeder=-3\nMasterPanpot=2\nMasterMute=0\nOutputMode=0\nTracks=3\nFeder0=4\nPanpot0=-9\nMute0=0\nSolo0=1\nFeder1=0\nPanpot1=0\nMute1=1\nSolo1=0\nFeder2=0\nPanpot2=0\nMute2=0\nSolo2=0\n");
        }
        text.push_str("[EventList]\n0=ID#0000\n");
        if key.is_some() {
            text.push_str("1920=ID#0001\n");
        }
        text.push_str("4000=EOS\n[ID#0000]\nType=Singer\nIconHandle=h#0000\n[h#0000]\nIconID=$07010000\nIDS=Original voice\nOriginal=0\nCaption=Descriptor only\nLength=1\nLanguage=0\nProgram=7\n");
        if let Some(key) = key {
            text.push_str(&format!("[ID#0001]\nType=Anote\nLength=801\nNote#={key}\nDynamics=79\nPMBendDepth=8\nPMBendLength=10\nPMbPortamentoUse=2\nDEMdecGainRate=41\nDEMaccent=61\nLyricHandle=h#0001\nVibratoHandle=h#0002\nVibratoDelay=266\n[h#0001]\nL0=\"Original a\",\"a\",9007199254740993,31,0\n[h#0002]\nIconID=$04040001\nIDS=Original vibrato\nOriginal=1\nCaption=Exact envelopes\nLength=534\nStartDepth=40\nDepthBPNum=1\nDepthBPX=0.250000\nDepthBPY=20\nStartRate=60\nRateBPNum=1\nRateBPX=1.000000\nRateBPY=0\n"));
        }
        text.push_str("[PitchBendBPList]\n1920=-234\n[PitchBendSensBPList]\n0=12\n[Reso1FreqBPList]\n1920=255\n");
        let mut text = text.into_bytes();
        if let Some(start) = text.windows(10).position(|w| w == b"Original a") {
            text.splice(start..start + 10, [0x82, 0xa0]); // CP932 original lyric あ
        }
        let mut track = meta(0, 3, format!("Container {}", index + 1).as_bytes());
        // Split the Common marker, version, and CP932 character across DM packets.
        let mut cuts = vec![4, 18];
        if let Some(start) = text.windows(2).position(|w| w == [0x82, 0xa0]) {
            cuts.push(start + 1);
        }
        cuts.push(text.len());
        let mut previous = 0;
        for (chunk, cut) in cuts.into_iter().enumerate() {
            let mut data = format!("DM:{chunk:04}:").into_bytes();
            data.extend(&text[previous..cut]);
            previous = cut;
            track.extend(meta(0, 1, &data));
        }
        command(&mut track, 0x60, &[(2, 0, None)]);
        command(&mut track, 0x53, &[(2, 7, None)]);
        command(&mut track, 0x55, &[(2, 0x40, None), (3, 255, None)]);
        if index == 0 {
            for _ in 0..extra_commands {
                command(&mut track, 0x63, &[(2, 79, None)]);
            }
        }
        if let Some(key) = key {
            command(
                &mut track,
                0x50,
                &[
                    (2, key, None),
                    (3, 79, None),
                    (4, 11, Some(11)),
                    (5, 3, None),
                    (0x0c, 0, Some(0)),
                    (0x0d, 2, Some(85)),
                    (0x0e, 43, None),
                    (0x12, 1, None),
                    (0x13, b'a', Some(31)),
                    (0x4f, 127, None),
                    (0x50, 8, None),
                    (0x51, 20, None),
                    (0x52, 20, None),
                    (0x53, 40, None),
                    (0x54, 24, None),
                    (0x55, 10, None),
                    (0x56, 12, None),
                    (0x57, 12, None),
                    (0x58, 2, None),
                    (0x59, 41, None),
                    (0x5a, 61, None),
                    (0x7f, 127, None),
                ],
            );
        }
        track.extend(meta(4000, 47, &[]));
        tracks.push(track);
    }
    tracks
}
