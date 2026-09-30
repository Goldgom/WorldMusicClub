//! Small, local-only printed-staff image review aid, **not** general optical music recognition.
//!
//! Detects one horizontal five-line staff and solid elliptical notehead candidates. It does not
//! recognize clefs, key signatures, accidentals, rests, rhythm, ties, beams, voices, or repeats.
//! Coordinates and tentative natural pitches are evidence for a human editor, never a `Score`.
//! Even a high shape score is not calibrated probability or permission to play a candidate.
use crate::Pitch;
use image::{ImageFormat, ImageReader, Limits};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

pub const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_IMAGE_PIXELS: u64 = 16_000_000;
const MAX_DIMENSION: u32 = 16_384;
const MAX_DECODER_ALLOCATION: u64 = 192 * 1024 * 1024;
const MAX_CANDIDATES: usize = 512;
const MAX_COMPONENTS: usize = 20_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ImageBounds {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StaffGeometry {
    pub id: String,
    /// Top to bottom, in source-image pixels.
    pub lines_y: [f64; 5],
    pub spacing: f64,
    pub bounds: ImageBounds,
    /// Uncalibrated geometric quality, not a probability of musical correctness.
    pub confidence: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OmrCandidate {
    pub id: String,
    pub staff_id: String,
    pub center_x: f64,
    pub center_y: f64,
    pub bounds: ImageBounds,
    /// Diatonic steps above the bottom line (assumed E4 in treble clef).
    pub staff_step: i32,
    /// Natural pitch under unverified treble-clef and C-major assumptions.
    pub tentative_pitch: Pitch,
    /// Uncalibrated notehead-shape quality only.
    pub confidence: f64,
    /// Always "unknown". Do not infer quarter-note timing from a filled notehead.
    pub duration: String,
    /// Always "unknown". A natural tentative pitch is not accidental recognition.
    pub accidental: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OmrReview {
    pub version: u32,
    pub width: u32,
    pub height: u32,
    pub format: String,
    /// "review_required" or "unsupported"; never "complete" or "playable".
    pub status: String,
    pub requires_review: bool,
    pub assumptions: Vec<String>,
    pub warnings: Vec<String>,
    pub staffs: Vec<StaffGeometry>,
    pub candidates: Vec<OmrCandidate>,
}

#[derive(Clone, Debug)]
struct LineBand {
    top: usize,
    bottom: usize,
    left: usize,
    right: usize,
}
impl LineBand {
    fn center(&self) -> f64 {
        (self.top + self.bottom) as f64 / 2.0
    }
}

struct StaffDetection {
    geometry: StaffGeometry,
    bands: [LineBand; 5],
}

/// Analyze PNG/JPEG bytes entirely in-process, returning only a mandatory-review proposal.
///
/// Input is limited to 8 MiB compressed, 16 million pixels, and 16,384 pixels on either axis.
/// Both the header pass and full decoder receive allocation/dimension limits. The image crate's
/// allocation ceiling is best-effort; independent dimensions/pixel limits are checked before the
/// full decode. No filesystem writes, network calls, external OMR service, or playable score.
pub fn analyze_image(bytes: &[u8]) -> Result<OmrReview, String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("Image must contain 1 byte to 8 MiB of PNG or JPEG data".into());
    }
    let format = image::guess_format(bytes)
        .map_err(|_| "Only PNG and JPEG images are supported".to_string())?;
    if !matches!(format, ImageFormat::Png | ImageFormat::Jpeg) {
        return Err("Only PNG and JPEG images are supported".into());
    }
    let reader = || {
        let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
        let mut limits = Limits::default();
        limits.max_image_width = Some(MAX_DIMENSION);
        limits.max_image_height = Some(MAX_DIMENSION);
        limits.max_alloc = Some(MAX_DECODER_ALLOCATION);
        reader.limits(limits);
        reader
    };
    let (width, height) = reader()
        .into_dimensions()
        .map_err(|e| format!("Cannot read image within decoder limits: {e}"))?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err("Image exceeds the 16-million-pixel limit or has empty dimensions".into());
    }
    let decoded = reader()
        .decode()
        .map_err(|e| format!("Cannot decode PNG/JPEG within image limits: {e}"))?;
    // Composite transparent pixels over white. Ignoring alpha would turn transparent black
    // pixels into false ink. Conversion also normalizes 16-bit input to bounded 8-bit channels.
    let rgba = decoded.into_rgba8();
    let grayscale: Vec<u8> = rgba
        .pixels()
        .map(|p| {
            let luma =
                (299 * u32::from(p[0]) + 587 * u32::from(p[1]) + 114 * u32::from(p[2])) / 1000;
            ((luma * u32::from(p[3]) + 255 * (255 - u32::from(p[3]))) / 255) as u8
        })
        .collect();
    drop(rgba);
    let mut review = OmrReview {
        version: 1,
        width,
        height,
        format: if format == ImageFormat::Png { "png" } else { "jpeg" }.into(),
        status: "review_required".into(),
        requires_review: true,
        assumptions: vec![
            "Treble clef is assumed, not recognized; the bottom staff line is treated as E4.".into(),
            "C major / natural pitches are assumed, not recognized; key signatures and accidentals need manual review.".into(),
        ],
        warnings: vec![
            "Experimental local image review: every candidate must be checked against the original image. Shape confidence is not musical accuracy.".into(),
            "Durations, rests, clefs, key signatures, accidentals, beams, ties, tuplets, voices, barlines, and repeats are not recognized. No playable score is produced.".into(),
            "Supports only a cropped, upright, high-contrast printed fragment with one horizontal five-line staff and separate filled noteheads. Handwriting, photographs, skew, multiple staves, chords, hollow noteheads, and complex notation are unsupported; symbols can be missed or mistaken for noteheads.".into(),
        ],
        staffs: Vec::new(),
        candidates: Vec::new(),
    };
    let min = grayscale.iter().copied().min().unwrap_or(255);
    let max = grayscale.iter().copied().max().unwrap_or(255);
    if max.saturating_sub(min) < 32 || width < 80 || height < 30 {
        review.status = "unsupported".into();
        review.warnings.push(
            "No usable high-contrast staff: crop or replace the image, or enter notes manually."
                .into(),
        );
        return Ok(review);
    }
    let threshold = otsu_threshold(&grayscale).min(200);
    let mut ink: Vec<u8> = grayscale
        .iter()
        .map(|&p| u8::from(p <= threshold))
        .collect();
    drop(grayscale);
    if ink.iter().map(|&p| usize::from(p)).sum::<usize>() > ink.len() / 2 {
        review.status = "unsupported".into();
        review.warnings.push("The image is too dark or uses a dark background; use dark notation on a light background.".into());
        return Ok(review);
    }
    let width = width as usize;
    let height = height as usize;
    let detections = detect_staffs(&ink, width, height);
    review.staffs = detections.iter().map(|s| s.geometry.clone()).collect();
    if detections.len() != 1 {
        review.status = "unsupported".into();
        review.warnings.push(if detections.is_empty() {
            "No unambiguous horizontal five-line staff was found. Crop to one staff, straighten the image, or annotate notes manually.".into()
        } else {
            "Multiple staves were detected. Crop the image to a single staff before recognition; no note candidates were inferred.".into()
        });
        return Ok(review);
    }
    let staff = &detections[0];
    remove_staff_lines(&mut ink, width, height, &staff.bands);
    let (candidates, interrupted) = detect_noteheads(&ink, width, height, &staff.geometry);
    review.candidates = candidates;
    if interrupted {
        review.candidates.clear();
        review.status = "unsupported".into();
        review.warnings.push("The image contains too many components for bounded local review; use a smaller, cleaner crop.".into());
    } else if review.candidates.is_empty() {
        review.warnings.push("Staff geometry was found, but no reliable filled-notehead candidates were found. Add note positions manually; no missing notes have been invented.".into());
    } else {
        review.warnings.push("Candidates are ordered left-to-right only. This is not rhythm, voice, chord, or reading-order recognition; check for missed and extra notes.".into());
    }
    Ok(review)
}

