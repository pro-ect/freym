import type { ParamSchema } from "../types";

/**
 * Provider parameters mirrored into the canvas.
 *
 * Generated from each fal endpoint's published input schema, for image and
 * video models. The catalog (models.param_schema) always wins on keys it
 * defines, so its curated labels, size lists and video durations stand; this
 * file only adds what the catalog leaves out. Fields the provider leaves unset
 * carry no default and are only sent once the user changes them.
 *
 * Deliberately excluded: prompt/seed/image plumbing, num_images and max_images
 * (run count is controlled by how many model nodes you wire up), the resolution
 * tier that distinguishes the priced Nano Banana Pro variants, and raw
 * image_size where the catalog already offers an aspect-ratio control that
 * start-prediction-fal converts.
 */
export const PARAM_MIRROR: Record<string, ParamSchema> = {
  "nano-banana-2-fal": {
    "enable_web_search": {
      "type": "boolean",
      "label": "Enable web search",
      "description": "Enable web search for the image generation task. This will allow the model to use the latest information from the web to generate the image",
      "default": false
    },
    "safety_tolerance": {
      "type": "select",
      "label": "Safety tolerance",
      "description": "The safety tolerance level for content moderation. 1 is the most strict (blocks most content), 6 is the least strict",
      "default": "4",
      "options": [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6"
      ]
    },
    "thinking_level": {
      "type": "select",
      "label": "Thinking level",
      "description": "When set, enables model thinking with the given level ('minimal' or 'high') and includes thoughts in the generation. Omit to disable",
      "options": [
        "minimal",
        "high"
      ]
    }
  },
  "nano-banana-2-lite-fal": {
    "safety_tolerance": {
      "type": "select",
      "label": "Safety tolerance",
      "description": "The safety tolerance level for content moderation. 1 is the most strict (blocks most content), 6 is the least strict",
      "default": "4",
      "options": [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6"
      ]
    },
    "thinking_level": {
      "type": "select",
      "label": "Thinking level",
      "description": "When set, enables model thinking with the given level ('minimal' or 'high') and includes thoughts in the generation. Omit to disable",
      "options": [
        "minimal",
        "high"
      ]
    }
  },
  "nano-banana-pro-4k-fal": {
    "enable_web_search": {
      "type": "boolean",
      "label": "Enable web search",
      "description": "Enable web search for the image generation task. This will allow the model to use the latest information from the web to generate the image",
      "default": false
    },
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "The format of the generated image.",
      "default": "png",
      "options": [
        "jpeg",
        "png",
        "webp"
      ]
    },
    "safety_tolerance": {
      "type": "select",
      "label": "Safety tolerance",
      "description": "The safety tolerance level for content moderation. 1 is the most strict (blocks most content), 6 is the least strict",
      "default": "4",
      "options": [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6"
      ]
    }
  },
  "nano-banana-pro-2k-fal": {
    "enable_web_search": {
      "type": "boolean",
      "label": "Enable web search",
      "description": "Enable web search for the image generation task. This will allow the model to use the latest information from the web to generate the image",
      "default": false
    },
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "The format of the generated image.",
      "default": "png",
      "options": [
        "jpeg",
        "png",
        "webp"
      ]
    },
    "safety_tolerance": {
      "type": "select",
      "label": "Safety tolerance",
      "description": "The safety tolerance level for content moderation. 1 is the most strict (blocks most content), 6 is the least strict",
      "default": "4",
      "options": [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6"
      ]
    }
  },
  "nano-banana-fal": {
    "safety_tolerance": {
      "type": "select",
      "label": "Safety tolerance",
      "description": "The safety tolerance level for content moderation. 1 is the most strict (blocks most content), 6 is the least strict",
      "default": "4",
      "options": [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6"
      ]
    }
  },
  "seedream-5-pro-fal": {
    "enable_safety_checker": {
      "type": "boolean",
      "label": "Enable safety checker",
      "description": "If set to true, the safety checker will be enabled.",
      "default": true
    },
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "The file format of the generated image.",
      "default": "jpeg",
      "options": [
        "jpeg",
        "png"
      ]
    }
  },
  "seedream-5-lite-fal": {
    "image_size": {
      "type": "select",
      "label": "Image size",
      "description": "The size of the generated image. Total pixels must be between 2560x1440 and 4096x4096",
      "default": "auto_2K",
      "options": [
        "square_hd",
        "square",
        "portrait_4_3",
        "portrait_16_9",
        "landscape_4_3",
        "landscape_16_9",
        "auto_2K",
        "auto_3K",
        "auto_4K"
      ]
    },
    "enable_safety_checker": {
      "type": "boolean",
      "label": "Enable safety checker",
      "description": "If set to true, the safety checker will be enabled. Disabling it requires account authorization; unauthorized requests are always checked",
      "default": true
    }
  },
  "seedream-4.5-fal": {
    "enable_safety_checker": {
      "type": "boolean",
      "label": "Enable safety checker",
      "description": "If set to true, the safety checker will be enabled. Disabling it requires account authorization; unauthorized requests are always checked",
      "default": true
    }
  },
  "gpt-image-2-fal": {
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "Output format for the images",
      "default": "png",
      "options": [
        "jpeg",
        "png",
        "webp"
      ]
    }
  },
  "recraft-v4-fal": {
    "enable_safety_checker": {
      "type": "boolean",
      "label": "Enable safety checker",
      "description": "If set to true, the safety checker will be enabled.",
      "default": true
    }
  },
  "flux-2-max-fal": {
    "safety_tolerance": {
      "type": "select",
      "label": "Safety tolerance",
      "description": "The safety tolerance level for the generated image. 1 being the most strict and 5 being the most permissive",
      "default": "2",
      "options": [
        "1",
        "2",
        "3",
        "4",
        "5"
      ]
    },
    "enable_safety_checker": {
      "type": "boolean",
      "label": "Enable safety checker",
      "description": "Whether to enable the safety checker. Disabling it requires account authorization; unauthorized requests are always checked",
      "default": true
    },
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "The format of the generated image.",
      "default": "jpeg",
      "options": [
        "jpeg",
        "png"
      ]
    }
  },
  "flux-2-pro-fal": {
    "safety_tolerance": {
      "type": "select",
      "label": "Safety tolerance",
      "description": "The safety tolerance level for the generated image. 1 being the most strict and 5 being the most permissive",
      "default": "2",
      "options": [
        "1",
        "2",
        "3",
        "4",
        "5"
      ]
    },
    "enable_safety_checker": {
      "type": "boolean",
      "label": "Enable safety checker",
      "description": "Whether to enable the safety checker. Disabling it requires account authorization; unauthorized requests are always checked",
      "default": true
    }
  },
  "reve-fal": {
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "Output format for the generated image.",
      "default": "png",
      "options": [
        "png",
        "jpeg",
        "webp"
      ]
    }
  },
  "phota-edit-phota": {
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "The format of the generated image.",
      "default": "jpeg",
      "options": [
        "jpeg",
        "png"
      ]
    }
  },
  "kling-image-v3-fal": {
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "The format of the generated image.",
      "default": "png",
      "options": [
        "jpeg",
        "png",
        "webp"
      ]
    }
  },
  "kling-image-o1-fal": {
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "The format of the generated image.",
      "default": "png",
      "options": [
        "jpeg",
        "png",
        "webp"
      ]
    }
  },
  "kling-image-o3-fal": {
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "The format of the generated image.",
      "default": "png",
      "options": [
        "jpeg",
        "png",
        "webp"
      ]
    },
    "result_type": {
      "type": "select",
      "label": "Result type",
      "description": "Result type. 'single' for one image, 'series' for a series of related images",
      "default": "single",
      "options": [
        "single",
        "series"
      ]
    }
  },
  "z-image-turbo-fal": {
    "acceleration": {
      "type": "select",
      "label": "Acceleration",
      "description": "The acceleration level to use.",
      "default": "regular",
      "options": [
        "none",
        "regular",
        "high"
      ]
    },
    "enable_safety_checker": {
      "type": "boolean",
      "label": "Enable safety checker",
      "description": "If set to true, the safety checker will be enabled.",
      "default": true
    },
    "enable_prompt_expansion": {
      "type": "boolean",
      "label": "Enable prompt expansion",
      "description": "Whether to enable prompt expansion. Note: this will increase the price by 0",
      "default": false
    },
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "The format of the generated image.",
      "default": "png",
      "options": [
        "jpeg",
        "png",
        "webp"
      ]
    }
  },
  "real-esrgan-fal": {
    "model": {
      "type": "select",
      "label": "Model",
      "description": "Model to use for upscaling",
      "default": "RealESRGAN_x4plus",
      "options": [
        "RealESRGAN_x4plus",
        "RealESRGAN_x2plus",
        "RealESRGAN_x4plus_anime_6B",
        "RealESRGAN_x4_v3",
        "RealESRGAN_x4_wdn_v3",
        "RealESRGAN_x4_anime_v3"
      ]
    },
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "Output image format (png or jpeg)",
      "default": "png",
      "options": [
        "png",
        "jpeg"
      ]
    }
  },
  "crystal-upscaler-fal": {
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "Output image format",
      "default": "jpg",
      "options": [
        "png",
        "jpg"
      ]
    }
  },
  "topaz-upscale-fal": {
    "detail": {
      "type": "slider",
      "label": "Detail",
      "description": "Detail recovery level (0.0-1",
      "min": 0,
      "max": 1,
      "step": 0.1
    },
    "texture": {
      "type": "slider",
      "label": "Texture",
      "description": "Texture detail level for generative upscaling (1-5). Applies to Redefine model only",
      "min": 1,
      "max": 5,
      "step": 1
    },
    "fix_compression": {
      "type": "slider",
      "label": "Fix compression",
      "description": "Compression artifact removal level (0.0-1",
      "min": 0,
      "max": 1,
      "step": 0.1
    },
    "strength": {
      "type": "slider",
      "label": "Strength",
      "description": "Enhancement strength (0.01-1",
      "min": 0.01,
      "max": 1,
      "step": 0.1
    },
    "denoise": {
      "type": "slider",
      "label": "Denoise",
      "description": "Denoising level (0.0-1",
      "min": 0,
      "max": 1,
      "step": 0.1
    },
    "subject_detection": {
      "type": "select",
      "label": "Subject detection",
      "description": "Subject detection mode for the image enhancement. Applies to standard enhance and Recovery V2 models",
      "default": "All",
      "options": [
        "All",
        "Foreground",
        "Background"
      ]
    },
    "color_preservation": {
      "type": "boolean",
      "label": "Color preservation",
      "description": "Preserve the source image's colors in the output. Applies to Bloom 2 model only"
    },
    "face_enhancement_creativity": {
      "type": "slider",
      "label": "Face enhancement creativity",
      "description": "Creativity level for face enhancement. 0",
      "default": 0,
      "min": 0,
      "max": 1,
      "step": 0.1
    },
    "sharpen": {
      "type": "slider",
      "label": "Sharpen",
      "description": "Sharpening level (0.0-1",
      "min": 0,
      "max": 1,
      "step": 0.1
    },
    "output_format": {
      "type": "select",
      "label": "Output format",
      "description": "Output format of the upscaled image.",
      "default": "jpeg",
      "options": [
        "jpeg",
        "png"
      ]
    },
    "enhancement_strength": {
      "type": "select",
      "label": "Enhancement strength",
      "description": "Enhancement strength for generative upscaling. Applies to Wonder 3 and Wonder 3",
      "options": [
        "low",
        "medium",
        "high"
      ]
    },
    "crop_to_fill": {
      "type": "boolean",
      "label": "Crop to fill",
      "default": false
    },
    "creativity": {
      "type": "slider",
      "label": "Creativity",
      "description": "Creativity level for generative upscaling. Higher values produce more creative/hallucinated details",
      "min": 1,
      "max": 9,
      "step": 1
    }
  },
  "gemini-omni-fal": {
    "duration": {
      "type": "slider",
      "label": "Duration",
      "description": "The duration of the generated video, in seconds.",
      "default": 8,
      "min": 3,
      "max": 10,
      "step": 1
    },
    "aspect_ratio": {
      "type": "select",
      "label": "Aspect ratio",
      "description": "The aspect ratio of the generated video.",
      "default": "16:9",
      "options": [
        "16:9",
        "9:16"
      ]
    }
  },
  "gemini-omni-ref-fal": {
    "duration": {
      "type": "slider",
      "label": "Duration",
      "description": "The duration of the generated video, in seconds.",
      "default": 8,
      "min": 3,
      "max": 10,
      "step": 1
    },
    "aspect_ratio": {
      "type": "select",
      "label": "Aspect ratio",
      "description": "The aspect ratio of the generated video.",
      "default": "16:9",
      "options": [
        "16:9",
        "9:16"
      ]
    }
  },
  "kling-3-fal": {
    "cfg_scale": {
      "type": "slider",
      "label": "Cfg scale",
      "description": "The CFG (Classifier Free Guidance) scale is a measure of how close you want\n            the model to stick to your prompt.",
      "default": 0.5,
      "min": 0,
      "max": 1,
      "step": 0.1
    },
    "generate_audio": {
      "type": "boolean",
      "label": "Generate audio",
      "description": "Whether to generate native audio for the video. Supports Chinese and English voice output",
      "default": true
    },
    "shot_type": {
      "type": "select",
      "label": "Shot type",
      "description": "The type of multi-shot video generation. 'intelligent' lets the model automatically determine shot structure",
      "default": "customize",
      "options": [
        "customize",
        "intelligent"
      ]
    },
    "aspect_ratio": {
      "type": "select",
      "label": "Aspect ratio",
      "description": "The aspect ratio of the generated video frame",
      "default": "16:9",
      "options": [
        "16:9",
        "9:16",
        "1:1"
      ]
    },
    "duration": {
      "type": "select",
      "label": "Duration",
      "description": "The duration of the generated video in seconds",
      "default": "5",
      "options": [
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "13",
        "14",
        "15"
      ]
    }
  },
  "kling-video-2.6-fal": {
    "cfg_scale": {
      "type": "slider",
      "label": "Cfg scale",
      "description": "The CFG (Classifier Free Guidance) scale is a measure of how close you want\n            the model to stick to your prompt.",
      "default": 0.5,
      "min": 0,
      "max": 1,
      "step": 0.1
    },
    "duration": {
      "type": "select",
      "label": "Duration",
      "description": "The duration of the generated video in seconds",
      "default": "5",
      "options": [
        "5",
        "10"
      ]
    },
    "generate_audio": {
      "type": "boolean",
      "label": "Generate audio",
      "description": "Whether to generate native audio for the video. Supports Chinese and English voice output",
      "default": true
    },
    "aspect_ratio": {
      "type": "select",
      "label": "Aspect ratio",
      "description": "The aspect ratio of the generated video frame",
      "default": "16:9",
      "options": [
        "16:9",
        "9:16",
        "1:1"
      ]
    }
  },
  "kling-o1-i2v-fal": {
    "duration": {
      "type": "select",
      "label": "Duration",
      "description": "Video duration in seconds.",
      "default": "5",
      "options": [
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10"
      ]
    }
  },
  "veo-3.1-fal": {
    "safety_tolerance": {
      "type": "select",
      "label": "Safety tolerance",
      "description": "The safety tolerance level for content moderation. 1 is the most strict (blocks most content), 6 is the least strict",
      "default": "4",
      "options": [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6"
      ]
    },
    "resolution": {
      "type": "select",
      "label": "Resolution",
      "description": "The resolution of the generated video.",
      "default": "720p",
      "options": [
        "720p",
        "1080p",
        "4k"
      ]
    },
    "aspect_ratio": {
      "type": "select",
      "label": "Aspect ratio",
      "description": "Aspect ratio of the generated video",
      "default": "16:9",
      "options": [
        "16:9",
        "9:16"
      ]
    },
    "duration": {
      "type": "select",
      "label": "Duration",
      "description": "The duration of the generated video.",
      "default": "8s",
      "options": [
        "4s",
        "6s",
        "8s"
      ]
    },
    "auto_fix": {
      "type": "boolean",
      "label": "Auto fix",
      "description": "Whether to automatically attempt to fix prompts that fail content policy or other validation checks by rewriting them.",
      "default": true
    },
    "generate_audio": {
      "type": "boolean",
      "label": "Generate audio",
      "description": "Whether to generate audio for the video.",
      "default": true
    }
  },
  "seedance-2-fal": {
    "bitrate_mode": {
      "type": "select",
      "label": "Bitrate mode",
      "description": "Output bitrate mode. 'high' requests a higher-quality, larger-file encode from the model; 'standard' uses the default bitrate",
      "default": "standard",
      "options": [
        "standard",
        "high"
      ]
    },
    "resolution": {
      "type": "select",
      "label": "Resolution",
      "description": "Video resolution - 480p for faster generation, 720p for balance.",
      "default": "720p",
      "options": [
        "480p",
        "720p"
      ]
    },
    "aspect_ratio": {
      "type": "select",
      "label": "Aspect ratio",
      "description": "The aspect ratio of the generated video. Use 16:9 for landscape, 9:16 for portrait/vertical, 1:1 for square, 21:9 for ultrawide cinematic, or auto to infer from the input image",
      "default": "auto",
      "options": [
        "auto",
        "21:9",
        "16:9",
        "4:3",
        "1:1",
        "3:4",
        "9:16"
      ]
    },
    "generate_audio": {
      "type": "boolean",
      "label": "Generate audio",
      "description": "Whether to generate synchronized audio for the video, including sound effects, ambient sounds, and lip-synced speech. The cost of video generation is the same regardless of whether audio is generated or not",
      "default": true
    },
    "duration": {
      "type": "select",
      "label": "Duration",
      "description": "Duration of the video in seconds. Supports 4 to 15 seconds, or auto to let the model decide based on the prompt",
      "default": "auto",
      "options": [
        "auto",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "13",
        "14",
        "15"
      ]
    }
  },
  "seedance-fast-fal": {
    "resolution": {
      "type": "select",
      "label": "Resolution",
      "description": "Video resolution - 480p for faster generation, 720p for balance, 1080p for higher quality",
      "default": "1080p",
      "options": [
        "480p",
        "720p",
        "1080p"
      ]
    },
    "enable_safety_checker": {
      "type": "boolean",
      "label": "Enable safety checker",
      "description": "If set to true, the safety checker will be enabled. Disabling it requires account authorization; unauthorized requests are always checked",
      "default": true
    },
    "aspect_ratio": {
      "type": "select",
      "label": "Aspect ratio",
      "description": "The aspect ratio of the generated video",
      "default": "auto",
      "options": [
        "21:9",
        "16:9",
        "4:3",
        "1:1",
        "3:4",
        "9:16",
        "auto"
      ]
    },
    "num_frames": {
      "type": "slider",
      "label": "Num frames",
      "description": "The number of frames to generate. If provided, will override duration",
      "min": 29,
      "max": 289,
      "step": 1
    },
    "camera_fixed": {
      "type": "boolean",
      "label": "Camera fixed",
      "description": "Whether to fix the camera position",
      "default": false
    },
    "duration": {
      "type": "select",
      "label": "Duration",
      "description": "Duration of the video in seconds",
      "default": "5",
      "options": [
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12"
      ]
    }
  },
  "heygen-avatar4-fal": {
    "talking_style": {
      "type": "select",
      "label": "Talking style",
      "description": "Talking style - 'stable' for minimal movement, 'expressive' for more animation",
      "default": "stable",
      "options": [
        "stable",
        "expressive"
      ]
    },
    "caption": {
      "type": "boolean",
      "label": "Caption",
      "description": "Whether to add captions to the video",
      "default": false
    },
    "aspect_ratio": {
      "type": "select",
      "label": "Aspect ratio",
      "description": "Aspect ratio of the output video. Supported values: '16:9', '9:16', '4:5', '5:4', '1:1', and 'auto'",
      "default": "16:9",
      "options": [
        "16:9",
        "9:16",
        "4:5",
        "5:4",
        "1:1",
        "auto"
      ]
    },
    "resolution": {
      "type": "select",
      "label": "Resolution",
      "description": "Video resolution preset. Options: 360p, 480p, 540p, 720p, 1080p",
      "default": "720p",
      "options": [
        "360p",
        "480p",
        "540p",
        "720p",
        "1080p"
      ]
    },
    "voice": {
      "type": "select",
      "label": "Voice",
      "description": "Name of the voice to use for the avatar",
      "options": [
        "Warm Pro Narrator",
        "Chill Brian",
        "Ivy",
        "John Doe",
        "Monika Sogam",
        "Hope ",
        "Archer ",
        "Brittney",
        "Patrick",
        "David Castlemore",
        "Michael C",
        "Adam Stone ",
        "Juniper",
        "Cassidy ",
        "Jessica Anne Bogart",
        "Arabella",
        "Andrew",
        "Spuds Oxley ",
        "Grace Elder",
        "Helen",
        "Canyon Rivers",
        "Derya - Lifelike - Excited 🤩",
        "Mellow Marcus",
        "Jack Sterling - Broadcaster 🎙️",
        "Brenda - UGC - 1.mp4",
        "Reid",
        "Reagan",
        "Terry",
        "Jenny",
        "Radio Rick",
        "Denise",
        "Tim in car - Excited 🤩",
        "Iskander",
        "Thompson",
        "Delicate Daisy - Excited 🤩",
        "Kingston",
        "George UGC 1",
        "Bold Blake",
        "Jane",
        "Expressive Evan",
        "Marianne - IA",
        "Aaron",
        "Modern Recipe Host - Voice 1",
        "Willow",
        "Cute Chloe - Friendly 😊",
        "Rafael",
        "June - Lifelike",
        "Crisp Chloe",
        "Slick Simon",
        "Nassim - Informative",
        "Baritone Ben",
        "Maxwell",
        "Ellie Faye - Excited 🤩",
        "Milani",
        "Feisty Fiona - Excited 🤩",
        "Professor Dean",
        "Rose - UGC - 1.mp4",
        "Shona",
        "Hudson Wilder",
        "Ann - IA",
        "Alastair Kensington",
        "Oxley",
        "Christina",
        "Andrew Rizz ",
        "Peyton",
        "Gerardo - Outdoor",
        "Chloe - Lifelike",
        "Stephanie",
        "Anthony - IA",
        "Signal - Voice 1",
        "Luca",
        "Lisa - Voice 1",
        "T.W.Tucker",
        "Jack Sullivan - Serious 😐",
        "Winter",
        "Mireia - Lifelike",
        "Georgia",
        "Stella",
        "Masha - Lifelike",
        "Charming Charles - Friendly 😊",
        "Serenity",
        "Annie - Excited",
        "Ralph",
        "Bethany",
        "Dominic",
        "Mason Finn",
        "Leena",
        "Veteran Victor",
        "Tamara",
        "Nik Public",
        "Calm Chloe",
        "Sevik",
        "Reilly",
        "Raul",
        "Imposing Ian",
        "Relaxed Ray",
        "Dexter - Professional",
        "Relaxed Rick",
        "Edwin",
        "Rupert Blackwood",
        "Ginny",
        "Hope"
      ]
    }
  }
};

