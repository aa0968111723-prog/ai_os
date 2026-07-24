/**
 * 剪映（JianYing 5.9）草稿檔模板——逐字取自開源專案 pyJianYingDraft 的 assets/
 * （draft_content_template.json、draft_meta_info.json；MIT 授權，剪映 5.9 與 10.8 實測可開）。
 * 剪映 6+ 自己儲存的草稿會加密，但「明文草稿」新版剪映仍可打開（同專案 README 實測）。
 * 這裡以 TS 常數內嵌，使用時務必 structuredClone 再填內容，不可直接改模板物件。
 */

/** draft_content.json 空模板（materials 45 個分類鍵全空、tracks 空） */
export const JY_CONTENT_TEMPLATE = {
  "canvas_config": {
    "height": 1080,
    "ratio": "original",
    "width": 1920
  },
  "color_space": 0,
  "config": {
    "adjust_max_index": 1,
    "attachment_info": [],
    "combination_max_index": 1,
    "export_range": null,
    "extract_audio_last_index": 1,
    "lyrics_recognition_id": "",
    "lyrics_sync": true,
    "lyrics_taskinfo": [],
    "maintrack_adsorb": true,
    "material_save_mode": 0,
    "multi_language_current": "none",
    "multi_language_list": [],
    "multi_language_main": "none",
    "multi_language_mode": "none",
    "original_sound_last_index": 1,
    "record_audio_last_index": 1,
    "sticker_max_index": 1,
    "subtitle_keywords_config": null,
    "subtitle_recognition_id": "",
    "subtitle_sync": true,
    "subtitle_taskinfo": [],
    "system_font_list": [],
    "video_mute": false,
    "zoom_info_params": null
  },
  "cover": null,
  "create_time": 0,
  "duration": 0,
  "extra_info": null,
  "fps": 30.0,
  "free_render_index_mode_on": false,
  "group_container": null,
  "id": "91E08AC5-22FB-47e2-9AA0-7DC300FAEA2B",
  "keyframe_graph_list": [],
  "keyframes": {
    "adjusts": [],
    "audios": [],
    "effects": [],
    "filters": [],
    "handwrites": [],
    "stickers": [],
    "texts": [],
    "videos": []
  },
  "last_modified_platform": {
    "app_id": 3704,
    "app_source": "lv",
    "app_version": "5.9.0",
    "os": "windows"
  },
  "platform": {
    "app_id": 3704,
    "app_source": "lv",
    "app_version": "5.9.0",
    "os": "windows"
  },
  "materials": {
    "ai_translates": [],
    "audio_balances": [],
    "audio_effects": [],
    "audio_fades": [],
    "audio_track_indexes": [],
    "audios": [],
    "beats": [],
    "canvases": [],
    "chromas": [],
    "color_curves": [],
    "digital_humans": [],
    "drafts": [],
    "effects": [],
    "flowers": [],
    "green_screens": [],
    "handwrites": [],
    "hsl": [],
    "images": [],
    "log_color_wheels": [],
    "loudnesses": [],
    "manual_deformations": [],
    "masks": [],
    "material_animations": [],
    "material_colors": [],
    "multi_language_refs": [],
    "placeholders": [],
    "plugin_effects": [],
    "primary_color_wheels": [],
    "realtime_denoises": [],
    "shapes": [],
    "smart_crops": [],
    "smart_relights": [],
    "sound_channel_mappings": [],
    "speeds": [],
    "stickers": [],
    "tail_leaders": [],
    "text_templates": [],
    "texts": [],
    "time_marks": [],
    "transitions": [],
    "video_effects": [],
    "video_trackings": [],
    "videos": [],
    "vocal_beautifys": [],
    "vocal_separations": []
  },
  "mutable_config": null,
  "name": "",
  "new_version": "110.0.0",
  "relationships": [],
  "render_index_track_mode_on": false,
  "retouch_cover": null,
  "source": "default",
  "static_cover_image_path": "",
  "time_marks": null,
  "tracks": [],
  "update_time": 0,
  "version": 360000
} as const;

/** draft_meta_info.json 空模板（draft_materials 七組全空） */
export const JY_META_TEMPLATE = {
  "cloud_package_completed_time": "",
  "draft_cloud_capcut_purchase_info": "",
  "draft_cloud_last_action_download": false,
  "draft_cloud_materials": [],
  "draft_cloud_purchase_info": "",
  "draft_cloud_template_id": "",
  "draft_cloud_tutorial_info": "",
  "draft_cloud_videocut_purchase_info": "",
  "draft_cover": "",
  "draft_deeplink_url": "",
  "draft_enterprise_info": {
    "draft_enterprise_extra": "",
    "draft_enterprise_id": "",
    "draft_enterprise_name": "",
    "enterprise_material": []
  },
  "draft_fold_path": "",
  "draft_id": "BC69C7CD-7C5E-4185-B284-AF3E1047A664",
  "draft_is_ai_packaging_used": false,
  "draft_is_ai_shorts": false,
  "draft_is_ai_translate": false,
  "draft_is_article_video_draft": false,
  "draft_is_from_deeplink": "false",
  "draft_is_invisible": false,
  "draft_materials": [
    {
      "type": 0,
      "value": []
    },
    {
      "type": 1,
      "value": []
    },
    {
      "type": 2,
      "value": []
    },
    {
      "type": 3,
      "value": []
    },
    {
      "type": 6,
      "value": []
    },
    {
      "type": 7,
      "value": []
    },
    {
      "type": 8,
      "value": []
    }
  ],
  "draft_materials_copied_info": [],
  "draft_name": "",
  "draft_new_version": "",
  "draft_removable_storage_device": "",
  "draft_root_path": "",
  "draft_segment_extra_info": [],
  "draft_type": "",
  "tm_draft_cloud_completed": "",
  "tm_draft_cloud_modified": 0,
  "tm_draft_removed": 0,
  "tm_duration": 0
} as const;
