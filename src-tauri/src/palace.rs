use std::path::Path;

use crate::errors::AppError;
use crate::models::{DrawerStructure, MemPalaceStructure, RoomStructure, WingStructure};

/// Parse a drawer from a YAML value (list item with name + optional fields).
fn parse_drawer(dv: &serde_yaml::Value) -> DrawerStructure {
    let name = dv
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("unnamed_drawer")
        .to_string();
    let keywords: Vec<String> = dv
        .get("keywords")
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let descriptions: Vec<String> = dv
        .get("descriptions")
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let entities: Vec<String> = dv
        .get("entities")
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    DrawerStructure {
        name,
        keywords,
        descriptions,
        entities,
        drawer_count: None,
    }
}

/// Parse rooms from either a mapping (room_name: {…}) or a list ([- name: …]).
/// Returns (rooms, total_drawer_count).
fn parse_rooms(rooms_raw: &serde_yaml::Value) -> (Vec<RoomStructure>, usize) {
    let mut rooms = Vec::new();
    let mut raw_count = 0;

    let items: Vec<(String, &serde_yaml::Value)> = if let Some(map) = rooms_raw.as_mapping() {
        // Mapping format: room_name: { keywords: …, drawers: … }
        map.iter()
            .map(|(k, v)| (k.as_str().unwrap_or("unnamed_room").to_string(), v))
            .collect()
    } else if let Some(seq) = rooms_raw.as_sequence() {
        // List format: - name: room_name\n  keywords: …
        seq.iter()
            .map(|item| {
                let name = item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unnamed_room")
                    .to_string();
                (name, item)
            })
            .collect()
    } else {
        vec![]
    };

    for (room_name, room_value) in items {
        if let Some(rv) = room_value.as_mapping() {
            let keywords: Vec<String> = rv
                .get(serde_yaml::Value::from("keywords"))
                .and_then(|v| v.as_sequence())
                .map(|seq| {
                    seq.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let entities: Vec<String> = rv
                .get(serde_yaml::Value::from("entities"))
                .and_then(|v| v.as_sequence())
                .map(|seq| {
                    seq.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();

            let drawers_raw = rv.get(serde_yaml::Value::from("drawers"));
            let mut drawers = Vec::new();
            if let Some(ds) = drawers_raw.and_then(|v| v.as_sequence()) {
                for dv in ds {
                    drawers.push(parse_drawer(dv));
                }
            }
            raw_count += drawers.len();

            let explicit_count = rv
                .get(serde_yaml::Value::from("drawer_count"))
                .and_then(|v| v.as_i64())
                .map(|c| c as usize);

            rooms.push(RoomStructure {
                name: room_name,
                keywords,
                entities,
                drawers,
                drawer_count: explicit_count,
            });
        }
    }

    (rooms, raw_count)
}

pub(crate) fn validate_palace_path(path: &Path) -> Result<(), AppError> {
    let raw_str = path.to_string_lossy();
    let clean_str = crate::db::extract_clean_path_str(&raw_str);
    let clean_path = Path::new(&clean_str);

    let has_yaml_ext = clean_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .is_some_and(|e| e == "yaml" || e == "yml");

    let has_traversal = clean_path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir));

    if has_yaml_ext && !has_traversal {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "Invalid MemPalace file path: {}. Path must end with .yaml or .yml and not contain parent traversal.",
            path.display()
        )))
    }
}

