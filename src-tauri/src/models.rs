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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "shape")]
pub enum DesktopBridgeResult {
    #[serde(rename = "success")]
    Success {
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        handoff_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        local_name: Option<String>,
    },
    #[serde(rename = "failure")]
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