fn otsu_threshold(pixels: &[u8]) -> u8 {
    let mut histogram = [0_u64; 256];
    for &p in pixels {
        histogram[p as usize] += 1;
    }
    let total = pixels.len() as f64;
    let sum: f64 = histogram
        .iter()
        .enumerate()
        .map(|(i, &n)| i as f64 * n as f64)
        .sum();
    let mut weight_low = 0.0;
    let mut sum_low = 0.0;
    let mut best_variance = -1.0;
    let mut threshold = 127;
    for (i, &n) in histogram.iter().enumerate() {
        weight_low += n as f64;
        sum_low += i as f64 * n as f64;
        let weight_high = total - weight_low;
        if weight_low == 0.0 || weight_high == 0.0 {
            continue;
        }
        let difference = sum_low / weight_low - (sum - sum_low) / weight_high;
        let variance = weight_low * weight_high * difference * difference;
        if variance > best_variance {
            best_variance = variance;
            threshold = i as u8;
        }
    }
    threshold
}

fn longest_run(row: &[u8]) -> (usize, usize) {
    let mut best = (0, 0);
    let mut start = 0;
    for (x, &value) in row.iter().chain(std::iter::once(&0)).enumerate() {
        if value == 0 {
            if x - start > best.1 - best.0 {
                best = (start, x);
            }
            start = x + 1;
        }
    }
    best
}

