---
name: vision-media
description: >
  Rules for computer vision and media processing tasks: command interface
  stability, row/frame/mask alignment, and visual output validation.
  Use for image processing, video analysis, object detection, segmentation,
  or any computer vision task.
---

# Vision Media

## Key Rules

1. **Command interface stability**: When using CLI tools (ffmpeg, ImageMagick,
   OpenCV CLI), verify the output format before further processing.
2. **Row/frame/mask alignment**: Ensure that coordinates, dimensions, and
   masks are properly aligned between input and output. Verify shape
   consistency after transformations.
3. **Visual output validation**: Always verify generated images or videos
   by checking dimensions, color channels, and file integrity.
4. **Coordinate systems**: Be explicit about coordinate conventions
   (row-major vs column-major, y-up vs y-down, center vs corner).

## Setup

```bash
# Install common vision libraries as needed:
pip install opencv-python pillow matplotlib numpy
```

## Usage

See [output-validation](references/output-validation.md) for procedures
to validate visual outputs.

---

## Pseudocode

```
SKILL vision-media

INPUTS:
  mediaType: string         // image, video, mask, segmentation
  inputFormat: string       // png, jpg, mp4, nifti, dicom
  processingOp: string      // transform, detect, segment, classify
  dimensions?: object       // Expected width, height, channels

OUTPUTS:
  processedMedia: binary    // Processed image/video data
  validationReport: object
  //   dimensions_match: bool
  //   color_channels: int
  //   file_integrity: bool
  coordinateSystem: string  // row-major or col-major, y-up or y-down

PRECONDITIONS:
  - Input file integrity confirmed before processing
  - Coordinate system explicitly declared
  - Output format compatible with intended use

POSTCONDITIONS:
  - Output dimensions match expected specification
  - Color channels preserved or explicitly converted
  - File integrity verified after processing
  - Coordinate convention consistent between input and output

ERROR_HANDLING:
  - If input file corrupt -> abort with integrity report
  - If dimension mismatch -> reshape or error with details
  - If CLI tool produces unexpected output -> re-verify format
```
