

use std::io::Cursor;
use std::path::Path;

use image::ImageFormat;
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

pub fn strip_bytes(data: &[u8], path: &Path) -> PylonResult<Vec<u8>> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "jpg" | "jpeg" => strip_jpeg(data),
        "png" => strip_png(data),
        "webp" => strip_webp(data),
        "gif" => strip_gif(data),
        "pdf" => strip_pdf(data),
        _ => Ok(data.to_vec()),
    }
}

pub fn strip_bytes_with_report(data: &[u8], path: &Path) -> PylonResult<(Vec<u8>, MetadataReport)> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let fields = read_fields(data, path).unwrap_or_default();
    let size_before = data.len();
    let clean = strip_bytes(data, path)?;
    let size_after = clean.len();

    let report = MetadataReport {
        file_type: ext,
        fields_found: fields.iter().map(|f| format!("{}: {}", f.tag, f.value)).collect(),
        fields_stripped: fields.len(),
        size_before,
        size_after,
    };
    Ok((clean, report))
}

pub fn read_fields(data: &[u8], path: &Path) -> PylonResult<Vec<MetadataField>> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "webp" | "tiff" | "tif" => read_exif(data),
        _ => Ok(vec![]),
    }
}

fn read_exif(data: &[u8]) -> PylonResult<Vec<MetadataField>> {
    let mut bufreader = std::io::BufReader::new(Cursor::new(data));
    let exif_reader = exif::Reader::new();
    match exif_reader.read_from_container(&mut bufreader) {
        Ok(exif) => {
            let fields = exif
                .fields()
                .map(|f| MetadataField {
                    tag: f.tag.to_string(),
                    value: f.display_value().with_unit(&exif).to_string(),
                })
                .collect();
            Ok(fields)
        }
        Err(_) => Ok(vec![]),
    }
}

fn strip_jpeg(data: &[u8]) -> PylonResult<Vec<u8>> {

    let img = image::load_from_memory_with_format(data, ImageFormat::Jpeg)
        .map_err(|e| PylonError::Metadata(format!("JPEG decode: {e}")))?;
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, ImageFormat::Jpeg)
        .map_err(|e| PylonError::Metadata(format!("JPEG encode: {e}")))?;
    Ok(out.into_inner())
}

fn strip_png(data: &[u8]) -> PylonResult<Vec<u8>> {
    let img = image::load_from_memory_with_format(data, ImageFormat::Png)
        .map_err(|e| PylonError::Metadata(format!("PNG decode: {e}")))?;
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, ImageFormat::Png)
        .map_err(|e| PylonError::Metadata(format!("PNG encode: {e}")))?;
    Ok(out.into_inner())
}

fn strip_webp(data: &[u8]) -> PylonResult<Vec<u8>> {
    let img = image::load_from_memory_with_format(data, ImageFormat::WebP)
        .map_err(|e| PylonError::Metadata(format!("WebP decode: {e}")))?;
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, ImageFormat::WebP)
        .map_err(|e| PylonError::Metadata(format!("WebP encode: {e}")))?;
    Ok(out.into_inner())
}

fn strip_gif(data: &[u8]) -> PylonResult<Vec<u8>> {
    let img = image::load_from_memory_with_format(data, ImageFormat::Gif)
        .map_err(|e| PylonError::Metadata(format!("GIF decode: {e}")))?;
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, ImageFormat::Gif)
        .map_err(|e| PylonError::Metadata(format!("GIF encode: {e}")))?;
    Ok(out.into_inner())
}

fn strip_pdf(data: &[u8]) -> PylonResult<Vec<u8>> {
    let mut doc = lopdf::Document::load_mem(data)
        .map_err(|e| PylonError::Metadata(format!("PDF load: {e}")))?;

    if let Ok(catalog_ref) = doc.trailer.get(b"Root").and_then(|o| o.as_reference()) {
        if let Ok(lopdf::Object::Dictionary(ref mut dict)) = doc.get_object_mut(catalog_ref) {
            dict.remove(b"Metadata");
        }
    }

    if let Some(info_ref) = doc
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|o| o.as_reference().ok())
    {
        if let Some(lopdf::Object::Dictionary(ref mut dict)) = doc.objects.get_mut(&info_ref) {
            for key in [
                b"Author" as &[u8], b"Creator", b"Producer", b"Subject",
                b"Keywords", b"Title", b"CreationDate", b"ModDate",
            ] {
                dict.remove(key);
            }
        }
    }
    doc.trailer.remove(b"Info");

    let mut out = Vec::new();
    doc.save_to(&mut Cursor::new(&mut out))
        .map_err(|e| PylonError::Metadata(format!("PDF save: {e}")))?;
    Ok(out)
}