fn detect_staffs(ink: &[u8], width: usize, height: usize) -> Vec<StaffDetection> {
    let minimum_ink = (width as f64 * 0.45).max(40.0) as usize;
    let minimum_run = (width as f64 * 0.35).max(32.0) as usize;
    let mut bands: Vec<LineBand> = Vec::new();
    for y in 0..height {
        let row = &ink[y * width..(y + 1) * width];
        if row.iter().map(|&p| usize::from(p)).sum::<usize>() < minimum_ink {
            continue;
        }
        let (left, right) = longest_run(row);
        if right - left < minimum_run {
            continue;
        }
        if let Some(band) = bands.last_mut().filter(|b| b.bottom + 1 == y) {
            band.bottom = y;
            band.left = band.left.max(left);
            band.right = band.right.min(right);
        } else {
            bands.push(LineBand {
                top: y,
                bottom: y,
                left,
                right,
            });
        }
    }
    let mut result = Vec::new();
    let mut index = 0;
    while index + 5 <= bands.len() {
        let lines: [LineBand; 5] = std::array::from_fn(|i| bands[index + i].clone());
        let centers = lines.each_ref().map(LineBand::center);
        let spacing = (centers[4] - centers[0]) / 4.0;
        let max_error = centers
            .windows(2)
            .map(|w| (w[1] - w[0] - spacing).abs())
            .fold(0.0, f64::max);
        let left = lines.iter().map(|l| l.left).max().unwrap_or(0);
        let right = lines.iter().map(|l| l.right).min().unwrap_or(0);
        let thin_lines = lines
            .iter()
            .all(|l| (l.bottom - l.top + 1) as f64 <= spacing * 0.30);
        let tolerance = (spacing * 0.12).max(1.0);
        // Six-line tablature and ruled grids must not be silently treated as a five-line staff.
        let extends_above =
            index > 0 && (centers[0] - bands[index - 1].center() - spacing).abs() <= tolerance;
        let extends_below = index + 5 < bands.len()
            && (bands[index + 5].center() - centers[4] - spacing).abs() <= tolerance;
        if (6.0..=80.0).contains(&spacing)
            && max_error <= tolerance
            && thin_lines
            && !extends_above
            && !extends_below
            && right.saturating_sub(left) >= minimum_run
        {
            result.push(StaffDetection {
                geometry: StaffGeometry {
                    id: format!("staff-{}", result.len() + 1),
                    lines_y: centers,
                    spacing,
                    bounds: ImageBounds {
                        x: left as u32,
                        y: lines[0].top as u32,
                        width: (right - left) as u32,
                        height: (lines[4].bottom - lines[0].top + 1) as u32,
                    },
                    confidence: (0.95 - max_error / spacing).clamp(0.0, 0.95),
                },
                bands: lines,
            });
            index += 5;
        } else {
            index += 1;
        }
    }
    result
}

