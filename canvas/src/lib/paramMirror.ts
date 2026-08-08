import type { ParamSchema } from "../types";

/**
 * Provider parameters mirrored into the canvas.
 *
 * Generated from each fal endpoint's published input schema. Only keys the
 * catalog (models.param_schema) does not already define appear here, so curated
 * labels and size lists always win. Fields the provider leaves unset carry no
 * default and are only sent once the user changes them.
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
  }
};

