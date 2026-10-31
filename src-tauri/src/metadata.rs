use std::io::Cursor;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{PylonError, PylonResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataReport {
    pub file_type: String,
    pub fields_found: Vec<String>,
    pub fields_stripped: usize,
    pub size_before: usize,
    pub size_after: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataField {
    pub tag: String,
    pub value: String,
}

fn ext_of(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

pub fn is_strippable(path: &Path) -> bool {
    matches!(ext_of(path).as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif" | "pdf")
}

pub fn strip_bytes(data: &[u8], path: &Path) -> PylonResult<Vec<u8>> {
    match ext_of(path).as_str() {
        "jpg" | "jpeg" => strip_jpeg(data),
        "png" => strip_png(data),
        "webp" => strip_webp(data),
        "gif" => strip_gif(data),
        "pdf" => strip_pdf(data),
        _ => Ok(data.to_vec()),
    }
}

pub fn strip_bytes_with_report(data: &[u8], path: &Path) -> PylonResult<(Vec<u8>, MetadataReport)> {
    let fields = read_fields(data, path).unwrap_or_default();
    let clean = strip_bytes(data, path)?;
    let report = MetadataReport {
        file_type: ext_of(path),
        fields_found: fields.iter().map(|f| format!("{}: {}", f.tag, f.value)).collect(),
        fields_stripped: fields.len(),
        size_before: data.len(),
        size_after: clean.len(),
    };
    Ok((clean, report))
}

pub fn read_fields(data: &[u8], path: &Path) -> PylonResult<Vec<MetadataField>> {
    let mut out = Vec::new();
    match ext_of(path).as_str() {
        "jpg" | "jpeg" | "png" | "webp" | "tiff" | "tif" | "heic" | "heif" => {
            let mut r = std::io::BufReader::new(Cursor::new(data));
            if let Ok(exif) = exif::Reader::new().read_from_container(&mut r) {
                out.extend(exif.fields().map(|f| MetadataField {
                    tag: f.tag.to_string(),
                    value: f.display_value().with_unit(&exif).to_string(),
                }));
            }
            if ext_of(path) == "png" {
                out.extend(png_text_fields(data));
            }
        }
        "pdf" => {
            if let Ok(doc) = lopdf::Document::load_mem(data) {
                if let Ok(info) = doc.trailer.get(b"Info").and_then(|o| o.as_reference()).and_then(|r| doc.get_dictionary(r)) {
                    for (k, v) in info.iter() {
                        let value = match v {
                            lopdf::Object::String(s, _) => String::from_utf8_lossy(s).into_owned(),
                            other => format!("{other:?}"),
                        };
                        out.push(MetadataField { tag: String::from_utf8_lossy(k).into_owned(), value });
                    }
                }
            }
        }
        _ => {}
    }
    Ok(out)
}

fn meta_err(fmt: &str, what: &str) -> PylonError {
    PylonError::Metadata(format!("{fmt}: {what}"))
}

fn strip_jpeg(data: &[u8]) -> PylonResult<Vec<u8>> {
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return Err(meta_err("JPEG", "not a JPEG file"));
    }
    let mut out = Vec::with_capacity(data.len());
    out.extend_from_slice(&data[..2]);
    let mut i = 2;
    while i + 4 <= data.len() {
        if data[i] != 0xFF {
            return Err(meta_err("JPEG", "corrupt marker stream"));
        }
        let marker = data[i + 1];
        if marker == 0xFF {
            i += 1;
            continue;
        }
        if marker == 0xDA || marker == 0xD9 {
            out.extend_from_slice(&data[i..]);
            return Ok(out);
        }
        if (0xD0..=0xD7).contains(&marker) || marker == 0x01 {
            out.extend_from_slice(&data[i..i + 2]);
            i += 2;
            continue;
        }
        let len = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
        let end = i + 2 + len;
        if len < 2 || end > data.len() {
            return Err(meta_err("JPEG", "truncated segment"));
        }
        let payload = &data[i + 4..end];
        let keep = match marker {
            0xE0 => true,
            0xE2 => payload.starts_with(b"ICC_PROFILE\0"),
            0xEE => payload.starts_with(b"Adobe"),
            0xE1 | 0xE3..=0xED | 0xEF => false,
            0xFE => false,
            _ => true,
        };
        if keep {
            out.extend_from_slice(&data[i..end]);
        }
        i = end;
    }
    Err(meta_err("JPEG", "no image data found"))
}

const PNG_SIG: &[u8] = b"\x89PNG\r\n\x1a\n";

fn png_chunks(data: &[u8]) -> PylonResult<Vec<(&[u8; 4], &[u8], usize, usize)>> {
    if !data.starts_with(PNG_SIG) {
        return Err(meta_err("PNG", "not a PNG file"));
    }
    let mut v = Vec::new();
    let mut i = PNG_SIG.len();
    while i + 12 <= data.len() {
        let len = u32::from_be_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]) as usize;
        let end = i + 12 + len;
        if end > data.len() {
            return Err(meta_err("PNG", "truncated chunk"));
        }
        let kind: &[u8; 4] = data[i + 4..i + 8].try_into().unwrap();
        v.push((kind, &data[i + 8..i + 8 + len], i, end));
        i = end;
        if kind == b"IEND" {
            break;
        }
    }
    Ok(v)
}

fn strip_png(data: &[u8]) -> PylonResult<Vec<u8>> {
    let mut out = Vec::with_capacity(data.len());
    out.extend_from_slice(PNG_SIG);
    for (kind, _, start, end) in png_chunks(data)? {
        if matches!(kind, b"tEXt" | b"zTXt" | b"iTXt" | b"eXIf" | b"tIME") {
            continue;
        }
        out.extend_from_slice(&data[start..end]);
    }
    Ok(out)
}

fn png_text_fields(data: &[u8]) -> Vec<MetadataField> {
    png_chunks(data)
        .unwrap_or_default()
        .into_iter()
        .filter(|(k, ..)| *k == b"tEXt" || *k == b"iTXt")
        .filter_map(|(_, body, ..)| {
            let nul = body.iter().position(|b| *b == 0)?;
            let key = String::from_utf8_lossy(&body[..nul]).into_owned();
            let value = String::from_utf8_lossy(&body[nul + 1..]).trim_matches('\0').chars().take(120).collect();
            Some(MetadataField { tag: key, value })
        })
        .collect()
}

fn strip_webp(data: &[u8]) -> PylonResult<Vec<u8>> {
    if data.len() < 12 || &data[..4] != b"RIFF" || &data[8..12] != b"WEBP" {
        return Err(meta_err("WebP", "not a WebP file"));
    }
    let mut body = Vec::with_capacity(data.len());
    let mut i = 12;
    while i + 8 <= data.len() {
        let kind = &data[i..i + 4];
        let len = u32::from_le_bytes([data[i + 4], data[i + 5], data[i + 6], data[i + 7]]) as usize;
        let padded = len + (len & 1);
        let end = (i + 8 + padded).min(data.len());
        if i + 8 + len > data.len() {
            return Err(meta_err("WebP", "truncated chunk"));
        }
        if kind != b"EXIF" && kind != b"XMP " {
            let start = body.len();
            body.extend_from_slice(&data[i..end]);
            if kind == b"VP8X" && len >= 1 {
                body[start + 8] &= !(0x08 | 0x04);
            }
        }
        i = end;
    }
    let mut out = Vec::with_capacity(body.len() + 12);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((body.len() + 4) as u32).to_le_bytes());
    out.extend_from_slice(b"WEBP");
    out.extend_from_slice(&body);
    Ok(out)
}

