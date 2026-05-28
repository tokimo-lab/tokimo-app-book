//! Best-effort EPUB/PDF metadata scraping from raw bytes.
//!
//! No temp files are written; all parsing happens in memory.

use std::io::{Cursor, Read};

use sha2::{Digest, Sha256};

/// Scraped metadata from an EPUB or PDF file.
pub struct ScrapedBookMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    /// Plain-text content, if available (currently not extracted for epub/pdf).
    pub content: Option<String>,
    /// Rich metadata object with all extracted fields.
    pub metadata: serde_json::Value,
}

/// Scrape metadata from a file's raw bytes.
///
/// `path` is used for the `sourcePath` metadata field only.
/// `format` is the file extension (e.g. `"epub"`, `"pdf"`, `"txt"`).
pub fn scrape_book_file(path: &str, format: &str, bytes: &[u8]) -> ScrapedBookMetadata {
    match format.to_ascii_lowercase().as_str() {
        "epub" => scrape_epub(path, bytes),
        "pdf" => scrape_pdf(path, bytes),
        _ => ScrapedBookMetadata {
            title: None,
            author: None,
            content: None,
            metadata: serde_json::json!({
                "sourcePath": path,
                "sourceFormat": format,
                "fieldsFound": [],
            }),
        },
    }
}

// ── EPUB ──────────────────────────────────────────────────────────────────────

fn scrape_epub(path: &str, bytes: &[u8]) -> ScrapedBookMetadata {
    let mut errors: Vec<String> = Vec::new();

    let mut zip = match zip::ZipArchive::new(Cursor::new(bytes)) {
        Ok(z) => z,
        Err(e) => {
            return ScrapedBookMetadata {
                title: None,
                author: None,
                content: None,
                metadata: serde_json::json!({
                    "sourcePath": path,
                    "sourceFormat": "epub",
                    "fieldsFound": [],
                    "errors": [format!("zip open: {e}")],
                }),
            };
        }
    };

    // 1. Read META-INF/container.xml to find OPF rootfile path
    let rootfile_path = match read_container_xml(&mut zip) {
        Ok(p) => p,
        Err(e) => {
            errors.push(format!("container.xml: {e}"));
            // Fallback: look for a .opf file
            find_opf_file(&zip).unwrap_or_else(|| "OEBPS/content.opf".to_string())
        }
    };

    // OPF directory (for resolving relative cover paths)
    let opf_dir = rootfile_path
        .rfind('/')
        .map(|i| rootfile_path[..i].to_string())
        .unwrap_or_default();

    // 2. Parse OPF
    let opf_content = match read_zip_file_string(&mut zip, &rootfile_path) {
        Ok(s) => s,
        Err(e) => {
            errors.push(format!("opf read: {e}"));
            return ScrapedBookMetadata {
                title: None,
                author: None,
                content: None,
                metadata: serde_json::json!({
                    "sourcePath": path,
                    "sourceFormat": "epub",
                    "fieldsFound": [],
                    "errors": errors,
                }),
            };
        }
    };

    let opf = parse_opf(&opf_content);

    // 3. Resolve cover file if possible
    let cover_info = if let Some(ref cover_href) = opf.cover_href {
        let cover_path = if opf_dir.is_empty() {
            cover_href.clone()
        } else {
            format!("{opf_dir}/{cover_href}")
        };
        match read_zip_file_bytes(&mut zip, &cover_path) {
            Ok(data) => {
                let size = data.len();
                let mut hasher = Sha256::new();
                hasher.update(&data);
                let hash = format!("{:x}", hasher.finalize());
                Some(serde_json::json!({
                    "coverPath": cover_path,
                    "coverMediaType": opf.cover_media_type.as_deref().unwrap_or("image/jpeg"),
                    "coverSize": size,
                    "coverSha256": hash,
                }))
            }
            Err(e) => {
                errors.push(format!("cover read: {e}"));
                None
            }
        }
    } else {
        None
    };

    let mut fields_found: Vec<&str> = Vec::new();
    if opf.title.is_some() {
        fields_found.push("title");
    }
    if opf.creator.is_some() {
        fields_found.push("creator");
    }
    if opf.language.is_some() {
        fields_found.push("language");
    }
    if opf.publisher.is_some() {
        fields_found.push("publisher");
    }
    if opf.identifier.is_some() {
        fields_found.push("identifier");
    }
    if opf.description.is_some() {
        fields_found.push("description");
    }
    if opf.date.is_some() {
        fields_found.push("date");
    }
    if cover_info.is_some() {
        fields_found.push("cover");
    }

    let mut epub_meta = serde_json::json!({
        "title": opf.title,
        "creator": opf.creator,
        "language": opf.language,
        "publisher": opf.publisher,
        "identifier": opf.identifier,
        "description": opf.description,
        "date": opf.date,
    });
    if let Some(cover) = cover_info {
        epub_meta.as_object_mut().unwrap().insert("cover".to_string(), cover);
    }

    let mut metadata = serde_json::json!({
        "sourcePath": path,
        "sourceFormat": "epub",
        "fieldsFound": fields_found,
        "epubInfo": epub_meta,
    });
    if !errors.is_empty() {
        metadata
            .as_object_mut()
            .unwrap()
            .insert("errors".to_string(), serde_json::json!(errors));
    }

    ScrapedBookMetadata {
        title: opf.title.filter(|s| !s.trim().is_empty()),
        author: opf.creator.filter(|s| !s.trim().is_empty()),
        content: None,
        metadata,
    }
}