pub fn parse_palace_yaml(path: &str) -> Result<MemPalaceStructure, AppError> {
    let clean_str = crate::db::extract_clean_path_str(path);
    let p = Path::new(&clean_str);
    if !p.exists() && !Path::new(path).exists() {
        return Err(AppError::NotFound(format!(
            "MemPalace config not found: {}",
            path
        )));
    }

    validate_palace_path(p)?;

    let content = std::fs::read_to_string(p)?;
    let yaml_value: serde_yaml::Value = serde_yaml::from_str(&content)?;

    // Get the wings node: either under a "wings" key or the whole document
    let wings_raw = yaml_value.get("wings").unwrap_or(&yaml_value);

    let mut wings = Vec::new();

    // Handle wings as mapping or list
    let wing_items: Vec<(String, Option<String>, &serde_yaml::Value)> =
        if let Some(map) = wings_raw.as_mapping() {
            // Mapping: wing_name: { path: …, rooms: … }
            map.iter()
                .map(|(k, v)| {
                    let name = k.as_str().unwrap_or("unnamed_wing").to_string();
                    let path = v.get("path").and_then(|p| p.as_str()).map(String::from);
                    (name, path, v)
                })
                .collect()
        } else if let Some(seq) = wings_raw.as_sequence() {
            // List: - name: wing_name\n  path: …\n  rooms: …
            seq.iter()
                .map(|item| {
                    let name = item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unnamed_wing")
                        .to_string();
                    let path_val = item.get("path").and_then(|p| p.as_str()).map(String::from);
                    (name, path_val, item)
                })
                .collect()
        } else {
            vec![]
        };

    for (wing_name, wing_path, wing_value) in wing_items {
        let rooms_raw = wing_value.get("rooms");
        let (rooms, _drawer_count) = match rooms_raw {
            Some(rv) => parse_rooms(rv),
            None => (vec![], 0),
        };

        wings.push(WingStructure {
            name: wing_name,
            path: wing_path,
            rooms: rooms.clone(),
            room_count: Some(rooms.len()),
        });
    }

    let total_wings = wings.len();
    let total_rooms: usize = wings.iter().map(|w| w.rooms.len()).sum();
    let total_drawers: usize = wings
        .iter()
        .flat_map(|w| w.rooms.iter())
        .map(|r| r.drawers.len())
        .sum();

    Ok(MemPalaceStructure {
        wings,
        total_wings,
        total_rooms,
        total_drawers,
        source_file: p.to_string_lossy().to_string(),
    })
}

/// Discover and parse a MemPalace config by searching common locations.
/// Tries: explicit path → ~/.mempalace/mempalace.yaml → ~/.mempalace/config.yaml → ~/.mempalace/palace/ (ChromaDB)
pub fn discover_and_parse(path: Option<&str>) -> Result<MemPalaceStructure, AppError> {
    if let Some(p) = path {
        if !p.is_empty() {
            return parse_palace_yaml(p);
        }
    }

    // Try YAML config files first
    let mempalace_dir = crate::paths::user_home().join(".mempalace");
    let yaml_candidates = [
        "mempalace.yaml",
        "mempalace.yml",
        "config.yaml",
        "config.yml",
        "palace.yaml",
        "palace.yml",
    ];

    for name in yaml_candidates {
        let candidate = mempalace_dir.join(name);
        if candidate.exists() {
            return parse_palace_yaml(&candidate.to_string_lossy());
        }
    }

    // Fall back: try ChromaDB at ~/.mempalace/palace/
    let chroma_dir = mempalace_dir.join("palace");
    let chroma_db = chroma_dir.join("chroma.sqlite3");
    if chroma_db.exists() {
        // MemPalace is stored as a ChromaDB. Return a basic structure
        // so the frontend can auto-discover and show it as a data source.
        return Ok(MemPalaceStructure {
            wings: vec![],
            total_wings: 0,
            total_rooms: 0,
            total_drawers: 0,
            source_file: chroma_dir.to_string_lossy().into_owned(),
        });
    }

    Err(AppError::NotFound(
        "No MemPalace config found in ~/.mempalace/ or at the given path".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_palace_path_accepts_valid_extensions() {
        assert!(validate_palace_path(Path::new("/some/path/config.yaml")).is_ok());
        assert!(validate_palace_path(Path::new("file:///some/path/palace.yml?mode=ro")).is_ok());
        assert!(validate_palace_path(Path::new("/SOME/PATH/PALACE.YAML")).is_ok());
    }

    #[test]
    fn validate_palace_path_rejects_non_yaml_and_traversal() {
        assert!(validate_palace_path(Path::new("/etc/passwd")).is_err());
        assert!(validate_palace_path(Path::new("../secret.yaml")).is_err());
        assert!(validate_palace_path(Path::new("/home/user/secret.txt")).is_err());
    }
}