fn gif_skip_subblocks(data: &[u8], mut i: usize) -> PylonResult<usize> {
    loop {
        let n = *data.get(i).ok_or_else(|| meta_err("GIF", "truncated sub-block"))? as usize;
        i += 1;
        if n == 0 {
            return Ok(i);
        }
        i += n;
        if i > data.len() {
            return Err(meta_err("GIF", "truncated sub-block"));
        }
    }
}

fn strip_gif(data: &[u8]) -> PylonResult<Vec<u8>> {
    if data.len() < 13 || !(data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a")) {
        return Err(meta_err("GIF", "not a GIF file"));
    }
    let flags = data[10];
    let gct = if flags & 0x80 != 0 { 3 * (1usize << ((flags & 0x07) + 1)) } else { 0 };
    let mut i = 13 + gct;
    if i > data.len() {
        return Err(meta_err("GIF", "truncated header"));
    }
    let mut out = Vec::with_capacity(data.len());
    out.extend_from_slice(&data[..i]);
    while i < data.len() {
        match data[i] {
            0x3B => {
                out.push(0x3B);
                return Ok(out);
            }
            0x21 => {
                let label = *data.get(i + 1).ok_or_else(|| meta_err("GIF", "truncated extension"))?;
                let end = gif_skip_subblocks(data, i + 2)?;
                let keep = match label {
                    0xFE => false,
                    0xFF => {
                        let id = data.get(i + 3..i + 14).unwrap_or(&[]);
                        id == b"NETSCAPE2.0" || id == b"ANIMEXTS1.0"
                    }
                    _ => true,
                };
                if keep {
                    out.extend_from_slice(&data[i..end]);
                }
                i = end;
            }
            0x2C => {
                if i + 10 > data.len() {
                    return Err(meta_err("GIF", "truncated image descriptor"));
                }
                let lflags = data[i + 9];
                let lct = if lflags & 0x80 != 0 { 3 * (1usize << ((lflags & 0x07) + 1)) } else { 0 };
                let data_start = i + 10 + lct + 1;
                let end = gif_skip_subblocks(data, data_start)?;
                out.extend_from_slice(&data[i..end]);
                i = end;
            }
            _ => return Err(meta_err("GIF", "unexpected block")),
        }
    }
    out.push(0x3B);
    Ok(out)
}