fn remove_staff_lines(ink: &mut [u8], width: usize, height: usize, bands: &[LineBand; 5]) {
    for band in bands {
        for x in 0..width {
            // Retain cross-line ink supported on both sides (stems and solid noteheads).
            let crosses = band.top > 0
                && band.bottom + 1 < height
                && ink[(band.top - 1) * width + x] == 1
                && ink[(band.bottom + 1) * width + x] == 1;
            if !crosses {
                for y in band.top..=band.bottom {
                    ink[y * width + x] = 0;
                }
            }
        }
    }
}

fn detect_noteheads(
    ink: &[u8],
    width: usize,
    height: usize,
    staff: &StaffGeometry,
) -> (Vec<OmrCandidate>, bool) {
    let spacing = staff.spacing;
    let top = (staff.lines_y[0] - 2.0 * spacing).max(0.0) as usize;
    let bottom = ((staff.lines_y[4] + 2.0 * spacing).ceil() as usize + 1).min(height);
    let left = staff.bounds.x as usize;
    let right = (staff.bounds.x + staff.bounds.width) as usize;
    let min_run = (spacing * 0.45).ceil() as usize;
    let max_run = (spacing * 1.9).ceil() as usize;
    // A horizontal opening eliminates narrow stems before component extraction, so a connected
    // stem does not force the entire note to be rejected as an impossibly tall ellipse.
    let mut heads = vec![0_u8; (bottom - top) * width];
    for y in top..bottom {
        let mut x = left;
        while x < right {
            if ink[y * width + x] == 0 {
                x += 1;
                continue;
            }
            let start = x;
            while x < right && ink[y * width + x] != 0 {
                x += 1;
            }
            if (min_run..=max_run).contains(&(x - start)) {
                heads[(y - top) * width + start..(y - top) * width + x].fill(1);
            }
        }
    }
    let mut candidates = Vec::new();
    let mut components = 0;
    let mut stack = Vec::new();
    for seed in 0..heads.len() {
        if heads[seed] == 0 {
            continue;
        }
        components += 1;
        if components > MAX_COMPONENTS {
            return (Vec::new(), true);
        }
        stack.push(seed);
        heads[seed] = 0;
        let (mut min_x, mut max_x) = (seed % width, seed % width);
        let (mut min_y, mut max_y) = (seed / width, seed / width);
        let mut area = 0;
        while let Some(pixel) = stack.pop() {
            let (x, y) = (pixel % width, pixel / width);
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
            area += 1;
            for ny in y.saturating_sub(1)..=(y + 1).min(bottom - top - 1) {
                for nx in x.saturating_sub(1)..=(x + 1).min(width - 1) {
                    let neighbor = ny * width + nx;
                    if heads[neighbor] != 0 {
                        heads[neighbor] = 0;
                        stack.push(neighbor);
                    }
                }
            }
        }
        let box_width = (max_x - min_x + 1) as f64;
        let box_height = (max_y - min_y + 1) as f64;
        let fill = area as f64 / (box_width * box_height);
        if !(0.75 * spacing..=1.9 * spacing).contains(&box_width)
            || !(0.4 * spacing..=1.15 * spacing).contains(&box_height)
            || !(1.05..=2.7).contains(&(box_width / box_height))
            || fill < 0.65
        {
            continue;
        }
        let center_x = (min_x + max_x) as f64 / 2.0;
        let center_y = top as f64 + (min_y + max_y) as f64 / 2.0;
        let step_float = (staff.lines_y[4] - center_y) * 2.0 / spacing;
        let staff_step = step_float.round() as i32;
        if !(-4..=12).contains(&staff_step) {
            continue;
        }
        // Preserve the raw center even when it falls between expected staff positions.
        let alignment = (step_float - f64::from(staff_step)).abs();
        let confidence = (0.65 + 0.2 * fill - 0.35 * alignment).clamp(0.0, 0.85);
        candidates.push(OmrCandidate {
            id: String::new(),
            staff_id: staff.id.clone(),
            center_x,
            center_y,
            bounds: ImageBounds {
                x: min_x as u32,
                y: (top + min_y) as u32,
                width: box_width as u32,
                height: box_height as u32,
            },
            staff_step,
            tentative_pitch: pitch_for_step(staff_step),
            confidence,
            duration: "unknown".into(),
            accidental: "unknown".into(),
        });
        if candidates.len() > MAX_CANDIDATES {
            return (Vec::new(), true);
        }
    }
    candidates.sort_by(|a, b| {
        a.center_x
            .total_cmp(&b.center_x)
            .then(a.center_y.total_cmp(&b.center_y))
    });
    for (i, candidate) in candidates.iter_mut().enumerate() {
        candidate.id = format!("candidate-{}", i + 1);
    }
    (candidates, false)
}

