use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalEditorKind {
    SystemDefault,
    VideoEditor,
    AudioEditor,
    ImageEditor,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedEditor {
    pub id: String,
    pub name: String,
    pub kind: ExternalEditorKind,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_default: Option<bool>,
    #[serde(skip)]
    pub launch: EditorLaunch,
}

#[derive(Debug, Clone)]
pub enum EditorLaunch {
    SystemDefault,
    Executable(PathBuf),
    MacApplication(PathBuf),
    Command(String),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAssetRequest {
    pub asset_id: String,
    pub project_id: Option<String>,
    pub editor_kind: ExternalEditorKind,
    pub editor_id: Option<String>,
    pub suggested_name: Option<String>,
    pub return_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealAssetRequest {
    pub asset_id: String,
    pub project_id: Option<String>,
}

/** 與 client/src/platform/desktopBridge.ts 的 DesktopBridgeResult 完全同形，不額外加入 discriminator。 */
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum DesktopBridgeResult {
    Success {
        ok: bool,
        #[serde(rename = "handoffId", skip_serializing_if = "Option::is_none")]
        handoff_id: Option<String>,
        #[serde(rename = "localName", skip_serializing_if = "Option::is_none")]
        local_name: Option<String>,
    },
    Failure {
        ok: bool,
        reason: String,
        message: String,
    },
}

impl DesktopBridgeResult {
    pub fn success(handoff_id: Option<String>, local_name: Option<String>) -> Self {
        Self::Success {
            ok: true,
            handoff_id,
            local_name,
        }
    }

    pub fn failure(reason: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Failure {
            ok: false,
            reason: reason.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffStatusEvent {
    pub handoff_id: String,
    pub project_id: Option<String>,
    pub source_asset_id: Option<String>,
    pub phase: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionUploadedEvent {
    pub handoff_id: String,
    pub project_id: String,
    pub source_asset_id: String,
    pub uploaded_asset_id: Option<String>,
    pub editor_id: Option<String>,
    pub title: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn success_result_matches_frontend_shape() {
        let value = serde_json::to_value(DesktopBridgeResult::success(
            Some("handoff-1".into()),
            Some("clip.mp4".into()),
        )).unwrap();
        assert_eq!(value["ok"], true);
        assert_eq!(value["handoffId"], "handoff-1");
        assert_eq!(value["localName"], "clip.mp4");
        assert!(value.get("shape").is_none());
        assert!(value.get("handoff_id").is_none());
    }

    #[test]
    fn failure_result_matches_frontend_shape() {
        let value = serde_json::to_value(DesktopBridgeResult::failure(
            "editor-not-found",
            "找不到剪輯軟體",
        )).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["reason"], "editor-not-found");
        assert_eq!(value["message"], "找不到剪輯軟體");
    }
}