struct OpfData {
    title: Option<String>,
    creator: Option<String>,
    language: Option<String>,
    publisher: Option<String>,
    identifier: Option<String>,
    description: Option<String>,
    date: Option<String>,
    /// Relative href from OPF dir to cover image
    cover_href: Option<String>,
    cover_media_type: Option<String>,
}

fn set_first(slot: &mut Option<String>, value: String) {
    if slot.is_none() {
        *slot = Some(value);
    }
}

fn parse_opf(xml: &str) -> OpfData {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut title: Option<String> = None;
    let mut creator: Option<String> = None;
    let mut language: Option<String> = None;
    let mut publisher: Option<String> = None;
    let mut identifier: Option<String> = None;
    let mut description: Option<String> = None;
    let mut date: Option<String> = None;

    // manifest items: id -> (href, media-type)
    let mut manifest: std::collections::HashMap<String, (String, String)> = std::collections::HashMap::new();
    // meta name="cover" content="<id>"
    let mut cover_id: Option<String> = None;

    // Current tag local name (lowercase), used for text capture
    let mut current_tag: Option<String> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => {
                let local = local_name_lower(e.local_name().as_ref());

                // Capture manifest items
                if local == "item" {
                    let mut item_id = String::new();
                    let mut item_href = String::new();
                    let mut item_media_type = String::new();
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.local_name().as_ref()).to_lowercase();
                        let val = attr
                            .decode_and_unescape_value(reader.decoder())
                            .unwrap_or_default()
                            .to_string();
                        match key.as_str() {
                            "id" => item_id = val,
                            "href" => item_href = val,
                            "media-type" => item_media_type = val,
                            _ => {}
                        }
                    }
                    if !item_id.is_empty() && !item_href.is_empty() {
                        manifest.insert(item_id, (item_href, item_media_type));
                    }
                }

                // Capture meta name="cover"
                if local == "meta" {
                    let mut meta_name = String::new();
                    let mut meta_content = String::new();
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.local_name().as_ref()).to_lowercase();
                        let val = attr
                            .decode_and_unescape_value(reader.decoder())
                            .unwrap_or_default()
                            .to_string();
                        match key.as_str() {
                            "name" => meta_name = val,
                            "content" => meta_content = val,
                            _ => {}
                        }
                    }
                    if meta_name == "cover" && !meta_content.is_empty() {
                        cover_id = Some(meta_content);
                    }
                }

                // DC tags we want text from
                if matches!(
                    local.as_str(),
                    "title" | "creator" | "language" | "publisher" | "identifier" | "description" | "date"
                ) {
                    current_tag = Some(local);
                } else {
                    current_tag = None;
                }
            }
            Ok(Event::Text(ref e)) => {
                if let Some(ref tag) = current_tag {
                    let text = e.unescape().unwrap_or_default().trim().to_string();
                    if !text.is_empty() {
                        match tag.as_str() {
                            "title" => set_first(&mut title, text),
                            "creator" => set_first(&mut creator, text),
                            "language" => set_first(&mut language, text),
                            "publisher" => set_first(&mut publisher, text),
                            "identifier" => set_first(&mut identifier, text),
                            "description" => set_first(&mut description, text),
                            "date" => set_first(&mut date, text),
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::End(_)) => {
                current_tag = None;
            }
            Ok(Event::Eof) => break,
            _ => {}
        }
    }

    // Resolve cover href from manifest
    let cover_href = cover_id
        .as_deref()
        .and_then(|id| manifest.get(id))
        .map(|(href, _)| href.clone());
    let cover_media_type = cover_id
        .as_deref()
        .and_then(|id| manifest.get(id))
        .map(|(_, mt)| mt.clone());

    // Also check manifest for item with id="cover-image" or media-type image/*
    let cover_href = cover_href.or_else(|| {
        manifest
            .get("cover-image")
            .or_else(|| manifest.get("cover"))
            .map(|(h, _)| h.clone())
    });
    let cover_media_type = cover_media_type.or_else(|| {
        manifest
            .get("cover-image")
            .or_else(|| manifest.get("cover"))
            .map(|(_, mt)| mt.clone())
    });

    OpfData {
        title,
        creator,
        language,
        publisher,
        identifier,
        description,
        date,
        cover_href,
        cover_media_type,
    }
}