fn pitch_for_step(staff_step: i32) -> Pitch {
    // C4 = diatonic index 28, E4 = 30. Euclidean arithmetic also handles ledger lines below C4.
    let diatonic = 30 + staff_step;
    Pitch {
        step: ["C", "D", "E", "F", "G", "A", "B"][diatonic.rem_euclid(7) as usize].into(),
        alter: 0,
        octave: diatonic.div_euclid(7) as i8,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SCALE: &[u8] = include_bytes!("../../../tests/fixtures/omr-original-scale.png");
    const TWO_STAFFS: &[u8] = include_bytes!("../../../tests/fixtures/omr-original-two-staffs.png");
    const HOLLOW: &[u8] = include_bytes!("../../../tests/fixtures/omr-original-hollow.png");

    #[test]
    fn original_stemmed_scale_is_a_review_not_a_score() {
        let review = analyze_image(SCALE).unwrap();
        assert_eq!(review.status, "review_required");
        assert!(review.requires_review);
        assert_eq!(review.staffs.len(), 1);
        assert_eq!(review.staffs[0].lines_y, [70., 82., 94., 106., 118.]);
        assert_eq!(review.candidates.len(), 8, "{:?}", review.candidates);
        let pitches: Vec<_> = review
            .candidates
            .iter()
            .map(|c| format!("{}{}", c.tentative_pitch.step, c.tentative_pitch.octave))
            .collect();
        assert_eq!(pitches, ["E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5"]);
        for (index, candidate) in review.candidates.iter().enumerate() {
            assert_eq!(candidate.duration, "unknown");
            assert_eq!(candidate.accidental, "unknown");
            assert!((candidate.center_x - (100. + 60. * index as f64)).abs() <= 1.0);
            assert!(candidate.confidence < 0.9);
        }
        let json = serde_json::to_value(&review).unwrap();
        assert!(json.get("score").is_none());
        assert!(json.get("timeline").is_none());
        assert!(json["assumptions"][0].as_str().unwrap().contains("assumed"));
    }

    #[test]
    fn jpeg_is_decoded_locally_too() {
        let image = image::load_from_memory(SCALE).unwrap().to_rgb8();
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95)
            .encode_image(&image)
            .unwrap();
        let review = analyze_image(&jpeg).unwrap();
        assert_eq!(review.format, "jpeg");
        assert_eq!(review.staffs.len(), 1);
        assert_eq!(review.candidates.len(), 8);
        assert!(review.requires_review);
    }

    #[test]
    fn multiple_staves_never_get_speculative_pitches() {
        let review = analyze_image(TWO_STAFFS).unwrap();
        assert_eq!(review.status, "unsupported");
        assert_eq!(review.staffs.len(), 2);
        assert!(review.candidates.is_empty());
        assert!(review
            .warnings
            .iter()
            .any(|w| w.contains("Multiple staves")));
    }

    #[test]
    fn hollow_noteheads_are_not_misreported_as_filled() {
        let review = analyze_image(HOLLOW).unwrap();
        assert_eq!(review.staffs.len(), 1);
        assert!(review.candidates.is_empty(), "{:?}", review.candidates);
    }

    #[test]
    fn six_line_tablature_is_not_a_treble_staff() {
        let mut image = image::load_from_memory(SCALE).unwrap().to_luma8();
        for x in 20..620 {
            image.put_pixel(x, 130, image::Luma([0]));
        }
        let mut png = Cursor::new(Vec::new());
        image.write_to(&mut png, ImageFormat::Png).unwrap();
        let review = analyze_image(png.get_ref()).unwrap();
        assert_eq!(review.status, "unsupported");
        assert!(review.staffs.is_empty());
        assert!(review.candidates.is_empty());
    }

    #[test]
    fn blank_and_transparent_images_have_no_invented_music() {
        for pixel in [image::Rgba([255, 255, 255, 255]), image::Rgba([0, 0, 0, 0])] {
            let image = image::RgbaImage::from_pixel(640, 160, pixel);
            let mut png = Cursor::new(Vec::new());
            image.write_to(&mut png, ImageFormat::Png).unwrap();
            let review = analyze_image(png.get_ref()).unwrap();
            assert_eq!(review.status, "unsupported");
            assert!(review.staffs.is_empty());
            assert!(review.candidates.is_empty());
        }
    }

    #[test]
    fn malformed_unsupported_and_large_inputs_are_rejected() {
        assert!(analyze_image(&[]).is_err());
        assert!(analyze_image(b"this is not an image").is_err());
        assert!(analyze_image(b"GIF89a")
            .unwrap_err()
            .contains("Only PNG and JPEG"));
        assert!(analyze_image(&SCALE[..32]).is_err());
        assert!(analyze_image(&vec![0; MAX_IMAGE_BYTES + 1])
            .unwrap_err()
            .contains("8 MiB"));
    }

    #[test]
    fn pixel_limit_is_checked_before_full_decode() {
        let mut png = SCALE.to_vec();
        png[16..20].copy_from_slice(&5000_u32.to_be_bytes());
        png[20..24].copy_from_slice(&5000_u32.to_be_bytes());
        let crc = crc32(&png[12..29]);
        png[29..33].copy_from_slice(&crc.to_be_bytes());
        assert!(analyze_image(&png)
            .unwrap_err()
            .contains("16-million-pixel"));
    }

    #[test]
    fn axis_limit_is_checked_by_header_decoder() {
        let mut png = SCALE.to_vec();
        png[16..20].copy_from_slice(&(MAX_DIMENSION + 1).to_be_bytes());
        let crc = crc32(&png[12..29]);
        png[29..33].copy_from_slice(&crc.to_be_bytes());
        assert!(analyze_image(&png).unwrap_err().contains("decoder limits"));
    }

    #[test]
    fn ledger_line_mapping_uses_natural_treble_assumption() {
        assert_eq!(pitch_for_step(-2).step, "C");
        assert_eq!(pitch_for_step(-2).octave, 4);
        assert_eq!(pitch_for_step(8).step, "F");
        assert_eq!(pitch_for_step(8).octave, 5);
        assert_eq!(pitch_for_step(12).step, "C");
        assert_eq!(pitch_for_step(12).octave, 6);
    }

    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = !0_u32;
        for &byte in bytes {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb8_8320_u32.wrapping_mul(crc & 1));
            }
        }
        !crc
    }
}