fn strip_pdf(data: &[u8]) -> PylonResult<Vec<u8>> {
    let mut doc = lopdf::Document::load_mem(data).map_err(|e| PylonError::Metadata(format!("PDF load: {e}")))?;
    if let Ok(catalog_ref) = doc.trailer.get(b"Root").and_then(|o| o.as_reference()) {
        if let Ok(lopdf::Object::Dictionary(ref mut dict)) = doc.get_object_mut(catalog_ref) {
            dict.remove(b"Metadata");
        }
    }
    if let Some(info_ref) = doc.trailer.get(b"Info").ok().and_then(|o| o.as_reference().ok()) {
        doc.objects.remove(&info_ref);
    }
    doc.trailer.remove(b"Info");
    let mut out = Vec::new();
    doc.save_to(&mut Cursor::new(&mut out)).map_err(|e| PylonError::Metadata(format!("PDF save: {e}")))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(marker: u8, payload: &[u8]) -> Vec<u8> {
        let mut v = vec![0xFF, marker];
        v.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
        v.extend_from_slice(payload);
        v
    }

    #[test]
    fn jpeg_drops_exif_keeps_icc_and_scan() {
        let mut j = vec![0xFF, 0xD8];
        j.extend(seg(0xE0, b"JFIF\0\x01\x01"));
        j.extend(seg(0xE1, b"Exif\0\0GPSDATA"));
        j.extend(seg(0xE2, b"ICC_PROFILE\0\x01\x01data"));
        j.extend(seg(0xFE, b"a comment"));
        j.extend(seg(0xDB, &[0u8; 65]));
        j.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x02, 0x11, 0x22, 0xFF, 0xD9]);
        let out = strip_jpeg(&j).unwrap();
        let s = String::from_utf8_lossy(&out);
        assert!(!s.contains("GPSDATA"));
        assert!(!s.contains("a comment"));
        assert!(s.contains("ICC_PROFILE"));
        assert!(out.ends_with(&[0x11, 0x22, 0xFF, 0xD9]));
    }

    fn png_chunk(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut v = (body.len() as u32).to_be_bytes().to_vec();
        v.extend_from_slice(kind);
        v.extend_from_slice(body);
        v.extend_from_slice(&[0, 0, 0, 0]);
        v
    }

    #[test]
    fn png_drops_text() {
        let mut p = PNG_SIG.to_vec();
        p.extend(png_chunk(b"IHDR", &[0; 13]));
        p.extend(png_chunk(b"tEXt", b"Author\0Secret Person"));
        p.extend(png_chunk(b"IDAT", b"pixels"));
        p.extend(png_chunk(b"IEND", b""));
        assert_eq!(png_text_fields(&p)[0].tag, "Author");
        let out = strip_png(&p).unwrap();
        assert!(!String::from_utf8_lossy(&out).contains("Secret"));
        assert!(String::from_utf8_lossy(&out).contains("pixels"));
    }

    #[test]
    fn webp_drops_exif_and_fixes_flags() {
        let mut body = b"WEBP".to_vec();
        body.extend_from_slice(b"VP8X");
        body.extend_from_slice(&10u32.to_le_bytes());
        body.extend_from_slice(&[0x0C, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        body.extend_from_slice(b"EXIF");
        body.extend_from_slice(&3u32.to_le_bytes());
        body.extend_from_slice(b"GPS\0");
        let mut w = b"RIFF".to_vec();
        w.extend_from_slice(&(body.len() as u32).to_le_bytes());
        w.extend(body);
        let out = strip_webp(&w).unwrap();
        assert!(!String::from_utf8_lossy(&out).contains("GPS"));
        assert_eq!(out[20] & 0x0C, 0);
        assert_eq!(u32::from_le_bytes(out[4..8].try_into().unwrap()) as usize, out.len() - 8);
    }

    #[test]
    fn gif_keeps_frames_and_loop() {
        let mut g = b"GIF89a".to_vec();
        g.extend_from_slice(&[1, 0, 1, 0, 0x80, 0, 0]);
        g.extend_from_slice(&[0, 0, 0, 255, 255, 255]);
        g.extend_from_slice(&[0x21, 0xFF, 11]);
        g.extend_from_slice(b"NETSCAPE2.0");
        g.extend_from_slice(&[3, 1, 0, 0, 0]);
        g.extend_from_slice(&[0x21, 0xFE, 5]);
        g.extend_from_slice(b"hello");
        g.push(0);
        for _ in 0..2 {
            g.extend_from_slice(&[0x2C, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4C, 0x01, 0]);
        }
        g.push(0x3B);
        let out = strip_gif(&g).unwrap();
        let s = String::from_utf8_lossy(&out);
        assert!(!s.contains("hello"));
        assert!(s.contains("NETSCAPE2.0"));
        assert_eq!(out.iter().filter(|b| **b == 0x2C).count(), 2);
    }
}