fn read_container_xml<R: Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>) -> Result<String, String> {
    let content = read_zip_file_string(zip, "META-INF/container.xml")?;
    parse_container_rootfile(&content)
}

fn parse_container_rootfile(xml: &str) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e) | Event::Empty(ref e)) => {
                let local = local_name_lower(e.local_name().as_ref());
                if local == "rootfile" {
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.local_name().as_ref()).to_lowercase();
                        if key == "full-path" {
                            let val = attr
                                .decode_and_unescape_value(reader.decoder())
                                .unwrap_or_default()
                                .to_string();
                            if !val.is_empty() {
                                return Ok(val);
                            }
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            _ => {}
        }
    }
    Err("rootfile full-path not found in container.xml".to_string())
}

fn find_opf_file(zip: &zip::ZipArchive<Cursor<&[u8]>>) -> Option<String> {
    for name in zip.file_names() {
        if std::path::Path::new(name)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("opf"))
        {
            return Some(name.to_string());
        }
    }
    None
}

fn read_zip_file_string<R: Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>, name: &str) -> Result<String, String> {
    let bytes = read_zip_file_bytes(zip, name)?;
    String::from_utf8(bytes).map_err(|e| format!("utf8: {e}"))
}

fn read_zip_file_bytes<R: Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>, name: &str) -> Result<Vec<u8>, String> {
    let mut file = zip.by_name(name).map_err(|e| format!("{name}: {e}"))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| format!("read {name}: {e}"))?;
    Ok(buf)
}

fn local_name_lower(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_lowercase()
}

// ── PDF ───────────────────────────────────────────────────────────────────────

fn scrape_pdf(path: &str, bytes: &[u8]) -> ScrapedBookMetadata {
    let doc = match lopdf::Document::load_mem(bytes) {
        Ok(d) => d,
        Err(e) => {
            return ScrapedBookMetadata {
                title: None,
                author: None,
                content: None,
                metadata: serde_json::json!({
                    "sourcePath": path,
                    "sourceFormat": "pdf",
                    "fieldsFound": [],
                    "errors": [format!("lopdf load: {e}")],
                }),
            };
        }
    };

    let info_dict = doc
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|obj| match obj {
            lopdf::Object::Reference(id) => doc.get_object(*id).ok(),
            other => Some(other),
        })
        .and_then(|obj| match obj {
            lopdf::Object::Dictionary(d) => Some(d),
            _ => None,
        });

    let mut pdf_info = serde_json::Map::new();
    let pdf_string_keys: &[(&[u8], &str)] = &[
        (b"Title", "Title"),
        (b"Author", "Author"),
        (b"Subject", "Subject"),
        (b"Keywords", "Keywords"),
        (b"Creator", "Creator"),
        (b"Producer", "Producer"),
        (b"CreationDate", "CreationDate"),
        (b"ModDate", "ModDate"),
    ];

    let mut title: Option<String> = None;
    let mut author: Option<String> = None;
    let mut fields_found: Vec<String> = Vec::new();

    if let Some(dict) = info_dict {
        for (key_bytes, key_str) in pdf_string_keys {
            if let Ok(obj) = dict.get(key_bytes) {
                let value = pdf_object_to_string(obj);
                if let Some(s) = value.filter(|s| !s.is_empty()) {
                    fields_found.push(key_str.to_string());
                    if *key_str == "Title" {
                        title = Some(s.clone());
                    } else if *key_str == "Author" {
                        author = Some(s.clone());
                    }
                    pdf_info.insert(key_str.to_string(), serde_json::Value::String(s));
                }
            }
        }
    }

    let metadata = serde_json::json!({
        "sourcePath": path,
        "sourceFormat": "pdf",
        "fieldsFound": fields_found,
        "pdfInfo": serde_json::Value::Object(pdf_info),
    });

    ScrapedBookMetadata {
        title: title.filter(|s| !s.trim().is_empty()),
        author: author.filter(|s| !s.trim().is_empty()),
        content: None,
        metadata,
    }
}

fn pdf_object_to_string(obj: &lopdf::Object) -> Option<String> {
    match obj {
        lopdf::Object::String(bytes, _) => {
            // Try UTF-16 BE (BOM: FF FE or FE FF) first, then UTF-8, then lossy
            if bytes.len() >= 2 && bytes[0] == 0xfe && bytes[1] == 0xff {
                // UTF-16 BE with BOM
                let words: Vec<u16> = bytes[2..]
                    .chunks_exact(2)
                    .map(|c| u16::from_be_bytes([c[0], c[1]]))
                    .collect();
                String::from_utf16(&words).ok()
            } else if bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] == 0xfe {
                // UTF-16 LE with BOM
                let words: Vec<u16> = bytes[2..]
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                String::from_utf16(&words).ok()
            } else {
                Some(String::from_utf8_lossy(bytes).into_owned())
            }
        }
        lopdf::Object::Name(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
        _ => None,
    }
}
